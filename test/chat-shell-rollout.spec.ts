import { describe, expect, it } from 'vitest'
import { HOME_AUTH_REDIRECT } from '../src/pages/homeContent'
import {
  authHomePath,
  CLASSIC_AUTH_HOME,
  CHAT_SHELL_AUTH_HOME,
  resolveChatShellGateReason,
  resolveChatShellRollout,
} from '../src/features/chat-shell/chatShellRollout'

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

  it('opens chat for every signed-in user when the flag is on, even without an invite', () => {
    for (const betaAccess of [false, null] as const) {
      const row = resolveChatShellRollout({
        killSwitch: 'enabled',
        betaAccess,
        preferredUi: 'classic',
      })
      expect(row.canAccessChat).toBe(true)
      expect(row.showSwitch).toBe(true)
      expect(row.effectiveHome).toBe('chat')
    }
  })

  it('sends flag-on users to chat even if they still prefer classic', () => {
    const row = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: true,
      preferredUi: 'classic',
    })
    expect(row.canAccessChat).toBe(true)
    expect(row.effectiveHome).toBe('chat')
  })

  it('keeps reporting betaAccess without using it as a gate', () => {
    const invited = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: true,
      preferredUi: 'chat',
    })
    const uninvited = resolveChatShellRollout({
      killSwitch: 'enabled',
      betaAccess: false,
      preferredUi: 'chat',
    })
    expect(invited.betaAccess).toBe(true)
    expect(uninvited.betaAccess).toBe(false)
    expect(invited.canAccessChat).toBe(true)
    expect(uninvited.canAccessChat).toBe(true)
  })
})

describe('resolveChatShellGateReason', () => {
  it('never uses invite copy after cutover', () => {
    expect(resolveChatShellGateReason('unreadable')).toBe('unreadable')
    expect(resolveChatShellGateReason('disabled')).toBe('disabled')
    expect(resolveChatShellGateReason('loading')).toBe('disabled')
    expect(resolveChatShellGateReason('enabled')).toBe('disabled')
  })
})

describe('authHomePath', () => {
  it('lands allowed users on /chat and fail-closed users on /dashboard', () => {
    expect(authHomePath(true)).toBe(CHAT_SHELL_AUTH_HOME)
    expect(authHomePath(false)).toBe(CLASSIC_AUTH_HOME)
    expect(CHAT_SHELL_AUTH_HOME).toBe('/chat')
    expect(CLASSIC_AUTH_HOME).toBe('/dashboard')
    expect(HOME_AUTH_REDIRECT).toBe('/chat')
  })
})
