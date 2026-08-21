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

  it('keeps classic home when the flag is on but the user is not invited', () => {
    const row = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: false,
      preferredUi: 'chat',
    })
    expect(row.canAccessChat).toBe(false)
    expect(row.showSwitch).toBe(false)
    expect(row.effectiveHome).toBe('classic')
  })

  it('treats missing beta as not invited', () => {
    const row = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: null,
      preferredUi: 'chat',
    })
    expect(row.canAccessChat).toBe(false)
    expect(row.effectiveHome).toBe('classic')
  })

  it('lets invited testers stay on classic until they opt in', () => {
    const row = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: true,
      preferredUi: 'classic',
    })
    expect(row.canAccessChat).toBe(true)
    expect(row.showSwitch).toBe(true)
    expect(row.effectiveHome).toBe('classic')
  })

  it('sends invited testers to chat only when they prefer it', () => {
    const row = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: true,
      preferredUi: 'chat',
    })
    expect(row.canAccessChat).toBe(true)
    expect(row.effectiveHome).toBe('chat')
  })
})
