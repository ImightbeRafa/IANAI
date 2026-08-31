import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './lib/supabase-admin.js'
import { CREDIT_COGS_USD } from './lib/credits/catalog.js'
import {
  ADMIN_USAGE_MAX_ROWS,
  aggregateDailyUsage,
  aggregateUsageSummary,
  aggregateUserUsageStats,
  buildCreditsByGenerationId,
  buildCreditsEconomics,
  filterUsageRowsBySource,
  paginateUsageLogs,
  resolveUsageLogSource,
  type AdminUsageLogRow,
  type CreditLedgerRow,
} from './lib/admin-usage.js'

const LOG_SELECT = 'id, user_id, user_email, feature, model, generation_id, input_tokens, output_tokens, total_tokens, estimated_cost_usd, success, created_at, metadata, source'

function queryString(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

async function fetchCreditLedger(
  supabase: NonNullable<typeof supabaseAdmin>,
  startIso: string,
  endIso: string
): Promise<CreditLedgerRow[]> {
  const { data, error } = await supabase
    .from('credit_ledger')
    .select('generation_id, credits, action, created_at')
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .limit(ADMIN_USAGE_MAX_ROWS)

  if (error) {
    console.warn('admin-usage credit_ledger read failed:', error.message)
    return []
  }
  return (data || []) as CreditLedgerRow[]
}

async function fetchCreditsInCirculation(
  supabase: NonNullable<typeof supabaseAdmin>
): Promise<number> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('credit_lots')
    .select('remaining, expires_at')
    .gt('remaining', 0)
    .limit(ADMIN_USAGE_MAX_ROWS)

  if (error) {
    console.warn('admin-usage credit_lots read failed:', error.message)
    return 0
  }

  let total = 0
  for (const row of data || []) {
    const remaining = Number((row as { remaining?: number }).remaining || 0)
    if (!Number.isFinite(remaining) || remaining <= 0) continue
    const expiresAt = (row as { expires_at?: string | null }).expires_at
    if (expiresAt && expiresAt <= nowIso) continue
    total += remaining
  }
  return total
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
  const source = queryString(req.query.source).trim().toLowerCase()
  const offset = Math.max(0, Number(queryString(req.query.offset) || 0) || 0)
  const limit = Math.min(100, Math.max(1, Number(queryString(req.query.limit) || 20) || 20))
  const logsOnly = queryString(req.query.logs_only) === '1'

  try {
    if (logsOnly) {
      let query = supabase
        .from('api_usage_logs')
        .select('id, user_email, feature, model, generation_id, total_tokens, estimated_cost_usd, success, created_at, metadata, source')
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (search) {
        query = query.ilike('user_email', `%${search}%`)
      }
      if (source === 'web') {
        query = query.or('source.eq.web,source.is.null')
      } else if (source === 'mcp' || source === 'cron' || source === 'legacy_preview_qa') {
        query = query.or(`source.eq.${source},metadata->>source.eq.${source}`)
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
          source: resolveUsageLogSource(row),
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
    const scopedRows = filterUsageRowsBySource(rows, source)
    const [ledger, creditsInCirculation] = await Promise.all([
      fetchCreditLedger(supabase, startIso, endIso),
      fetchCreditsInCirculation(supabase),
    ])
    const scopedGenIds = new Set(
      scopedRows
        .map((row) => (typeof row.generation_id === 'string' ? row.generation_id.trim() : ''))
        .filter(Boolean)
    )
    const scopedLedger =
      source && source !== 'all'
        ? ledger.filter((row) => {
            const gid = typeof row.generation_id === 'string' ? row.generation_id.trim() : ''
            return Boolean(gid && scopedGenIds.has(gid))
          })
        : ledger
    const creditsByGenerationId = buildCreditsByGenerationId(scopedLedger)
    const page = paginateUsageLogs(rows, { search, offset, limit, source })

    return res.status(200).json({
      summary: aggregateUsageSummary(scopedRows, creditsByGenerationId),
      daily: aggregateDailyUsage(scopedRows),
      userStats: aggregateUserUsageStats(scopedRows),
      creditsEconomics: buildCreditsEconomics({
        rows: scopedRows,
        ledger: scopedLedger,
        creditsInCirculation,
        creditCogsUsd: CREDIT_COGS_USD,
      }),
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
