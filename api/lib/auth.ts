import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Create Supabase client with service role for server-side operations
export const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

export interface AuthenticatedUser {
  id: string
  email?: string
  plan?: string
}

export interface AuthResult {
  user: AuthenticatedUser | null
  error: string | null
}

/**
 * Verify the user's JWT token from the Authorization header
 * Returns the authenticated user or null if invalid
 */
export async function verifyAuth(req: VercelRequest): Promise<AuthResult> {
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

    // Optionally fetch user's subscription/plan
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('plan, status')
      .eq('user_id', user.id)
      .eq('status', 'active')
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
 * Middleware helper to require authentication
 * Returns true if authenticated, false if response was sent
 */
export async function requireAuth(
  req: VercelRequest, 
  res: VercelResponse
): Promise<AuthenticatedUser | null> {
  const { user, error } = await verifyAuth(req)

  if (!user) {
    res.status(401).json({ error: error || 'Unauthorized' })
    return null
  }

  return user
}

/**
 * Check if user can perform an action based on their plan limits
 */
export async function checkUsageLimit(
  userId: string,
  action: 'script' | 'image' | 'video' | 'description'
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  if (!supabaseAdmin) {
    console.error('Usage limit check: Supabase not configured — denying request')
    return { allowed: false, remaining: 0, limit: 0 }
  }

  try {
    // Get user's plan
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('plan')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single()

    const plan = subscription?.plan || 'free'

    // Get plan limits
    const { data: limits } = await supabaseAdmin
      .from('plan_limits')
      .select('*')
      .eq('plan', plan)
      .single()

    if (!limits) {
      return { allowed: true, remaining: -1, limit: -1 }
    }

    const limit = action === 'script' 
      ? limits.scripts_per_month 
      : action === 'image' 
        ? limits.images_per_month 
        : action === 'description'
          ? (limits.descriptions_per_month ?? -1)
          : limits.videos_per_month || 10

    // -1 means unlimited
    if (limit === -1) {
      return { allowed: true, remaining: -1, limit: -1 }
    }

    // Get current usage
    const currentMonth = new Date().toISOString().slice(0, 7) + '-01'
    const { data: usage } = await supabaseAdmin
      .from('usage')
      .select('*')
      .eq('user_id', userId)
      .eq('period_start', currentMonth)
      .single()

    const currentUsage = action === 'script' 
      ? (usage?.scripts_generated || 0)
      : action === 'image'
        ? (usage?.images_generated || 0)
        : action === 'description'
          ? (usage?.descriptions_generated || 0)
          : (usage?.videos_generated || 0)

    const remaining = limit - currentUsage
    const allowed = remaining > 0

    return { allowed, remaining, limit }
  } catch (err) {
    console.error('Usage limit check error:', err)
    return { allowed: false, remaining: 0, limit: 0 }
  }
}

/**
 * Increment usage counter for a user (atomic via Postgres function)
 */
export async function incrementUsage(
  userId: string,
  action: 'script' | 'image' | 'video' | 'description'
): Promise<void> {
  if (!supabaseAdmin) return

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
