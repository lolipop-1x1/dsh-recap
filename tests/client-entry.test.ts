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
    useChat: (select: (value: object) => unknown) => select({ timeline: { turnOrder: [1, 2, 3] } }),
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
  expect(f.rows.size).toBe(3)
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
  expect(f.rows.size).toBe(3)
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
  expect(f.rows.has('conversation.input.dock')).toBe(false)
  expect(f.rows.get('conversation.chat.commandview')?.key).toBe('recap')
  expect(f.rows.has('conversation.chat.turnTail')).toBe(true)
  const component = f.rows.get('conversation.chat.commandview')?.component as ComponentType<
    Record<string, unknown>
  >
  const old = { seq: 1, name: 'recap', args: '', outcome: { kind: 'success', text: '旧摘要' } }
  const latest = { seq: 2, name: 'recap', args: 'refresh', outcome: null }
  const props = {
    useChat: (select: (value: object) => unknown) =>
      select({
        order: ['old', 'latest'],
        nodes: new Map([
          ['old', { kind: 'command', data: old }],
          ['latest', { kind: 'command', data: latest }],
        ]),
      }),
  }
  expect(renderToStaticMarkup(createElement(component, { ...props, node: old }))).toBe('')
  expect(renderToStaticMarkup(createElement(component, { ...props, node: latest }))).toBe('')
  expect(
    renderToStaticMarkup(
      createElement(component, {
        ...props,
        node: { ...latest, args: 'help', outcome: { kind: 'success', text: '命令帮助' } },
      }),
    ),
  ).toContain('命令帮助')
})
