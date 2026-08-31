/**
 * One-time +100 pack credits when a user first opens chat-shell.
 * Deterministic lot id → concurrent-safe; PK conflict = already granted.
 */

import { getSupabaseAdmin } from '../supabase-admin.js'
import { deterministicGenerationUuid } from './generation-id.js'
import { getCreditRemaining } from './consume.js'
import { isCreditsV1Enabled } from './catalog.js'

export const CHAT_SHELL_OPEN_GIFT_CREDITS = 100
export const CHAT_SHELL_OPEN_GIFT_TTL_MONTHS = 12
export const CHAT_SHELL_OPEN_GIFT_KEY = 'chat-shell-gift-v1'

export function chatShellOpenGiftLotId(userId: string): string {
  return deterministicGenerationUuid(CHAT_SHELL_OPEN_GIFT_KEY, userId)
}

export type ChatShellOpenGiftResult = {
  ok: true
  granted: boolean
  already: boolean
  credits: number
  creditsRemaining: number
  showWelcome: boolean
  tourDone: boolean
}

function readUserMetaFlag(
  metadata: Record<string, unknown> | null | undefined,
  key: string
): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  const value = metadata[key]
  return value === true || value === 'true' || value === 1
}

/**
 * Fail-closed: grant the +100 pack only on production.
 * Preview, `vercel dev`, Cloud Agent, and unset VERCEL_ENV must not insert lots on AIIAN.
 * Opt out on production with CHAT_SHELL_OPEN_GIFT=0.
 */
export function shouldSkipChatShellOpenGift(): boolean {
  const vercelEnv = (process.env.VERCEL_ENV || '').toLowerCase()
  if (vercelEnv !== 'production') return true
  const flag = (process.env.CHAT_SHELL_OPEN_GIFT || '1').trim().toLowerCase()
  return flag === '0' || flag === 'false' || flag === 'off'
}

export async function ensureChatShellOpenGift(userId: string): Promise<ChatShellOpenGiftResult> {
  const empty: ChatShellOpenGiftResult = {
    ok: true,
    granted: false,
    already: true,
    credits: CHAT_SHELL_OPEN_GIFT_CREDITS,
    creditsRemaining: 0,
    showWelcome: false,
    tourDone: false,
  }
  if (!userId) return empty

  const db = getSupabaseAdmin()
  if (!db) return empty

  const { data: authUser } = await db.auth.admin.getUserById(userId)
  const meta = (authUser?.user?.user_metadata || {}) as Record<string, unknown>
  const welcomeSeen = readUserMetaFlag(meta, 'chat_shell_welcome_seen')
  const tourDone = readUserMetaFlag(meta, 'chat_shell_tour_done')

  const remainingBefore = await getCreditRemaining(userId)
  const lotId = chatShellOpenGiftLotId(userId)

  // Already granted?
  const { data: existing } = await db
    .from('credit_lots')
    .select('id')
    .eq('id', lotId)
    .maybeSingle()

  if (existing?.id) {
    return {
      ok: true,
      granted: false,
      already: true,
      credits: CHAT_SHELL_OPEN_GIFT_CREDITS,
      creditsRemaining: remainingBefore || (await getCreditRemaining(userId)),
      showWelcome: !welcomeSeen,
      tourDone,
    }
  }

  // Non-production (and CREDITS_V1 off): never insert a new +100 lot.
  // Do not claw existing production lots.
  if (shouldSkipChatShellOpenGift() || !isCreditsV1Enabled()) {
    return {
      ok: true,
      granted: false,
      already: false,
      credits: CHAT_SHELL_OPEN_GIFT_CREDITS,
      creditsRemaining: remainingBefore,
      showWelcome: false,
      tourDone: true,
    }
  }

  const expires = new Date()
  expires.setMonth(expires.getMonth() + CHAT_SHELL_OPEN_GIFT_TTL_MONTHS)

  const { error } = await db.from('credit_lots').insert({
    id: lotId,
    user_id: userId,
    kind: 'pack',
    granted: CHAT_SHELL_OPEN_GIFT_CREDITS,
    remaining: CHAT_SHELL_OPEN_GIFT_CREDITS,
    expires_at: expires.toISOString(),
  })

  if (error) {
    // Unique violation = concurrent grant won
    if (error.code === '23505') {
      return {
        ok: true,
        granted: false,
        already: true,
        credits: CHAT_SHELL_OPEN_GIFT_CREDITS,
        creditsRemaining: await getCreditRemaining(userId),
        showWelcome: !welcomeSeen,
        tourDone,
      }
    }
    console.error('chat-shell open gift insert failed', error)
    return {
      ok: true,
      granted: false,
      already: false,
      credits: CHAT_SHELL_OPEN_GIFT_CREDITS,
      creditsRemaining: remainingBefore,
      showWelcome: !welcomeSeen,
      tourDone,
    }
  }

  return {
    ok: true,
    granted: true,
    already: false,
    credits: CHAT_SHELL_OPEN_GIFT_CREDITS,
    creditsRemaining: await getCreditRemaining(userId),
    showWelcome: !welcomeSeen,
    tourDone,
  }
}

export async function markChatShellWelcomeSeen(userId: string): Promise<boolean> {
  const db = getSupabaseAdmin()
  if (!db || !userId) return false
  const { data: authUser, error: getErr } = await db.auth.admin.getUserById(userId)
  if (getErr || !authUser?.user) {
    console.error('markChatShellWelcomeSeen getUserById', getErr)
    return false
  }
  const prev = (authUser.user.user_metadata || {}) as Record<string, unknown>
  const { error } = await db.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...prev,
      chat_shell_welcome_seen: true,
    },
  })
  if (error) {
    console.error('markChatShellWelcomeSeen', error)
    return false
  }
  return true
}

export async function markChatShellTourDone(userId: string): Promise<boolean> {
  const db = getSupabaseAdmin()
  if (!db || !userId) return false
  const { data: authUser, error: getErr } = await db.auth.admin.getUserById(userId)
  if (getErr || !authUser?.user) {
    console.error('markChatShellTourDone getUserById', getErr)
    return false
  }
  const prev = (authUser.user.user_metadata || {}) as Record<string, unknown>
  const { error } = await db.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...prev,
      chat_shell_tour_done: true,
      chat_shell_welcome_seen: true,
    },
  })
  if (error) {
    console.error('markChatShellTourDone', error)
    return false
  }
  return true
}
