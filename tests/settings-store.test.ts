import { it, expect, vi, afterEach } from 'vitest'
import { SettingsStore } from '../src/client/settings-store.js'
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
  const api: ApiClient = async <T>(route: string, body?: object): Promise<T> => {
    if (route === 'save-settings') {
      const input = body as { patch: object; revision: number }
      calls.push(input)
      if (hold) {
        hold = false
        await held.promise
      }
      if (input.revision !== view.revision) throw new RecapError('CONFLICT', '')
      view = { ...view, config: { ...view.config, ...input.patch }, revision: view.revision! + 1 }
    }
    return view as T
  }
  const store = new SettingsStore(api)
  return {
    store,
    calls,
    held,
    hold: () => {
      hold = true
    },
    conflict: () => {
      view = { ...view, revision: view.revision! + 1 }
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
  const f = fixture()
  await f.store.load()
  f.conflict()
  f.store.edit({ idleMinutes: 9 })
  await f.store.save()
  expect(f.store.getSnapshot().error).toBeInstanceOf(RecapError)
  expect(f.store.getSnapshot().draft).toEqual({ idleMinutes: 9 })
  await f.store.load()
  await flush()
  expect(f.calls).toHaveLength(1)
  await f.store.save()
  expect(f.store.getSnapshot().view?.config.idleMinutes).toBe(9)
})
