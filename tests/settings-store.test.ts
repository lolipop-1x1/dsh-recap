import { it, expect, vi, afterEach } from 'vitest'
import { settingsStore } from '../src/client/settings-store.js'
import { RecapError, DEFAULTS, FIELDS } from '../src/core/config.js'
import type { SettingsView } from '../src/core/api.js'
import type { ApiClient } from '../src/client/api.js'
import { deferred, flush } from './helpers.js'
afterEach(() => vi.useRealTimers())
function fixture() {
  let view: SettingsView = {
    config: { ...DEFAULTS },
    fields: FIELDS,
    revision: 0,
    namespace: 'test',
    writable: true,
  }
  const calls: object[] = []
  const held = deferred<void>()
  let hold = false
  let failure: unknown
  const api: ApiClient = async <T>(route: string, body?: object): Promise<T> => {
    if (route === 'save-settings') {
      const input = body as { patch: object; revision: number }
      calls.push(input)
      if (failure) {
        const error = failure
        failure = undefined
        throw error
      }
      if (hold) {
        hold = false
        await held.promise
      }
      if (input.revision !== view.revision) throw new RecapError('CONFLICT', '')
      view = { ...view, config: { ...view.config, ...input.patch }, revision: view.revision! + 1 }
    }
    return view as T
  }
  const store = settingsStore(api)
  return {
    api,
    store,
    calls,
    held,
    remote: () => view,
    fail: (error: unknown) => {
      failure = error
    },
    hold: () => {
      hold = true
    },
    conflict: (patch: Partial<SettingsView['config']> = {}) => {
      view = { ...view, config: { ...view.config, ...patch }, revision: view.revision! + 1 }
    },
  }
}
it('关闭面板不丢失防抖草稿', async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.store.load()
  const unsubscribe = f.store.subscribe(() => {})
  f.store.edit({ idleMinutes: 5 })
  unsubscribe()
  await vi.advanceTimersByTimeAsync(501)
  expect(f.store.getSnapshot().view?.config.idleMinutes).toBe(5)
  expect(f.store.getSnapshot().draft).toEqual({})
})
it('面板关闭后在途请求和新修改仍按 revision 串行提交', async () => {
  const f = fixture()
  await f.store.load()
  f.hold()
  f.store.edit({ idleMinutes: 4 })
  const pending = f.store.save()
  f.store.edit({ idleMinutes: 6 })
  f.held.resolve()
  await pending
  expect(f.calls).toEqual([
    { patch: { idleMinutes: 4 }, revision: 0 },
    { patch: { idleMinutes: 6 }, revision: 1 },
  ])
})
it('冲突草稿跨面板保留，读取新版本后由用户明确重试', async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.store.load()
  f.conflict({ idleMinutes: 8 })
  f.store.edit({ idleMinutes: 9 })
  await f.store.save()
  expect(f.store.getSnapshot().error).toBeInstanceOf(RecapError)
  expect(f.store.getSnapshot().draft).toEqual({ idleMinutes: 9 })
  await f.store.load()
  await flush()
  expect(f.calls).toHaveLength(1)
  // 失焦、提交表单和面板卸载都可能调用 save()，不代表用户确认覆盖。
  await f.store.save()
  await vi.advanceTimersByTimeAsync(501)
  expect(f.calls).toHaveLength(1)
  expect(f.remote().config.idleMinutes).toBe(8)
  expect(f.store.getSnapshot().draft).toEqual({ idleMinutes: 9 })
  expect(f.store.getSnapshot().needsRetry).toBe(true)
  await f.store.save(true)
  expect(f.store.getSnapshot().view?.config.idleMinutes).toBe(9)
  expect(f.calls.at(-1)).toEqual({ patch: { idleMinutes: 9 }, revision: 1 })
  expect(f.store.getSnapshot().needsRetry).toBe(false)
})
it('冲突重新读取后继续编辑及重开面板仍等待明确重试', async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.store.load()
  f.conflict({ idleMinutes: 8 })
  f.store.edit({ idleMinutes: 9 })
  await f.store.save()
  await f.store.save(true)
  expect(f.calls).toHaveLength(1)
  await f.store.load()
  const reopened = settingsStore(f.api)
  reopened.edit({ idleMinutes: 10 })
  await vi.advanceTimersByTimeAsync(501)
  await reopened.save()
  expect(f.calls).toHaveLength(1)
  expect(f.remote().config.idleMinutes).toBe(8)
  expect(reopened.getSnapshot().needsRetry).toBe(true)
  expect(reopened.getSnapshot().draft).toEqual({ idleMinutes: 10 })
  await reopened.save(true)
  expect(f.remote().config.idleMinutes).toBe(10)
  reopened.edit({ idleMinutes: 11 })
  await vi.advanceTimersByTimeAsync(501)
  expect(f.remote().config.idleMinutes).toBe(11)
})
it('明确重试再次冲突时恢复自动保存阻止状态', async () => {
  const f = fixture()
  await f.store.load()
  f.conflict({ idleMinutes: 8 })
  f.store.edit({ idleMinutes: 9 })
  await f.store.save()
  await f.store.load()
  f.conflict({ idleMinutes: 10 })
  await f.store.save(true)
  await f.store.load()
  await f.store.save()
  expect(f.calls).toHaveLength(2)
  expect(f.remote().config.idleMinutes).toBe(10)
  expect(f.store.getSnapshot().draft).toEqual({ idleMinutes: 9 })
  await f.store.save(true)
  expect(f.remote().config.idleMinutes).toBe(9)
})
it('无冲突的面板关闭立即提交防抖草稿', async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.store.load()
  f.store.edit({ idleMinutes: 5 })
  await f.store.save()
  expect(f.remote().config.idleMinutes).toBe(5)
  await vi.advanceTimersByTimeAsync(501)
  expect(f.calls).toHaveLength(1)
})
it('无冲突失败仍可明确重试，修正无效草稿后仍自动保存', async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.store.load()
  f.fail(new Error('Temporary failure'))
  f.store.edit({ idleMinutes: 5 })
  await f.store.save()
  expect(f.store.getSnapshot().needsRetry).toBe(true)
  await f.store.save(true)
  expect(f.remote().config.idleMinutes).toBe(5)
  f.store.edit({ idleMinutes: -1 })
  await vi.advanceTimersByTimeAsync(501)
  expect(f.store.getSnapshot().needsRetry).toBe(true)
  f.store.edit({ idleMinutes: 6 })
  await vi.advanceTimersByTimeAsync(501)
  expect(f.remote().config.idleMinutes).toBe(6)
  expect(f.store.getSnapshot().needsRetry).toBe(false)
})
