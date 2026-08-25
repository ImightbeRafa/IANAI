import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin as supabase } from '../lib/supabase-admin.js'
import { CREDIT_PACK, PLAN_CATALOG, type PlanId } from '../lib/credits/catalog.js'
import { createTilopayOneTimeCheckout } from '../lib/tilopay/one-time.js'

/** Checkout SKUs — subscription plans use static TiloPay links; credit_pack uses one-time API. */
function paymentLinkFor(plan: string): string | null {
  if (plan === 'credit_pack' || plan === 'image_boost') {
    return null // one-time API path below
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

    let checkoutUrl: string | null = null

    if (plan === 'credit_pack') {
      const orderNumber = `pack-${user.id.slice(0, 8)}-${Date.now()}`
      const origin = (process.env.APP_ORIGIN || process.env.VITE_APP_ORIGIN || 'https://advanceai.studio').replace(/\/$/, '')
      const oneTime = await createTilopayOneTimeCheckout({
        amountUsd: CREDIT_PACK.priceUsd,
        email: user.email || '',
        description: `${CREDIT_PACK.credits} créditos IA (${CREDIT_PACK.ttlMonths} meses)`,
        orderNumber,
        redirectUrl: `${origin}/settings?pack=return`,
      })
      if (!oneTime.ok) {
        return res.status(502).json({ error: oneTime.error, plan })
      }
      checkoutUrl = oneTime.checkoutUrl
    } else {
      checkoutUrl = paymentLinkFor(plan)
      if (!checkoutUrl) {
        return res.status(503).json({
          error: 'Checkout link not configured yet',
          plan,
          hint: 'Paste TiloPay subscription URL into api/lib/credits/catalog.ts',
        })
      }
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

    return res.status(200).json({ checkoutUrl, plan, orderId: plan === 'credit_pack' ? randomUUID() : undefined })
  } catch (error) {
    console.error('Checkout error:', error)
    return res.status(500).json({
      error: 'Failed to create checkout',
    })
  }
}
