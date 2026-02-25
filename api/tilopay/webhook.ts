import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

/**
 * TiloPay Webhook Handler
 * 
 * TiloPay Repeat API sends webhooks to different URLs for each event type:
 * - webhook_subscribe: New subscription created
 * - webhook_payment: Successful recurring payment
 * - webhook_rejected: Failed payment
 * - webhook_unsubscribe: Subscription cancelled
 * - webhook_reactive: Subscription reactivated
 * 
 * Configure these URLs in TiloPay dashboard when creating/editing plans:
 * https://advanceai.studio/api/tilopay/webhook?event=subscribe&secret=YOUR_SECRET
 * https://advanceai.studio/api/tilopay/webhook?event=payment&secret=YOUR_SECRET
 * https://advanceai.studio/api/tilopay/webhook?event=rejected&secret=YOUR_SECRET
 * https://advanceai.studio/api/tilopay/webhook?event=unsubscribe&secret=YOUR_SECRET
 * https://advanceai.studio/api/tilopay/webhook?event=reactive&secret=YOUR_SECRET
 */

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const WEBHOOK_SECRET = process.env.TILOPAY_WEBHOOK_SECRET

const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey) 
  : null

// TiloPay webhook payload structure (based on their API docs)
interface TiloPayWebhookData {
  // Common fields TiloPay may send (various naming conventions)
  email?: string
  subscriber_email?: string
  customer_email?: string
  correo?: string
  subscriber_id?: string
  subscription_id?: string
  plan_id?: string
  plan_title?: string
  amount?: number | string
  monto?: number | string
  currency?: string
  status?: string
  modality?: string
  description?: string
  nombre?: string
  name?: string
  // Allow any other fields
  [key: string]: unknown
}

// =============================================
// BODY PARSING — handle undefined, form-encoded, JSON, query params
// =============================================
function parseWebhookData(req: VercelRequest): TiloPayWebhookData {
  // 1. Try req.body (Vercel auto-parses JSON and form-urlencoded)
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return req.body as TiloPayWebhookData
  }

  // 2. Try parsing body as string (some providers send raw string)
  if (req.body && typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as TiloPayWebhookData
    } catch {
      // Try URL-encoded string
      const params = new URLSearchParams(req.body)
      if (params.has('email') || params.has('subscriber_email') || params.has('amount')) {
        const obj: TiloPayWebhookData = {}
        params.forEach((value, key) => { obj[key] = value })
        return obj
      }
    }
  }

  // 3. Fallback: extract from query params (TiloPay might send everything in URL)
  const q = req.query
  if (q && (q.email || q.subscriber_email || q.amount)) {
    const obj: TiloPayWebhookData = {}
    for (const [key, val] of Object.entries(q)) {
      if (key !== 'event' && key !== 'secret') {
        obj[key] = typeof val === 'string' ? val : Array.isArray(val) ? val[0] : val
      }
    }
    return obj
  }

  // 4. Nothing found
  return {}
}

