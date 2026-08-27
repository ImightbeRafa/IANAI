import { describe, expect, it } from 'vitest'
import { resolveChatShellRollout } from '../src/features/chat-shell/chatShellRollout'

describe('resolveChatShellRollout', () => {
  it('fails closed when the kill switch is off or unreadable', () => {
    for (const killSwitch of ['disabled', 'unreadable', 'loading'] as const) {
      const row = resolveChatShellRollout({
        killSwitch,
        betaAccess: true,
        preferredUi: 'chat',
      })
      expect(row.canAccessChat).toBe(false)
      expect(row.showSwitch).toBe(false)
      expect(row.effectiveHome).toBe('classic')
    }
  })

  it('opens chat to all users when the flag is on, even without beta invite', () => {
    const row = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: false,
      preferredUi: 'chat',
    })
    expect(row.canAccessChat).toBe(true)
    expect(row.showSwitch).toBe(true)
    expect(row.effectiveHome).toBe('chat')
  })

  it('treats missing beta as irrelevant when the kill switch is on', () => {
    const row = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: null,
      preferredUi: 'chat',
    })
    expect(row.canAccessChat).toBe(true)
    expect(row.effectiveHome).toBe('chat')
  })

  it('keeps classic home until the user opts into chat', () => {
    const row = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: false,
      preferredUi: 'classic',
    })
    expect(row.canAccessChat).toBe(true)
    expect(row.showSwitch).toBe(true)
    expect(row.effectiveHome).toBe('classic')
  })

  it('sends opted-in users to chat when the flag is on', () => {
    const row = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: true,
      preferredUi: 'chat',
    })
    expect(row.canAccessChat).toBe(true)
    expect(row.effectiveHome).toBe('chat')
  })
})
