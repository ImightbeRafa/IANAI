import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin as supabase } from '../lib/supabase-admin.js'

const BOOST_AMOUNT = 100
const MAX_AGE_HOURS = 24

/**
 * Client-side "confirm purchase" endpoint.
 *
 * SECURITY: This must NEVER credit bonus images on its own.
 * Credits are granted only by the TiloPay webhook after a payment event.
 * This endpoint only reports status / surfaces already-granted credits.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Server not configured' })
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

    const cutoff = new Date()
    cutoff.setHours(cutoff.getHours() - MAX_AGE_HOURS)

    // Prefer webhook-verified payment evidence
    const { data: verifiedPayment } = await supabase
      .from('payment_transactions')
      .select('id, status, amount, created_at')
      .eq('user_id', user.id)
      .eq('plan', 'image_boost')
      .in('status', ['succeeded', 'succeeded_fallback'])
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: profile } = await supabase
      .from('profiles')
      .select('bonus_images')
      .eq('id', user.id)
      .maybeSingle()

    if (verifiedPayment) {
      // Ensure any lingering pending row is closed (idempotent)
      await supabase
        .from('pending_subscriptions')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('plan', 'image_boost')
        .eq('status', 'pending')

      return res.status(200).json({
        success: true,
        bonusImages: profile?.bonus_images ?? BOOST_AMOUNT,
        message: `Purchase verified. Bonus designs are available on your account.`,
        source: 'webhook'
      })
    }

    // Also accept a recently completed pending row that the webhook already finished
    const { data: completed } = await supabase
      .from('pending_subscriptions')
      .select('id, status, updated_at')
      .eq('user_id', user.id)
      .eq('plan', 'image_boost')
      .eq('status', 'completed')
      .gte('updated_at', cutoff.toISOString())
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (completed) {
      return res.status(200).json({
        success: true,
        bonusImages: profile?.bonus_images ?? BOOST_AMOUNT,
        message: `Purchase already activated.`,
        source: 'pending_completed'
      })
    }

    // Do NOT credit here — payment has not been verified by webhook
    return res.status(402).json({
      error: 'Payment not verified yet. Complete checkout in TiloPay and wait a moment for confirmation, then try again. If payment succeeded but credits never appear, contact support with your receipt.',
      code: 'PAYMENT_NOT_VERIFIED'
    })

  } catch (error) {
    console.error('[confirm-boost] Unexpected error:', error instanceof Error ? error.message : 'unknown')
    return res.status(500).json({ error: 'Internal server error' })
  }
}
