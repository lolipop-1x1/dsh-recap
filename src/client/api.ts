import { API_ROOT, type ApiResponse, type Route } from '../core/api.js'
import { RecapError, record } from '../core/config.js'
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>
export type ApiClient = <T>(route: Route, body?: object, signal?: AbortSignal) => Promise<T>
export function createApi(fetcher: Fetcher): ApiClient {
  return async <T>(route: Route, body: object = {}, signal?: AbortSignal): Promise<T> => {
    const timeout = AbortSignal.timeout(10_000)
    const response = await fetcher(`${API_ROOT}/${route}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (response.status === 401 || response.status === 403)
      throw new RecapError(
        'AUTH_REQUIRED',
        'Reconnect to Harness before using Recap.',
        response.status,
      )
    const parsed: unknown = await response.json()
    const object = record(parsed)
    if (!object || typeof object.ok !== 'boolean')
      throw new RecapError('BAD_RESPONSE', 'Recap returned an invalid response.', 502)
    const result = parsed as ApiResponse<T>
    if (!result.ok) throw new RecapError(result.error.code, result.error.message, response.status)
    if (!response.ok)
      throw new RecapError('BAD_RESPONSE', 'Recap request did not succeed.', response.status)
    return result.data
  }
}
