import { useEffect, useRef, useState } from 'react'
import type { Language } from '../core/config.js'
import type { ViewState } from '../core/contracts.js'
import type { Route } from '../core/api.js'
import type { ApiClient } from './api.js'
export function useRecap(api: ApiClient, sessionId: string, language: Language) {
  const [state, setState] = useState<ViewState | null>(null)
  const identity = useRef(getPageIdentity())
  useEffect(() => {
    let alive = true,
      issued = 0,
      applied = 0,
      polling = false,
      lastActivity = -Infinity
    const controllers = new Set<AbortController>()
    const visible = () => document.visibilityState === 'visible' && document.hasFocus()
    setState(null)
    const send = async (route: Route, body: object): Promise<boolean> => {
      const controller = new AbortController(),
        request = ++issued
      controllers.add(controller)
      try {
        const data = await api<ViewState>(route, body, controller.signal)
        if (alive && request >= applied) {
          applied = request
          setState(data)
        }
        return true
      } catch {
        // 会话加载或连接恢复期间静默重试，不展示空回顾或后台错误。
        return false
      } finally {
        controllers.delete(controller)
      }
    }
    const presence = async (extra: object = {}): Promise<void> => {
      const acknowledged = await send('presence', {
        sessionId,
        clientId: identity.current.id,
        sequence: ++identity.current.sequence,
        visible: visible(),
        locale: language,
        open: !openedSessions.has(sessionId),
        ...extra,
      })
      if (alive && acknowledged) openedSessions.add(sessionId)
    }
    const poll = async (): Promise<void> => {
      if (!visible() || polling) return
      polling = true
      try {
        if (openedSessions.has(sessionId))
          await send('state', { sessionId, clientId: identity.current.id })
        else await presence()
      } finally {
        polling = false
      }
    }
    const activity = (): void => {
      if (!visible() || Date.now() - lastActivity < 5000) return
      lastActivity = Date.now()
      void presence({ active: true })
    }
    const visibility = (): void => {
      void presence()
      if (visible()) void poll()
    }
    const focus = (): void => {
      void presence({ visible: true, active: true })
      void poll()
    }
    const blur = (): void => {
      void presence({ visible: false })
    }
    const pagehide = (): void => {
      void presence({ visible: false, closed: true })
    }
    void presence({ active: true })
    const pollTimer = setInterval(() => {
      void poll()
    }, 2000)
    const heartbeat = setInterval(() => {
      if (visible()) void presence()
    }, 15000)
    document.addEventListener('visibilitychange', visibility)
    document.addEventListener('pointerdown', activity, { passive: true })
    document.addEventListener('keydown', activity)
    document.addEventListener('wheel', activity, { passive: true })
    window.addEventListener('focus', focus)
    window.addEventListener('blur', blur)
    window.addEventListener('pagehide', pagehide)
    return () => {
      alive = false
      clearInterval(pollTimer)
      clearInterval(heartbeat)
      for (const controller of controllers) controller.abort()
      document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('pointerdown', activity)
      document.removeEventListener('keydown', activity)
      document.removeEventListener('wheel', activity)
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', blur)
      window.removeEventListener('pagehide', pagehide)
      void api('presence', {
        sessionId,
        clientId: identity.current.id,
        sequence: ++identity.current.sequence,
        visible: false,
        open: !openedSessions.has(sessionId),
      }).catch(() => undefined)
    }
  }, [api, sessionId, language])
  return {
    state,
  }
}

export function createClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

// 页面刷新获得新身份；组件在命令行和轮次之间移动不应清除展示。
let pageIdentity: { id: string; sequence: number } | undefined
function getPageIdentity() {
  return (pageIdentity ??= { id: createClientId(), sequence: 0 })
}
// Only successful presence responses acknowledge initialization; failed/aborted opens retry.
const openedSessions = new Set<string>()
