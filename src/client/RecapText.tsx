import React, { useId, useState } from 'react'
import type { Language } from '../core/config.js'
import { t } from './i18n.js'
export function RecapText({
  text,
  language,
  facts = false,
  stale = false,
}: {
  text: string
  language: Language
  facts?: boolean
  stale?: boolean
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  return (
    <section className="dshr-recap" aria-label={t(language, 'title')}>
      <button
        type="button"
        className="dshr-recap-toggle"
        aria-label={`${t(language, expanded ? 'collapse' : 'expand')}${t(language, 'title')}`}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="dshr-recap-prefix" aria-hidden="true">
          ›recap ·
        </span>
        <span id={id} className="dshr-summary" data-expanded={expanded}>
          {facts && <span className="dshr-kind">{t(language, 'facts')} · </span>}
          {stale && <span className="dshr-kind">{t(language, 'stale')} · </span>}
          {text}
        </span>
        <span className="dshr-chevron" aria-hidden="true">
          {expanded ? '⌃' : '⌄'}
        </span>
      </button>
    </section>
  )
}
