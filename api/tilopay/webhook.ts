import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// Tilo Pay webhook handler
// Documentation: https://tilopay.com/docs/webhooks

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Initialize Supabase with service role key for webhook operations
const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey) 
  : null

// Webhook event types from Tilo Pay (Repeat API)
type TiloPayEventType = 
  | 'payment.succeeded'
  | 'payment.failed'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'subscription.past_due'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'plan.created'
  | 'plan.updated'

interface TiloPayWebhookPayload {
  event: TiloPayEventType
  data: {
    id: string
    customer_id?: string
    subscription_id?: string
    amount?: number
    currency?: string
    status?: string
    metadata?: Record<string, string>
    [key: string]: unknown
  }
  timestamp: string
}

/**
 * Verify TiloPay webhook signature using HMAC-SHA256
 * TiloPay sends the signature in the 'hash-tilopay' header
 * 
 * @param rawBody - The raw request body as a string
 * @param providedHash - The hash from 'hash-tilopay' header
 * @returns boolean - True if signature is valid
 */
function verifyWebhookSignature(rawBody: string, providedHash: string | undefined): boolean {
  const webhookSecret = process.env.TILOPAY_WEBHOOK_SECRET
  
  // In production, ALWAYS require valid signature
  if (!webhookSecret) {
    console.error('TILOPAY_WEBHOOK_SECRET not configured')
    return false
  }

  if (!providedHash) {
    console.error('Missing hash-tilopay header in webhook request')
    return false
  }

  // Generate expected signature using HMAC-SHA256
  const expectedHash = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody, 'utf8')
    .digest('hex')

  // Timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedHash, 'hex'),
      Buffer.from(providedHash, 'hex')
    )
  } catch {
    // If buffers are different lengths, comparison fails
    console.error('Webhook signature mismatch')
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle GET request (webhook verification)
  if (req.method === 'GET') {
    // Tilo Pay may send a verification challenge
    const challenge = req.query.challenge || req.query.hub_challenge
    if (challenge) {
      console.log('Webhook verification challenge received')
      return res.status(200).send(challenge)
    }
    return res.status(200).json({ status: 'Webhook endpoint active' })
  }

  // Only accept POST requests for webhook events
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Check if Supabase is configured
    if (!supabase) {
      console.error('Supabase not configured - missing env vars')
      return res.status(500).json({ error: 'Server not configured' })
    }

    const rawBody = JSON.stringify(req.body)
    // TiloPay uses 'hash-tilopay' header for signature
    const signature = req.headers['hash-tilopay'] as string | undefined

    // Verify webhook signature
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.error('Invalid webhook signature')
      return res.status(401).json({ error: 'Invalid signature' })
    }

    const payload: TiloPayWebhookPayload = req.body

    console.log(`Received Tilo Pay webhook: ${payload.event}`, {
      id: payload.data?.id,
      timestamp: payload.timestamp
    })

    // Process webhook events
    switch (payload.event) {
      case 'payment.succeeded':
        await handlePaymentSucceeded(payload.data)
        break

      case 'payment.failed':
        await handlePaymentFailed(payload.data)
        break

      case 'subscription.created':
        await handleSubscriptionCreated(payload.data)
        break

      case 'subscription.updated':
        await handleSubscriptionUpdated(payload.data)
        break

      case 'subscription.cancelled':
        await handleSubscriptionCancelled(payload.data)
        break

      case 'subscription.past_due':
        await handleSubscriptionPastDue(payload.data)
        break

      case 'invoice.paid':
        await handleInvoicePaid(payload.data)
        break

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(payload.data)
        break

      default:
        console.log(`Unhandled webhook event: ${payload.event}`)
    }

    // Always return 200 to acknowledge receipt
    return res.status(200).json({ received: true })

  } catch (error) {
    console.error('Webhook processing error:', error)
    // Return 200 anyway to prevent retries for unrecoverable errors
    // Return 500 only for temporary failures that should be retried
    return res.status(500).json({ error: 'Webhook processing failed' })
  }
}

// =============================================
// EVENT HANDLERS
// =============================================

