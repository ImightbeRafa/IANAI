import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Verify auth + admin status
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization' })
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Server configuration error' })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Verify the token and check admin status
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.is_admin) {
    return res.status(403).json({ error: 'Admin access required' })
  }

  try {
    // Fetch ALL subscriptions (service role bypasses RLS)
    const { data: subscriptions } = await supabase
      .from('subscriptions')
      .select('*')
      .order('updated_at', { ascending: false })

    // Fetch ALL payments
    const { data: payments } = await supabase
      .from('payments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)

    // Fetch payment_transactions (may not exist — catch silently)
    let transactions: unknown[] = []
    try {
      const { data: txData } = await supabase
        .from('payment_transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      transactions = txData || []
    } catch { /* table may not exist */ }

    // Fetch pending_subscriptions
    let pendingSubs: unknown[] = []
    try {
      const { data: pendingData } = await supabase
        .from('pending_subscriptions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      pendingSubs = pendingData || []
    } catch { /* non-critical */ }

    // Enrich with user emails
    const allUserIds = new Set<string>()
    for (const s of (subscriptions || []) as { user_id: string }[]) allUserIds.add(s.user_id)
    for (const p of (payments || []) as { user_id: string }[]) allUserIds.add(p.user_id)
    for (const t of transactions as { user_id?: string }[]) if (t.user_id) allUserIds.add(t.user_id)

    let profilesMap: Record<string, { email: string; full_name: string }> = {}
    const userIds = [...allUserIds]
    if (userIds.length > 0) {
      // Batch fetch in chunks of 50
      for (let i = 0; i < userIds.length; i += 50) {
        const chunk = userIds.slice(i, i + 50)
        const { data: pData } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .in('id', chunk)
        for (const p of (pData || []) as { id: string; email: string; full_name: string }[]) {
          profilesMap[p.id] = { email: p.email, full_name: p.full_name }
        }
      }
    }

    // Enrich records
    const enrichedSubs = (subscriptions || []).map((s: Record<string, unknown>) => ({
      ...s,
      user_email: profilesMap[s.user_id as string]?.email || 'Unknown',
      user_name: profilesMap[s.user_id as string]?.full_name || ''
    }))

    const enrichedPayments = (payments || []).map((p: Record<string, unknown>) => ({
      ...p,
      user_email: profilesMap[p.user_id as string]?.email || 'Unknown'
    }))

    const enrichedTransactions = (transactions as Record<string, unknown>[]).map(t => ({
      ...t,
      user_email: t.user_id ? profilesMap[t.user_id as string]?.email || t.email || 'Unknown' : t.email || 'Unknown'
    }))

    return res.status(200).json({
      subscriptions: enrichedSubs,
      payments: enrichedPayments,
      transactions: enrichedTransactions,
      pendingSubscriptions: pendingSubs
    })

  } catch (error) {
    console.error('Admin billing fetch error:', error)
    return res.status(500).json({ error: 'Failed to fetch billing data' })
  }
}
