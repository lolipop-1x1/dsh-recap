import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Language } from '../src/core/config.js'
import type { PresenceMessage, ViewState } from '../src/core/contracts.js'
import { createApi } from '../src/client/api.js'
import { deferred, fixture, flush } from './helpers.js'

// Exercise the actual effect and transport without a browser/DOM implementation.
const hooks = vi.hoisted(() => ({
  effects: [] as (() => (() => void) | void)[],
  states: [] as (ViewState | null)[],
}))
vi.mock('react', () => ({
  useRef: <T>(current: T) => ({ current }),
  useState: (initial: ViewState | null) => [
    initial,
    (value: ViewState | null) => hooks.states.push(value),
  ],
  useEffect: (effect: () => (() => void) | void) => hooks.effects.push(effect),
}))
let useRecap: typeof import('../src/client/use-recap.js').useRecap
let doc: EventTarget
const cleanups: (() => void)[] = []
const engines: ReturnType<typeof fixture>['engine'][] = []
beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-02T00:00:00Z'))
  hooks.effects.length = 0
  hooks.states.length = 0
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true })
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', new EventTarget())
  ;({ useRecap } = await import('../src/client/use-recap.js'))
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  for (const engine of engines.splice(0)) engine.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function setup() {
  const f = fixture()
  engines.push(f.engine)
  f.add('s')
  await f.engine.request('s', 'manual')
  const requests: {
    route: string
    body: PresenceMessage & { sessionId: string }
    signal: AbortSignal
    response: ReturnType<typeof deferred<Response>>
  }[] = []
  const api = createApi(async (input, init) => {
    const response = deferred<Response>()
    requests.push({
      route: input.split('/').at(-1)!,
      body: JSON.parse(String(init?.body)),
      signal: init!.signal!,
      response,
    })
    return response.promise
  })
  const mount = (sessionId = 's', language: Language = 'en') => {
    useRecap(api, sessionId, language)
    const cleanup = hooks.effects.pop()!()!
    cleanups.push(cleanup)
    return () => {
      cleanups.splice(cleanups.indexOf(cleanup), 1)
      cleanup()
    }
  }
  const deliver = async (index: number, loseResponse = false) => {
    const request = requests[index]!,
      { sessionId, ...message } = request.body
    const state =
      request.route === 'presence'
        ? f.engine.presence(sessionId, message)
        : f.engine.state(sessionId, message.clientId)
    if (loseResponse) request.response.reject(new Error('Connection lost after host accepted'))
    else request.response.resolve(Response.json({ ok: true, data: state }))
    await flush()
    return state
  }
  return { ...f, requests, mount, deliver, latest: () => hooks.states.at(-1) }
}

it('does not expose cached recap when activity overtakes the initial open request', async () => {
  const f = await setup()
  f.mount()
  doc.dispatchEvent(new Event('keydown'))
  expect(f.requests).toHaveLength(2)
  await f.deliver(1)
  expect(f.latest()?.hidden).toBe(true)
  expect(f.requests[1]!.body.open).toBe(true)
  await f.deliver(0)
  expect(f.latest()?.hidden).toBe(true)
  expect(hooks.states.filter((state) => state && !state.hidden)).toEqual([])
})

it('retries a failed initialization on the next poll before reading ordinary state', async () => {
  const f = await setup()
  f.mount()
  f.requests[0]!.response.reject(new Error('Session not loaded'))
  await flush()
  expect(f.latest()).toBeNull()
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.requests[1]).toMatchObject({ route: 'presence', body: { open: true } })
  await f.deliver(1)
  expect(f.latest()?.hidden).toBe(true)
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.requests[2]!.route).toBe('state')
  await f.deliver(2)
  expect(f.latest()?.hidden).toBe(true)
})

it('preserves a new manual recap when a successfully applied initialization is retried', async () => {
  const f = await setup()
  f.mount()
  await f.deliver(0, true)
  await f.engine.request('s', 'manual')
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.requests[1]).toMatchObject({ route: 'presence', body: { open: true } })
  await f.deliver(1)
  expect(f.latest()?.hidden).toBe(false)
})

it('retries after abort/remount without hiding a recap created after host initialization', async () => {
  const f = await setup()
  const unmount = f.mount()
  unmount()
  expect(f.requests[0]!.signal.aborted).toBe(true)
  // The cleanup report can reach the host ahead of the aborted open.
  await f.deliver(1)
  await f.engine.request('s', 'manual')
  f.mount()
  expect(f.requests[2]).toMatchObject({ route: 'presence', body: { open: true } })
  expect(f.requests[2]!.body.clientId).toBe(f.requests[0]!.body.clientId)
  expect(f.requests[2]!.body.sequence).toBeGreaterThan(f.requests[1]!.body.sequence)
  await f.deliver(2)
  expect(f.latest()?.hidden).toBe(false)
  await f.deliver(0)
  expect(f.latest()?.hidden).toBe(false)
})

it('keeps acknowledged initialization across locale remounts and returning to a session', async () => {
  const f = await setup()
  let unmount = f.mount()
  await f.deliver(0)
  await f.engine.request('s', 'manual')
  unmount()
  unmount = f.mount('s', 'zh')
  expect(f.requests[2]!.body.open).toBe(false)
  await f.deliver(2)
  expect(f.latest()?.hidden).toBe(false)
  unmount()
  f.add('other')
  unmount = f.mount('other')
  expect(f.requests[4]!.body.open).toBe(true)
  await f.deliver(4)
  unmount()
  f.mount()
  expect(f.requests[6]!.body.open).toBe(false)
  await f.deliver(6)
  expect(f.latest()?.hidden).toBe(false)
  expect(new Set(f.requests.map(({ body }) => body.clientId)).size).toBe(1)
})

it('ignores an older state response after newer presence displays a manual recap', async () => {
  const f = await setup()
  f.mount()
  await f.deliver(0)
  await vi.advanceTimersByTimeAsync(2000)
  const oldState = f.engine.state('s', f.requests[1]!.body.clientId)
  await f.engine.request('s', 'manual')
  doc.dispatchEvent(new Event('keydown'))
  await f.deliver(2)
  expect(f.latest()?.hidden).toBe(false)
  f.requests[1]!.response.resolve(Response.json({ ok: true, data: oldState }))
  await flush()
  expect(f.latest()?.hidden).toBe(false)
})
