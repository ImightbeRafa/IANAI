import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_SHELL_ACTIVE_BRAND_KEY,
  CHAT_SHELL_ACTIVE_SESSION_KEY,
  persistSelection,
  readStoredSelection,
  resolveInitialSelection,
  selectionFromSearchParams,
  selectionToSearchParams,
} from '../src/features/chat-shell/chatShellPersistence'

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null
    },
    removeItem(key: string) {
      map.delete(key)
    },
    setItem(key: string, value: string) {
      map.set(key, String(value))
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chatShellPersistence', () => {
  it('parses brand/session from search params', () => {
    const params = new URLSearchParams('brand=b1&session=s1&extra=1')
    expect(selectionFromSearchParams(params)).toEqual({
      brandId: 'b1',
      sessionId: 's1',
    })
  })

  it('treats empty search values as null', () => {
    expect(selectionFromSearchParams(new URLSearchParams('brand=&session='))).toEqual({
      brandId: null,
      sessionId: null,
    })
  })

  it('serializes only set selection keys', () => {
    expect(selectionToSearchParams({ brandId: 'b1', sessionId: null }).toString()).toBe('brand=b1')
    expect(selectionToSearchParams({ brandId: null, sessionId: 's1' }).toString()).toBe('session=s1')
    expect(selectionToSearchParams({ brandId: null, sessionId: null }).toString()).toBe('')
  })

  it('prefers URL over storage', () => {
    expect(
      resolveInitialSelection(
        { brandId: 'url-brand', sessionId: 'url-session' },
        { brandId: 'stored-brand', sessionId: 'stored-session' }
      )
    ).toEqual({ brandId: 'url-brand', sessionId: 'url-session' })
  })

  it('keeps URL session even when brand is missing or mismatched in storage', () => {
    expect(
      resolveInitialSelection(
        { brandId: null, sessionId: 'url-session' },
        { brandId: 'other-brand', sessionId: 'stored-session' }
      )
    ).toEqual({ brandId: 'other-brand', sessionId: 'url-session' })

    expect(
      resolveInitialSelection(
        { brandId: null, sessionId: 'deep-link' },
        { brandId: null, sessionId: null }
      )
    ).toEqual({ brandId: null, sessionId: 'deep-link' })
  })

  it('does not pair a URL brand with an unrelated stored session', () => {
    expect(
      resolveInitialSelection(
        { brandId: 'url-brand', sessionId: null },
        { brandId: 'other-brand', sessionId: 'stored-session' }
      )
    ).toEqual({ brandId: 'url-brand', sessionId: null })
  })

  it('restores stored session when brand matches', () => {
    expect(
      resolveInitialSelection(
        { brandId: null, sessionId: null },
        { brandId: 'b1', sessionId: 's1' }
      )
    ).toEqual({ brandId: 'b1', sessionId: 's1' })
  })

  it('persists and clears localStorage keys', () => {
    persistSelection({ brandId: 'b1', sessionId: 's1' })
    expect(localStorage.getItem(CHAT_SHELL_ACTIVE_BRAND_KEY)).toBe('b1')
    expect(localStorage.getItem(CHAT_SHELL_ACTIVE_SESSION_KEY)).toBe('s1')
    expect(readStoredSelection()).toEqual({ brandId: 'b1', sessionId: 's1' })

    persistSelection({ brandId: null, sessionId: null })
    expect(localStorage.getItem(CHAT_SHELL_ACTIVE_BRAND_KEY)).toBeNull()
    expect(localStorage.getItem(CHAT_SHELL_ACTIVE_SESSION_KEY)).toBeNull()
  })

  it('survives unavailable localStorage', () => {
    vi.stubGlobal('localStorage', {
      get length() {
        return 0
      },
      clear() {
        throw new Error('blocked')
      },
      getItem() {
        throw new Error('blocked')
      },
      key() {
        return null
      },
      removeItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    } satisfies Storage)
    expect(readStoredSelection()).toEqual({ brandId: null, sessionId: null })
    expect(() => persistSelection({ brandId: 'b1', sessionId: 's1' })).not.toThrow()
  })
})
