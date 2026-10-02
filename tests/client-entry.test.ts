import { it, expect, vi, onTestFinished } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { resolveSlotLabel, type SlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import * as Client from '../src/client/index.js'
import { createElement, type ComponentType, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
async function mount() {
  const ctx = new Context(),
    styles = new Set<object>(),
    rows = new Map<string, Record<string, unknown>>()
  let active = 'zh'
  vi.stubGlobal('document', {
    head: { append: (element: object) => styles.add(element) },
    createElement: () => {
      const element = { dataset: {}, textContent: '', remove: () => styles.delete(element) }
      return element
    },
  })
  class Slots extends Service {
    constructor(owner: Context) {
      super(owner, 'slots')
    }
    inject(_name: string, install: () => () => void) {
      return this.ctx.effect(install)
    }
    register(meta: Record<string, unknown>, component: unknown) {
      const key = String(meta.name),
        value = { ...meta, component }
      rows.set(key, value)
      return () => {
        if (rows.get(key) === value) rows.delete(key)
      }
    }
  }
  class Locale extends Service {
    constructor(owner: Context) {
      super(owner, 'locale')
    }
    getSnapshot() {
      return { active }
    }
    subscribe() {
      return () => {}
    }
  }
  const modelRemote = {
    modelCatalog: async () => ({
      ok: true,
      value: {
        default: { provider: '', model: '' },
        routableProviders: [],
        groups: [],
        failures: [],
      },
    }),
  }
  ctx.provide('remote', { session: modelRemote })
  ctx.provide('remote.session', modelRemote)
  await ctx.plugin(Slots)
  await ctx.plugin(Locale)
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    vi.unstubAllGlobals()
  })
  const fiber = await ctx.plugin(Client)
  return {
    ctx,
    fiber,
    styles,
    rows,
    language: (value: string) => {
      active = value
      ctx.emit('locale/change')
    },
  }
}
it('registers the conversation dock and native settings section', async () => {
  const f = await mount()
  expect(f.styles.size).toBe(1)
  expect(f.rows.get('conversation.chat.turnTail')?.id).toBe('dsh-recap')
  const label = f.rows.get('settings.section')?.label as SlotLabel | undefined
  expect(typeof label).toBe('function')
  expect(resolveSlotLabel(label)).toBe('会话回顾')
})
it('mounts the automatic recap only for the latest open turn', async () => {
  const f = await mount()
  const tail = f.rows.get('conversation.chat.turnTail')?.component as (
    props: object,
  ) => ReactElement<{ sessionId: string; turn: number }> | null
  const props = {
    sessionId: 'live-session',
    turn: { turn: 3 },
    useChat: (select: (value: object) => unknown) =>
      select({ timeline: { turnOrder: [1, 2, 3], turns: new Map() }, order: [], nodes: new Map() }),
    useSession: (select: (value: object) => unknown) =>
      select({ blank: false, removed: false, openState: 'open' }),
  }
  expect(tail(props)?.props.sessionId).toBe('live-session')
  expect(tail(props)?.props.turn).toBe(3)
  expect(tail({ ...props, turn: { turn: 2 } })).toBeNull()
  expect(tail({ ...props, useSession: () => false })).toBeNull()
})
it('updates the menu label without replacing the settings entry when locale changes', async () => {
  const f = await mount(),
    entry = f.rows.get('settings.section'),
    label = entry?.label as SlotLabel | undefined
  f.language('en')
  expect(f.rows.get('settings.section')).toBe(entry)
  expect(resolveSlotLabel(label)).toBe('Recap')
  f.language('zh-CN')
  expect(f.rows.get('settings.section')).toBe(entry)
  expect(resolveSlotLabel(label)).toBe('会话回顾')
  expect(f.rows.size).toBe(4)
})
it('removes styles and registrations on unload', async () => {
  const f = await mount()
  await f.fiber.dispose()
  f.language('en')
  expect(f.styles.size).toBe(0)
  expect(f.rows.size).toBe(0)
})
it('does not accumulate duplicate registrations across remounts', async () => {
  const f = await mount()
  await f.fiber.dispose()
  await f.ctx.plugin(Client)
  expect(f.styles.size).toBe(1)
  expect(f.rows.size).toBe(4)
})

import { createClientId } from '../src/client/use-recap.js'
it('creates a bounded presence identifier when randomUUID is unavailable', () => {
  vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(15) })
  try {
    expect(createClientId()).toBe('0f'.repeat(16))
  } finally {
    vi.unstubAllGlobals()
  }
})
it('renders recap command rows in chat instead of the composer dock', async () => {
  const f = await mount()
  expect(f.rows.get('conversation.input.dock')?.id).toBe('dsh-recap-empty-command')
  expect(f.rows.get('conversation.chat.commandview')?.key).toBe('recap')
  expect(f.rows.has('conversation.chat.turnTail')).toBe(true)
  const component = f.rows.get('conversation.chat.commandview')?.component as ComponentType<
    Record<string, unknown>
  >
  const old = { seq: 1, name: 'recap', args: '', outcome: { kind: 'success', text: '旧摘要' } }
  const latest = { seq: 2, name: 'recap', args: 'refresh', outcome: null }
  const props = {
    useSession: () => true,
    useChat: (select: (value: object) => unknown) =>
      select({
        timeline: { turnOrder: [3], turns: new Map() },
        order: ['old', 'latest'],
        nodes: new Map([
          ['old', { kind: 'command', data: old }],
          ['latest', { kind: 'command', data: latest }],
        ]),
      }),
  }
  expect(renderToStaticMarkup(createElement(component, { ...props, node: old }))).toBe(
    '<div data-dshr-command="true"></div>',
  )
  expect(renderToStaticMarkup(createElement(component, { ...props, node: latest }))).toBe(
    '<div data-dshr-command="true"></div>',
  )
  expect(
    renderToStaticMarkup(
      createElement(component, {
        ...props,
        node: { ...latest, args: 'help', outcome: { kind: 'success', text: '命令帮助' } },
      }),
    ),
  ).toContain('命令帮助')
})

