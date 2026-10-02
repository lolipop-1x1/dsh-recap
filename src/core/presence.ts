import type { PresenceMessage } from './contracts.js'
import type { RecapConfig } from './config.js'
const LEASE_MS = 45_000
interface Tab {
  sequence: number
  visible: boolean
  seen: number
  closed: boolean
  hiddenThrough: number
}
/** 时间由 Host 记录，页面序号只用于拒绝乱序消息。 */
export class Presence {
  private readonly tabs = new Map<string, Tab>()
  private visible = false
  private idleFired = false
  private lastInteraction: number
  constructor(now: number) {
    this.lastInteraction = now
  }
  update(message: PresenceMessage, now: number, presentation = 0): { accepted: boolean } {
    const old = this.tabs.get(message.clientId)
    if (old && old.sequence >= message.sequence) return { accepted: false }
    this.isVisible(now)
    if (!old && this.tabs.size >= 32) {
      const expired = [...this.tabs].find(([, tab]) => now - tab.seen > LEASE_MS)
      if (!expired) return { accepted: false }
      this.tabs.delete(expired[0])
    }
    this.tabs.set(message.clientId, {
      sequence: message.sequence,
      visible: message.visible && !message.closed,
      seen: now,
      closed: message.closed === true,
      // Any first report can overtake open. Initialize once; retries must not hide newer recaps.
      hiddenThrough: old?.hiddenThrough ?? presentation,
    })
    if (message.visible && (message.active || message.open)) this.activity(now)
    this.isVisible(now)
    return { accepted: true }
  }
  canDisplay(clientId: string, presentation: number): boolean {
    const tab = this.tabs.get(clientId)
    return !!tab && !tab.closed && presentation > tab.hiddenThrough
  }
  hasOpen(): boolean {
    return [...this.tabs.values()].some((tab) => !tab.closed)
  }
  activity(now: number): void {
    this.lastInteraction = now
    this.idleFired = false
  }
  reset(): void {
    this.idleFired = false
  }
  isVisible(now: number): boolean {
    const visible = [...this.tabs.values()].some((tab) => tab.visible && now - tab.seen <= LEASE_MS)
    if (visible && !this.visible) this.activity(now)
    this.visible = visible
    return visible
  }
  due(now: number, config: RecapConfig): 'idle' | undefined {
    if (
      this.isVisible(now) &&
      config.autoEnabled &&
      config.onIdle &&
      !this.idleFired &&
      now - this.lastInteraction >= config.idleMinutes * 60_000
    ) {
      this.idleFired = true
      return 'idle'
    }
    return undefined
  }
}
