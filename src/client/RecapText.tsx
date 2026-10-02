import React, { useId, useState, useEffect, useRef } from 'react'
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
  const summary = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const element = summary.current
    if (!element) return
    const measure = () => {
      if (!expanded) setOverflow(element.scrollHeight > element.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text, expanded])
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
        <span className="dshr-recap-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor">
            <path d={expanded ? 'M4 6L8 10L12 6' : 'M3 4L7 8L3 12M9 12H13'} />
          </svg>
        </span>
        <span className="dshr-recap-prefix" aria-hidden="true">
          recap
        </span>
        <span className="dshr-recap-separator" aria-hidden="true" />
        <span ref={summary} id={id} className="dshr-summary" data-expanded={expanded}>
          {facts && <span className="dshr-kind">{t(language, 'facts')} · </span>}
          {stale && <span className="dshr-kind">{t(language, 'stale')} · </span>}
          {text}
        </span>
      </button>
      {(overflow || expanded) && (
        <button className="dshr-text-button" type="button" onClick={() => setExpanded(!expanded)}>
          {t(language, expanded ? 'collapse' : 'expand')}
        </button>
      )}
    </section>
  )
}
