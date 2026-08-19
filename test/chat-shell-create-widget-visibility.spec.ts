import { describe, expect, it } from 'vitest'
import {
  createWidgetHiddenStorageKey,
  isCreateWidgetAvailable,
  readCreateWidgetHidden,
  writeCreateWidgetHidden,
} from '../src/features/chat-shell/useChatCreateWidgetVisibility'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  clear() {
    this.data.clear()
  }
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
}

describe('create widget visibility', () => {
  it('uses a per-user per-business hidden key', () => {
    expect(createWidgetHiddenStorageKey('u1', 'b1')).toBe(
      'ianai.chat-shell.createWidget.hidden.u1.b1'
    )
  })

  it('is available only with a session and an offer name', () => {
    expect(isCreateWidgetAvailable({ sessionId: 's1', offerName: 'Arnés' })).toBe(true)
    expect(isCreateWidgetAvailable({ sessionId: null, offerName: 'Arnés' })).toBe(false)
    expect(isCreateWidgetAvailable({ sessionId: 's1', offerName: '  ' })).toBe(false)
  })

  it('defaults to visible, persists hide, and removes the key on show', () => {
    const storage = new MemoryStorage()
    expect(readCreateWidgetHidden(storage, 'u1', 'b1')).toBe(false)
    writeCreateWidgetHidden(storage, 'u1', 'b1', true)
    expect(storage.getItem('ianai.chat-shell.createWidget.hidden.u1.b1')).toBe('1')
    expect(readCreateWidgetHidden(storage, 'u1', 'b1')).toBe(true)
    expect(readCreateWidgetHidden(storage, 'u1', 'b2')).toBe(false)
    writeCreateWidgetHidden(storage, 'u1', 'b1', false)
    expect(storage.getItem('ianai.chat-shell.createWidget.hidden.u1.b1')).toBeNull()
    expect(readCreateWidgetHidden(storage, 'u1', 'b1')).toBe(false)
  })

  it('never throws when storage is missing', () => {
    expect(readCreateWidgetHidden(null, 'u1', 'b1')).toBe(false)
    expect(() => writeCreateWidgetHidden(null, 'u1', 'b1', true)).not.toThrow()
  })
})
