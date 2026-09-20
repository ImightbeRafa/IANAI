import { describe, expect, it } from 'vitest'
import { resolveHomeRedirect } from '../src/lib/homeRouteGate'
import { CLASSIC_AUTH_HOME, CHAT_SHELL_AUTH_HOME } from '../src/features/chat-shell/chatShellRollout'

describe('resolveHomeRedirect', () => {
  it('keeps the public landing while the session is still loading', () => {
    expect(resolveHomeRedirect({
      authLoading: true,
      hasUser: false,
      rolloutLoading: false,
      canAccessChat: false,
    })).toBeNull()
    expect(resolveHomeRedirect({
      authLoading: true,
      hasUser: true,
      rolloutLoading: false,
      canAccessChat: true,
    })).toBeNull()
  })

  it('keeps the public landing for anonymous visitors after auth resolves', () => {
    expect(resolveHomeRedirect({
      authLoading: false,
      hasUser: false,
      rolloutLoading: true,
      canAccessChat: false,
    })).toBeNull()
    expect(resolveHomeRedirect({
      authLoading: false,
      hasUser: false,
      rolloutLoading: false,
      canAccessChat: true,
    })).toBeNull()
  })

  it('keeps the public landing while rollout is unresolved for a signed-in user', () => {
    expect(resolveHomeRedirect({
      authLoading: false,
      hasUser: true,
      rolloutLoading: true,
      canAccessChat: true,
    })).toBeNull()
  })

  it('redirects resolved signed-in users to /chat or /dashboard', () => {
    expect(resolveHomeRedirect({
      authLoading: false,
      hasUser: true,
      rolloutLoading: false,
      canAccessChat: true,
    })).toBe(CHAT_SHELL_AUTH_HOME)
    expect(resolveHomeRedirect({
      authLoading: false,
      hasUser: true,
      rolloutLoading: false,
      canAccessChat: false,
    })).toBe(CLASSIC_AUTH_HOME)
  })
})