// =============================================
// AUDIT TRAIL — record every webhook event
// =============================================
async function recordTransaction(params: {
  userId: string | null
  email: string | null
  eventType: string
  plan: string | null
  amount: number | null
  currency: string
  status: string
  tilopaySubscriptionId: string | null
  rawData: TiloPayWebhookData
  errorMessage?: string
}): Promise<void> {
  if (!supabase) return
  try {
    await supabase.from('payment_transactions').insert({
      user_id: params.userId,
      email: params.email,
      event_type: params.eventType,
      plan: params.plan,
      amount: params.amount,
      currency: params.currency,
      status: params.status,
      tilopay_subscription_id: params.tilopaySubscriptionId,
      tilopay_data: params.rawData,
      error_message: params.errorMessage || null
    })
  } catch (err) {
    console.error('Failed to record transaction:', err)
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow GET for health check
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', handler: 'tilopay-webhook' })
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Log the FULL raw request for debugging
  console.log('=== TiloPay Webhook Raw Request ===')
  console.log('Headers:', JSON.stringify({
    'content-type': req.headers['content-type'],
    'user-agent': req.headers['user-agent'],
    'x-forwarded-for': req.headers['x-forwarded-for']
  }))
  console.log('Query:', JSON.stringify(req.query))
  console.log('Body type:', typeof req.body)
  console.log('Body:', JSON.stringify(req.body))

  try {
    // Verify webhook secret
    const secret = req.query.secret as string
    if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
      console.error('Webhook secret mismatch', {
        hasSecret: !!WEBHOOK_SECRET,
        received: secret ? `${secret.slice(0, 4)}...` : 'none'
      })
      return res.status(403).json({ error: 'Forbidden' })
    }

    if (!supabase) {
      console.error('Supabase not configured')
      return res.status(500).json({ error: 'Server not configured' })
    }

    // Parse the event type and data defensively
    const eventType = (req.query.event as string) || 'unknown'
    const data = parseWebhookData(req)
    const hasData = Object.keys(data).length > 0

    console.log(`TiloPay event: ${eventType}, parsed data:`, JSON.stringify(data, null, 2))

    // Extract email from various possible fields
    const email = (
      data.email ||
      data.subscriber_email ||
      data.customer_email ||
      data.correo ||
      (typeof data.nombre === 'string' && data.nombre.includes('@') ? data.nombre : null) ||
      (typeof data.name === 'string' && data.name.includes('@') ? data.name : null)
    ) as string | undefined

    if (!email) {
      console.warn('No email found in webhook payload. Keys received:', Object.keys(data))

      // Fallback: for one-time payments (image_boost), TiloPay sends empty body.
      // Check for recent pending image_boost subscriptions and auto-credit them.
      if (eventType === 'payment') {
        const cutoff = new Date()
        cutoff.setHours(cutoff.getHours() - 24)

        const { data: pendingBoosts } = await supabase
          .from('pending_subscriptions')
          .select('user_id, email, plan')
          .eq('plan', 'image_boost')
          .eq('status', 'pending')
          .gte('created_at', cutoff.toISOString())
          .order('created_at', { ascending: false })

        if (pendingBoosts && pendingBoosts.length > 0) {
          console.log(`[webhook-fallback] Found ${pendingBoosts.length} pending image_boost(s), processing...`)
          for (const pb of pendingBoosts) {
            try {
              await handleImageBoost(
                pb.user_id,
                pb.email || 'unknown',
                'image_boost',
                14.99,
                'USD',
                { ...data, _fallback: true }
              )
              await recordTransaction({
                userId: pb.user_id, email: pb.email, eventType,
                plan: 'image_boost', amount: 14.99, currency: 'USD',
                status: 'succeeded_fallback', tilopaySubscriptionId: null,
                rawData: { ...data, _fallback: true, pending_user: pb.user_id }
              })
              console.log(`[webhook-fallback] Credited image_boost to ${pb.email} (${pb.user_id})`)
            } catch (err) {
              console.error(`[webhook-fallback] Failed to credit ${pb.email}:`, err)
              await recordTransaction({
                userId: pb.user_id, email: pb.email, eventType,
                plan: 'image_boost', amount: 14.99, currency: 'USD',
                status: 'error_fallback', tilopaySubscriptionId: null,
                rawData: data, errorMessage: err instanceof Error ? err.message : 'Fallback credit failed'
              })
            }
          }
          return res.status(200).json({ received: true, action: 'image_boost_fallback', count: pendingBoosts.length })
        }
      }

      await recordTransaction({
        userId: null, email: null, eventType, plan: null,
        amount: null, currency: 'USD', status: 'error_no_email',
        tilopaySubscriptionId: null, rawData: data,
        errorMessage: `No email in payload. HasData: ${hasData}. Keys: ${Object.keys(data).join(',')}`
      })
      return res.status(200).json({ received: true, warning: 'No email found in payload' })
    }

    // Find user by email
    let userId: string | null = null
    let pendingPlan: string | null = null

    // First check pending_subscriptions
    const { data: pending } = await supabase
      .from('pending_subscriptions')
      .select('user_id, plan')
      .eq('email', email)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (pending) {
      userId = pending.user_id
      pendingPlan = pending.plan
    } else {
      // Fallback: find user by email in profiles
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle()

      if (profile) {
        userId = profile.id
      }
    }

    if (!userId) {
      console.error(`No user found for email: ${email}`)
      await recordTransaction({
        userId: null, email, eventType, plan: pendingPlan,
        amount: parseAmount(data), currency: String(data.currency || 'USD'),
        status: 'error_no_user', tilopaySubscriptionId: getSubId(data),
        rawData: data, errorMessage: `No user found for email ${email}`
      })
      return res.status(200).json({ received: true, warning: 'User not found' })
    }

    // Determine plan
    const plan = pendingPlan || determinePlanFromData(data)
    const amount = parseAmount(data)
    const currency = String(data.currency || 'USD')
    const subId = getSubId(data)

    console.log(`Processing: user=${userId}, email=${email}, event=${eventType}, plan=${plan}, amount=${amount}`)

    // Handle one-time image boost purchase
    if (plan === 'image_boost') {
      await handleImageBoost(userId, email, plan, amount, currency, data)
      await recordTransaction({
        userId, email, eventType, plan: 'image_boost',
        amount, currency, status: 'succeeded',
        tilopaySubscriptionId: subId, rawData: data
      })
      return res.status(200).json({ received: true, event: eventType, action: 'image_boost' })
    }

    // Process based on event type
    let txStatus = 'processed'
    let txError: string | undefined

    try {
      switch (eventType) {
        case 'subscribe':
          await handleSubscribe(userId, email, plan, amount, currency, data)
          break
        case 'payment':
          await handlePayment(userId, plan, amount, currency, data)
          break
        case 'rejected':
          await handleRejected(userId, plan, amount, currency, data)
          txStatus = 'rejected'
          break
        case 'unsubscribe':
          await handleUnsubscribe(userId, data)
          txStatus = 'cancelled'
          break
        case 'reactive':
          await handleReactive(userId, plan, data)
          break
        default:
          console.log(`Unknown event type: ${eventType}`)
          txStatus = 'unknown_event'
      }
    } catch (handlerErr) {
      txStatus = 'error'
      txError = handlerErr instanceof Error ? handlerErr.message : 'Handler failed'
      console.error(`Handler error for ${eventType}:`, handlerErr)
    }

    // Record audit trail
    await recordTransaction({
      userId, email, eventType, plan, amount, currency,
      status: txStatus, tilopaySubscriptionId: subId,
      rawData: data, errorMessage: txError
    })

    return res.status(200).json({ received: true, event: eventType })

  } catch (error) {
    console.error('Webhook top-level error:', error)
    // Try to record even on crash
    try {
      await recordTransaction({
        userId: null, email: null, eventType: (req.query.event as string) || 'unknown',
        plan: null, amount: null, currency: 'USD', status: 'crash',
        tilopaySubscriptionId: null, rawData: parseWebhookData(req),
        errorMessage: error instanceof Error ? error.message : 'Unknown crash'
      })
    } catch { /* ignore */ }
    return res.status(200).json({ received: true, error: 'Processing failed' })
  }
}

