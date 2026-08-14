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

/**
 * Three independent controls. Kill switch off or unreadable → classic.
 * Beta false/null → classic, no switch. Preference never grants access.
 */
export function resolveChatShellRollout(input: ChatShellRolloutInput): ChatShellRollout {
  const killSwitch = input.killSwitch
  const betaAccess = input.betaAccess === true
  const preferredUi = input.preferredUi === 'chat' ? 'chat' : 'classic'
  const killOn = killSwitch === 'enabled'
  const canAccessChat = killOn && betaAccess
  const showSwitch = canAccessChat
  const effectiveHome: PreferredUi = canAccessChat && preferredUi === 'chat' ? 'chat' : 'classic'

  return {
    killSwitch,
    betaAccess,
    preferredUi,
    canAccessChat,
    showSwitch,
    effectiveHome,
  }
}
