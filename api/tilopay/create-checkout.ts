import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// TiloPay API credentials from environment
const TILOPAY_API_KEY = process.env.TILOPAY_API_KEY || '7067-2615-6995-8721-7143'
const TILOPAY_API_USER = process.env.TILOPAY_API_USER || '0S4T29'
const TILOPAY_API_PASSWORD = process.env.TILOPAY_API_PASSWORD || 'exojM6'

// TiloPay payment links (direct checkout links from TiloPay dashboard)
const BASE_PAYMENT_LINKS: Record<string, string> = {
  starter: 'https://tp.cr/l/TkRnM01RPT18MQ==',  // Individual plan
  pro: 'https://tp.cr/l/TkRnM01nPT18MQ=='       // Teams plan
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
    // Verify auth token
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization' })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    const { plan } = req.body

    if (!plan || !BASE_PAYMENT_LINKS[plan]) {
      return res.status(400).json({ error: 'Invalid plan' })
    }

    // Store pending subscription in database for webhook to match
    const { error: pendingError } = await supabase
      .from('pending_subscriptions')
      .upsert({
        user_id: user.id,
        email: user.email,
        plan: plan,
        created_at: new Date().toISOString(),
        status: 'pending'
      }, { onConflict: 'user_id' })

    if (pendingError) {
      console.error('Failed to store pending subscription:', pendingError)
      // Continue anyway - we can still try to match by email in webhook
    }

    // Build payment URL with email parameter for matching
    const paymentUrl = new URL(BASE_PAYMENT_LINKS[plan])
    paymentUrl.searchParams.set('email', user.email || '')
    paymentUrl.searchParams.set('encrypted', 'base64')

    return res.status(200).json({
      checkoutUrl: paymentUrl.toString(),
      userId: user.id
    })

  } catch (error) {
    console.error('Checkout error:', error)
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    })
  }
}