// =============================================
// EVENT HANDLERS
// =============================================

async function handleSubscribe(
  userId: string,
  email: string,
  plan: string,
  amount: number | null,
  currency: string,
  data: TiloPayWebhookData
) {
  console.log(`New subscription for user ${userId}: ${plan}`)

  await supabase!.from('subscriptions').upsert({
    user_id: userId,
    plan: plan,
    status: 'active',
    tilopay_subscription_id: getSubId(data),
    current_period_start: new Date().toISOString(),
    current_period_end: getNextBillingDate().toISOString()
  }, { onConflict: 'user_id' })

  await supabase!.from('pending_subscriptions')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('user_id', userId)

  if (amount && amount > 0) {
    await supabase!.from('payments').insert({
      user_id: userId,
      amount,
      currency,
      status: 'succeeded',
      plan,
      description: `New subscription: ${plan}`,
      paid_at: new Date().toISOString()
    })
  }

  console.log(`Subscription activated for ${email}`)
}

async function handlePayment(
  userId: string,
  plan: string,
  amount: number | null,
  currency: string,
  data: TiloPayWebhookData
) {
  console.log(`Recurring payment for user ${userId}, plan: ${plan}`)

  // Update/create subscription — ensures plan is correct even if subscribe was missed
  const { error: subError } = await supabase!.from('subscriptions')
    .upsert({
      user_id: userId,
      plan: plan,
      status: 'active',
      tilopay_subscription_id: getSubId(data),
      current_period_start: new Date().toISOString(),
      current_period_end: getNextBillingDate().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })

  if (subError) {
    console.error('Failed to upsert subscription:', subError)
  }

  // Mark any pending subscription as completed
  await supabase!.from('pending_subscriptions')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('status', 'pending')

  await supabase!.from('payments').insert({
    user_id: userId,
    amount: amount || 0,
    currency,
    status: 'succeeded',
    plan,
    description: `Recurring payment: ${plan}`,
    paid_at: new Date().toISOString()
  })

  console.log(`Payment recorded, subscription extended, plan: ${plan}`)
}

