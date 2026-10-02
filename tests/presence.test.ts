import { expect, it } from 'vitest'
import { Presence } from '../src/core/presence.js'

it('initializes a new tab watermark even when a heartbeat arrives before open', () => {
  const presence = new Presence(0)
  expect(presence.update({ clientId: 'new', sequence: 2, visible: true }, 1, 7)).toEqual({
    accepted: true,
  })
  expect(presence.canDisplay('new', 7)).toBe(false)
  expect(
    presence.update({ clientId: 'new', sequence: 1, visible: true, open: true }, 2, 7),
  ).toEqual({ accepted: false })
  expect(presence.canDisplay('new', 7)).toBe(false)
  expect(presence.canDisplay('new', 8)).toBe(true)
})

it('does not move the initial watermark when an open acknowledgment is lost and retried', () => {
  const presence = new Presence(0)
  presence.update({ clientId: 'a', sequence: 1, visible: true, open: true }, 1, 4)
  expect(presence.canDisplay('a', 4)).toBe(false)
  presence.update({ clientId: 'a', sequence: 2, visible: true, open: true }, 2, 5)
  expect(presence.canDisplay('a', 5)).toBe(true)
  expect(presence.update({ clientId: 'a', sequence: 1, visible: false, open: true }, 3, 6)).toEqual(
    { accepted: false },
  )
  expect(presence.isVisible(3)).toBe(true)
  expect(presence.canDisplay('a', 5)).toBe(true)
})

it('retains independent tab watermarks through lease expiry, blur, and remount reports', () => {
  const presence = new Presence(0)
  presence.update({ clientId: 'original', sequence: 1, visible: true, open: true }, 0, 2)
  presence.update({ clientId: 'refreshed', sequence: 1, visible: true }, 50_000, 3)
  expect(presence.canDisplay('original', 3)).toBe(true)
  expect(presence.canDisplay('refreshed', 3)).toBe(false)
  presence.update({ clientId: 'original', sequence: 2, visible: false }, 50_001, 3)
  presence.update({ clientId: 'original', sequence: 3, visible: true, open: true }, 50_002, 3)
  expect(presence.canDisplay('original', 3)).toBe(true)
  expect(presence.canDisplay('refreshed', 3)).toBe(false)
})

it('keeps close and visibility ordering separate from initialization', () => {
  const presence = new Presence(0)
  presence.update({ clientId: 'a', sequence: 2, visible: false, closed: true }, 1, 4)
  presence.update({ clientId: 'a', sequence: 1, visible: true, open: true }, 2, 5)
  expect(presence.canDisplay('a', 5)).toBe(false)
  expect(presence.hasOpen()).toBe(false)
  expect(presence.isVisible(2)).toBe(false)
})
