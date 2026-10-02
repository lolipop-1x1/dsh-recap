import React, { useEffect, useRef, useState } from 'react'
import { DEFAULTS, validatePatch, resolveConfig } from '../core/config.js'
import type { SettingsView } from '../core/api.js'
import type { ApiClient } from './api.js'
import { t, errorText, useLanguage, type LocaleAccess } from './i18n.js'
export function Settings({
  api,
  locale,
}: {
  api: ApiClient
  locale: LocaleAccess
}): React.ReactElement {
  const language = useLanguage(locale)
  const [view, setView] = useState<SettingsView | null>(null),
    [draft, setDraft] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<unknown>(null),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false)
  const request = useRef<AbortController | null>(null)
  const load = async (): Promise<void> => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setError(null)
    setSaved(false)
    try {
      const data = await api<SettingsView>('settings', {}, controller.signal)
      if (!controller.signal.aborted) {
        setView(data)
        setDraft({})
        setSaving(false)
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure)
    }
  }
  useEffect(() => {
    void load()
    return () => request.current?.abort()
  }, [api])
  const save = async (): Promise<void> => {
    if (!view || view.revision === null) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const patch = validatePatch(draft)
      resolveConfig({ ...view.config, ...patch })
      const data = await api<SettingsView>(
        'save-settings',
        { patch, revision: view.revision },
        controller.signal,
      )
      if (!controller.signal.aborted) {
        setView(data)
        setDraft({})
        setSaved(true)
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure)
    } finally {
      if (!controller.signal.aborted) setSaving(false)
    }
  }
  const current: Record<string, unknown> = { ...view?.config, ...draft }
  const edit = (key: string, value: unknown): void => {
    setSaved(false)
    setDraft((previous) => {
      const next = { ...previous, [key]: value }
      if (view && value === Reflect.get(view.config, key)) delete next[key]
      return next
    })
  }
  const dirty = Object.keys(draft).length > 0
  return (
    <form
      className="dshr-settings"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="dshr-settings-heading">
        <h2>{t(language, 'title')}</h2>
        <button
          className="dshr-button dshr-primary"
          type="submit"
          disabled={!view?.writable || !dirty || saving}
        >
          {t(language, saving ? 'saving' : 'save')}
        </button>
      </div>
      <p className="dshr-subtitle">{t(language, 'subtitle')}</p>
      <p className="dshr-note">{t(language, 'privacy')}</p>
      {!view && !error && <p role="status">{t(language, 'loading')}</p>}
      {Boolean(error) && (
        <div className="dshr-alert" role="alert">
          <p>{errorText(error, language)}</p>
          <button
            className="dshr-text-button"
            type="button"
            disabled={saving}
            onClick={() => {
              void load()
            }}
          >
            {t(language, 'reload')}
          </button>
        </div>
      )}
      {saved && <p role="status">{t(language, 'saved')}</p>}
      {view && !view.writable && <p role="status">{t(language, 'readOnly')}</p>}
      {current.injectToModel === true && <p className="dshr-alert">{t(language, 'injection')}</p>}
      {view &&
        (['triggers', 'generation', 'display', 'advanced'] as const).map((group) => (
          <fieldset key={group} disabled={saving || !view.writable}>
            <legend>{t(language, group)}</legend>
            {view.fields
              .filter((field) => field.group === group)
              .map((field) => {
                const value = current[field.key],
                  inputId = `dshr-setting-${field.key}`,
                  helpId = `${inputId}-help`
                return (
                  <div className="dshr-field" key={field.key}>
                    <div>
                      <label htmlFor={inputId}>{field.label[language]}</label>
                      {field.help[language] && <p id={helpId}>{field.help[language]}</p>}
                    </div>
                    {field.kind === 'boolean' ? (
                      <input
                        id={inputId}
                        aria-describedby={helpId}
                        type="checkbox"
                        checked={value === true}
                        onChange={(event) => edit(field.key, event.currentTarget.checked)}
                      />
                    ) : field.kind === 'select' ? (
                      <select
                        id={inputId}
                        aria-describedby={helpId}
                        value={String(value)}
                        onChange={(event) => edit(field.key, event.currentTarget.value)}
                      >
                        {field.choices?.map((choice) => (
                          <option key={choice} value={choice}>
                            {choice === 'auto'
                              ? language === 'zh'
                                ? '跟随界面'
                                : 'Follow UI'
                              : choice === 'hybrid'
                                ? language === 'zh'
                                  ? '模型回顾（失败时使用事实模式）'
                                  : 'Model + factual mode fallback'
                                : choice === 'deterministic'
                                  ? language === 'zh'
                                    ? '纯事实（不调模型）'
                                    : 'Facts only (no model)'
                                  : choice === 'zh'
                                    ? '中文'
                                    : 'English'}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={inputId}
                        aria-describedby={helpId}
                        type={field.kind === 'number' ? 'number' : 'text'}
                        min={field.min}
                        max={field.max}
                        maxLength={field.kind === 'text' ? 256 : undefined}
                        step={field.key === 'idleMinutes' ? 0.1 : 1}
                        value={typeof value === 'number' || typeof value === 'string' ? value : ''}
                        onChange={(event) =>
                          edit(
                            field.key,
                            field.kind === 'number' && event.currentTarget.value !== ''
                              ? Number(event.currentTarget.value)
                              : event.currentTarget.value,
                          )
                        }
                      />
                    )}
                  </div>
                )
              })}
          </fieldset>
        ))}
      <div className="dshr-setting-actions">
        <button
          className="dshr-text-button"
          type="button"
          disabled={!view?.writable || saving}
          onClick={() => {
            setDraft({ ...DEFAULTS })
            setSaved(false)
          }}
        >
          {t(language, 'reset')}
        </button>
      </div>
    </form>
  )
}
