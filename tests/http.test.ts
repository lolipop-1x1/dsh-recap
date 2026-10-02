import { afterEach, describe, expect, it } from 'vitest'
import { handler } from '../src/host/http.js'
import { SettingsBridge } from '../src/host/settings.js'
import { resolveConfig } from '../src/core/config.js'
import { fixture } from './helpers.js'
import type { Route } from '../src/core/api.js'
import type { Context } from '@deepseek-ai/cordis'
const instances: ReturnType<typeof fixture>[] = []
afterEach(() => {
  for (const f of instances.splice(0)) f.engine.dispose()
})
function mount(route: Route) {
  const f = fixture()
  f.add()
  instances.push(f)
  const settings = new SettingsBridge({ get: () => undefined } as unknown as Context, () =>
    resolveConfig({}),
  )
  return { ...f, call: handler(route, f.engine, settings) }
}
const request = (
  body: unknown = { sessionId: 'session-1' },
  headers: HeadersInit = { 'content-type': 'application/json' },
) =>
  new Request('http://localhost/api/dsh-recap/state', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
describe('authenticated carrier payload handler', () => {
  it('returns a no-store view without raw conversation messages', async () => {
    const f = mount('state'),
      response = await f.call(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('messages')
  })
  it.each([
    null,
    [],
    { sessionId: '../private' },
    { sessionId: 'session-1', extra: true },
    { sessionId: 123 },
  ])('rejects malformed payload %j', async (body) => {
    const response = await mount('state').call(request(body))
    expect(response.status).toBe(400)
  })
  it('requires JSON content type', async () => {
    expect((await mount('state').call(request({}, { 'content-type': 'text/plain' }))).status).toBe(
      415,
    )
  })
  it('rejects declared oversize before reading the stream', async () => {
    expect(
      (
        await mount('state').call(
          request({}, { 'content-type': 'application/json', 'content-length': '20000' }),
        )
      ).status,
    ).toBe(413)
  })
  it('enforces the streaming limit without trusting content-length', async () => {
    expect((await mount('state').call(request({ sessionId: 'x'.repeat(18000) }))).status).toBe(413)
  })
  it('rejects invalid JSON', async () => {
    const req = new Request('http://localhost/api/dsh-recap/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    expect((await mount('state').call(req)).status).toBe(400)
  })
  it('does not serve the action via GET', async () => {
    expect(
      (await mount('state').call(new Request('http://localhost/api/dsh-recap/state'))).status,
    ).toBe(405)
  })
  it('does not activate cold or unknown sessions', async () => {
    expect((await mount('state').call(request({ sessionId: 'not-loaded' }))).status).toBe(404)
  })
  it('accepts refresh without awaiting an unresponsive model', async () => {
    const f = mount('refresh')
    f.generate.mockImplementation(() => new Promise(() => {}))
    const response = await f.call(request())
    expect(response.status).toBe(202)
    expect((await response.json()).data.status).toMatch(/queued|generating/)
  })
  it('dismisses the session without deleting its log', async () => {
    const f = mount('dismiss')
    const before = f.sessions.get('session-1')?.state
    const response = await f.call(request())
    expect((await response.json()).data.hidden).toBe(true)
    expect(f.sessions.get('session-1')?.state).toBe(before)
  })
  it('exposes settings as read-only when the native service is absent', async () => {
    const response = await mount('settings').call(request({}))
    expect((await response.json()).data.writable).toBe(false)
  })
  it('refuses settings edits without a real writable entry', async () => {
    const response = await mount('save-settings').call(
      request({ patch: { minTurns: 1 }, revision: 0 }),
    )
    expect(response.status).toBe(503)
  })
  it('requires a revision on every settings write', async () => {
    expect((await mount('save-settings').call(request({ patch: { minTurns: 1 } }))).status).toBe(
      400,
    )
  })
  it('validates presence sequence and boolean fields', async () => {
    expect(
      (
        await mount('presence').call(
          request({ sessionId: 'session-1', clientId: 'x', sequence: -1, visible: 'yes' }),
        )
      ).status,
    ).toBe(400)
  })
  it('contains internal errors without returning provider details', async () => {
    const f = fixture()
    f.add()
    instances.push(f)
    const settings = {
      read: () => {
        throw new Error('synthetic-private-provider-detail')
      },
    } as unknown as SettingsBridge
    const response = await handler('settings', f.engine, settings)(request({}))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('synthetic-private-provider-detail')
  })
})
