import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin as supabase } from '../lib/supabase-admin.js'

const BOOST_AMOUNT = 100
const BOOST_PRICE = 14.99
const MAX_AGE_HOURS = 24 // pending must be created within last 24h

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

    // Verify auth
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization' })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    console.log(`[confirm-boost] User ${user.id} (${user.email}) requesting image boost confirmation`)

    // 1. Find a recent pending image_boost record for this user
    const cutoff = new Date()
    cutoff.setHours(cutoff.getHours() - MAX_AGE_HOURS)

    const { data: pending, error: pendingError } = await supabase
      .from('pending_subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .eq('plan', 'image_boost')
      .eq('status', 'pending')
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (pendingError) {
      console.error('[confirm-boost] Error looking up pending:', pendingError)
      return res.status(500).json({ error: 'Database error' })
    }

    if (!pending) {
      console.log('[confirm-boost] No recent pending image_boost found for user')
      return res.status(400).json({
        error: 'No pending purchase found. Please initiate the purchase first by clicking "Buy +100 Designs".'
      })
    }

    // 2. Mark as completed FIRST (prevents double-confirm)
    const { error: updateError } = await supabase
      .from('pending_subscriptions')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('plan', 'image_boost')
      .eq('status', 'pending')

    if (updateError) {
      console.error('[confirm-boost] Failed to mark pending as completed:', updateError)
      return res.status(500).json({ error: 'Failed to process confirmation' })
    }

    // 3. Credit bonus images
    const { error: creditError } = await supabase.rpc('credit_bonus_images', {
      p_user_id: user.id,
      p_amount: BOOST_AMOUNT
    })

    if (creditError) {
      console.error('[confirm-boost] Failed to credit bonus images:', creditError)
      // Try to revert the pending status
      await supabase
        .from('pending_subscriptions')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('plan', 'image_boost')
        .eq('status', 'completed')
      return res.status(500).json({ error: 'Failed to credit images. Please try again.' })
    }

    // 4. Record payment (resilient: retry without 'plan' if column doesn't exist)
    const payRow = {
      user_id: user.id,
      amount: BOOST_PRICE,
      currency: 'USD',
      status: 'succeeded',
      plan: 'image_boost',
      description: `+${BOOST_AMOUNT} bonus designs`,
      paid_at: new Date().toISOString()
    }
    const { error: payError } = await supabase.from('payments').insert(payRow)
    if (payError) {
      console.warn('[confirm-boost] payments insert failed, retrying without plan:', payError.message)
      const { plan: _drop, ...coreRow } = payRow
      await supabase.from('payments').insert(coreRow)
    }

    // 5. Record in audit trail (if payment_transactions table exists)
    try {
      await supabase.from('payment_transactions').insert({
        user_id: user.id,
        email: user.email,
        event_type: 'boost_confirmed',
        plan: 'image_boost',
        amount: BOOST_PRICE,
        currency: 'USD',
        status: 'succeeded',
        raw_data: { source: 'confirm-boost', amount: BOOST_AMOUNT }
      })
    } catch (_) { /* non-critical */ }

    console.log(`[confirm-boost] Successfully credited ${BOOST_AMOUNT} bonus images to ${user.email}`)

    return res.status(200).json({
      success: true,
      bonusImages: BOOST_AMOUNT,
      message: `+${BOOST_AMOUNT} bonus designs added to your account!`
    })

  } catch (error) {
    console.error('[confirm-boost] Unexpected error:', error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    })
  }
}
