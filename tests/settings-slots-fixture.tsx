import React, { useSyncExternalStore } from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as JSXRuntime from 'react/jsx-runtime'
import * as Cordis from '@deepseek-ai/cordis'
import * as Slots from '@deepseek-ai/dsh-client-ui-slots'
import type * as Renderer from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import * as Recap from '../src/client/index.js'
import { FIELDS, resolveConfig } from '../src/core/config.js'
import type { SettingsView } from '../src/core/api.js'

type Registration = {
  id: string
  factory(require: (id: string) => unknown): unknown
}
const globals = globalThis as typeof globalThis & {
  __ModuleLoader__: { load(registration: Registration): void }
  startSettingsSlots(): Promise<void>
  settingsSlotsTest: {
    language(value: string): void
    holdNextSave(): void
    finishSave(): void
    captureInput(): void
    snapshot(): {
      reads: number
      saves: number
      aborted: number
      lastPatch: unknown
      pending: boolean
      sameEntry: boolean
      sameInput: boolean
      entries: number
      styles: number
      localeListeners: number
      value: number
    }
    unloadPlugin(): Promise<void>
    dispose(): Promise<void>
  }
}

// Supply one shared React/Cordis/SlotCore instance to the SDK's real ModuleLoader factory.
// The fixture does not reproduce the renderer's entry-key or lifecycle logic.
const dependencies: Record<string, unknown> = {
  react: React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'react/jsx-runtime': JSXRuntime,
  '@deepseek-ai/cordis': Cordis,
  '@deepseek-ai/dsh-client-ui-slots': Slots,
}
let renderer: typeof Renderer | undefined

globals.__ModuleLoader__ = {
  load({ id, factory }) {
    if (id !== '@deepseek-ai/dsh-client-ui-renderer') throw new Error(`Unexpected module: ${id}`)
    renderer = factory((name) => {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unknown SDK dependency: ${name}`)
      return dependencies[name]
    }) as typeof Renderer
  },
}

globals.startSettingsSlots = async () => {
  if (!renderer) throw new Error('Load the SDK renderer before starting the fixture.')
  const ctx = new Cordis.Context(),
    localeListeners = new Set<() => void>()
  let localeSnapshot: LocaleSnapshot = {
    active: 'zh',
    locales: [
      { id: 'en', label: 'English' },
      { id: 'zh', label: '中文', fallback: 'en' },
    ],
    revision: 0,
  }
  let config = resolveConfig({}),
    revision = 0,
    holdSave = false,
    pendingSave: (() => void) | undefined,
    capturedInput: Element | null = null
  const calls: { route: string; body: Record<string, unknown>; aborted: boolean }[] = []
  const settings = (): SettingsView => ({
    config,
    fields: FIELDS,
    revision,
    namespace: 'synthetic-recap',
    writable: true,
  })
  const originalFetch = window.fetch
  window.fetch = async (input, init) => {
    const route = String(input).split('/').at(-1) ?? '',
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      call = { route, body, aborted: false }
    calls.push(call)
    if (route === 'settings') return Response.json({ ok: true, data: settings() })
    if (route !== 'save-settings') throw new Error(`Unexpected request: ${route}`)
    if (body.revision !== revision) throw new Error('Unexpected settings revision.')
    const complete = (): Response => {
      config = resolveConfig({ ...config, ...(body.patch as object) })
      revision++
      return Response.json({ ok: true, data: settings() })
    }
    if (!holdSave) return complete()
    holdSave = false
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal
      const cleanup = (): void => {
        signal?.removeEventListener('abort', abort)
        pendingSave = undefined
      }
      const abort = (): void => {
        call.aborted = true
        cleanup()
        reject(new DOMException('Synthetic save cancelled.', 'AbortError'))
      }
      if (signal?.aborted) return abort()
      signal?.addEventListener('abort', abort, { once: true })
      pendingSave = () => {
        cleanup()
        resolve(complete())
      }
    })
  }

  class Locale extends Cordis.Service {
    constructor(owner: Cordis.Context) {
      super(owner, 'locale')
    }
    getSnapshot() {
      return localeSnapshot
    }
    subscribe(listener: () => void) {
      localeListeners.add(listener)
      return () => {
        localeListeners.delete(listener)
      }
    }
  }
  await ctx.plugin(Locale)
  await ctx.plugin(renderer)
  const slots = ctx.slots,
    subscribeLocale = (listener: () => void) => ctx.locale.subscribe(listener),
    activeLocale = () => ctx.locale.getSnapshot().active
  const absent = { key: undefined, hooks: {}, keyedHooks: {}, props: {} },
    current = { getSnapshot: () => absent, subscribe: () => () => {} }
  ctx.slots.installScope('session', { current, bindingSource: () => current })
  function Shell({ renderSlot }: Slots.PropsRenderSlots<'settings.section'>) {
    useSyncExternalStore(subscribeLocale, activeLocale)
    useSyncExternalStore(
      (listener) => ctx.slots.subscribe('settings.section', listener),
      () => ctx.slots.getVersion('settings.section'),
    )
    return (
      <main>
        <nav aria-label="Settings sections">
          {ctx.slots.entries('settings.section').map((entry) => (
            <span key={entry.options.id}>{Slots.resolveSlotLabel(entry.options.label)}</span>
          ))}
        </nav>
        {renderSlot('settings.section', { close: () => {} })}
      </main>
    )
  }
  ctx.slots.register(
    { name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } },
    Shell,
  )
  const fiber = await ctx.plugin(Recap),
    entry = ctx.slots.entries('settings.section')[0],
    container = document.getElementById('root')
  if (!container || !entry) throw new Error('The settings slot did not register.')
  const unmount = ctx.uiRenderer.mount(container)
  globals.settingsSlotsTest = {
    language(value) {
      localeSnapshot = { ...localeSnapshot, active: value, revision: localeSnapshot.revision + 1 }
      for (const listener of [...localeListeners]) listener()
      ctx.emit('locale/change', localeSnapshot)
    },
    holdNextSave() {
      if (pendingSave) throw new Error('A synthetic save is already pending.')
      holdSave = true
    },
    finishSave() {
      if (!pendingSave) throw new Error('No synthetic save is pending.')
      pendingSave()
    },
    captureInput() {
      capturedInput = document.getElementById('dshr-setting-idleMinutes')
      if (!capturedInput) throw new Error('The settings input is not mounted.')
    },
    snapshot() {
      return {
        reads: calls.filter((call) => call.route === 'settings').length,
        saves: calls.filter((call) => call.route === 'save-settings').length,
        aborted: calls.filter((call) => call.aborted).length,
        lastPatch: calls.findLast((call) => call.route === 'save-settings')?.body.patch,
        pending: Boolean(pendingSave),
        sameEntry: slots.entries('settings.section')[0] === entry,
        sameInput: document.getElementById('dshr-setting-idleMinutes') === capturedInput,
        entries: slots.entries('settings.section').length,
        styles: document.querySelectorAll('style[data-dsh-recap]').length,
        localeListeners: localeListeners.size,
        value: config.idleMinutes,
      }
    },
    async unloadPlugin() {
      await fiber.dispose()
    },
    async dispose() {
      unmount()
      await ctx.fiber.dispose()
      window.fetch = originalFetch
    },
  }
}
