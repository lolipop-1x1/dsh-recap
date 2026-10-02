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
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientTransportHooks } from '@deepseek-ai/dsh-client-connection/client'
import { RecapView } from './RecapView.js'
import { SettingsDialog } from './SettingsDialog.js'
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
    let recapCommand: CommandRowProps['node'] | undefined
    for (const key of snapshot.order) {
      const row = snapshot.nodes.get(key)
      if (row?.kind !== 'command') continue
      const node = row.data as CommandRowProps['node']
      if (node.name !== 'recap') continue
      if (!command || node.seq > command.seq) command = node
      // 设置、状态和帮助只改变提示，不夺走已有摘要的展示位置。
      if (
        ['', 'refresh'].includes((node.args ?? '').trim()) &&
        node.outcome?.kind !== 'error' &&
        (!recapCommand || node.seq > recapCommand.seq)
      )
        recapCommand = node
    }
    return {
      turn,
      latest: command?.seq,
      command,
      recapSeq: recapCommand?.seq,
      inCommand: end !== undefined && recapCommand !== undefined && recapCommand.seq > end,
    }
  }
  const CommandContent = ({ node, useChat, useSession, sessionId }: CommandRowProps) => {
    const { latest, turn, inCommand, recapSeq } = useChat(recapPosition)
    const usable = useSession(
      (session) => !session.blank && !session.removed && session.openState === 'open',
    )
    if (node.seq === recapSeq && inCommand && usable && turn !== undefined)
      return (
        <RecapView key={sessionId} sessionId={sessionId} turn={turn} api={api} locale={locale} />
      )
    if (node.seq !== latest) return null
    if (!node.outcome) return null
    if ((node.args ?? '').trim() === 'settings' && node.outcome.kind === 'success')
      return (
        <SettingsDialog
          key={node.commandId}
          requestId={`${sessionId}:${node.commandId}`}
          requestedAt={node.time}
          api={api}
          locale={locale}
          loadModels={loadModels}
        />
      )
    const text = node.outcome.text
    if (
      node.outcome.kind === 'error' ||
      turn === undefined ||
      !['', 'refresh'].includes((node.args ?? '').trim())
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
  // 空白会话没有聊天时间线，在输入区仅承载命令反馈，不展示摘要。
  const EmptyCommandFeedback = (props: PropsRuntime<'conversation.input.dock'>) => {
    const blank = props.useSession((session) => session.blank && !session.removed)
    const { command } = props.useChat(recapPosition)
    if (!blank || !command) return null
    return <CommandRecap {...props} node={command} />
  }
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
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      { name: 'conversation.input.dock', id: 'dsh-recap-empty-command' },
      EmptyCommandFeedback,
    ),
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
