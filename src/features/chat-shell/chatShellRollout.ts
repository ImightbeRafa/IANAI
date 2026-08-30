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
 * Kill switch gates access for everyone. Preference never grants access and
 * never redirects home unless the user opted into chat (`preferred_ui`).
 * `chat_beta_access` is retained for ops/reporting but no longer required.
 */
export function resolveChatShellRollout(input: ChatShellRolloutInput): ChatShellRollout {
  const killSwitch = input.killSwitch
  const betaAccess = input.betaAccess === true
  const preferredUi = input.preferredUi === 'chat' ? 'chat' : 'classic'
  const killOn = killSwitch === 'enabled'
  const canAccessChat = killOn
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