async function handlePaymentSucceeded(data: TiloPayWebhookPayload['data']) {
  let userId = data.metadata?.user_id
  const subscriptionId = data.subscription_id
  const customerEmail = (data as Record<string, unknown>).customer_email || (data as Record<string, unknown>).email

  // If no user_id in metadata, try to match by email from pending_subscriptions
  if (!userId && customerEmail) {
    const { data: pending } = await supabase!
      .from('pending_subscriptions')
      .select('user_id, plan')
      .eq('email', customerEmail)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (pending) {
      userId = pending.user_id
      console.log(`Matched payment to user ${userId} via email ${customerEmail}`)
      
      // Mark pending subscription as completed
      await supabase!
        .from('pending_subscriptions')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('user_id', userId)
    }
  }

  if (!userId) {
    console.error('Payment succeeded but could not identify user')
    return
  }

  // Record the payment
  await supabase!.from('payments').insert({
    subscription_id: subscriptionId,
    user_id: userId,
    amount: data.amount,
    currency: data.currency || 'CRC',
    status: 'succeeded',
    tilopay_payment_id: data.id,
    paid_at: new Date().toISOString()
  })

  console.log(`Payment recorded for user ${userId}`)
}

async function handlePaymentFailed(data: TiloPayWebhookPayload['data']) {
  const userId = data.metadata?.user_id

  if (!userId) {
    console.error('Payment failed but no user_id in metadata')
    return
  }

  // Record failed payment
  await supabase!.from('payments').insert({
    user_id: userId,
    amount: data.amount || 0,
    currency: data.currency || 'CRC',
    status: 'failed',
    tilopay_payment_id: data.id
  })

  console.log(`Failed payment recorded for user ${userId}`)
}

async function handleSubscriptionCreated(data: TiloPayWebhookPayload['data']) {
  const userId = data.metadata?.user_id
  const plan = data.metadata?.plan || 'starter'

  if (!userId) {
    console.error('Subscription created but no user_id in metadata')
    return
  }

  // Update or create subscription
  await supabase!.from('subscriptions')
    .upsert({
      user_id: userId,
      plan: plan,
      status: 'active',
      tilopay_subscription_id: data.id,
      tilopay_customer_id: data.customer_id,
      current_period_start: new Date().toISOString(),
      current_period_end: getNextBillingDate().toISOString()
    }, { onConflict: 'user_id' })

  console.log(`Subscription created for user ${userId}: ${plan}`)
}

async function handleSubscriptionUpdated(data: TiloPayWebhookPayload['data']) {
  const tilopaySubscriptionId = data.id

  // Find subscription by Tilo Pay ID and update
  await supabase!.from('subscriptions')
    .update({
      plan: data.metadata?.plan,
      status: data.status || 'active',
      updated_at: new Date().toISOString()
    })
    .eq('tilopay_subscription_id', tilopaySubscriptionId)

  console.log(`Subscription updated: ${tilopaySubscriptionId}`)
}

async function handleSubscriptionCancelled(data: TiloPayWebhookPayload['data']) {
  const tilopaySubscriptionId = data.id

  await supabase!.from('subscriptions')
    .update({
      status: 'cancelled',
      cancel_at_period_end: true,
      updated_at: new Date().toISOString()
    })
    .eq('tilopay_subscription_id', tilopaySubscriptionId)

  console.log(`Subscription cancelled: ${tilopaySubscriptionId}`)
}

async function handleSubscriptionPastDue(data: TiloPayWebhookPayload['data']) {
  const tilopaySubscriptionId = data.id

  await supabase!.from('subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString()
    })
    .eq('tilopay_subscription_id', tilopaySubscriptionId)

  console.log(`Subscription past due: ${tilopaySubscriptionId}`)
}

async function handleInvoicePaid(data: TiloPayWebhookPayload['data']) {
  // Extend subscription period when invoice is paid
  const tilopaySubscriptionId = data.subscription_id

  if (tilopaySubscriptionId) {
    await supabase!.from('subscriptions')
      .update({
        status: 'active',
        current_period_start: new Date().toISOString(),
        current_period_end: getNextBillingDate().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('tilopay_subscription_id', tilopaySubscriptionId)
  }

  console.log(`Invoice paid, subscription extended: ${tilopaySubscriptionId}`)
}

async function handleInvoicePaymentFailed(data: TiloPayWebhookPayload['data']) {
  const tilopaySubscriptionId = data.subscription_id

  if (tilopaySubscriptionId) {
    await supabase!.from('subscriptions')
      .update({
        status: 'past_due',
        updated_at: new Date().toISOString()
      })
      .eq('tilopay_subscription_id', tilopaySubscriptionId)
  }

  console.log(`Invoice payment failed: ${tilopaySubscriptionId}`)
}

// =============================================
// HELPER FUNCTIONS
// =============================================

function getNextBillingDate(): Date {
  const date = new Date()
  date.setMonth(date.getMonth() + 1)
  return date
}
