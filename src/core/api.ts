import type { FieldSpec, RecapConfig } from './config.js'
export const API_ROOT = '/api/dsh-recap'
export const ROUTES = [
  'state',
  'refresh',
  'presence',
  'dismiss',
  'settings',
  'save-settings',
] as const
export type Route = (typeof ROUTES)[number]
export interface SettingsView {
  config: RecapConfig
  fields: readonly FieldSpec[]
  revision: number | null
  namespace: string | null
  writable: boolean
}
export type ApiResponse<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
