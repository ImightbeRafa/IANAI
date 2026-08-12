import { describe, expect, it } from 'vitest'
import {
  brandOpenStorageKey,
  formatRelativeSessionTime,
  isDefaultSessionTitle,
  readBrandOpen,
  resolveSessionSidebarTitle,
  truncateSidebarTitle,
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

  it('honors explicit collapse (0) vs null default', () => {
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
  })
})
