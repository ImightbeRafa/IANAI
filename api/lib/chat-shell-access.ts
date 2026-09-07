import type { VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './supabase-admin.js'

export const CHAT_SHELL_UNAVAILABLE =
  'Chat is not available for this account'

/** Kill switch only. Invite (`chat_beta_access`) is not required after cutover. */
export function chatShellAccessFromFlag(enabled: unknown): boolean {
  return enabled === true
}

/**
 * Kill switch is the only gate. When `app_feature_flags.chat_shell` is on,
 * every authenticated user has chat-shell (production-open + Preview-open).
 * Flag off / unreadable fails closed. Gift is a separate production-only path.
 */
export async function userHasChatShellAccess(userId: string): Promise<boolean> {
  if (!supabaseAdmin || !userId) return false
  try {
    const { data: flag, error: flagError } = await supabaseAdmin
      .from('app_feature_flags')
      .select('enabled')
      .eq('key', 'chat_shell')
      .maybeSingle()
    if (flagError) return false
    return chatShellAccessFromFlag(flag?.enabled)
  } catch (err) {
    console.error('Chat-shell access check failed:', err)
    return false
  }
}

/** Returns false after sending 403. Call only for shell-bound requests (sessionId present). */
export async function requireChatShellAccess(
  res: VercelResponse,
  userId: string
): Promise<boolean> {
  const ok = await userHasChatShellAccess(userId)
  if (ok) return true
  res.status(403).json({ error: CHAT_SHELL_UNAVAILABLE })
  return false
}
