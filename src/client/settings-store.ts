import { resolveConfig, validatePatch } from '../core/config.js'
import type { SettingsView } from '../core/api.js'
import { errorCode } from '../core/text.js'
import type { ApiClient } from './api.js'

// 保存队列跟随插件，而不是设置面板。关窗后继续提交，重开仍能看到草稿和错误。
export class SettingsStore {
  private snapshot = {
    view: null as SettingsView | null,
    draft: {} as Record<string, unknown>,
    error: null as unknown,
    saving: false,
    saved: false,
    needsRetry: false,
  }
  private listeners = new Set<() => void>()
  private timer?: ReturnType<typeof setTimeout>
  private loading?: Promise<void>
  constructor(private readonly api: ApiClient) {}
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private update(patch: Partial<typeof this.snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
  load = (): Promise<void> => {
    if (this.loading) return this.loading
    if (this.snapshot.saving) return Promise.resolve()
    this.loading = this.api<SettingsView>('settings')
      .then((view) => {
        // 重新读取 revision 后仍保留草稿，冲突解决由用户确认重试。
        this.update({ view, error: null, saved: false })
      })
      .catch((error: unknown) => this.update({ error }))
      .finally(() => {
        this.loading = undefined
      })
    return this.loading
  }
  edit = (patch: Record<string, unknown>): void => {
    const { draft, view, saving, error } = this.snapshot
    const next = { ...draft, ...patch }
    if (!saving && view)
      for (const key of Object.keys(next)) {
        if (next[key] === Reflect.get(view.config, key)) delete next[key]
      }
    this.update({
      draft: next,
      saved: false,
      error: errorCode(error) === 'CONFLICT' ? error : null,
      needsRetry: errorCode(error) === 'CONFLICT',
    })
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.save()
    }, 500)
  }
  save = async (): Promise<void> => {
    clearTimeout(this.timer)
    const { view, draft, saving, error } = this.snapshot
    if (
      !view?.writable ||
      view.revision === null ||
      saving ||
      errorCode(error) === 'CONFLICT' ||
      !Object.keys(draft).length
    )
      return
    this.update({ saving: true, saved: false, error: null, needsRetry: false })
    let success = false
    try {
      const patch = validatePatch(draft)
      resolveConfig({ ...view.config, ...patch })
      const data = await this.api<SettingsView>('save-settings', { patch, revision: view.revision })
      const pending = Object.fromEntries(
        Object.entries(this.snapshot.draft).filter(
          ([key, value]) => value !== Reflect.get(data.config, key),
        ),
      )
      this.update({ view: data, draft: pending, saved: true })
      success = true
    } catch (failure) {
      this.update({ error: failure, needsRetry: true })
    } finally {
      this.update({ saving: false })
    }
    if (success && Object.keys(this.snapshot.draft).length) await this.save()
  }
}
const stores = new WeakMap<ApiClient, SettingsStore>()
export function settingsStore(api: ApiClient): SettingsStore {
  let store = stores.get(api)
  if (!store) {
    store = new SettingsStore(api)
    stores.set(api, store)
  }
  return store
}
