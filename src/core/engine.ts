import { RecapError, languageOf, type RecapConfig, type Language } from './config.js'
import { factualSummary, hasFacts, type Facts } from './facts.js'
import { line, errorCode } from './text.js'
import { WorkGate, raceAbort } from './async.js'
import { Presence } from './presence.js'
import type {
  EnginePorts,
  LiveSnapshot,
  Recap,
  Trigger,
  ViewState,
  PresenceMessage,
} from './contracts.js'
interface Task {
  epoch: number
  signature: string
  facts: Facts
  language: Language
  automatic: boolean
  controller: AbortController
  promise: Promise<ViewState>
  waiters: number
  done: boolean
}
interface Entry {
  id: string
  instance: object
  epoch: number
  revision: number
  locale: string
  status: ViewState['status']
  recap: Recap | null
  recapSignature?: string
  error: string | null
  task?: Task
  pending?: Trigger
  nextAutoAt: number
  displayTurn: number | null
  presentation: number
  presence: Presence
}
export class RecapEngine {
  private config: RecapConfig
  private signature: string
  private readonly entries = new Map<string, Entry>()
  private readonly dismissed = new WeakSet<object>()
  private readonly gate: WorkGate
  private closed = false
  private serial = 0
  constructor(private readonly ports: EnginePorts) {
    this.config = ports.config()
    this.signature = contentSignature(this.config)
    this.gate = new WorkGate(() => this.config.maxConcurrent)
  }
  private now(): number {
    return this.ports.now?.() ?? Date.now()
  }
  syncConfig(): void {
    const config = this.ports.config(),
      signature = contentSignature(config)
    if (JSON.stringify(config) === JSON.stringify(this.config)) return
    const changed = signature !== this.signature
    this.config = config
    this.signature = signature
    for (const entry of this.entries.values()) {
      if (changed) this.cancel(entry)
      else if ((!config.autoEnabled || !config.onIdle) && entry.task?.automatic) {
        // Retire automatic demand without cancelling manual consumers of shared work.
        entry.task.automatic = false
        if (entry.task.waiters === 0) this.cancel(entry)
      }
      entry.pending = undefined
      entry.presence.reset()
      entry.revision++
    }
    this.trim()
    this.gate.drain()
  }
  private live(id: string): LiveSnapshot {
    if (this.closed) throw new RecapError('UNAVAILABLE', 'Plugin is unloaded.', 503)
    const live = this.ports.snapshot(id, this.config)
    if (!live) throw new RecapError('NOT_LIVE', 'This session is not loaded.', 404)
    return live
  }
  private entry(id: string, live: LiveSnapshot): Entry {
    let entry = this.entries.get(id)
    if (entry && entry.instance !== live.instance) {
      this.cancel(entry)
      this.entries.delete(id)
      entry = undefined
    }
    if (!entry) {
      entry = {
        id,
        instance: live.instance,
        epoch: 0,
        revision: 0,
        locale: '',
        status: 'empty',
        recap: null,
        error: null,
        nextAutoAt: 0,
        displayTurn: null,
        presentation: 0,
        presence: new Presence(this.now()),
      }
    }
    this.entries.delete(id)
    this.entries.set(id, entry)
    this.trim()
    return entry
  }
  private trim(): void {
    while (this.entries.size > this.config.maxSessions) {
      const id = this.entries.keys().next().value
      if (id === undefined) break
      this.remove(id)
    }
  }
  private language(entry: Entry, facts: Facts): Language {
    const fallback = /\p{Script=Han}/u.test(facts.latestRequest) ? 'zh' : 'en'
    return languageOf(this.config, entry.locale || fallback)
  }
  private view(entry: Entry, live?: LiveSnapshot, clientId?: string): ViewState {
    const snapshot = live ?? (this.closed ? undefined : this.ports.snapshot(entry.id, this.config))
    return {
      sessionId: entry.id,
      status: entry.status,
      revision: entry.revision,
      hidden:
        this.dismissed.has(entry.instance) ||
        entry.displayTurn === null ||
        (!!clientId && !entry.presence.canDisplay(clientId, entry.presentation)),
      displayTurn: entry.displayTurn,
      stale:
        entry.recap !== null &&
        (entry.recapSignature !== this.signature ||
          !snapshot ||
          entry.recap.watermark !== snapshot.facts.watermark ||
          entry.recap.language !== this.language(entry, snapshot.facts)),
      recap: entry.recap,
      error: entry.error,
      autoEnabled: this.config.autoEnabled,
    }
  }
  state(id: string, clientId?: string): ViewState {
    this.syncConfig()
    const live = this.live(id)
    return this.view(this.entry(id, live), live, clientId)
  }
  private cancel(entry: Entry): void {
    entry.epoch++
    entry.task?.controller.abort(new RecapError('CANCELLED', 'Session changed.', 409))
    entry.task = undefined
    entry.status = entry.recap ? 'ready' : 'empty'
    entry.revision++
  }
  activity(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.cancel(entry)
    entry.displayTurn = null
    entry.pending = undefined
    entry.presence.activity(this.now())
  }
  idle(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    const pending = entry.pending
    entry.pending = undefined
    if (entry.status === 'busy') entry.status = entry.recap ? 'ready' : 'empty'
    entry.presence.activity(this.now())
    if (pending && entry.presence.isVisible(this.now())) this.background(id, pending)
  }
  request(
    id: string,
    trigger: Trigger,
    options: { force?: boolean; signal?: AbortSignal } = {},
  ): Promise<ViewState> {
    this.syncConfig()
    const live = this.live(id),
      entry = this.entry(id, live),
      facts = live.facts
    const manual = trigger === 'manual',
      language = this.language(entry, facts)
    if (manual) this.dismissed.delete(entry.instance)
    if (live.subagent) {
      entry.status = 'disabled'
      entry.error = 'SUBAGENT'
      return Promise.resolve(this.view(entry, live))
    }
    if (
      !manual &&
      (!this.config.autoEnabled ||
        !this.config.onIdle ||
        !entry.presence.isVisible(this.now()) ||
        this.dismissed.has(entry.instance) ||
        facts.completedTurns < this.config.minTurns)
    )
      return Promise.resolve(this.view(entry, live))
    if (!hasFacts(facts)) {
      entry.status = 'empty'
      entry.error = 'NO_DATA'
      return Promise.resolve(this.view(entry, live))
    }
    if (live.running) {
      entry.status = 'busy'
      entry.revision++
      return Promise.resolve(this.view(entry, live))
    }
    if (manual) this.present(entry, facts.turn, true)
    const recap = entry.recap
    if (
      !options.force &&
      entry.recapSignature === this.signature &&
      recap?.language === language &&
      (recap.watermark === facts.watermark ||
        (!manual &&
          this.config.cacheTtlTurns > 0 &&
          facts.turn >= recap.turn &&
          facts.turn - recap.turn < this.config.cacheTtlTurns))
    ) {
      // Opening stays quiet; an eligible request explicitly presents the retained evidence here.
      this.present(entry, facts.turn)
      return Promise.resolve(this.view(entry, live))
    }
    if (
      entry.task &&
      entry.task.facts.watermark === facts.watermark &&
      entry.task.language === language
    ) {
      return this.consume(entry.task, options.signal, manual)
    }
    if (entry.task) this.cancel(entry)
    if (!manual && this.now() < entry.nextAutoAt) {
      entry.pending = trigger
      return Promise.resolve(this.view(entry, live))
    }
    if (!manual) this.present(entry, facts.turn, true)
    if (this.config.mode === 'deterministic') {
      const text = factualSummary(facts, language, this.config.oneLineMaxChars)
      if (text) this.commit(entry, facts, language, text, 'facts')
      else {
        entry.error = 'NO_STRUCTURED_DATA'
        entry.status = 'error'
      }
      return Promise.resolve(this.view(entry, live))
    }
    const task: Task = {
      epoch: entry.epoch,
      signature: this.signature,
      facts,
      language,
      automatic: !manual,
      controller: new AbortController(),
      promise: Promise.resolve(this.view(entry, live)),
      waiters: 0,
      done: false,
    }
    entry.task = task
    entry.status = 'queued'
    entry.error = null
    entry.revision++
    entry.nextAutoAt = this.now() + this.config.autoCooldownSeconds * 1000
    const config = this.config
    task.promise = this.gate
      .run(task.controller.signal, manual, () => this.execute(entry, task, config))
      .catch((error: unknown) => this.failed(entry, task, error))
      .finally(() => {
        task.done = true
        if (entry.task === task) {
          entry.task = undefined
          if (entry.status === 'queued' || entry.status === 'generating')
            entry.status = entry.recap ? 'ready' : 'empty'
          entry.revision++
        }
      })
    return this.consume(task, options.signal, manual)
  }
  private consume(
    task: Task,
    signal: AbortSignal | undefined,
    manual: boolean,
  ): Promise<ViewState> {
    if (!manual) {
      task.automatic = true
      return task.promise
    }
    if (!signal?.aborted) this.gate.promote(task.controller.signal)
    task.waiters++
    const promise = signal ? raceAbort(task.promise, signal) : task.promise
    return promise.finally(() => {
      task.waiters--
      if (!task.done && !task.automatic && task.waiters === 0)
        task.controller.abort(new RecapError('CANCELLED', 'No remaining consumers.', 409))
    })
  }
  private current(entry: Entry, task: Task): boolean {
    try {
      this.syncConfig()
      const live = this.ports.snapshot(entry.id, this.config)
      return (
        !this.closed &&
        this.entries.get(entry.id) === entry &&
        entry.task === task &&
        entry.epoch === task.epoch &&
        task.signature === this.signature &&
        live?.instance === entry.instance &&
        !live.running &&
        (!task.automatic || task.waiters > 0 || entry.presence.isVisible(this.now())) &&
        live.facts.watermark === task.facts.watermark &&
        this.language(entry, live.facts) === task.language
      )
    } catch {
      return false
    }
  }
  private async execute(entry: Entry, task: Task, config: RecapConfig): Promise<ViewState> {
    if (!this.current(entry, task)) throw new RecapError('CANCELLED', 'Session changed.', 409)
    entry.status = 'generating'
    entry.revision++
    const timeout = setTimeout(
      () => task.controller.abort(new RecapError('TIMEOUT', 'Recap generation timed out.', 504)),
      config.timeoutSeconds * 1000,
    )
    try {
      const result = await raceAbort(
        this.ports.generate(task.facts, config, task.language, task.controller.signal),
        task.controller.signal,
      )
      if (!this.current(entry, task)) throw new RecapError('CANCELLED', 'Session changed.', 409)
      if (Array.from(result.text).length > 8000)
        throw new RecapError('OUTPUT_TOO_LARGE', 'Recap exceeds the safety limit.', 502)
      const text = line(result.text, 8000)
      if (!text) throw new RecapError('EMPTY_RESPONSE', 'The model returned no text.', 502)
      this.commit(
        entry,
        task.facts,
        task.language,
        text,
        'model',
        null,
        result.provider,
        result.model,
      )
      return this.view(entry)
    } finally {
      clearTimeout(timeout)
    }
  }
  private failed(entry: Entry, task: Task, error: unknown): ViewState {
    const code = errorCode(error)
    if (code === 'CANCELLED' || !this.current(entry, task))
      return { ...this.view(entry), error: 'CANCELLED' }
    this.ports.report?.(code)
    entry.error = code
    entry.status = 'error'
    entry.displayTurn = task.facts.turn
    entry.revision++
    return this.view(entry)
  }
  private present(entry: Entry, turn: number, fresh = false): void {
    if (fresh) entry.presentation++
    if (entry.displayTurn === turn && !fresh) return
    entry.displayTurn = turn
    entry.revision++
  }
  private commit(
    entry: Entry,
    facts: Facts,
    language: Language,
    text: string,
    source: Recap['source'],
    warning: string | null = null,
    provider: string | null = null,
    model: string | null = null,
  ): void {
    entry.recap = {
      id: `${facts.watermark}:${this.now()}:${++this.serial}`,
      text: line(text, 8000),
      source,
      generatedAt: this.now(),
      watermark: facts.watermark,
      turn: facts.turn,
      language,
      warning,
      provider,
      model,
    }
    entry.recapSignature = this.signature
    entry.displayTurn = facts.turn
    entry.status = 'ready'
    entry.error = null
    entry.revision++
    entry.pending = undefined
  }
  background(id: string, trigger: Trigger, force = false): void {
    try {
      this.syncConfig()
      if (trigger !== 'manual' && (!this.config.autoEnabled || !this.config.onIdle)) return
      void this.request(id, trigger, { force }).catch((error: unknown) =>
        this.ports.report?.(errorCode(error)),
      )
    } catch (error) {
      this.ports.report?.(errorCode(error))
    }
  }
  presence(id: string, message: PresenceMessage): ViewState {
    this.syncConfig()
    const live = this.live(id),
      entry = this.entry(id, live)
    const result = entry.presence.update(message, this.now(), entry.presentation)
    if (!result.accepted) return this.view(entry, live, message.clientId)
    if (message.locale && entry.locale !== message.locale) {
      entry.locale = message.locale
      entry.revision++
      if (entry.task && entry.task.language !== this.language(entry, live.facts)) this.cancel(entry)
    }
    if (message.closed && !entry.presence.hasOpen() && entry.displayTurn !== null) {
      entry.displayTurn = null
      entry.revision++
      if (entry.task) this.cancel(entry)
    }
    if (!entry.presence.isVisible(this.now())) {
      entry.pending = undefined
      if (entry.task?.automatic && entry.task.waiters === 0) this.cancel(entry)
    }
    return this.view(entry, live, message.clientId)
  }
  dismiss(id: string): ViewState {
    this.syncConfig()
    const entry = this.entry(id, this.live(id))
    this.dismissed.add(entry.instance)
    this.cancel(entry)
    entry.pending = undefined
    return this.view(entry)
  }
  tick(): void {
    if (this.closed) return
    this.syncConfig()
    for (const entry of [...this.entries.values()]) {
      if (!entry.presence.isVisible(this.now())) {
        entry.pending = undefined
        if (entry.task?.automatic && entry.task.waiters === 0) this.cancel(entry)
        continue
      }
      const due = entry.presence.due(this.now(), this.config)
      if (due) this.background(entry.id, due)
      const pending = entry.pending
      if (pending && entry.status !== 'busy' && !entry.task && this.now() >= entry.nextAutoAt) {
        entry.pending = undefined
        this.background(entry.id, pending)
      }
    }
  }
  forInjection(id: string): Recap | null {
    this.syncConfig()
    const entry = this.entries.get(id)
    if (!this.config.injectToModel || !entry?.recap || this.dismissed.has(entry.instance))
      return null
    const live = this.ports.snapshot(id, this.config)
    if (
      !live ||
      live.instance !== entry.instance ||
      live.facts.lastInjectedId === entry.recap.id ||
      this.view(entry, live).stale
    )
      return null
    return entry.recap
  }
  remove(id: string): void {
    const entry = this.entries.get(id)
    if (entry) {
      this.cancel(entry)
      entry.pending = undefined
      this.entries.delete(id)
    }
  }
  dispose(): void {
    if (this.closed) return
    this.closed = true
    for (const id of [...this.entries.keys()]) this.remove(id)
    this.gate.close()
  }
  inspect(): { cached: number; active: number; queued: number } {
    return { cached: this.entries.size, active: this.gate.size, queued: this.gate.queued }
  }
}

// 调度设置不改变摘要内容，不应使缓存或正在展示的结果失效。
function contentSignature(config: RecapConfig): string {
  return JSON.stringify([
    config.mode,
    config.provider,
    config.model,
    config.language,
    config.maxTokens,
    config.maxSourceMessages,
    config.maxSourceChars,
    config.timeoutSeconds,
    config.oneLineMaxChars,
  ])
}
