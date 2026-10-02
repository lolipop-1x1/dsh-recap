import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { z } from 'zod'
import { API_ROOT, ROUTES, type Route } from '../core/api.js'
import { RecapError, record } from '../core/config.js'
import type { RecapEngine } from '../core/engine.js'
import type { SettingsBridge } from './settings.js'
const MAX_BODY_BYTES = 16_384
const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\u0000-\u0020/\\]+$/u)
const sessionBody = z
  .object({ sessionId: id, clientId: z.string().min(1).max(128).optional() })
  .strict()
const presenceBody = z
  .object({
    sessionId: id,
    clientId: z.string().min(1).max(128),
    sequence: z.number().int().nonnegative().safe(),
    visible: z.boolean(),
    active: z.boolean().optional(),
    open: z.boolean().optional(),
    closed: z.boolean().optional(),
    locale: z
      .string()
      .max(40)
      .regex(/^[A-Za-z0-9-]*$/u)
      .optional(),
  })
  .strict()
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new RecapError('CONTENT_TYPE', 'Send application/json.', 415)
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES)
    throw new RecapError('TOO_LARGE', 'Request body is too large.', 413)
  const reader = request.body?.getReader()
  if (!reader) return {}
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new RecapError('TOO_LARGE', 'Request body is too large.', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes) || '{}',
    )
    const body = record(parsed)
    if (!body) throw new Error('object required')
    return body
  } catch {
    throw new RecapError('INVALID_JSON', 'Expected a valid JSON object.')
  }
}
function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })
}
export function handler(
  route: Route,
  engine: RecapEngine,
  settings: SettingsBridge,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      if (request.method !== 'POST')
        return json({ ok: false, error: { code: 'METHOD', message: 'Use POST.' } }, 405)
      const body = await readBody(request)
      if (route === 'settings') {
        z.object({}).strict().parse(body)
        return json({ ok: true, data: settings.read() })
      }
      if (route === 'save-settings') {
        const input = z
          .object({
            patch: z.record(z.string(), z.unknown()),
            revision: z.number().int().nonnegative().safe(),
          })
          .strict()
          .parse(body)
        const data = await settings.save(input.patch, input.revision)
        engine.syncConfig()
        return json({ ok: true, data })
      }
      if (route === 'presence') {
        const { sessionId, ...message } = presenceBody.parse(body)
        return json({ ok: true, data: engine.presence(sessionId, message) })
      }
      const { sessionId, clientId } = sessionBody.parse(body)
      if (route === 'dismiss') return json({ ok: true, data: engine.dismiss(sessionId) })
      if (route === 'refresh') {
        engine.state(sessionId)
        engine.background(sessionId, 'manual', true)
        return json({ ok: true, data: engine.state(sessionId) }, 202)
      }
      return json({ ok: true, data: engine.state(sessionId, clientId) })
    } catch (error) {
      if (error instanceof z.ZodError)
        return json(
          { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid request fields.' } },
          400,
        )
      if (error instanceof RecapError)
        return json(
          { ok: false, error: { code: error.code, message: error.message } },
          error.status,
        )
      return json(
        {
          ok: false,
          error: { code: 'INTERNAL', message: 'Recap could not complete this request.' },
        },
        500,
      )
    }
  }
}
/** Shared Connection owns authentication, trust policy and disposal. No public exact WebServer routes. */
export function installRoutes(ctx: Context, engine: RecapEngine, settings: SettingsBridge): void {
  ctx.inject(['connection'], (child) => {
    for (const route of ROUTES)
      child.connection.fetch.register({
        path: `${API_ROOT}/${route}`,
        methods: ['POST'],
        requestBody: 'streaming',
        fetch: handler(route, engine, settings),
      })
  })
}