async function handleRejected(
  userId: string,
  plan: string,
  amount: number | null,
  currency: string,
  data: TiloPayWebhookData
) {
  console.log(`Payment rejected for user ${userId}`)

  await supabase!.from('subscriptions')
    .update({ status: 'past_due', updated_at: new Date().toISOString() })
    .eq('user_id', userId)

  await supabase!.from('payments').insert({
    user_id: userId,
    amount: amount || 0,
    currency,
    status: 'failed',
    plan,
    description: `Failed payment: ${plan}`,
    paid_at: new Date().toISOString()
  })

  console.log(`Subscription marked as past_due`)
}

async function handleUnsubscribe(userId: string, _data: TiloPayWebhookData) {
  console.log(`Subscription cancelled for user ${userId}`)

  await supabase!.from('subscriptions')
    .update({
      status: 'cancelled',
      cancel_at_period_end: true,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)

  console.log(`Subscription cancelled`)
}

async function handleReactive(
  userId: string,
  plan: string,
  data: TiloPayWebhookData
) {
  console.log(`Subscription reactivated for user ${userId}`)

  await supabase!.from('subscriptions')
    .update({
      status: 'active',
      plan: plan,
      cancel_at_period_end: false,
      tilopay_subscription_id: getSubId(data),
      current_period_end: getNextBillingDate().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)

  console.log(`Subscription reactivated`)
}

async function handleImageBoost(
  userId: string,
  email: string,
  plan: string,
  amount: number | null,
  currency: string,
  data: TiloPayWebhookData
) {
  console.log(`Image boost purchase for user ${userId} (${email})`)

  const { error } = await supabase!.rpc('credit_bonus_images', {
    p_user_id: userId,
    p_amount: 100
  })

  if (error) {
    console.error('Failed to credit bonus images:', error)
  }

  await supabase!.from('pending_subscriptions')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('plan', 'image_boost')

  if (amount && amount > 0) {
    await supabase!.from('payments').insert({
      user_id: userId,
      amount,
      currency,
      status: 'succeeded',
      plan: 'image_boost',
      description: '+100 bonus images',
      paid_at: new Date().toISOString()
    })
  }

  console.log(`+100 bonus images credited to ${email}`)
}

// =============================================
// HELPER FUNCTIONS
// =============================================

function parseAmount(data: TiloPayWebhookData): number | null {
  const raw = data.amount ?? data.monto
  if (raw === undefined || raw === null) return null
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw))
  return isNaN(num) ? null : num
}

function getSubId(data: TiloPayWebhookData): string | null {
  return (data.subscriber_id || data.subscription_id || null) as string | null
}

function determinePlanFromData(data: TiloPayWebhookData): string {
  const amount = parseAmount(data) || 0

  if (amount >= 14 && amount <= 16) return 'image_boost'
  if (amount >= 200) return 'enterprise'
  if (amount >= 40) return 'pro'
  if (amount >= 20) return 'starter'

  const title = String(data.modality || data.plan_title || data.description || '').toLowerCase()

  if (title.includes('boost') || title.includes('extra') || title.includes('100')) return 'image_boost'
  if (title.includes('enterprise') || title.includes('empresa')) return 'enterprise'
  if (title.includes('premium') || title.includes('pro')) return 'pro'
  if (title.includes('starter') || title.includes('individual') || title.includes('básico')) return 'starter'

  console.log('Could not determine plan from data, defaulting to starter:', JSON.stringify(data))
  return 'starter'
}

function getNextBillingDate(): Date {
  const date = new Date()
  date.setMonth(date.getMonth() + 1)
  return date
}
