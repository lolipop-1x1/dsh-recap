import React from 'react'
import type { ApiClient } from './api.js'
import { t, useLanguage, type LocaleAccess } from './i18n.js'
import { useRecap } from './use-recap.js'
import { RecapText } from './RecapText.js'
export interface RecapViewProps {
  sessionId: string
  turn: number
  api: ApiClient
  locale: LocaleAccess
}
/** 回顾只在当前轮次的聊天尾部展示，暂不可用时保持安静。 */
export function RecapView({
  sessionId,
  turn,
  api,
  locale,
}: RecapViewProps): React.ReactElement | null {
  const language = useLanguage(locale)
  const { state } = useRecap(api, sessionId, language)
  if (!state || state.hidden || state.sessionId !== sessionId || state.displayTurn !== turn)
    return null
  if (state.status === 'queued' || state.status === 'generating')
    return (
      <p className="dshr-command-note" role="status">
        ›recap · {t(language, 'generating')}
      </p>
    )
  const recap = state.recap
  if (!recap) return null
  return (
    <RecapText
      key={recap.id}
      text={recap.text}
      language={language}
      facts={recap.source === 'facts'}
      stale={state.stale}
    />
  )
}
