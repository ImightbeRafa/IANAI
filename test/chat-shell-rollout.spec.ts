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

  it('denies chat when the flag is on but the user has no beta invite', () => {
    const row = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: false,
      preferredUi: 'chat',
    })
    expect(row.canAccessChat).toBe(false)
    expect(row.showSwitch).toBe(false)
    expect(row.effectiveHome).toBe('classic')
  })

  it('treats missing beta as deny when the kill switch is on', () => {
    const row = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: null,
      preferredUi: 'chat',
    })
    expect(row.canAccessChat).toBe(false)
    expect(row.effectiveHome).toBe('classic')
  })

  it('keeps classic home for invited users until they opt into chat', () => {
    const row = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: true,
      preferredUi: 'classic',
    })
    expect(row.canAccessChat).toBe(true)
    expect(row.showSwitch).toBe(true)
    expect(row.effectiveHome).toBe('classic')
  })

  it('sends invited opted-in users to chat when the flag is on', () => {
    const row = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: true,
      preferredUi: 'chat',
    })
    expect(row.canAccessChat).toBe(true)
    expect(row.effectiveHome).toBe('chat')
  })
})
