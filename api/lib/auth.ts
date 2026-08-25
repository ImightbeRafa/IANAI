import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from './supabase-admin.js'
import {
  isCreditsV1Enabled,
  legacyActionToCredit,
  quoteCredits,
} from './credits/catalog.js'
import { checkCredits, consumeCredits, ensureWelcomeCredits } from './credits/consume.js'

export interface AuthenticatedUser {
  id: string
  email?: string
  plan?: string
  isAdmin?: boolean
}

export interface AuthResult {
  user: AuthenticatedUser | null
  error: string | null
}

/**
 * Verify the user's JWT token from the Authorization header
 * Returns the authenticated user or null if invalid
 */
async function verifyAuth(req: VercelRequest): Promise<AuthResult> {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: null, error: 'Missing or invalid Authorization header' }
  }

  const token = authHeader.substring(7) // Remove 'Bearer ' prefix

  if (!supabaseAdmin) {
    console.error('Supabase admin client not configured - missing env vars')
    return { user: null, error: 'Server configuration error' }
  }

  try {
    // Verify the JWT token with Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)

    if (error || !user) {
      return { user: null, error: 'Invalid or expired token' }
    }

    // Optionally fetch user's subscription/plan (include trialing for referral users)
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('plan, status')
      .eq('user_id', user.id)
      .in('status', ['active', 'trialing'])
      .single()

    return {
      user: {
        id: user.id,
        email: user.email,
        plan: subscription?.plan || 'free'
      },
      error: null
    }
  } catch (err) {
    console.error('Auth verification error:', err)
    return { user: null, error: 'Authentication failed' }
  }
}

/**
 * Server-side admin check using profiles.is_admin.
 * Kept separate from requireAuth so regular endpoints do not pay for this query.
 */
export async function isAdminUser(userId: string): Promise<boolean> {
  if (!supabaseAdmin) return false

  try {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .maybeSingle()

    return data?.is_admin === true
  } catch (err) {
    console.error('Admin status check error:', err)
    return false
  }
}

/**
 * Middleware helper to require authentication
 * Returns the user if authenticated, null if a 401 response was sent
 */
export async function requireAuth(
  req: VercelRequest,
  res: VercelResponse,
  options?: { unauthorizedHeaders?: Record<string, string> }
): Promise<AuthenticatedUser | null> {
  const { user, error } = await verifyAuth(req)

  if (!user) {
    if (options?.unauthorizedHeaders) {
      for (const [key, value] of Object.entries(options.unauthorizedHeaders)) {
        res.setHeader(key, value)
      }
    }
    res.status(401).json({ error: error || 'Unauthorized' })
    return null
  }

  return user
}

/**
 * Check if user can perform an action based on their plan limits.
 * When CREDITS_V1 is enabled, uses Créditos IA wallet instead of monthly meters.
 */
