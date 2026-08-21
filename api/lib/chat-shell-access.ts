import type { VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './supabase-admin.js'

export const CHAT_SHELL_UNAVAILABLE =
  'Chat is not available for this account'

export async function userHasChatShellAccess(userId: string): Promise<boolean> {
  if (!supabaseAdmin || !userId) return false
  try {
    const { data: flag, error: flagError } = await supabaseAdmin
      .from('app_feature_flags')
      .select('enabled')
      .eq('key', 'chat_shell')
      .maybeSingle()
    if (flagError || flag?.enabled !== true) return false

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('chat_beta_access')
      .eq('id', userId)
      .maybeSingle()
    if (profileError || !profile) return false
    return profile.chat_beta_access === true
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
