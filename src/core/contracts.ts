import type { RecapConfig, Language } from './config.js'
import type { Facts } from './facts.js'
export type Trigger = 'manual' | 'idle'
export interface LiveSnapshot {
  instance: object
  running: boolean
  subagent: boolean
  facts: Facts
}
export interface ModelResult {
  text: string
  provider: string
  model: string
}
export interface EnginePorts {
  config(): RecapConfig
  snapshot(id: string, config: RecapConfig): LiveSnapshot | undefined
  generate(
    facts: Facts,
    config: RecapConfig,
    language: Language,
    signal: AbortSignal,
  ): Promise<ModelResult>
  now?(): number
  report?(code: string): void
}
export interface Recap {
  id: string
  text: string
  source: 'model' | 'facts' | 'compaction'
  generatedAt: number
  watermark: number
  turn: number
  language: Language
  provider: string | null
  model: string | null
  warning: string | null
}
export interface ViewState {
  sessionId: string
  status: 'empty' | 'ready' | 'queued' | 'generating' | 'busy' | 'disabled' | 'error'
  revision: number
  hidden: boolean
  /** Presentation target; recap.turn remains the original evidence turn when a cache is reused. */
  displayTurn: number | null
  stale: boolean
  recap: Recap | null
  error: string | null
  autoEnabled: boolean
}
export interface PresenceMessage {
  clientId: string
  sequence: number
  visible: boolean
  active?: boolean
  open?: boolean
  closed?: boolean
  locale?: string
}
