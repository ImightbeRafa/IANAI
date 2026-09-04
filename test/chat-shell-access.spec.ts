import { describe, expect, it } from 'vitest'
import { chatShellAccessFromFlag } from '../api/lib/chat-shell-access'

describe('chatShellAccessFromFlag', () => {
  it('grants access only when the kill switch row is enabled', () => {
    expect(chatShellAccessFromFlag(true)).toBe(true)
    expect(chatShellAccessFromFlag(false)).toBe(false)
    expect(chatShellAccessFromFlag(null)).toBe(false)
    expect(chatShellAccessFromFlag(undefined)).toBe(false)
    expect(chatShellAccessFromFlag('true')).toBe(false)
  })
})
