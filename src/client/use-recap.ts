import { useEffect, useRef, useState } from 'react'
import type { Language } from '../core/config.js'
import type { ViewState } from '../core/contracts.js'
import type { Route } from '../core/api.js'
import type { ApiClient } from './api.js'
export function useRecap(api: ApiClient, sessionId: string, language: Language) {
  const [state, setState] = useState<ViewState | null>(null)
  const identity = useRef({ id: createClientId(), sequence: 0 })
  useEffect(() => {
    let alive = true,
      issued = 0,
      applied = 0,
      polling = false,
      lastActivity = -Infinity
    const controllers = new Set<AbortController>()
    const visible = () => document.visibilityState === 'visible' && document.hasFocus()
    setState(null)
    const send = async (route: Route, body: object): Promise<void> => {
      const controller = new AbortController(),
        request = ++issued
      controllers.add(controller)
      try {
        const data = await api<ViewState>(route, body, controller.signal)
        if (alive && request >= applied) {
          applied = request
          setState(data)
        }
      } catch {
        // 会话加载或连接恢复期间静默重试，不展示空回顾或后台错误。
      } finally {
        controllers.delete(controller)
      }
    }
    const presence = (extra: object = {}): void => {
      void send('presence', {
        sessionId,
        clientId: identity.current.id,
        sequence: ++identity.current.sequence,
        visible: visible(),
        locale: language,
        ...extra,
      })
    }
    const poll = async (): Promise<void> => {
      if (!visible() || polling) return
      polling = true
      try {
        await send('state', { sessionId })
      } finally {
        polling = false
      }
    }
    const activity = (): void => {
      if (!visible() || Date.now() - lastActivity < 5000) return
      lastActivity = Date.now()
      presence({ active: true })
    }
    const visibility = (): void => {
      presence()
      if (visible()) void poll()
    }
    const focus = (): void => {
      presence({ visible: true, active: true })
      void poll()
    }
    const blur = (): void => {
      presence({ visible: false })
    }
    const pagehide = (): void => {
      presence({ visible: false, closed: true })
    }
    presence({ open: true, active: true })
    const pollTimer = setInterval(() => {
      void poll()
    }, 2000)
    const heartbeat = setInterval(() => {
      if (visible()) presence()
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
        closed: true,
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
