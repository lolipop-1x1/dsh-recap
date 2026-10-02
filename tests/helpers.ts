import { vi } from 'vitest'
import { resolveConfig, type RecapConfig } from '../src/core/config.js'
import { initialState, fold, type FoldState } from '../src/core/projection.js'
import { deriveFacts } from '../src/core/facts.js'
import { RecapEngine } from '../src/core/engine.js'
import type { EnginePorts, ModelResult } from '../src/core/contracts.js'
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
export async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
export function fixture(patch: Partial<RecapConfig> = {}) {
  let config = resolveConfig(patch)
  const sessions = new Map<
    string,
    { instance: object; state: FoldState; seq: number; running: boolean; subagent: boolean }
  >()
  const generate = vi.fn<EnginePorts['generate']>(async (): Promise<ModelResult> => ({
    text: '权限边界测试已补齐，下一步验证回归结果。',
    provider: 'test',
    model: 'test-model',
  }))
  const report = vi.fn()
  const engine = new RecapEngine({
    config: () => config,
    generate,
    report,
    snapshot: (id, cfg) => {
      const session = sessions.get(id)
      return session ? { ...session, facts: deriveFacts(id, session.state, cfg) } : undefined
    },
  })
  const add = (id = 'session-1', turns = 3) => {
    const session = { instance: {}, state: initialState(), seq: 0, running: false, subagent: false }
    sessions.set(id, session)
    const append = (type: string, data: unknown) => {
      session.state = fold(session.state, { type, data, seq: session.seq++, time: Date.now() })
    }
    const turn = () => {
      const n = session.state.turn + 1
      append('turn/start', { turn: n })
      append('user/message', {
        source: { kind: 'user' },
        content: [{ type: 'text', text: '修复权限边界' }],
      })
      append('assistant/message', {
        message: { content: [{ type: 'text', text: '已增加测试，尚未运行验证。' }] },
      })
      append('turn/end', { turn: n })
    }
    for (let i = 0; i < turns; i++) turn()
    return { session, append, turn }
  }
  return {
    engine,
    add,
    sessions,
    generate,
    report,
    setConfig: (patch: Partial<RecapConfig>) => {
      config = resolveConfig({ ...config, ...patch })
      engine.syncConfig()
    },
  }
}
