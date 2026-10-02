import { beforeEach, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ViewState } from '../src/core/contracts.js'
import { RecapView } from '../src/client/RecapView.js'
import { createApi } from '../src/client/api.js'

const view = vi.hoisted(() => ({ current: null as ViewState | null }))
vi.mock('../src/client/use-recap.js', () => ({ useRecap: () => ({ state: view.current }) }))
const api = createApi(async () => {
  throw new Error('Rendering must not fetch')
})
const locale = { active: () => 'zh', subscribe: () => () => {} }
const render = (turn = 4) =>
  renderToStaticMarkup(<RecapView api={api} locale={locale} sessionId="s" turn={turn} />)

beforeEach(() => {
  view.current = {
    sessionId: 's',
    status: 'ready',
    revision: 1,
    hidden: false,
    displayTurn: 4,
    stale: true,
    recap: {
      id: 'cached',
      text: '已补齐权限用例，下一步运行验证。',
      source: 'facts',
      generatedAt: 1,
      watermark: 10,
      turn: 3,
      language: 'zh',
      provider: null,
      model: null,
      warning: null,
    },
    error: null,
    autoEnabled: true,
  }
})
it('renders an approved older cache only in its presentation turn and labels it as earlier', () => {
  const html = render()
  expect(html).toContain('已补齐权限用例')
  expect(html).toContain('较早回顾')
  expect(html).toContain('事实整理')
  expect(render(3)).toBe('')
  expect(view.current?.recap?.turn).toBe(3)
})
it('does not label current evidence as an earlier recap', () => {
  view.current!.stale = false
  expect(render()).not.toContain('较早回顾')
})
it.each([
  { hidden: true },
  { displayTurn: null },
  { displayTurn: 3 },
  { sessionId: 'another-session' },
])('rejects hidden or mismatched presentation state %j', (patch) => {
  Object.assign(view.current!, patch)
  expect(render()).toBe('')
})
it('shows manual generation only in the intended current turn', () => {
  view.current!.status = 'generating'
  expect(render()).toContain('正在整理回顾')
  expect(render(3)).toBe('')
})
it('keeps an unavailable state quiet', () => {
  view.current = null
  expect(render()).toBe('')
})
