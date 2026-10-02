import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import ProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as Plugin from '../src/host/index.js'
import { snapshot } from '../src/host/adapter.js'
// Use the locked SDK's real projection fold without starting its full Session Controller.
import { installModelSelectionProjection } from '../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/model-selection-projection.js'
import { resolveConfig, type RecapConfig } from '../src/core/config.js'
import { deferred, flush } from './helpers.js'
import type { ViewState } from '../src/core/contracts.js'
async function mount(patch: Partial<RecapConfig> = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(ProjectionRegistry)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('real-session'))
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    options: { provider: 'session-provider', model: 'session-model' },
  } as Agent
  await ctx.plugin((inner: Context) => {
    Object.assign(agent, { ctx: createScope(inner, agent).ctx })
  })
  ctx.provide('agents', {
    get: (id: string) => (id === agent.id ? agent : undefined),
  } as unknown as Context['agents'])
  const stream = vi.fn((_options: GenerateOptions): AsyncIterable<StreamChunk> =>
    (async function* () {
      yield {
        type: 'text-delta',
        index: 0,
        text: '已定位权限边界，下一步运行验证。',
      } as StreamChunk
      yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
    })(),
  )
  ctx.provide('llm', { stream } as unknown as Context['llm'])
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  ctx.provide('connection', {
    fetch: {
      register: (spec: { path: string; fetch: (request: Request) => Promise<Response> }) => {
        routes.set(spec.path, spec.fetch)
        return () => routes.delete(spec.path)
      },
    },
  } as unknown as Context['connection'])
  const fiber = await ctx.plugin(Plugin, { ...resolveConfig(patch), minTurns: 0 })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: '修复权限问题' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const command = (text: string) =>
    ctx.commands.execute(agent, text, [], new AbortController().signal)
  const read = async (): Promise<ViewState> => {
    const response = await routes.get('/api/dsh-recap/state')!(
      new Request('http://localhost/api/dsh-recap/state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: agent.id }),
      }),
    )
    return ((await response.json()) as { data: ViewState }).data
  }
  const ready = async () => {
    await flush()
    return read()
  }
  return { ctx, agent, session, fiber, stream, command, read, ready }
}
describe('real Cordis, Session, Projection and Command services', () => {
  it('acknowledges a slow recap before model completion and publishes one current result', async () => {
    const f = await mount(),
      wait = deferred<void>()
    onTestFinished(() => wait.resolve())
    f.stream.mockImplementationOnce(() =>
      (async function* () {
        await wait.promise
        yield { type: 'text-delta', index: 0, text: '慢响应测试完成。' } as StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      })(),
    )
    let accepted = false
    const pending = f.command('/recap').then((result) => {
      accepted = true
      return result
    })
    await flush()
    expect(accepted).toBe(true)
    expect((await pending)?.result.text).toContain('已受理')
    expect((await f.read()).status).toBe('generating')
    wait.resolve()
    const state = await f.ready()
    expect(state.status).toBe('ready')
    expect(state.hidden).toBe(false)
    expect(state.recap?.text).toBe('慢响应测试完成。')
  })
  it('loads the Host plugin and runs /recap through the real command registry', async () => {
    const f = await mount()
    expect(f.ctx.commands.list(f.agent).some((row) => row.name === 'recap')).toBe(true)
    const result = await f.command('/recap')
    expect(result?.result.kind).toBe('success')
    expect(result?.result.text).toMatch(/已受理|已就绪/)
    expect((await f.ready()).recap?.text).toContain('权限边界')
    expect(f.stream).toHaveBeenCalledTimes(1)
    expect(f.stream.mock.calls[0]?.[0]).toMatchObject({
      provider: 'session-provider',
      model: 'session-model',
    })
    expect(f.stream.mock.calls[0]?.[0]).not.toHaveProperty('purpose')
    expect(f.stream.mock.calls[0]?.[0]).not.toHaveProperty('tools')
  })
  it('keeps derived model messages identical by default', async () => {
    const f = await mount()
    const before = f.session.deriveMessages()
    await f.command('/recap')
    await f.command('/recap refresh')
    expect(f.session.deriveMessages()).toEqual(before)
  })
  it('uses explicit provider and model together when configured', async () => {
    const f = await mount({ provider: 'override', model: 'small-model' })
    await f.command('/recap')
    expect(f.stream.mock.calls[0]?.[0]).toMatchObject({
      provider: 'override',
      model: 'small-model',
    })
  })
  it.each([false, true])(
    'honors pending session model selection without consuming it (override: %s)',
    async (override) => {
      const f = await mount(override ? { provider: 'override', model: 'small-model' } : {})
      installModelSelectionProjection(f.ctx)
      f.session.append('turn/start', { turn: 2 })
      f.session.append('step/start', { turn: 2, step: 2 })
      f.session.append('request/header', {
        header: { config: { provider: 'previous-provider', model: 'previous-model' } },
        reason: 'initial',
      })
      f.session.append('step/end', { turn: 2, step: 2 })
      f.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
      const selected = { provider: 'selected-provider', model: 'selected-model' }
      f.session.append('model/selection', selected)
      const before = f.ctx.sessionProjections.stateOf(f.session, 'modelSelection')
      expect(before?.pending).toEqual(selected)
      await f.command('/recap refresh')
      await f.ready()
      expect(f.stream.mock.calls[0]?.[0]).toMatchObject(
        override ? { provider: 'override', model: 'small-model' } : selected,
      )
      expect(f.ctx.sessionProjections.stateOf(f.session, 'modelSelection')).toEqual(before)
      expect(f.session.requestHeader()?.config).toMatchObject({
        provider: 'previous-provider',
        model: 'previous-model',
      })
      expect(f.agent.options).toMatchObject({
        provider: 'session-provider',
        model: 'session-model',
      })
    },
  )
  it('uses the historical complete route when no model selection is pending', async () => {
    const f = await mount()
    installModelSelectionProjection(f.ctx)
    f.session.append('turn/start', { turn: 2 })
    f.session.append('step/start', { turn: 2, step: 2 })
    f.session.append('request/header', {
      header: { config: { provider: 'previous-provider', model: 'previous-model' } },
      reason: 'initial',
    })
    f.session.append('step/end', { turn: 2, step: 2 })
    f.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await f.command('/recap refresh')
    await f.ready()
    expect(f.stream.mock.calls[0]?.[0]).toMatchObject({
      provider: 'previous-provider',
      model: 'previous-model',
    })
  })
  it('removes the command and the projection on plugin unload', async () => {
    const f = await mount()
    await f.command('/recap')
    await f.fiber.dispose()
    expect(f.ctx.commands.find(f.agent, 'recap')).toBeUndefined()
    expect(f.ctx.sessionProjections.stateOf(f.session, 'dshRecapFacts')).toBeUndefined()
  })
  it('counts real committed user events through the registered projection', async () => {
    const f = await mount()
    const view = snapshot(f.ctx, f.agent.id, resolveConfig({}))
    expect(view?.facts.latestRequest).toBe('修复权限问题')
    expect(view?.facts.completedTurns).toBe(1)
    expect(view?.facts).not.toHaveProperty('stats')
  })
  it('reports incomplete model output as a clearly tagged factual fallback', async () => {
    const f = await mount()
    f.stream.mockImplementationOnce(() =>
      (async function* () {
        yield { type: 'text-delta', index: 0, text: 'unfinished' } as StreamChunk
      })(),
    )
    await f.command('/recap')
    const state = await f.ready()
    expect(state.recap).toBeNull()
    expect(state.status).toBe('error')
    expect(String(state.recap?.text)).not.toContain('unfinished')
  })
  it('exposes help and rejects unknown command arguments', async () => {
    const f = await mount()
    expect((await f.command('/recap help'))?.result.kind).toBe('success')
    expect((await f.command('/recap unsupported'))?.result.kind).toBe('error')
    expect(f.stream).not.toHaveBeenCalled()
    await f.command('/recap')
    await f.ready()
    expect((await f.command('/recap status'))?.result.text).toContain('已有缓存')
    expect(f.stream).toHaveBeenCalledTimes(1)
  })
})
import { agentEvents } from '@deepseek-ai/dsh-agent'
it('injects one legal notice only when enabled and preserves the pre-step decision', async () => {
  const f = await mount({ injectToModel: true })
  await f.command('/recap')
  await f.ready()
  const proposed = createUserMessage({
    content: [{ type: 'text', text: '继续验证' }],
    source: { kind: 'user' },
  })
  const fire = () =>
    agentEvents(f.ctx, f.agent).waterfall(
      'agent/pre-step',
      { messages: [proposed], turn: 2, step: 2, signal: new AbortController().signal },
      () =>
        Promise.resolve({
          kind: 'enter' as const,
          messages: [proposed],
          startsRequestSeries: true,
        }),
    )
  const first = await fire()
  expect(first.kind).toBe('enter')
  expect(first.startsRequestSeries).toBe(true)
  expect(first.messages).toHaveLength(2)
  const notice = first.messages[1]!
  expect(notice.source).toMatchObject({ kind: 'recap', form: 'notice' })
  f.session.append('user/message', notice, { surfaceOp: 'append' })
  expect((await fire()).messages).toHaveLength(1)
})

