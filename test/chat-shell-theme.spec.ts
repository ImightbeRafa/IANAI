import { describe, expect, it } from 'vitest'
import {
  isChatShellTheme,
  resolveChatShellTheme,
} from '../src/features/chat-shell/chatShellTheme'

describe('chatShellTheme', () => {
  it('accepts only obsidian themes', () => {
    expect(isChatShellTheme('obsidian-dark')).toBe(true)
    expect(isChatShellTheme('obsidian-light')).toBe(true)
    expect(isChatShellTheme('dark')).toBe(false)
    expect(isChatShellTheme(null)).toBe(false)
  })

  it('prefers stored theme over system', () => {
    expect(resolveChatShellTheme('obsidian-light', false)).toBe('obsidian-light')
    expect(resolveChatShellTheme('obsidian-dark', true)).toBe('obsidian-dark')
  })

  it('falls back to system preference', () => {
    expect(resolveChatShellTheme(null, true)).toBe('obsidian-light')
    expect(resolveChatShellTheme('garbage', false)).toBe('obsidian-dark')
  })
})
