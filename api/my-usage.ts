import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { supabaseAdmin } from './lib/supabase-admin.js'
import { mergeUsageHistory, type UsageLedgerInput, type UsageLogInput } from './lib/my-usage.js'

const LOG_SELECT = 'id, generation_id, feature, success, error_message, created_at, metadata'
const LEDGER_SELECT = 'generation_id, action, units, credits, created_at'
const MAX_ROWS = 80

function queryString(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await requireAuth(req, res)
  if (!user) return

  const supabase = supabaseAdmin
  if (!supabase) {
    return res.status(500).json({ error: 'Server configuration error' })
  }

  const limit = Math.min(50, Math.max(1, Number(queryString(req.query.limit) || 50) || 50))

  try {
    const [logsResult, ledgerResult] = await Promise.all([
      supabase
        .from('api_usage_logs')
        .select(LOG_SELECT)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS),
      supabase
        .from('credit_ledger')
        .select(LEDGER_SELECT)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS),
    ])

    if (logsResult.error) {
      return res.status(500).json({ error: 'Failed to fetch usage', details: logsResult.error.message })
    }
    if (ledgerResult.error) {
      return res.status(500).json({ error: 'Failed to fetch usage', details: ledgerResult.error.message })
    }

    const items = mergeUsageHistory(
      (logsResult.data || []) as UsageLogInput[],
      (ledgerResult.data || []) as UsageLedgerInput[]
    ).slice(0, limit)

    return res.status(200).json({ items })
  } catch (err) {
    console.error('my-usage', err)
    return res.status(500).json({ error: 'Failed to fetch usage' })
  }
}