it('removes disabled commands from discovery and restores one registration when enabled', async () => {
  const f = await mount({ onCommand: false })
  expect(f.ctx.commands.find(f.agent, 'recap')).toBeUndefined()
  f.fiber.update({ ...resolveConfig({}), onCommand: true })
  await new Promise((resolve) => setTimeout(resolve, 1100))
  expect(f.ctx.commands.list(f.agent).filter((row) => row.name === 'recap')).toHaveLength(1)
  f.fiber.update({ ...resolveConfig({}), onCommand: false })
  await new Promise((resolve) => setTimeout(resolve, 1100))
  expect(f.ctx.commands.find(f.agent, 'recap')).toBeUndefined()
})

it.each(['max-tokens', 'error', 'aborted', 'tool-calls'])(
  'does not publish partial model output after %s termination',
  async (kind) => {
    const f = await mount()
    f.stream.mockImplementationOnce(() =>
      (async function* () {
        yield { type: 'text-delta', index: 0, text: '不完整的模型输出' } as StreamChunk
        yield { type: 'finish', reason: { kind } } as StreamChunk
      })(),
    )
    await f.command('/recap')
    const state = await f.ready()
    expect(state.recap).toBeNull()
    expect(state.status).toBe('error')
    expect(state.error).toBe('INCOMPLETE_RESPONSE')
    expect(String(state.recap?.text)).not.toContain('不完整的模型输出')
  },
)
it.each(['empty', 'exception', 'oversized'])(
  'falls back safely for %s provider output',
  async (failure) => {
    const f = await mount()
    f.stream.mockImplementationOnce(() =>
      (async function* () {
        if (failure === 'exception') throw new Error('PRIVATE_PROVIDER_ERROR')
        if (failure === 'oversized')
          yield { type: 'text-delta', index: 0, text: 'x'.repeat(2_000_001) } as StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      })(),
    )
    await f.command('/recap')
    const state = await f.ready()
    expect(state.recap).toBeNull()
    expect(state.status).toBe('error')
    expect(String(state.recap?.text)).not.toContain('PRIVATE_PROVIDER_ERROR')
    expect(state.error).toBe(
      { empty: 'EMPTY_RESPONSE', exception: 'GENERATION_FAILED', oversized: 'OUTPUT_TOO_LARGE' }[
        failure
      ],
    )
  },
)
it('forwards the requested language and budgets without tools or main-model mutation', async () => {
  const f = await mount({ language: 'en', maxTokens: 256, maxSourceChars: 1000 })
  const before = { ...f.agent.options }
  await f.command('/recap')
  await f.ready()
  const options = f.stream.mock.calls[0]![0]
  expect(options.system).toContain('English')
  expect(options.maxTokens).toBe(256)
  expect(options).not.toHaveProperty('tools')
  expect(f.agent.options).toEqual(before)
})

it('status 只查询，不恢复 hide 暂停的回顾', async () => {
  const f = await mount()
  await f.command('/recap')
  await f.ready()
  await f.command('/recap hide')
  const before = await f.read()
  expect((await f.command('/recap status'))?.result.text).toContain('已隐藏')
  expect(await f.read()).toEqual(before)
  expect(f.stream).toHaveBeenCalledTimes(1)
})
