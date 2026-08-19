import { describe, expect, it } from 'vitest'
import {
  brandOpenStorageKey,
  formatRelativeSessionTime,
  isDefaultSessionTitle,
  openSessionActionMenu,
  openSessionDeleteConfirm,
  readBrandOpen,
  resolveBrandOpenMap,
  resolveSessionSidebarTitle,
  sessionActionAnchorFromRect,
  truncateSidebarTitle,
  uniquifySidebarLabels,
  writeBrandOpen,
} from '../src/features/chat-shell/chatShellSidebar'

describe('chatShellSidebar titles', () => {
  it('treats Session · / Quick · / New chat as default spam', () => {
    expect(isDefaultSessionTitle('Session · Aug 11, 09:27 PM')).toBe(true)
    expect(isDefaultSessionTitle('Quick · Aug 11, 09:27 PM')).toBe(true)
    expect(isDefaultSessionTitle('New chat')).toBe(true)
    expect(isDefaultSessionTitle('Campaign kickoff')).toBe(false)
  })

  it('prefers stored title, then first user message, then relative time', () => {
    const stored = resolveSessionSidebarTitle({
      session: {
        title: 'Launch offer A',
        updated_at: '2026-08-12T21:27:00.000Z',
        created_at: '2026-08-12T21:27:00.000Z',
      },
      firstUserMessage: 'ignore me',
    })
    expect(stored.label).toBe('Launch offer A')
    expect(stored.fullTitle).toBe('Launch offer A')

    const fromMsg = resolveSessionSidebarTitle({
      session: {
        title: 'Session · Aug 11, 09:27 PM',
        updated_at: '2026-08-12T21:27:00.000Z',
        created_at: '2026-08-11T21:27:00.000Z',
      },
      firstUserMessage: 'dame un guion corto de venta para el lanzamiento',
    })
    expect(fromMsg.label.endsWith('…') || fromMsg.label.length <= 40).toBe(true)
    expect(fromMsg.fullTitle).toContain('dame un guion')
    expect(fromMsg.label).not.toMatch(/^Session/)

    const relative = resolveSessionSidebarTitle({
      session: {
        title: 'New chat',
        updated_at: '2026-08-11T15:00:00.000Z',
        created_at: '2026-08-11T15:00:00.000Z',
      },
      nowMs: Date.parse('2026-08-12T12:00:00.000Z'),
    })
    expect(relative.label).toBe('Yesterday')
  })

  it('formats Today / Yesterday / month day', () => {
    const now = Date.parse('2026-08-12T18:00:00.000Z')
    expect(formatRelativeSessionTime('2026-08-12T15:27:00.000Z', now)).toMatch(/^Today /)
    expect(formatRelativeSessionTime('2026-08-11T15:27:00.000Z', now)).toBe('Yesterday')
    expect(formatRelativeSessionTime('2026-08-10T15:27:00.000Z', now)).toMatch(/Aug/)
  })

  it('formats Hoy / Ayer in Spanish', () => {
    const now = Date.parse('2026-08-12T18:00:00.000Z')
    expect(formatRelativeSessionTime('2026-08-12T15:27:00.000Z', now, 'es')).toMatch(/^Hoy /)
    expect(formatRelativeSessionTime('2026-08-11T15:27:00.000Z', now, 'es')).toBe('Ayer')
    expect(formatRelativeSessionTime('2026-08-10T15:27:00.000Z', now, 'es')).not.toMatch(/Today|Yesterday/)
  })

  it('numbers duplicate sidebar labels in list order', () => {
    expect(uniquifySidebarLabels([
      { id: 'a', label: 'Hoy 6:11 p. m.' },
      { id: 'b', label: 'Launch' },
      { id: 'c', label: 'Hoy 6:11 p. m.' },
    ])).toEqual({
      a: 'Hoy 6:11 p. m. · 1',
      b: 'Launch',
      c: 'Hoy 6:11 p. m. · 2',
    })
  })

  it('truncates around 36–42 chars without Session spam', () => {
    const long = 'a'.repeat(80)
    const out = truncateSidebarTitle(long, 40)
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('brand open persistence', () => {
  it('reads and writes ianai.sidebar.brandOpen.{businessId}', () => {
    const store: Record<string, string> = {}
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
    }
    expect(brandOpenStorageKey('b1')).toBe('ianai.sidebar.brandOpen.b1')
    expect(readBrandOpen(storage, 'b1')).toBeNull()
    writeBrandOpen(storage, 'b1', true)
    expect(readBrandOpen(storage, 'b1')).toBe(true)
    writeBrandOpen(storage, 'b1', false)
    expect(readBrandOpen(storage, 'b1')).toBe(false)
  })

  it('honors explicit collapse (0) across remount; null defaults active only', () => {
    const store: Record<string, string> = {
      'ianai.sidebar.brandOpen.active': '0',
    }
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
    }
    expect(readBrandOpen(storage, 'active')).toBe(false)
    expect(readBrandOpen(storage, 'other')).toBeNull()

    const map = resolveBrandOpenMap({
      businessIds: ['active', 'other'],
      activeBrandId: 'active',
      readStored: (id) => readBrandOpen(storage, id),
    })
    expect(map.active).toBe(false) // stored 0 wins even when active
    expect(map.other).toBe(false) // null + inactive → collapsed

    // Simulate activeBrandId effect re-run / reload with previous in-memory map:
    // stored 0 must still win (never treat false as missing).
    const afterActiveFlip = resolveBrandOpenMap({
      businessIds: ['active', 'other'],
      activeBrandId: 'active',
      readStored: (id) => readBrandOpen(storage, id),
      previous: { active: true, other: false },
    })
    expect(afterActiveFlip.active).toBe(false)
    expect(Object.keys(store)).toEqual(['ianai.sidebar.brandOpen.active']) // no invented writes

    const fresh = resolveBrandOpenMap({
      businessIds: ['fresh'],
      activeBrandId: 'fresh',
      readStored: () => null,
    })
    expect(fresh.fresh).toBe(true) // null + active → default-expand
  })

  it('does not force-open when stored null, previous false, becomes active', () => {
    const map = resolveBrandOpenMap({
      businessIds: ['b1'],
      activeBrandId: 'b1',
      readStored: () => null,
      previous: { b1: false },
    })
    expect(map.b1).toBe(false)
  })

  it('default-expands when activeBrandId arrives after first paint with unset previous', () => {
    const beforeActive = resolveBrandOpenMap({
      businessIds: ['b1'],
      activeBrandId: null,
      readStored: () => null,
    })
    expect(beforeActive.b1).toBeUndefined()

    const afterActive = resolveBrandOpenMap({
      businessIds: ['b1'],
      activeBrandId: 'b1',
      readStored: () => null,
      previous: beforeActive,
    })
    expect(afterActive.b1).toBe(true)
  })

  it('stored 0 wins across activeBrandId flips (no LS invent)', () => {
    const store: Record<string, string> = {
      'ianai.sidebar.brandOpen.b1': '0',
    }
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
    }
    const first = resolveBrandOpenMap({
      businessIds: ['b1', 'b2'],
      activeBrandId: 'b2',
      readStored: (id) => readBrandOpen(storage, id),
    })
    expect(first.b1).toBe(false)
    expect(first.b2).toBe(true) // null + active, previous unset

    const back = resolveBrandOpenMap({
      businessIds: ['b1', 'b2'],
      activeBrandId: 'b1',
      readStored: (id) => readBrandOpen(storage, id),
      previous: first,
    })
    expect(back.b1).toBe(false) // stored 0 still wins
    expect(store['ianai.sidebar.brandOpen.b1']).toBe('0') // name/URL path must not write 1 over 0
  })

  it('does not accordion-open a collapsed folder when the active brand changes', () => {
    const first = resolveBrandOpenMap({
      businessIds: ['bloom', 'luna'],
      activeBrandId: 'bloom',
      readStored: () => null,
    })
    expect(first.bloom).toBe(true)
    expect(first.luna).toBe(false)

    const switched = resolveBrandOpenMap({
      businessIds: ['bloom', 'luna'],
      activeBrandId: 'luna',
      readStored: () => null,
      previous: first,
    })
    expect(switched.bloom).toBe(true)
    expect(switched.luna).toBe(false)
  })
})

describe('session ⋯ action panel', () => {
  it('anchors menu under the triggering more button', () => {
    expect(
      sessionActionAnchorFromRect({ bottom: 120.4, right: 300.2 }, 800)
    ).toEqual({ top: 122, right: 500 })
  })

  it('toggles menu and clears prior confirm when opening another row', () => {
    const a = openSessionActionMenu(null, 's1', { top: 10, right: 10 })
    expect(a).toEqual({ kind: 'menu', sessionId: 's1', anchor: { top: 10, right: 10 } })
    expect(openSessionActionMenu(a, 's1', { top: 10, right: 10 })).toBeNull()

    const confirm = openSessionDeleteConfirm('s1', { top: 10, right: 10 })
    expect(confirm.kind).toBe('confirm')
    expect(confirm.sessionId).toBe('s1')

    // Opening ⋯ on another row replaces confirm (one panel globally).
    const other = openSessionActionMenu(confirm, 's2', { top: 40, right: 12 })
    expect(other).toEqual({ kind: 'menu', sessionId: 's2', anchor: { top: 40, right: 12 } })
  })

  it('confirm keeps the captured session id (2-step; never instant)', () => {
    const menu = openSessionActionMenu(null, 'captured', { top: 1, right: 2 })
    expect(menu?.sessionId).toBe('captured')
    const confirm = openSessionDeleteConfirm(menu!.sessionId, menu!.anchor)
    expect(confirm).toEqual({
      kind: 'confirm',
      sessionId: 'captured',
      anchor: { top: 1, right: 2 },
    })
  })
})