it('places the latest recap after Compact in its command row without a duplicate turn preview', async () => {
  const f = await mount()
  const command = { seq: 12, name: 'recap', args: '', outcome: { kind: 'success', text: '已受理' } }
  const snapshot = {
    timeline: { turnOrder: [3], turns: new Map([[3, { end: { seq: 10 } }]]) },
    order: ['compact', 'recap'],
    nodes: new Map([
      ['compact', { kind: 'command', data: { seq: 11, name: 'compact' } }],
      ['recap', { kind: 'command', data: command }],
    ]),
  }
  const props = {
    sessionId: 'live-session',
    turn: { turn: 3 },
    node: command,
    useChat: (select: (value: object) => unknown) => select(snapshot),
    useSession: () => true,
  }
  const row = f.rows.get('conversation.chat.commandview')?.component as (
    props: object,
  ) => ReactElement<{ children: ReactElement<{ turn: number }> | null }> | null
  const tail = f.rows.get('conversation.chat.turnTail')?.component as (
    props: object,
  ) => ReactElement | null
  expect(row(props)?.props.children?.props.turn).toBe(3)
  expect(tail(props)).toBeNull()
  snapshot.timeline.turns.set(3, { end: { seq: 13 } })
  expect(row(props)?.props.children).toBeNull()
  expect(tail(props)).not.toBeNull()
})

it('空白会话也保留命令的无数据提示', async () => {
  const f = await mount()
  const component = f.rows.get('conversation.chat.commandview')?.component as ComponentType<
    Record<string, unknown>
  >
  const node = {
    seq: 1,
    name: 'recap',
    args: '',
    outcome: { kind: 'error', text: '暂无可回顾的对话' },
  }
  const html = renderToStaticMarkup(
    createElement(component, {
      node,
      sessionId: 'empty',
      useSession: () => false,
      useChat: (select: (value: object) => unknown) =>
        select({
          timeline: { turnOrder: [], turns: new Map() },
          order: ['command'],
          nodes: new Map([['command', { kind: 'command', data: node }]]),
        }),
    }),
  )
  expect(html).toContain('暂无可回顾的对话')
})

it('空白会话在输入区显示命令反馈，普通会话不重复展示', async () => {
  const f = await mount()
  const component = f.rows.get('conversation.input.dock')?.component as ComponentType<
    Record<string, unknown>
  >
  const node = {
    seq: 1,
    name: 'recap',
    args: '',
    outcome: { kind: 'error', text: '当前还没有可展示的回顾' },
  }
  const props = {
    sessionId: 'empty',
    useSession: () => true,
    useChat: (select: (value: object) => unknown) =>
      select({
        timeline: { turnOrder: [], turns: new Map() },
        order: ['cmd'],
        nodes: new Map([['cmd', { kind: 'command', data: node }]]),
      }),
  }
  expect(renderToStaticMarkup(createElement(component, props))).toContain('当前还没有可展示的回顾')
  expect(
    renderToStaticMarkup(createElement(component, { ...props, useSession: () => false })),
  ).toBe('')
})

it.each(['settings', 'status', 'help'])(
  '执行 %s 后摘要仍位于 Compact 后的原回顾命令行',
  async (args) => {
    const f = await mount()
    const recap = { seq: 12, name: 'recap', args: '', outcome: { kind: 'success', text: '已受理' } }
    const later = { seq: 13, name: 'recap', args, outcome: { kind: 'success', text: '命令提示' } }
    const snapshot = {
      timeline: { turnOrder: [3], turns: new Map([[3, { end: { seq: 10 } }]]) },
      order: ['compact', 'recap', 'later'],
      nodes: new Map([
        ['compact', { kind: 'command', data: { seq: 11, name: 'compact' } }],
        ['recap', { kind: 'command', data: recap }],
        ['later', { kind: 'command', data: later }],
      ]),
    }
    const props = {
      sessionId: 's',
      turn: { turn: 3 },
      node: recap,
      useChat: (select: (value: object) => unknown) => select(snapshot),
      useSession: () => true,
    }
    const row = f.rows.get('conversation.chat.commandview')?.component as (
      props: object,
    ) => ReactElement<{ children: ReactElement<{ turn: number }> | null }>
    const tail = f.rows.get('conversation.chat.turnTail')?.component as (
      props: object,
    ) => ReactElement | null
    expect(row(props).props.children?.props.turn).toBe(3)
    expect(tail(props)).toBeNull()
  },
)
