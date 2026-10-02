import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RecapView } from '../src/client/RecapView.js'
import { SettingsDialog } from '../src/client/SettingsDialog.js'
import { Settings } from '../src/client/Settings.js'
import { createApi } from '../src/client/api.js'
import { FIELDS, resolveConfig } from '../src/core/config.js'
import { deriveFacts } from '../src/core/facts.js'
import { initialState, fold } from '../src/core/projection.js'
import { RecapEngine } from '../src/core/engine.js'
import { styles } from '../src/client/styles.js'
import type { SettingsView } from '../src/core/api.js'

// 使用合成会话，不读取真实对话或调用模型。
let active = 'zh',
  revision = 0,
  conflict = false,
  unavailable = false,
  config = resolveConfig({ mode: 'deterministic', minTurns: 0 })
const listeners = new Set<() => void>(),
  calls: { route: string; body: Record<string, unknown> }[] = []
let state = initialState(),
  seq = 0
const append = (type: string, data: unknown) => {
  state = fold(state, { type, data, seq: seq++, time: Date.now() - 180000 })
}
append('turn/start', { turn: 7 })
append('user/message', {
  source: { kind: 'user' },
  content: [{ type: 'text', text: '为配置中心补齐只读权限测试，并验证灰度发布不会越权。' }],
})
append('assistant/message', {
  message: {
    content: [{ type: 'text', text: '已定位目录权限边界并补充测试用例，尚未执行完整回归。' }],
  },
})
append('turn/end', { turn: 7 })
append('tool/result', {
  message: {
    isError: true,
    content: [{ type: 'text', text: '早前一次测试连接超时，后续情况未确认。' }],
  },
})
const instance = {},
  engine = new RecapEngine({
    config: () => config,
    generate: async () => {
      throw new Error('Browser fixture must never call a model')
    },
    snapshot: (id) => ({
      instance,
      running: false,
      subagent: false,
      facts: deriveFacts(id, state, config, {
        title: '配置中心 · 权限边界验证',
        todos: [
          { content: '补齐只读权限用例', status: 'completed' },
          { content: '执行灰度环境回归', status: 'pending' },
        ],
        goal: {
          goal: {
            objective:
              '为配置中心补齐只读权限测试，检查目录权限边界，并验证灰度发布不会越权。核对读写能力隔离，覆盖管理员与普通成员的不同角色。',
            phase: 'active',
          },
        },
        files: [
          { path: 'src/permissions/ReadOnlyPolicyTest.java', added: 42, deleted: 3, turn: 7 },
        ],
      }),
    }),
  })
await engine.request('browser-session', 'manual')
let viewEpoch = 0
const settings = (): SettingsView => ({
  config,
  fields: FIELDS,
  namespace: 'recap',
  revision,
  writable: true,
})
const api = createApi(async (input, init) => {
  const route = input.split('/').at(-1)!,
    body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  calls.push({ route, body })
  let data: unknown
  if (unavailable && !['settings', 'save-settings'].includes(route))
    return Response.json(
      { ok: false, error: { code: 'NOT_LIVE', message: 'Not loaded yet' } },
      { status: 404 },
    )
  if (route === 'settings') data = settings()
  else if (route === 'save-settings') {
    if (conflict || body.revision !== revision) {
      conflict = false
      return Response.json(
        { ok: false, error: { code: 'CONFLICT', message: 'Changed elsewhere' } },
        { status: 409 },
      )
    }
    config = resolveConfig({ ...config, ...(body.patch as object) })
    revision++
    data = settings()
    engine.syncConfig()
  } else if (route === 'presence') {
    data = engine.presence(String(body.sessionId), {
      clientId: String(body.clientId),
      sequence: Number(body.sequence),
      visible: body.visible === true,
      active: body.active === true,
      open: body.open === true,
      closed: body.closed === true,
      locale: typeof body.locale === 'string' ? body.locale : undefined,
    })
  } else if (route === 'dismiss') data = engine.dismiss(String(body.sessionId))
  else if (route === 'refresh') {
    const sessionId = String(body.sessionId)
    engine.state(sessionId)
    engine.background(sessionId, 'manual', true)
    data = engine.state(sessionId)
  } else
    data = engine.state(
      String(body.sessionId),
      typeof body.clientId === 'string' ? body.clientId : undefined,
    )
  return Response.json({ ok: true, data })
})
const loadModels = async () => ({
  default: { provider: 'configured', model: 'main' },
  routableProviders: ['configured'],
  groups: [{ id: 'configured', name: '已配置服务商', models: [{ id: 'small', name: '轻量模型' }] }],
  failures: [],
})
const locale = {
  active: () => active,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
const style = document.createElement('style')
style.textContent = styles
document.head.append(style)
const root = createRoot(document.getElementById('root')!)
function App() {
  const [settingsCommand, setSettingsCommand] = useState({ id: 'historical-settings', time: 0 })
  const [dialogMount, setDialogMount] = useState(0)
  return (
    <>
      <header className="fixture-heading">
        <span>DSH RECAP · COMPONENT PREVIEW</span>
        <p>配置中心 · 权限边界验证</p>
      </header>
      <main>
        <article className="fixture-message">
          已定位目录权限检查的差异。回归测试是下一步；这不是已完成上线的声明。
        </article>
        <RecapView api={api} locale={locale} sessionId="browser-session" turn={7} />
        <textarea aria-label="Conversation input" placeholder="继续之前的工作…" />
        <hr />
        <button onClick={() => setSettingsCommand({ id: crypto.randomUUID(), time: Date.now() })}>
          Run settings command
        </button>
        <button onClick={() => setDialogMount(dialogMount + 1)}>Remount settings command</button>
        <SettingsDialog
          key={`${settingsCommand.id}:${dialogMount}`}
          requestId={settingsCommand.id}
          requestedAt={settingsCommand.time}
          api={api}
          locale={locale}
          loadModels={loadModels}
        />
        <Settings api={api} locale={locale} loadModels={loadModels} />
      </main>
    </>
  )
}
root.render(<App />)
Object.assign(window, {
  recapTest: {
    calls,
    locale: (value: string) => {
      active = value
      for (const listener of listeners) listener()
    },
    conflict: () => {
      conflict = true
    },
    unavailable: () => {
      unavailable = true
      root.render(<App key={++viewEpoch} />)
    },
    showAuto: async () => {
      unavailable = false
      await engine.request('browser-session', 'manual')
      root.render(<App key={++viewEpoch} />)
    },
    continue: () => engine.activity('browser-session'),
    unmount: () => {
      root.unmount()
      engine.dispose()
    },
    show: async () => {
      unavailable = false
      await engine.request('browser-session', 'manual')
      root.render(<App key={++viewEpoch} />)
    },
  },
})
