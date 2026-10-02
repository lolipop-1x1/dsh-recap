import React from 'react'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  CommandRowProps,
  TurnTailOwnerProps,
  ChatSnapshot,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientTransportHooks } from '@deepseek-ai/dsh-client-connection/client'
import { RecapView } from './RecapView.js'
import { Settings } from './Settings.js'
import { createApi } from './api.js'
import { t, type LocaleAccess } from './i18n.js'
import { styles } from './styles.js'
export const inject = ['slots', 'locale', 'remote', 'remote.session']
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
  const recapPosition = (snapshot: ChatSnapshot) => {
    const turn = snapshot.timeline.turnOrder.at(-1)
    const end = turn === undefined ? undefined : snapshot.timeline.turns.get(turn)?.end?.seq
    let command: CommandRowProps['node'] | undefined
    for (const key of snapshot.order) {
      const row = snapshot.nodes.get(key)
      if (row?.kind !== 'command') continue
      const node = row.data as CommandRowProps['node']
      if (node.name === 'recap' && (!command || node.seq > command.seq)) command = node
    }
    return {
      turn,
      latest: command?.seq,
      inCommand:
        end !== undefined &&
        command !== undefined &&
        command.seq > end &&
        ['', 'refresh', 'status'].includes((command.args ?? '').trim()) &&
        command.outcome?.kind !== 'error',
    }
  }
  const CommandContent = ({ node, useChat, useSession, sessionId }: CommandRowProps) => {
    const { latest, turn, inCommand } = useChat(recapPosition)
    const usable = useSession(
      (session) => !session.blank && !session.removed && session.openState === 'open',
    )
    if (node.seq === latest && inCommand && usable && turn !== undefined)
      return (
        <RecapView key={sessionId} sessionId={sessionId} turn={turn} api={api} locale={locale} />
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
  const CommandRecap = (props: CommandRowProps) => (
    <div data-dshr-command="true">{CommandContent(props)}</div>
  )
  const SessionRecap = ({
    turn,
    sessionId,
    useChat,
    useSession,
  }: Pick<CommandRowProps, 'sessionId' | 'useChat' | 'useSession'> & TurnTailOwnerProps) => {
    const { turn: latestTurn, inCommand } = useChat(recapPosition)
    const usable = useSession(
      (session) => !session.blank && !session.removed && session.openState === 'open',
    )
    if (!usable || turn.turn !== latestTurn || inCommand) return null
    return (
      <RecapView key={sessionId} sessionId={sessionId} turn={turn.turn} api={api} locale={locale} />
    )
  }
  const loadModels = async (): Promise<ModelCatalog> => {
    const remote = ctx.get('remote')
    if (!remote) throw new Error('Model catalog unavailable')
    const result = await remote.session.modelCatalog()
    if (!result.ok) throw new Error(`Model catalog unavailable: ${result.error.code}`)
    return result.value
  }
  const SettingsPage = () => <Settings api={api} locale={locale} loadModels={loadModels} />
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
