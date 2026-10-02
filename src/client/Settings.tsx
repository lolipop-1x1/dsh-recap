import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import React, { useEffect, useRef, useState } from 'react'
import { DEFAULTS, validatePatch, resolveConfig } from '../core/config.js'
import type { SettingsView } from '../core/api.js'
import type { ApiClient } from './api.js'
import { errorCode } from '../core/text.js'
import { t, errorText, useLanguage, type LocaleAccess } from './i18n.js'
export function Settings({
  api,
  locale,
  loadModels,
}: {
  api: ApiClient
  locale: LocaleAccess
  loadModels?: () => Promise<ModelCatalog>
}): React.ReactElement {
  const language = useLanguage(locale)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [modelError, setModelError] = useState(false)
  useEffect(() => {
    let alive = true
    if (loadModels)
      void loadModels()
        .then((data) => {
          if (alive) {
            setCatalog(data)
            setModelError(data.failures.length > 0)
          }
        })
        .catch(() => {
          if (alive) setModelError(true)
        })
    return () => {
      alive = false
    }
  }, [loadModels])
  const [view, setView] = useState<SettingsView | null>(null),
    [draft, setDraft] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<unknown>(null),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false)
  const request = useRef<AbortController | null>(null)
  const savePending = useRef(false)
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
    if (
      !view?.writable ||
      view.revision === null ||
      savePending.current ||
      errorCode(error) === 'CONFLICT' ||
      !Object.keys(draft).length
    )
      return
    savePending.current = true
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
        // 只移除本次已保存的值，保留请求期间的新修改。
        setDraft((pending) =>
          Object.fromEntries(
            Object.entries(pending).filter(
              ([key, value]) => value !== Reflect.get(data.config, key),
            ),
          ),
        )
        setSaved(true)
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure)
    } finally {
      savePending.current = false
      if (!controller.signal.aborted) setSaving(false)
    }
  }
  const current: Record<string, unknown> = { ...view?.config, ...draft }
  const edit = (key: string, value: unknown): void => {
    setSaved(false)
    if (errorCode(error) !== 'CONFLICT') setError(null)
    setDraft((previous) => {
      const next = { ...previous, [key]: value }
      if (!savePending.current && view && value === Reflect.get(view.config, key)) delete next[key]
      return next
    })
  }
  const dirty = Object.keys(draft).length > 0
  const modelValue =
    current.provider && current.model ? JSON.stringify([current.provider, current.model]) : ''
  const knownModel = catalog?.groups.some(
    (group) =>
      group.id === current.provider && group.models.some((model) => model.id === current.model),
  )
  useEffect(() => {
    if (!dirty || saving || error || !view?.writable) return
    const timer = setTimeout(() => {
      void save()
    }, 500)
    return () => clearTimeout(timer)
  }, [draft, view, saving, error])
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
        <span role="status">
          {t(language, saving ? 'saving' : dirty ? 'unsaved' : saved ? 'saved' : 'autoSave')}
        </span>
      </div>
      <p className="dshr-subtitle">{t(language, 'subtitle')}</p>
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
      {view && !view.writable && <p role="status">{t(language, 'readOnly')}</p>}
      {current.injectToModel === true && <p className="dshr-alert">{t(language, 'injection')}</p>}
      {view &&
        (['triggers', 'generation', 'display', 'advanced'] as const).map((group) => (
          <fieldset key={group} disabled={!view.writable}>
            <legend>{t(language, group)}</legend>
            {view.fields
              .filter((field) => field.group === group && !['mode', 'provider'].includes(field.key))
              .map((field) => {
                const value = current[field.key],
                  inputId = `dshr-setting-${field.key}`,
                  helpId = `${inputId}-help`
                if (field.key === 'model')
                  return (
                    <div className="dshr-field" key="model">
                      <div>
                        <label htmlFor={inputId}>{t(language, 'recapModel')}</label>
                        <p id={helpId}>{t(language, 'modelHelp')}</p>
                        {modelError && <p role="status">{t(language, 'modelError')}</p>}
                      </div>
                      <select
                        id={inputId}
                        aria-describedby={helpId}
                        value={modelValue}
                        onChange={(event) => {
                          const choice = event.currentTarget.value
                          const [provider, model] = choice
                            ? (JSON.parse(choice) as [string, string])
                            : ['', '']
                          edit('provider', provider)
                          edit('model', model)
                        }}
                      >
                        <option value="">{t(language, 'followModel')}</option>
                        {modelValue && !knownModel && (
                          <option value={modelValue}>
                            {String(current.model)} ({String(current.provider)})
                          </option>
                        )}
                        {catalog?.groups.map((group) => (
                          <optgroup key={group.id} label={group.name}>
                            {group.models.map((model) => (
                              <option key={model.id} value={JSON.stringify([group.id, model.id])}>
                                {model.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  )
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
                        onBlur={() => {
                          void save()
                        }}
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
