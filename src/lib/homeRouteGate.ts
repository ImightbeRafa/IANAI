import { authHomePath } from '../features/chat-shell/chatShellRollout'

/**
 * Public `/` paints the marketing landing unless a signed-in destination is known.
 * Never wait on auth/rollout by returning a loading shell — that caused the empty nav pill.
 */
export function resolveHomeRedirect(input: {
  authLoading: boolean
  hasUser: boolean
  rolloutLoading: boolean
  canAccessChat: boolean
}): string | null {
  if (input.authLoading || !input.hasUser || input.rolloutLoading) return null
  return authHomePath(input.canAccessChat)
}
