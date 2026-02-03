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
 * https://advanceai.studio/api/tilopay/webhook?event=subscribe
 * https://advanceai.studio/api/tilopay/webhook?event=payment
 * https://advanceai.studio/api/tilopay/webhook?event=rejected
 * https://advanceai.studio/api/tilopay/webhook?event=unsubscribe
 * https://advanceai.studio/api/tilopay/webhook?event=reactive
 */

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey) 
  : null

// TiloPay webhook payload structure (based on their API docs)
interface TiloPayWebhookData {
  // Common fields TiloPay likely sends
  email?: string
  subscriber_email?: string
  customer_email?: string
  subscriber_id?: string
  subscription_id?: string
  plan_id?: string
  plan_title?: string
  amount?: number
  currency?: string
  status?: string
  modality?: string
  // Allow any other fields
  [key: string]: unknown
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle GET request (endpoint verification)
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'TiloPay webhook endpoint active',
      usage: 'Add ?event=subscribe|payment|rejected|unsubscribe|reactive'
    })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    if (!supabase) {
      console.error('Supabase not configured')
      return res.status(500).json({ error: 'Server not configured' })
    }

    // Get event type from query parameter (configured in TiloPay dashboard)
    const eventType = req.query.event as string || 'unknown'
    const data: TiloPayWebhookData = req.body

    console.log(`TiloPay webhook received: ${eventType}`, JSON.stringify(data, null, 2))

    // Extract email from various possible fields
    const email = data.email || data.subscriber_email || data.customer_email
    
    if (!email) {
      console.error('No email in webhook payload')
      return res.status(200).json({ received: true, warning: 'No email found' })
    }

    // Find user by email in pending_subscriptions or profiles
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
      .single()

    if (pending) {
      userId = pending.user_id
      pendingPlan = pending.plan
    } else {
      // Fallback: find user by email in profiles
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .single()
      
      if (profile) {
        userId = profile.id
      }
    }

    if (!userId) {
      console.error(`No user found for email: ${email}`)
      return res.status(200).json({ received: true, warning: 'User not found' })
    }

    // Determine plan from webhook data or pending subscription
    const plan = pendingPlan || determinePlanFromData(data)

    // Process based on event type
    switch (eventType) {
      case 'subscribe':
        await handleSubscribe(userId, email, plan, data)
        break

      case 'payment':
        await handlePayment(userId, data)
        break

      case 'rejected':
        await handleRejected(userId, data)
        break

      case 'unsubscribe':
        await handleUnsubscribe(userId, data)
        break

      case 'reactive':
        await handleReactive(userId, plan, data)
        break

      default:
        console.log(`Unknown event type: ${eventType}`)
    }

    return res.status(200).json({ received: true, event: eventType })

  } catch (error) {
    console.error('Webhook error:', error)
    return res.status(200).json({ received: true, error: 'Processing failed' })
  }
}

// =============================================
// EVENT HANDLERS (TiloPay Repeat API format)
// =============================================

/**
 * Handle new subscription (webhook_subscribe)
 * Called when user completes initial subscription
 */
async function handleSubscribe(
  userId: string, 
  email: string, 
  plan: string, 
  data: TiloPayWebhookData
) {
  console.log(`New subscription for user ${userId}: ${plan}`)

  // Create/update subscription record
  await supabase!.from('subscriptions').upsert({
    user_id: userId,
    plan: plan,
    status: 'active',
    tilopay_subscription_id: data.subscriber_id || data.subscription_id,
    current_period_start: new Date().toISOString(),
    current_period_end: getNextBillingDate().toISOString()
  }, { onConflict: 'user_id' })

  // Mark pending subscription as completed
  await supabase!.from('pending_subscriptions')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('user_id', userId)

  // Record payment if amount provided
  if (data.amount) {
    await supabase!.from('payments').insert({
      user_id: userId,
      amount: data.amount,
      currency: data.currency || 'USD',
      status: 'succeeded',
      paid_at: new Date().toISOString()
    })
  }

  console.log(`Subscription activated for ${email}`)
}

/**
 * Handle successful recurring payment (webhook_payment)
 * Called for each successful recurring charge
 */
async function handlePayment(userId: string, data: TiloPayWebhookData) {
  console.log(`Recurring payment for user ${userId}`)

  // Extend subscription period
  await supabase!.from('subscriptions')
    .update({
      status: 'active',
      current_period_start: new Date().toISOString(),
      current_period_end: getNextBillingDate().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)

  // Record payment
  await supabase!.from('payments').insert({
    user_id: userId,
    amount: data.amount || 0,
    currency: data.currency || 'USD',
    status: 'succeeded',
    paid_at: new Date().toISOString()
  })

  console.log(`Payment recorded and subscription extended`)
}

/**
 * Handle failed payment (webhook_rejected)
 * Called when recurring charge fails
 */
async function handleRejected(userId: string, data: TiloPayWebhookData) {
  console.log(`Payment rejected for user ${userId}`)

  // Update subscription status
  await supabase!.from('subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)

  // Record failed payment
  await supabase!.from('payments').insert({
    user_id: userId,
    amount: data.amount || 0,
    currency: data.currency || 'USD',
    status: 'failed',
    paid_at: new Date().toISOString()
  })

  console.log(`Subscription marked as past_due`)
}

/**
 * Handle cancellation (webhook_unsubscribe)
 * Called when user cancels subscription
 */
async function handleUnsubscribe(userId: string, data: TiloPayWebhookData) {
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

/**
 * Handle reactivation (webhook_reactive)
 * Called when cancelled subscription is reactivated
 */
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
      current_period_end: getNextBillingDate().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)

  console.log(`Subscription reactivated`)
}

// =============================================
// HELPER FUNCTIONS
// =============================================

/**
 * Determine plan from TiloPay webhook data
 */
function determinePlanFromData(data: TiloPayWebhookData): string {
  // Try to determine plan from modality or plan_title
  const title = (data.modality || data.plan_title || '').toLowerCase()
  
  if (title.includes('team') || title.includes('pro')) {
    return 'pro'
  }
  return 'starter'
}

/**
 * Calculate next billing date (1 month from now)
 */
function getNextBillingDate(): Date {
  const date = new Date()
  date.setMonth(date.getMonth() + 1)
  return date
}
