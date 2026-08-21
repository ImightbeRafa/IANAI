import { useChatShellRollout } from './ChatShellRolloutContext'

export type ChatShellFlagState = 'loading' | 'enabled' | 'disabled' | 'unreadable'

/**
 * Kill-switch view of the shared rollout resolver.
 * Prefer useChatShellRollout when entitlement / home UI matter.
 */
export function useChatShellFlag(): { state: ChatShellFlagState; refresh: () => void } {
  const rollout = useChatShellRollout()
  return {
    state: rollout.state,
    refresh: rollout.refresh,
  }
}
