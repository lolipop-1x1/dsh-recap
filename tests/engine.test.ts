import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixture, deferred, flush } from './helpers.js'
import type { RecapConfig } from '../src/core/config.js'
import type { ModelResult } from '../src/core/contracts.js'
const active: ReturnType<typeof fixture>[] = []
const setup = (patch: Partial<RecapConfig> = {}) => {
  const f = fixture(patch)
  active.push(f)
  return f
}
const result = (text = 'A complete recap.'): ModelResult => ({
  text,
  provider: 'test',
  model: 'test-model',
})
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-02T00:00:00Z'))
})
afterEach(() => {
  for (const f of active.splice(0)) f.engine.dispose()
  vi.useRealTimers()
})
describe('manual and automatic recap', () => {
  it('manual use bypasses automatic disable and minimum turns', async () => {
    const f = setup({ autoEnabled: false, minTurns: 20 })
    f.add('s', 1)
    expect((await f.engine.request('s', 'manual')).recap?.source).toBe('model')
    expect(f.generate).toHaveBeenCalledTimes(1)
  })
  it('automatic calls obey minimum turns, master switch and trigger switch', async () => {
    const f = setup({ onIdle: false })
    f.add('s', 1)
    await f.engine.request('s', 'idle')
    expect(f.generate).not.toHaveBeenCalled()
    f.setConfig({ autoEnabled: false, minTurns: 0 })
    await f.engine.request('s', 'idle')
    expect(f.generate).not.toHaveBeenCalled()
  })
  it('empty and child sessions never make model requests', async () => {
    const f = setup()
    const s = f.add('s', 0)
    expect((await f.engine.request('s', 'manual')).error).toBe('NO_DATA')
    s.session.subagent = true
    expect((await f.engine.request('s', 'manual')).status).toBe('disabled')
    expect(f.generate).not.toHaveBeenCalled()
  })
  it('deduplicates concurrent requests and reuses exact cached results', async () => {
    const f = setup()
    f.add()
    f.engine.presence('session-1', { clientId: 'a', sequence: 1, visible: true })
    await Promise.all([
      f.engine.request('session-1', 'manual'),
      f.engine.request('session-1', 'idle'),
    ])
    await f.engine.request('session-1', 'manual')
    expect(f.generate).toHaveBeenCalledTimes(1)
    await f.engine.request('session-1', 'manual', { force: true })
    expect(f.generate).toHaveBeenCalledTimes(2)
  })
  it('waits for idle without claiming agent maintenance', async () => {
    const f = setup({ idleMinutes: 0.1 })
    const s = f.add()
    f.engine.presence('session-1', { clientId: 'a', sequence: 1, visible: true })
    s.session.running = true
    f.engine.background('session-1', 'idle')
    expect(f.engine.state('session-1').status).toBe('busy')
    expect(f.generate).not.toHaveBeenCalled()
    s.session.running = false
    f.engine.idle('session-1')
    await flush()
    expect(f.generate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(6001)
    f.engine.tick()
    await flush()
    expect(f.generate).toHaveBeenCalledTimes(1)
  })
  it('deterministic mode never calls a model', async () => {
    const f = setup({ mode: 'deterministic' })
    f.add()
    expect((await f.engine.request('session-1', 'manual')).recap?.source).toBe('facts')
    f.engine.dismiss('session-1')
    expect(f.engine.reveal('session-1').hidden).toBe(false)
    expect(f.generate).not.toHaveBeenCalled()
  })
})
describe('cancellation, stale work and resource bounds', () => {
  it('does not call the model when the only consumer cancels before generation starts', async () => {
    const f = setup()
    f.add()
    const controller = new AbortController()
    const pending = f.engine
      .request('session-1', 'manual', { signal: controller.signal })
      .catch((error) => error.code)
    controller.abort()
    expect(await pending).toBe('CANCELLED')
    await flush()
    expect(f.generate).not.toHaveBeenCalled()
    expect(f.engine.inspect().active).toBe(0)
  })
  it('does not let late output replace new session facts', async () => {
    const f = setup()
    const s = f.add()
    const old = deferred<ModelResult>()
    f.generate.mockImplementationOnce(() => old.promise)
    const pending = f.engine.request('session-1', 'manual')
    await flush()
    f.engine.activity('session-1')
    s.turn()
    const newer = await f.engine.request('session-1', 'manual')
    old.resolve(result('obsolete'))
    await pending
    await flush()
    expect(f.engine.state('session-1').recap?.id).toBe(newer.recap?.id)
    expect(f.engine.state('session-1').recap?.text).not.toBe('obsolete')
  })
  it('times out uncooperative providers and releases the admission slot', async () => {
    const f = setup({ timeoutSeconds: 2, maxConcurrent: 1 })
    f.add('a')
    f.add('b')
    f.generate.mockImplementationOnce(() => new Promise(() => {}))
    const pending = f.engine.request('a', 'manual')
    await flush()
    const next = f.engine.request('b', 'manual')
    await vi.advanceTimersByTimeAsync(2001)
    expect((await pending).recap?.warning).toBe('TIMEOUT')
    expect((await next).recap?.source).toBe('model')
    expect(f.engine.inspect().active).toBe(0)
  })
  it('cancels a manual request only after its final consumer leaves', async () => {
    const f = setup()
    f.add()
    const wait = deferred<ModelResult>()
    f.generate.mockImplementation(() => wait.promise)
    const a = new AbortController(),
      b = new AbortController()
    const one = f.engine
      .request('session-1', 'manual', { signal: a.signal })
      .catch((error) => error.code)
    const two = f.engine.request('session-1', 'manual', { signal: b.signal })
    await flush()
    a.abort()
    expect(await one).toBe('CANCELLED')
    wait.resolve(result())
    expect((await two).recap?.source).toBe('model')
  })
  it('invalidates work when settings change', async () => {
    const f = setup()
    f.add()
    const wait = deferred<ModelResult>()
    f.generate.mockImplementationOnce(() => wait.promise)
    const pending = f.engine.request('session-1', 'manual')
    await flush()
    f.setConfig({ language: 'en' })
    wait.resolve(result('old language'))
    await pending
    expect(f.engine.state('session-1').recap).toBeNull()
  })
  it('globally limits concurrent sessions and cancels queued work on unload', async () => {
    const f = setup({ maxConcurrent: 1 })
    f.add('a')
    f.add('b')
    const wait = deferred<ModelResult>()
    f.generate.mockImplementation(() => wait.promise)
    const a = f.engine.request('a', 'manual'),
      b = f.engine.request('b', 'manual')
    await flush()
    expect(f.generate).toHaveBeenCalledTimes(1)
    expect(f.engine.inspect().queued).toBe(1)
    f.engine.dispose()
    await Promise.all([a, b])
    expect(f.engine.inspect().active).toBe(0)
    expect(f.engine.inspect().queued).toBe(0)
  })
  it('preserves dismissal across bounded-cache eviction', async () => {
    const f = setup({ maxSessions: 5 })
    f.add('a')
    await f.engine.request('a', 'manual')
    f.engine.dismiss('a')
    for (let i = 0; i < 8; i++) {
      f.add(`b${i}`)
      f.engine.state(`b${i}`)
    }
    expect(f.engine.inspect().cached).toBe(5)
    await f.engine.request('a', 'idle')
    expect(f.engine.state('a').hidden).toBe(true)
    expect(f.generate).toHaveBeenCalledTimes(1)
    await f.engine.request('a', 'manual')
    expect(f.engine.state('a').hidden).toBe(false)
  })
  it('marks cached older facts stale and lets manual requests refresh them', async () => {
    const f = setup()
    const s = f.add()
    await f.engine.request('session-1', 'manual')
    s.turn()
    expect((await f.engine.request('session-1', 'idle')).stale).toBe(true)
    expect(f.generate).toHaveBeenCalledTimes(1)
    expect((await f.engine.request('session-1', 'manual')).stale).toBe(false)
    expect(f.generate).toHaveBeenCalledTimes(2)
  })
})
describe('presence and optional injection', () => {
  it('ignores out-of-order presence updates', async () => {
    const f = setup({ idleMinutes: 0.1 })
    f.add()
    f.engine.presence('session-1', { clientId: 'a', sequence: 5, visible: true })
    f.engine.presence('session-1', { clientId: 'a', sequence: 4, visible: false })
    await vi.advanceTimersByTimeAsync(7000)
    f.engine.tick()
    await flush()
    expect(f.generate).toHaveBeenCalledTimes(1)
  })
  it('foreground idle is independent from heartbeat requests', async () => {
    const f = setup({ onIdle: true, idleMinutes: 0.1 })
    f.add()
    f.engine.presence('session-1', { clientId: 'a', sequence: 1, visible: true, active: true })
    await vi.advanceTimersByTimeAsync(3000)
    f.engine.presence('session-1', { clientId: 'a', sequence: 2, visible: true })
    await vi.advanceTimersByTimeAsync(3001)
    f.engine.tick()
    await flush()
    expect(f.generate).toHaveBeenCalledTimes(1)
  })
  it('defaults to no injection and deduplicates explicitly enabled injection', async () => {
    const f = setup()
    const s = f.add()
    await f.engine.request('session-1', 'manual')
    expect(f.engine.forInjection('session-1')).toBeNull()
    f.setConfig({ injectToModel: true })
    await f.engine.request('session-1', 'manual')
    const recap = f.engine.forInjection('session-1')
    expect(recap).not.toBeNull()
    s.append('user/message', {
      source: { kind: 'recap', recapId: recap?.id },
      content: [{ type: 'text', text: recap?.text }],
    })
    expect(f.engine.forInjection('session-1')).toBeNull()
  })
})
it('expired browser leases cannot trigger idle generation', async () => {
  const f = setup({ idleMinutes: 1 })
  f.add()
  f.engine.presence('session-1', { clientId: 'lost-tab', sequence: 1, visible: true })
  await vi.advanceTimersByTimeAsync(60001)
  f.engine.tick()
  await flush()
  expect(f.generate).not.toHaveBeenCalled()
})
it('hides the previous recap when conversation work resumes and allows manual reopening', async () => {
  const f = setup()
  const s = f.add()
  const previous = await f.engine.request('session-1', 'manual')
  expect(previous.hidden).toBe(false)
  f.engine.activity('session-1')
  s.turn()
  f.engine.idle('session-1')
  expect(f.engine.state('session-1').hidden).toBe(true)
  expect(f.engine.state('session-1').recap?.id).toBe(previous.recap?.id)
  const refreshed = await f.engine.request('session-1', 'manual')
  expect(refreshed.hidden).toBe(false)
  expect(refreshed.recap?.watermark).not.toBe(previous.recap?.watermark)
})
it('keeps opening quiet and only generates for the visible idle session', async () => {
  const f = setup({ onIdle: true, idleMinutes: 0.1 })
  f.add('visible')
  f.add('hidden')
  f.engine.presence('visible', { clientId: 'a', sequence: 1, visible: true, open: true })
  f.engine.presence('hidden', { clientId: 'b', sequence: 1, visible: false, open: true })
  await flush()
  expect(f.generate).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(6001)
  f.engine.tick()
  await flush()
  expect(f.generate).toHaveBeenCalledTimes(1)
  expect(f.engine.state('hidden').recap).toBeNull()
})
it('cancels idle generation when the last visible browser leaves', async () => {
  const f = setup({ onIdle: true, idleMinutes: 0.1 })
  f.add()
  const wait = deferred<ModelResult>()
  f.generate.mockImplementationOnce(() => wait.promise)
  f.engine.presence('session-1', { clientId: 'a', sequence: 1, visible: true })
  f.engine.presence('session-1', { clientId: 'b', sequence: 1, visible: true })
  await vi.advanceTimersByTimeAsync(6001)
  f.engine.tick()
  await flush()
  f.engine.presence('session-1', { clientId: 'a', sequence: 2, visible: false })
  expect(f.engine.state('session-1').status).toBe('generating')
  f.engine.presence('session-1', { clientId: 'b', sequence: 2, visible: false })
  wait.resolve(result('must not appear in the hidden session'))
  await flush()
  expect(f.engine.state('session-1').recap).toBeNull()
})
it('merges manual and idle generation into one presented recap', async () => {
  const f = setup()
  f.add()
  const wait = deferred<ModelResult>()
  f.generate.mockImplementationOnce(() => wait.promise)
  f.engine.presence('session-1', { clientId: 'a', sequence: 1, visible: true })
  const automatic = f.engine.request('session-1', 'idle')
  await flush()
  const manual = f.engine.request('session-1', 'manual')
  wait.resolve(result())
  const state = await manual
  expect((await automatic).recap?.id).toBe(state.recap?.id)
  expect(state.recap?.text).toBe('A complete recap.')
  expect(state.hidden).toBe(false)
  expect(f.generate).toHaveBeenCalledTimes(1)
})
it('hides an automatic preview when leaving and does not show it again on opening', async () => {
  const f = setup()
  f.add()
  f.engine.presence('session-1', { clientId: 'a', sequence: 1, visible: true })
  expect((await f.engine.request('session-1', 'idle')).hidden).toBe(false)
  f.engine.presence('session-1', { clientId: 'a', sequence: 2, visible: false, closed: true })
  const reopened = f.engine.presence('session-1', {
    clientId: 'a',
    sequence: 3,
    visible: true,
    open: true,
  })
  expect(reopened.hidden).toBe(true)
  expect(f.generate).toHaveBeenCalledTimes(1)
})
describe('cached recap presentation', () => {
  it('keeps reopening quiet, then presents the same cache at the next idle threshold', async () => {
    const f = setup({ idleMinutes: 0.1 })
    f.add()
    f.engine.presence('session-1', { clientId: 'a', sequence: 1, visible: true })
    const first = await f.engine.request('session-1', 'idle')
    f.engine.presence('session-1', { clientId: 'a', sequence: 2, visible: false, closed: true })
    const reopened = f.engine.presence('session-1', {
      clientId: 'a',
      sequence: 3,
      visible: true,
      open: true,
    })
    expect(reopened.hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(5999)
    f.engine.tick()
    expect(f.engine.state('session-1').hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(2)
    f.engine.tick()
    const shown = f.engine.state('session-1')
    expect(shown.hidden).toBe(false)
    expect(shown.displayTurn).toBe(3)
    expect(shown.recap).toEqual(first.recap)
    expect(shown.stale).toBe(false)
    expect(shown.revision).toBeGreaterThan(reopened.revision)
    expect(f.generate).toHaveBeenCalledTimes(1)
  })
  it('presents a permitted older cache in the current turn without changing its evidence', async () => {
    const f = setup({
      idleMinutes: 0.1,
      cacheTtlTurns: 3,
      autoCooldownSeconds: 0,
      injectToModel: true,
    })
    const s = f.add()
    f.engine.presence('session-1', { clientId: 'a', sequence: 1, visible: true })
    const first = await f.engine.request('session-1', 'idle')
    f.engine.activity('session-1')
    s.turn()
    f.engine.idle('session-1')
    expect(f.engine.state('session-1').hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(6001)
    f.engine.tick()
    const shown = f.engine.state('session-1')
    expect(shown.hidden).toBe(false)
    expect(shown.displayTurn).toBe(4)
    expect(shown.stale).toBe(true)
    expect(shown.recap).toEqual(first.recap)
    expect(shown.recap?.turn).toBe(3)
    expect(f.engine.forInjection('session-1')).toBeNull()
    expect(f.generate).toHaveBeenCalledTimes(1)
    f.engine.activity('session-1')
    expect(f.engine.state('session-1').displayTurn).toBeNull()
    expect(f.engine.state('session-1').hidden).toBe(true)
  })
  it.each([0, 1])('regenerates outside a turn cache window of %i', async (cacheTtlTurns) => {
    const f = setup({ idleMinutes: 0.1, cacheTtlTurns, autoCooldownSeconds: 0 })
    const s = f.add()
    f.engine.presence('session-1', { clientId: 'a', sequence: 1, visible: true })
    const first = await f.engine.request('session-1', 'idle')
    f.engine.activity('session-1')
    s.turn()
    f.engine.idle('session-1')
    await vi.advanceTimersByTimeAsync(6001)
    f.engine.tick()
    await flush()
    const shown = f.engine.state('session-1')
    expect(shown.hidden).toBe(false)
    expect(shown.displayTurn).toBe(4)
    expect(shown.stale).toBe(false)
    expect(shown.recap?.id).not.toBe(first.recap?.id)
    expect(f.generate).toHaveBeenCalledTimes(2)
  })
  it('does not reopen cached recaps after dismissal or while the agent is busy', async () => {
    const f = setup({ idleMinutes: 0.1 })
    const s = f.add()
    f.engine.presence('session-1', { clientId: 'a', sequence: 1, visible: true })
    await f.engine.request('session-1', 'idle')
    f.engine.dismiss('session-1')
    await vi.advanceTimersByTimeAsync(6001)
    f.engine.tick()
    expect(f.engine.state('session-1').hidden).toBe(true)
    await f.engine.request('session-1', 'manual')
    f.engine.activity('session-1')
    s.session.running = true
    await vi.advanceTimersByTimeAsync(6001)
    f.engine.tick()
    expect(f.engine.state('session-1').hidden).toBe(true)
    expect(f.generate).toHaveBeenCalledTimes(1)
  })
})
describe('manual promotion of queued automatic work', () => {
  it('promotes a shared queued task behind existing manual work and ahead of automatic work', async () => {
    const f = setup({ maxConcurrent: 1 })
    for (const id of ['blocker', 'auto-before', 'promoted', 'manual-before']) {
      f.add(id)
      f.engine.presence(id, { clientId: id, sequence: 1, visible: true })
    }
    const wait = deferred<ModelResult>()
    f.generate.mockImplementationOnce(() => wait.promise)
    const blocker = f.engine.request('blocker', 'manual')
    await flush()
    const before = f.engine.request('auto-before', 'idle')
    const automatic = f.engine.request('promoted', 'idle')
    const existingManual = f.engine.request('manual-before', 'manual')
    const manual = f.engine.request('promoted', 'manual')
    const repeated = f.engine.request('promoted', 'manual')
    expect(f.engine.inspect().queued).toBe(3)
    wait.resolve(result())
    const [, , original, , joined, duplicate] = await Promise.all([
      blocker,
      before,
      automatic,
      existingManual,
      manual,
      repeated,
    ])
    expect(f.generate.mock.calls.map(([facts]) => facts.sessionId)).toEqual([
      'blocker',
      'manual-before',
      'promoted',
      'auto-before',
    ])
    expect(joined?.recap?.id).toBe(original?.recap?.id)
    expect(duplicate?.recap?.id).toBe(original?.recap?.id)
    expect(f.engine.inspect()).toMatchObject({ active: 0, queued: 0 })
  })
  it('keeps promoted queued work cancellable without starting a duplicate generation', async () => {
    const f = setup({ maxConcurrent: 1 })
    for (const id of ['blocker', 'before', 'promoted']) {
      f.add(id)
      f.engine.presence(id, { clientId: id, sequence: 1, visible: true })
    }
    const wait = deferred<ModelResult>()
    f.generate.mockImplementationOnce(() => wait.promise)
    const blocker = f.engine.request('blocker', 'manual')
    await flush()
    const before = f.engine.request('before', 'idle')
    const automatic = f.engine.request('promoted', 'idle')
    const manual = f.engine.request('promoted', 'manual')
    f.engine.dismiss('promoted')
    expect((await manual).error).toBe('CANCELLED')
    expect((await automatic).error).toBe('CANCELLED')
    wait.resolve(result())
    await Promise.all([blocker, before])
    expect(f.generate.mock.calls.map(([facts]) => facts.sessionId)).toEqual(['blocker', 'before'])
    expect(f.engine.inspect()).toMatchObject({ active: 0, queued: 0 })
  })
})

it('keeps a completed recap through blur and lease expiry until the page closes', async () => {
  const f = setup()
  f.add()
  f.engine.presence('session-1', { clientId: 'a', sequence: 1, visible: true })
  const first = await f.engine.request('session-1', 'manual')
  f.engine.presence('session-1', { clientId: 'a', sequence: 2, visible: false })
  expect(f.engine.state('session-1').hidden).toBe(false)
  await vi.advanceTimersByTimeAsync(60_000)
  f.engine.tick()
  expect(f.engine.state('session-1').recap).toEqual(first.recap)
  expect(f.engine.state('session-1').hidden).toBe(false)
  f.engine.presence('session-1', { clientId: 'a', sequence: 3, visible: false, closed: true })
  expect(f.engine.state('session-1').hidden).toBe(true)
})

it('does not hide a visible tab recap when another tab closes', async () => {
  const f = setup()
  f.add()
  f.engine.presence('session-1', { clientId: 'a', sequence: 1, visible: true })
  f.engine.presence('session-1', { clientId: 'b', sequence: 1, visible: true })
  await f.engine.request('session-1', 'manual')
  f.engine.presence('session-1', { clientId: 'a', sequence: 2, visible: false, closed: true })
  expect(f.engine.state('session-1').hidden).toBe(false)
  f.engine.presence('session-1', { clientId: 'b', sequence: 2, visible: false, closed: true })
  expect(f.engine.state('session-1').hidden).toBe(true)
})

it('does not resurrect a recap after refreshing during manual generation', async () => {
  const f = setup()
  f.add()
  const wait = deferred<ModelResult>()
  f.generate.mockImplementationOnce(() => wait.promise)
  f.engine.presence('session-1', { clientId: 'old-page', sequence: 1, visible: true })
  const request = f.engine.request('session-1', 'manual')
  await flush()
  f.engine.presence('session-1', {
    clientId: 'old-page',
    sequence: 2,
    visible: false,
    closed: true,
  })
  f.engine.presence('session-1', { clientId: 'new-page', sequence: 1, visible: true, open: true })
  wait.resolve(result('late manual result'))
  await request
  expect(f.engine.state('session-1').hidden).toBe(true)
  expect(f.engine.state('session-1').recap).toBeNull()
})
