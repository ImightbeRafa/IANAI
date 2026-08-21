import { afterEach, describe, expect, it } from 'vitest'
import {
  getTextModelPreference,
  setTextModelPreference,
  TEXT_MODEL_STORAGE_KEY,
} from '../src/features/chat-shell/textModelPreference'

describe('textModelPreference', () => {
  const store: Record<string, string> = {}
  const memory: Storage = {
    get length() {
      return Object.keys(store).length
    },
    clear() {
      for (const key of Object.keys(store)) delete store[key]
    },
    getItem(key: string) {
      return store[key] ?? null
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null
    },
    removeItem(key: string) {
      delete store[key]
    },
    setItem(key: string, value: string) {
      store[key] = String(value)
    },
  }

  afterEach(() => {
    memory.clear()
  })

  it('defaults to best and round-trips efficient', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true })
    memory.removeItem(TEXT_MODEL_STORAGE_KEY)
    expect(getTextModelPreference()).toBe('best')
    setTextModelPreference('efficient')
    expect(getTextModelPreference()).toBe('efficient')
    setTextModelPreference('best')
    expect(getTextModelPreference()).toBe('best')
  })
})
