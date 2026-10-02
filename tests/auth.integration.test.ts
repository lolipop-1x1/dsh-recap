import { request as httpRequest } from 'node:http'
import { describe, it, expect, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { installRoutes } from '../src/host/http.js'
import { SettingsBridge } from '../src/host/settings.js'
import { resolveConfig } from '../src/core/config.js'
import { fixture } from './helpers.js'
async function mount() {
  const ctx = new Context(),
    f = fixture()
  f.add()
  onTestFinished(async () => {
    f.engine.dispose()
    await ctx.fiber.dispose()
  })
  let credential: CredentialRecord | undefined
  ctx.provide('credentials', {
    readRecord: async () => credential,
    modifyRecord: async (
      _key: unknown,
      mutate: (value: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
    ) => {
      credential = await mutate(credential)
      return credential
    },
    deleteRecord: async () => {
      credential = undefined
    },
  } as unknown as CredentialProvider)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Connection)
  const fiber = await ctx.plugin((child: Context) =>
    installRoutes(child, f.engine, new SettingsBridge(child, () => resolveConfig({}))),
  )
  const base = `http://127.0.0.1:${ctx.webServer.port}`,
    authority = new URL(base).host
  const launch = new URL(ctx.connection.authenticatedUrl(base))
  let cookie = ''
  ctx.connection.authorizeIndex(
    { method: 'GET', url: launch.pathname + launch.search, headers: { host: authority } },
    {
      writeHead: (_status, headers) => {
        cookie = headers?.['set-cookie']?.split(';')[0] ?? ''
      },
      end: () => {},
    },
  )
  const call = (headers: Record<string, string> = {}) =>
    fetch(`${base}/api/dsh-recap/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ sessionId: 'session-1' }),
    })
  return { ctx, fiber, call, cookie, base }
}
describe('real authenticated loopback HTTP carrier', () => {
  it('rejects unauthenticated requests before dispatch', async () => {
    const f = await mount()
    expect((await f.call()).status).toBe(401)
  })
  it('accepts a valid Host-issued cookie', async () => {
    const f = await mount()
    expect(f.cookie.length).toBeGreaterThan(0)
    const response = await f.call({ cookie: f.cookie, origin: f.base })
    expect(response.status).toBe(200)
    expect((await response.json()).ok).toBe(true)
  })
  it('rejects foreign origins even with a valid cookie', async () => {
    const f = await mount()
    expect(
      (
        await f.call({
          cookie: f.cookie,
          origin: 'https://attacker.invalid',
          'sec-fetch-site': 'cross-site',
        })
      ).status,
    ).toBe(403)
  })
  it('rejects an untrusted Host header', async () => {
    const f = await mount()
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        new URL('/api/dsh-recap/state', f.base),
        {
          method: 'POST',
          headers: {
            host: 'attacker.invalid',
            cookie: f.cookie,
            'content-type': 'application/json',
          },
        },
        (response) => {
          response.resume()
          response.on('end', () => resolve(response.statusCode))
        },
      )
      req.on('error', reject)
      req.end(JSON.stringify({ sessionId: 'session-1' }))
    })
    expect(status).toBe(403)
  })
  it('removes route ownership after plugin unload', async () => {
    const f = await mount()
    await f.fiber.dispose()
    expect((await f.call({ cookie: f.cookie, origin: f.base })).status).toBe(404)
  })
})