export async function checkUsageLimit(
  userId: string,
  action: 'script' | 'image' | 'description' | 'enhance' | 'reply',
  options?: { imageModel?: string | null; units?: number }
): Promise<{ allowed: boolean; remaining: number; limit: number; creditsRequired?: number }> {
  if (!supabaseAdmin) {
    console.error('Usage limit check: Supabase not configured — denying request')
    return { allowed: false, remaining: 0, limit: 0 }
  }

  if (isCreditsV1Enabled()) {
    try {
      await ensureWelcomeCredits(userId)
      const mapped = legacyActionToCredit({
        action,
        imageModel: options?.imageModel,
      })
      const units = options?.units ?? mapped.units
      const check = await checkCredits(userId, mapped.creditAction, units)
      return {
        allowed: check.allowed,
        remaining: check.remaining,
        limit: check.remaining + (check.allowed ? check.required : 0),
        creditsRequired: check.required,
      }
    } catch (err) {
      console.error('Credit limit check error:', err)
      return { allowed: false, remaining: 0, limit: 0 }
    }
  }

  try {
    // Get user's plan (check both active and trialing)
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('plan, status, trial_ends_at')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing'])
      .single()

    let plan = subscription?.plan || 'free'

    // Lazy trial expiry: if trial has ended, downgrade to free
    if (subscription?.status === 'trialing' && subscription?.trial_ends_at) {
      const trialEnd = new Date(subscription.trial_ends_at)
      if (trialEnd < new Date()) {
        // Trial expired — downgrade
        await supabaseAdmin
          .from('subscriptions')
          .update({ plan: 'free', status: 'active', trial_ends_at: null, updated_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('status', 'trialing')
        plan = 'free'
      }
    }

    // Get plan limits
    const { data: limits } = await supabaseAdmin
      .from('plan_limits')
      .select('*')
      .eq('plan', plan)
      .single()

    if (!limits) {
      // Fail closed: missing plan configuration must not grant unlimited usage
      console.error('Usage limit check: missing plan_limits row for plan', plan)
      return { allowed: false, remaining: 0, limit: 0 }
    }

    // Enhance checks against the image limit (at half rate) — legacy path only
    const effectiveAction = action === 'enhance' ? 'image' : action

    let limit = effectiveAction === 'script' 
      ? limits.scripts_per_month 
      : effectiveAction === 'image' 
        ? limits.images_per_month 
        : effectiveAction === 'description'
          ? (limits.descriptions_per_month ?? -1)
          : (limits.replies_per_month ?? 10)

    // -1 means unlimited (legacy only; CREDITS_V1 never uses this branch)
    if (limit === -1) {
      return { allowed: true, remaining: -1, limit: -1 }
    }

    // For images/enhances, add bonus_images from profiles (persistent pool, not monthly)
    if (effectiveAction === 'image') {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('bonus_images')
        .eq('id', userId)
        .single()
      
      const bonus = profile?.bonus_images || 0
      if (bonus > 0) {
        limit = limit + bonus
      }
    }

    // Get current usage
    const currentMonth = new Date().toISOString().slice(0, 7) + '-01'
    const { data: usage } = await supabaseAdmin
      .from('usage')
      .select('*')
      .eq('user_id', userId)
      .eq('period_start', currentMonth)
      .single()

    // For image limit: count full images + enhances at half rate (2 enhances = 1 image)
    const currentUsage = effectiveAction === 'script' 
      ? (usage?.scripts_generated || 0)
      : effectiveAction === 'image'
        ? (usage?.images_generated || 0) + Math.floor((usage?.enhances_generated || 0) / 2)
        : effectiveAction === 'description'
          ? (usage?.descriptions_generated || 0)
          : (usage?.replies_generated || 0)

    const remaining = limit - currentUsage
    const allowed = remaining > 0

    return { allowed, remaining, limit }
  } catch (err) {
    console.error('Usage limit check error:', err)
    return { allowed: false, remaining: 0, limit: 0 }
  }
}

/**
 * Deduct one bonus image from the user's persistent pool.
 * Called after image generation when usage exceeds the base plan limit.
 * Uses atomic RPC to prevent race conditions.
 */
export async function deductBonusImage(userId: string): Promise<void> {
  if (!supabaseAdmin) return

  try {
    const { error } = await supabaseAdmin.rpc('deduct_bonus_image', {
      p_user_id: userId
    })

    if (error) {
      console.error('deduct_bonus_image RPC error:', error)
    }
  } catch (err) {
    console.error('Deduct bonus image error:', err)
  }
}

/**
 * Increment usage counter for a user (atomic via Postgres function).
 * When CREDITS_V1 is on, consumes Créditos IA instead (idempotent on generationId).
 */
export async function incrementUsage(
  userId: string,
  action: 'script' | 'image' | 'description' | 'enhance' | 'reply',
  options?: { generationId?: string; imageModel?: string | null; units?: number }
): Promise<{ creditsError?: string; creditsCharged?: number } | void> {
  if (!supabaseAdmin) {
    if (isCreditsV1Enabled()) {
      console.error('Increment usage: Supabase not configured — denying credit charge')
      return { creditsError: 'not_configured', creditsCharged: 0 }
    }
    return
  }

  if (isCreditsV1Enabled()) {
    try {
      const mapped = legacyActionToCredit({
        action,
        imageModel: options?.imageModel,
      })
      const result = await consumeCredits({
        userId,
        action: mapped.creditAction,
        generationId: options?.generationId || randomUUID(),
        units: options?.units ?? mapped.units,
      })
      if (!result.ok) {
        console.error('consumeCredits failed after success path', result)
        return { creditsError: result.code, creditsCharged: 0 }
      }
      return { creditsCharged: result.credits }
    } catch (err) {
      console.error('Credit consume error:', err)
      return { creditsError: err instanceof Error ? err.message : 'credit_error', creditsCharged: 0 }
    }
  }

  try {
    const { error } = await supabaseAdmin.rpc('increment_usage', {
      p_user_id: userId,
      p_action: action
    })

    if (error) {
      console.error('Increment usage RPC error:', error)
    }
  } catch (err) {
    console.error('Increment usage error:', err)
  }
}

/** Quote credits for UI / MCP (0 when CREDITS_V1 off — callers use legacy). */
export function quoteLegacyActionCredits(
  action: 'script' | 'image' | 'description' | 'enhance' | 'reply',
  imageModel?: string | null
): number {
  const mapped = legacyActionToCredit({ action, imageModel })
  return quoteCredits(mapped.creditAction, mapped.units)
}
