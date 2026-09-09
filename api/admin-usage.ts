import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './lib/supabase-admin.js'
import { CREDIT_COGS_USD } from './lib/credits/catalog.js'
import { resolveAdminDashboardAccess } from './lib/preview-admin.js'
import {
  aggregateDailyTotals,
  aggregateDailyUsage,
  aggregateUsageSummary,
  aggregateUserUsageStats,
  findPeakUsageDay,
  buildCreditsByGenerationId,
  buildCreditsEconomics,
  buildUsageCoverage,
  estimateOfficialApiCostUsd,
  fetchAllPagedRows,
  filterUsageRowsBySource,
  paginateUsageLogs,
  resolveAdminUsageWindow,
  resolveUsageLogSource,
  type AdminUsageLogRow,
  type CreditLedgerRow,
} from './lib/admin-usage.js'

const LOG_SELECT = 'id, user_id, user_email, feature, model, generation_id, input_tokens, output_tokens, total_tokens, estimated_cost_usd, success, created_at, metadata, source'

function queryString(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

function applyCreatedAtRange<T extends { gte: (column: string, value: string) => T; lte: (column: string, value: string) => T }>(
  query: T,
  startIso: string | null,
  endIso: string
): T {
  const bounded = startIso ? query.gte('created_at', startIso) : query
  return bounded.lte('created_at', endIso)
}

async function fetchCreditLedger(
  supabase: NonNullable<typeof supabaseAdmin>,
  startIso: string | null,
  endIso: string
): Promise<CreditLedgerRow[]> {
  try {
    const { rows } = await fetchAllPagedRows<CreditLedgerRow>(async (from, to) => {
      let query = supabase
        .from('credit_ledger')
        .select('generation_id, credits, action, created_at')
        .order('created_at', { ascending: false })
      query = applyCreatedAtRange(query, startIso, endIso)
      return query.range(from, to)
    })
    return rows
  } catch (error) {
    console.warn('admin-usage credit_ledger read failed:', error instanceof Error ? error.message : error)
    return []
  }
}

async function fetchCreditsInCirculation(
  supabase: NonNullable<typeof supabaseAdmin>
): Promise<number> {
  const nowIso = new Date().toISOString()
  try {
    const { rows } = await fetchAllPagedRows<{ remaining?: number; expires_at?: string | null }>(async (from, to) => {
      return supabase
        .from('credit_lots')
        .select('remaining, expires_at')
        .gt('remaining', 0)
        .order('created_at', { ascending: true })
        .range(from, to)
    })
    let total = 0
    for (const row of rows) {
      const remaining = Number(row.remaining || 0)
      if (!Number.isFinite(remaining) || remaining <= 0) continue
      if (row.expires_at && row.expires_at <= nowIso) continue
      total += remaining
    }
    return total
  } catch (error) {
    console.warn('admin-usage credit_lots read failed:', error instanceof Error ? error.message : error)
    return 0
  }
}

async function fetchOldestUsageAt(
  supabase: NonNullable<typeof supabaseAdmin>,
  startIso: string | null,
  endIso: string
): Promise<string | null> {
  let query = supabase
    .from('api_usage_logs')
    .select('created_at')
    .order('created_at', { ascending: true })
    .limit(1)
  query = applyCreatedAtRange(query, startIso, endIso)
  const { data, error } = await query
  if (error) return null
  return (data?.[0] as { created_at?: string } | undefined)?.created_at || null
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

  let window
  try {
    window = resolveAdminUsageWindow({
      startDate: queryString(req.query.start_date),
      endDate: queryString(req.query.end_date),
      lifetime: queryString(req.query.lifetime) === '1',
    })
  } catch {
    return res.status(400).json({ error: 'Invalid start_date or end_date' })
  }
  const { startIso, endIso, lifetime } = window
  const search = queryString(req.query.search).trim()
  const source = queryString(req.query.source).trim().toLowerCase()
  const offset = Math.max(0, Number(queryString(req.query.offset) || 0) || 0)
  const limit = Math.min(100, Math.max(1, Number(queryString(req.query.limit) || 20) || 20))
  const logsOnly = queryString(req.query.logs_only) === '1'

  try {
    if (logsOnly) {
      let query = supabase
        .from('api_usage_logs')
        .select('id, user_email, feature, model, generation_id, input_tokens, output_tokens, total_tokens, estimated_cost_usd, success, created_at, metadata, source')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
      query = applyCreatedAtRange(query, startIso, endIso)

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
          estimated_cost_usd: estimateOfficialApiCostUsd(row),
          stored_cost_usd: Number(row.estimated_cost_usd || 0),
          success: row.success !== false,
          created_at: row.created_at,
          metadata: row.metadata || {},
          source: resolveUsageLogSource(row),
        })),
        hasMore: logs.length >= limit,
      })
    }

    const [{ rows, truncated }, oldestCreatedAt] = await Promise.all([
      fetchAllPagedRows<AdminUsageLogRow>(async (from, to) => {
        let query = supabase
          .from('api_usage_logs')
          .select(LOG_SELECT)
          .order('created_at', { ascending: false })
        query = applyCreatedAtRange(query, startIso, endIso)
        return query.range(from, to)
      }),
      fetchOldestUsageAt(supabase, startIso, endIso),
    ])
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
    const daily = aggregateDailyUsage(scopedRows)
    const dailyTotals = aggregateDailyTotals(daily)

    return res.status(200).json({
      summary: aggregateUsageSummary(scopedRows, creditsByGenerationId),
      daily,
      dailyTotals,
      peakDay: findPeakUsageDay(dailyTotals),
      userStats: aggregateUserUsageStats(scopedRows),
      creditsEconomics: buildCreditsEconomics({
        rows: scopedRows,
        ledger: scopedLedger,
        creditsInCirculation,
        creditCogsUsd: CREDIT_COGS_USD,
      }),
      logs: page.logs,
      hasMore: page.hasMore,
      truncated,
      coverage: buildUsageCoverage({
        rows,
        startIso,
        endIso,
        lifetime,
        truncated,
        oldestCreatedAt,
      }),
    })
  } catch (err) {
    console.error('Admin usage error:', err)
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load usage data',
    })
  }
}
