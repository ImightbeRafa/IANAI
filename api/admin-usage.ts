import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './lib/supabase-admin.js'
import {
  ADMIN_USAGE_MAX_ROWS,
  aggregateDailyUsage,
  aggregateUsageSummary,
  aggregateUserUsageStats,
  paginateUsageLogs,
  type AdminUsageLogRow,
} from './lib/admin-usage.js'

const LOG_SELECT = 'id, user_id, user_email, feature, model, generation_id, input_tokens, output_tokens, total_tokens, estimated_cost_usd, success, created_at, metadata'

function queryString(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
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

  if (!profile?.is_admin) {
    return res.status(403).json({ error: 'Admin access required' })
  }

  const endDate = queryString(req.query.end_date) ? new Date(queryString(req.query.end_date)) : new Date()
  const startDate = queryString(req.query.start_date)
    ? new Date(queryString(req.query.start_date))
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return res.status(400).json({ error: 'Invalid start_date or end_date' })
  }

  const startIso = startDate.toISOString()
  const endIso = endDate.toISOString()
  const search = queryString(req.query.search).trim()
  const offset = Math.max(0, Number(queryString(req.query.offset) || 0) || 0)
  const limit = Math.min(100, Math.max(1, Number(queryString(req.query.limit) || 20) || 20))
  const logsOnly = queryString(req.query.logs_only) === '1'

  try {
    if (logsOnly) {
      let query = supabase
        .from('api_usage_logs')
        .select('id, user_email, feature, model, generation_id, total_tokens, estimated_cost_usd, success, created_at, metadata')
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (search) {
        query = query.ilike('user_email', `%${search}%`)
      }

      const { data, error } = await query
      if (error) return res.status(500).json({ error: 'Failed to fetch usage logs', details: error.message })

      const logs = (data || []) as AdminUsageLogRow[]
      return res.status(200).json({
        logs: logs.map(row => ({
          id: row.id,
          user_email: row.user_email || '',
          feature: row.feature,
          model: row.model,
          generation_id: row.generation_id || null,
          total_tokens: Number(row.total_tokens || 0),
          estimated_cost_usd: Number(row.estimated_cost_usd || 0),
          success: row.success !== false,
          created_at: row.created_at,
          metadata: row.metadata || {},
        })),
        hasMore: logs.length >= limit,
      })
    }

    const { data, error } = await supabase
      .from('api_usage_logs')
      .select(LOG_SELECT)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false })
      .limit(ADMIN_USAGE_MAX_ROWS)

    if (error) return res.status(500).json({ error: 'Failed to fetch usage logs', details: error.message })

    const rows = (data || []) as AdminUsageLogRow[]
    const page = paginateUsageLogs(rows, { search, offset, limit })

    return res.status(200).json({
      summary: aggregateUsageSummary(rows),
      daily: aggregateDailyUsage(rows),
      userStats: aggregateUserUsageStats(rows),
      logs: page.logs,
      hasMore: page.hasMore,
      truncated: rows.length >= ADMIN_USAGE_MAX_ROWS,
    })
  } catch (err) {
    console.error('Admin usage error:', err)
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load usage data',
    })
  }
}
