import type { PreferredUi } from '../../types'

export type { PreferredUi }
export type ChatShellKillSwitch = 'loading' | 'enabled' | 'disabled' | 'unreadable'

export interface ChatShellRolloutInput {
  killSwitch: ChatShellKillSwitch
  /** null = missing row, missing column, or read error — fail closed */
  betaAccess: boolean | null
  preferredUi: PreferredUi | null
}

export interface ChatShellRollout {
  killSwitch: ChatShellKillSwitch
  betaAccess: boolean
  preferredUi: PreferredUi
  canAccessChat: boolean
  showSwitch: boolean
  effectiveHome: PreferredUi
}

export function parsePreferredUi(value: unknown): PreferredUi | null {
  if (value === 'chat' || value === 'classic') return value
  return null
}

export const CHAT_SHELL_AUTH_HOME = '/chat'
export const CLASSIC_AUTH_HOME = '/dashboard'

/**
 * Kill switch is the only gate. When `chat_shell` is on, every signed-in user
 * can open `/chat` (invite-all). Preference no longer grants or denies access.
 * Flag off / unreadable fails closed to classic.
 */
export function resolveChatShellRollout(input: ChatShellRolloutInput): ChatShellRollout {
  const killSwitch = input.killSwitch
  const betaAccess = input.betaAccess === true
  const preferredUi = input.preferredUi === 'chat' ? 'chat' : 'classic'
  const killOn = killSwitch === 'enabled'
  const canAccessChat = killOn
  const showSwitch = canAccessChat
  const effectiveHome: PreferredUi = canAccessChat ? 'chat' : 'classic'

  return {
    killSwitch,
    betaAccess,
    preferredUi,
    canAccessChat,
    showSwitch,
    effectiveHome,
  }
}

export function resolveChatShellGateReason(
  killSwitch: ChatShellKillSwitch
): 'unreadable' | 'disabled' {
  return killSwitch === 'unreadable' ? 'unreadable' : 'disabled'
}

export function authHomePath(canAccessChat: boolean): string {
  return canAccessChat ? CHAT_SHELL_AUTH_HOME : CLASSIC_AUTH_HOME
}
