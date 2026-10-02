import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { CommandRowProps, TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientTransportHooks } from '@deepseek-ai/dsh-client-connection/client'
import { RecapView } from './RecapView.js'
import { Settings } from './Settings.js'
import { createApi } from './api.js'
import { t, type LocaleAccess } from './i18n.js'
import { styles } from './styles.js'
export const inject = ['slots', 'locale']
export function apply(ctx: Context): void {
  const globals = globalThis as typeof globalThis & { __DSH_TRANSPORT__?: ClientTransportHooks }
  const transport = globals.__DSH_TRANSPORT__?.fetch
  const api = createApi((input, init) =>
    transport ? transport(input, init ?? {}) : fetch(input, init),
  )
  const locale: LocaleAccess = {
    active: () => ctx.locale.getSnapshot().active,
    subscribe: (listener) => ctx.locale.subscribe(listener),
  }
  const CommandRecap = ({ node, useChat }: CommandRowProps) => {
    const latest = useChat((snapshot) =>
      snapshot.order.reduce((seq, key) => {
        const row = snapshot.nodes.get(key)
        const command = row?.kind === 'command' ? (row.data as CommandRowProps['node']) : undefined
        return command?.name === 'recap' ? Math.max(seq, command.seq) : seq
      }, -1),
    )
    if (node.seq !== latest) return null
    if (!node.outcome) return null
    const text = node.outcome.text
    if (
      node.outcome.kind === 'error' ||
      !['', 'refresh', 'status'].includes((node.args ?? '').trim())
    )
      return (
        <p
          className="dshr-command-note"
          role={node.outcome?.kind === 'error' ? 'status' : undefined}
        >
          {text}
        </p>
      )
    return null
  }
  const SessionRecap = ({
    turn,
    sessionId,
    useChat,
    useSession,
  }: Pick<CommandRowProps, 'sessionId' | 'useChat' | 'useSession'> & TurnTailOwnerProps) => {
    const latestTurn = useChat((snapshot) => snapshot.timeline.turnOrder.at(-1))
    const usable = useSession(
      (session) => !session.blank && !session.removed && session.openState === 'open',
    )
    if (!usable || turn.turn !== latestTurn) return null
    return (
      <RecapView key={sessionId} sessionId={sessionId} turn={turn.turn} api={api} locale={locale} />
    )
  }
  const SettingsPage = () => <Settings api={api} locale={locale} />
  ctx.effect(() => {
    const element = document.createElement('style')
    element.dataset.dshRecap = 'true'
    element.textContent = styles
    document.head.append(element)
    return () => element.remove()
  })
  ctx.slots.inject('conversation.chat.commandview', () =>
    ctx.slots.register({ name: 'conversation.chat.commandview', key: 'recap' }, CommandRecap),
  )
  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      { name: 'conversation.chat.turnTail', id: 'dsh-recap', order: 90 },
      SessionRecap,
    ),
  )
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'dsh-recap',
        order: 65,
        // Resolve copy without replacing the entry: its identity owns the settings draft.
        label: () => t(/^zh(?:-|$)/iu.test(locale.active()) ? 'zh' : 'en', 'title'),
      },
      SettingsPage,
    ),
  )
}
