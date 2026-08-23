import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin as supabase } from '../lib/supabase-admin.js'
import { CREDIT_PACK, PLAN_CATALOG, type PlanId } from '../lib/credits/catalog.js'

// TiloPay API credentials from environment (NEVER hardcode these!)
const TILOPAY_API_KEY = process.env.TILOPAY_API_KEY
const TILOPAY_API_USER = process.env.TILOPAY_API_USER
const TILOPAY_API_PASSWORD = process.env.TILOPAY_API_PASSWORD

void TILOPAY_API_KEY
void TILOPAY_API_USER
void TILOPAY_API_PASSWORD

/** Checkout SKUs — prefer catalog links; placeholders return 503 until human pastes URLs. */
function paymentLinkFor(plan: string): string | null {
  if (plan === 'credit_pack' || plan === 'image_boost') {
    // Prefer new pack; legacy boost link only as last resort for confirm-boost compat
    return CREDIT_PACK.paymentLink || (plan === 'image_boost' ? CREDIT_PACK.legacyBoostLink : null)
  }
  const entry = PLAN_CATALOG[plan as PlanId]
  return entry?.paymentLink ?? null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Server not configured. Missing SUPABASE_URL or SUPABASE_SECRET_KEY' })
    }

    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization' })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    let { plan } = req.body as { plan?: string }
    if (plan === 'image_boost') {
      // Stop selling boost; redirect intent to credit pack when URL exists
      plan = 'credit_pack'
    }

    const allowed = new Set([
      'starter',
      'pro',
      'business',
      'enterprise',
      'credit_pack',
    ])
    if (!plan || !allowed.has(plan)) {
      return res.status(400).json({ error: 'Invalid plan' })
    }

    const checkoutUrl = paymentLinkFor(plan)
    if (!checkoutUrl) {
      return res.status(503).json({
        error: 'Checkout link not configured yet',
        plan,
        hint: 'Paste TiloPay URL into api/lib/credits/catalog.ts (business or CREDIT_PACK.paymentLink)',
      })
    }

    const { error: pendingError } = await supabase
      .from('pending_subscriptions')
      .upsert({
        user_id: user.id,
        email: user.email,
        plan,
        created_at: new Date().toISOString(),
        status: 'pending',
      }, { onConflict: 'user_id' })

    if (pendingError) {
      console.error('Failed to store pending subscription:', pendingError)
    }

    return res.status(200).json({ checkoutUrl, plan })
  } catch (error) {
    console.error('Checkout error:', error)
    return res.status(500).json({
      error: 'Failed to create checkout',
    })
  }
}
