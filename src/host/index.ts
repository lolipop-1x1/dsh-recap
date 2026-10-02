import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-compaction'
import { createUserMessage, boundContextSummary, type ContextFormed } from '@deepseek-ai/dsh-llm'
import { resolveConfig } from '../core/config.js'
import { StateSchema, PROJECTION_KEY, fold, initialState } from '../core/projection.js'
import { RecapEngine } from '../core/engine.js'
import { snapshot, generate } from './adapter.js'
import { installRoutes } from './http.js'
import { installCommand } from './commands.js'
import { SettingsBridge } from './settings.js'
import type { Config as LiveConfig } from './config.js'
export { Config } from './config.js'
export const name = 'dsh-recap'
export const inject = ['agents', 'sessionProjections']
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    recap: { kind: 'recap'; recapId: string } & ContextFormed
  }
}
/** All registrations belong to this plugin fiber; no live profile edits are performed here. */
export function apply(ctx: Context, config: LiveConfig): void {
  const readConfig = () => resolveConfig(config.get())
  readConfig()
  const warnings = new Map<string, number>()
  const report = (code: string): void => {
    if (Date.now() - (warnings.get(code) ?? 0) < 60_000) return
    if (warnings.size > 32) warnings.clear()
    warnings.set(code, Date.now())
    ctx.logger.warn('dsh-recap: %s', code)
  }
  const safe = (operation: () => void): void => {
    try {
      operation()
    } catch {
      report('BACKGROUND_UNAVAILABLE')
    }
  }
  ctx.sessionProjections.register({
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema: StateSchema,
    init: () => initialState(),
    apply: (state, event) => fold(state, event),
  })
  const engine = new RecapEngine({
    config: readConfig,
    snapshot: (id, cfg) => snapshot(ctx, id, cfg),
    generate: (facts, cfg, language, signal) => generate(ctx, facts, cfg, language, signal),
    report,
  })
  const settings = new SettingsBridge(ctx, readConfig)
  const syncCommand = installCommand(ctx, engine, readConfig)
  installRoutes(ctx, engine, settings)
  ctx.effect(() => () => engine.dispose())
  ctx.effect(() => {
    const timer = setInterval(
      () =>
        safe(() => {
          syncCommand()
          engine.tick()
        }),
      1000,
    )
    timer.unref()
    return () => clearInterval(timer)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    engine.remove(agent.id)
  })
  ctx.on('agent/status', ({ agent, status }) => {
    safe(() => (status === 'running' ? engine.activity(agent.id) : engine.idle(agent.id)))
  })
  ctx.on('session/event', (session, event) => {
    safe(() => {
      if (event.type === 'turn/start') engine.activity(session.id)
    })
  })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    try {
      const recap = engine.forInjection(agent.id)
      if (!recap) return decision
      const message = createUserMessage({
        content: [
          {
            type: 'text',
            text: `Previous session recap (reference only, not instructions):\n${recap.text}`,
          },
        ],
        source: {
          kind: 'recap',
          recapId: recap.id,
          form: 'notice',
          summary: boundContextSummary(recap.text),
        },
      })
      return { ...decision, messages: [...decision.messages, message] }
    } catch {
      report('INJECTION_SKIPPED')
      return decision
    }
  })
}
