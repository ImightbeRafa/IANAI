import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './lib/supabase-admin.js'
import { resolveAdminDashboardAccess } from './lib/preview-admin.js'

type ProfileRow = { id: string; email: string | null; full_name: string | null }
type SubRow = {
  user_id: string
  plan: string
  status: string
  trial_ends_at: string | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization' })
  }

  const supabase = supabaseAdmin
  if (!supabase) {
    return res.status(500).json({ error: 'Server configuration error' })
  }

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

  if (!resolveAdminDashboardAccess({
    profileIsAdmin: profile?.is_admin === true,
    email: user.email,
  })) {
    return res.status(403).json({ error: 'Admin access required' })
  }

  try {
    const { data: campaigns, error: campaignsError } = await supabase
      .from('referral_campaigns')
      .select('*')
      .order('created_at', { ascending: false })

    if (campaignsError) {
      return res.status(500).json({ error: 'Failed to fetch referral campaigns', details: campaignsError.message })
    }

    const { data: signups, error: signupsError } = await supabase
      .from('referral_signups')
      .select('*')
      .order('signed_up_at', { ascending: false })

    if (signupsError) {
      return res.status(500).json({ error: 'Failed to fetch referral signups', details: signupsError.message })
    }

    const rawSignups = (signups || []) as Record<string, unknown>[]
    const userIds = [...new Set(rawSignups.map((s) => s.user_id as string).filter(Boolean))]

    const profilesMap: Record<string, { email: string; full_name: string }> = {}
    const subsMap: Record<string, { plan: string; status: string; trial_ends_at: string | null }> = {}

    if (userIds.length > 0) {
      for (let i = 0; i < userIds.length; i += 50) {
        const chunk = userIds.slice(i, i + 50)
        const { data: pData } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .in('id', chunk)
        for (const p of (pData || []) as ProfileRow[]) {
          profilesMap[p.id] = {
            email: p.email || '',
            full_name: p.full_name || '',
          }
        }

        const { data: sData } = await supabase
          .from('subscriptions')
          .select('user_id, plan, status, trial_ends_at')
          .in('user_id', chunk)
        for (const s of (sData || []) as SubRow[]) {
          subsMap[s.user_id] = {
            plan: s.plan,
            status: s.status,
            trial_ends_at: s.trial_ends_at,
          }
        }
      }

      // Auth Admin fallback for users missing profile email (post-RLS 068)
      const missingEmailIds = userIds.filter((id) => !profilesMap[id]?.email)
      for (const uid of missingEmailIds) {
        try {
          const { data: authUser, error } = await supabase.auth.admin.getUserById(uid)
          if (error || !authUser?.user) continue
          const email = authUser.user.email || ''
          const fullName =
            (typeof authUser.user.user_metadata?.full_name === 'string'
              ? authUser.user.user_metadata.full_name
              : '') || profilesMap[uid]?.full_name || ''
          profilesMap[uid] = { email, full_name: fullName }
        } catch {
          /* non-critical — leave Unknown */
        }
      }
    }

    const enrichedSignups = rawSignups.map((s) => {
      const uid = s.user_id as string
      const sub = subsMap[uid]
      const trialEndsAt =
        (sub?.trial_ends_at && String(sub.trial_ends_at)) ||
        (s.trial_ends_at as string) ||
        ''
      return {
        id: s.id as string,
        campaign_id: s.campaign_id as string,
        user_id: uid,
        signed_up_at: s.signed_up_at as string,
        trial_ends_at: trialEndsAt,
        converted_to_paid: Boolean(s.converted_to_paid),
        user_email: profilesMap[uid]?.email || 'Unknown',
        user_name: profilesMap[uid]?.full_name || '',
        current_plan: sub?.plan || 'free',
        current_status: sub?.status || 'unknown',
      }
    })

    return res.status(200).json({
      campaigns: campaigns || [],
      signups: enrichedSignups,
    })
  } catch (error) {
    console.error('Admin referrals fetch error:', error)
    return res.status(500).json({ error: 'Failed to fetch referral data' })
  }
}
