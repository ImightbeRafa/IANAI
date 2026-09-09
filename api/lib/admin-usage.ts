import { ESTIMATE_DISCLAIMER, estimateApiCostUsd } from './model-pricing.js'

export const ADMIN_USAGE_PAGE_SIZE = 1000
export const ADMIN_USAGE_MAX_ROWS = 250_000

const IMAGE_FEATURES = new Set(['image', 'edit', 'enhance', 'logo'])
const SCRIPT_FEATURES = new Set([
  'script',
  'script_edit',
  'script_enhance',
  'script_hook',
  'script_consciousness',
])
const INGEST_FEATURES = new Set([
  'url_fetch',
  'brand_extraction',
  'pdf_extract',
  'paste_organize',
  'ocr',
])

export type AdminUsageLogRow = {
  id: string
  user_id: string | null
  user_email: string | null
  feature: string
  model: string
  generation_id?: string | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  estimated_cost_usd: number | string | null
  success: boolean | null
  created_at: string
  metadata?: Record<string, unknown> | null
  source?: string | null
}

export type UsageSummaryRow = {
  model: string
  feature: string
  total_calls: number
  successful_calls: number
  failed_calls: number
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  /** Stored logger estimate (may under/over-count vs official list). */
  total_cost_usd: number
  /** Official-list estimate recomputed for admin display. */
  estimated_api_cost_usd: number
  /** Credits charged to users (joined via generation_id). */
  total_credits: number
}

export type DailyUsageRow = {
  day: string
  model: string
  total_calls: number
  total_cost_usd: number
}

export type DailyTotalRow = {
  day: string
  total_calls: number
  total_cost_usd: number
}

export type UserUsageStatsRow = {
  user_id: string
  user_email: string
  total_calls: number
  total_cost_usd: number
  script_calls: number
  description_calls: number
  image_calls: number
  voice_calls: number
  ingest_calls: number
  other_calls: number
  last_active: string
}

export type RecentLogRow = {
  id: string
  user_email: string
  feature: string
  model: string
  generation_id?: string | null
  total_tokens: number
  estimated_cost_usd: number
  stored_cost_usd: number
  success: boolean
  created_at: string
  metadata?: Record<string, unknown> | null
  source?: string | null
}

export type CreditsEconomics = {
  creditsConsumed: number
  estimatedApiCostUsd: number
  impliedUsdPerCredit: number | null
  creditsInCirculation: number
  creditCogsUsd: number
  estimateNote: string
}

export type UsageCoverage = {
  from: string | null
  to: string
  rowCount: number
  truncated: boolean
  lifetime: boolean
}

export type CreditLedgerRow = {
  generation_id: string | null
  credits: number | string | null
  action?: string | null
  created_at?: string
}

function num(value: number | string | null | undefined): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

function roundCost(value: number): number {
  return Number(value.toFixed(6))
}

function utcDay(iso: string): string {
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return iso.slice(0, 10)
  return new Date(parsed).toISOString().slice(0, 10)
}

export function resolveUsageLogSource(row: {
  source?: string | null
  metadata?: Record<string, unknown> | null
}): string {
  if (typeof row.source === 'string' && row.source.trim()) return row.source.trim()
  const meta = row.metadata?.source
  if (typeof meta === 'string' && meta.trim()) return meta.trim()
  return 'web'
}

/** $0 MCP tools/call audit rows — exclude from cost/call totals; real EXECUTE costs use feature≠mcp_tool. */
export function isMcpToolAuditRow(row: Pick<AdminUsageLogRow, 'feature'>): boolean {
  return row.feature === 'mcp_tool'
}

/**
 * Recompute estimated API $ from official list prices.
 * Labels as estimates in the UI — not a provider invoice.
 */
export function estimateOfficialApiCostUsd(row: Pick<
  AdminUsageLogRow,
  'model' | 'input_tokens' | 'output_tokens' | 'estimated_cost_usd' | 'metadata'
>): number {
  return estimateApiCostUsd({
    model: row.model,
    inputTokens: num(row.input_tokens),
    outputTokens: num(row.output_tokens),
    estimatedCostUsd: row.estimated_cost_usd,
    metadata: row.metadata,
  })
}

export function buildCreditsByGenerationId(ledger: CreditLedgerRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of ledger) {
    const gid = typeof row.generation_id === 'string' ? row.generation_id.trim() : ''
    if (!gid) continue
    map.set(gid, (map.get(gid) || 0) + num(row.credits))
  }
  return map
}

export function sumLedgerCredits(ledger: CreditLedgerRow[]): number {
  return ledger.reduce((sum, row) => sum + num(row.credits), 0)
}

export function buildCreditsEconomics(options: {
  rows: AdminUsageLogRow[]
  ledger: CreditLedgerRow[]
  creditsInCirculation: number
  creditCogsUsd: number
}): CreditsEconomics {
  const estimatedApiCostUsd = roundCost(
    options.rows
      .filter((row) => !isMcpToolAuditRow(row))
      .reduce((sum, row) => sum + estimateOfficialApiCostUsd(row), 0)
  )
  const creditsConsumed = sumLedgerCredits(options.ledger)
  const impliedUsdPerCredit =
    creditsConsumed > 0 ? roundCost(estimatedApiCostUsd / creditsConsumed) : null

  return {
    creditsConsumed,
    estimatedApiCostUsd,
    impliedUsdPerCredit,
    creditsInCirculation: Math.max(0, Math.floor(options.creditsInCirculation)),
    creditCogsUsd: options.creditCogsUsd,
    estimateNote: ESTIMATE_DISCLAIMER,
  }
}

function toRecentLog(row: AdminUsageLogRow): RecentLogRow {
  return {
    id: row.id,
    user_email: row.user_email || '',
    feature: row.feature,
    model: row.model,
    generation_id: row.generation_id || null,
    total_tokens: num(row.total_tokens),
    estimated_cost_usd: estimateOfficialApiCostUsd(row),
    stored_cost_usd: roundCost(num(row.estimated_cost_usd)),
    success: row.success !== false,
    created_at: row.created_at,
    metadata: row.metadata || {},
    source: resolveUsageLogSource(row),
  }
}

export function filterUsageRowsBySource(
  rows: AdminUsageLogRow[],
  source?: string
): AdminUsageLogRow[] {
  const normalized = (source || '').trim().toLowerCase()
  if (!normalized || normalized === 'all') return rows
  return rows.filter((row) => resolveUsageLogSource(row) === normalized)
}

export function aggregateUsageSummary(
  rows: AdminUsageLogRow[],
  creditsByGenerationId?: Map<string, number>
): UsageSummaryRow[] {
  const grouped = new Map<string, UsageSummaryRow>()
  // Clone so one generation_id is attributed once without mutating the caller's map.
  const creditsMap = new Map(creditsByGenerationId || [])

  for (const row of rows) {
    if (isMcpToolAuditRow(row)) continue
    const model = row.model || 'unknown'
    const feature = row.feature || 'unknown'
    const key = `${model}\0${feature}`
    const existing = grouped.get(key)
    const bucket = existing || {
      model,
      feature,
      total_calls: 0,
      successful_calls: 0,
      failed_calls: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_tokens: 0,
      total_cost_usd: 0,
      estimated_api_cost_usd: 0,
      total_credits: 0,
    }

    bucket.total_calls += 1
    if (row.success) bucket.successful_calls += 1
    else bucket.failed_calls += 1
    bucket.total_input_tokens += num(row.input_tokens)
    bucket.total_output_tokens += num(row.output_tokens)
    bucket.total_tokens += num(row.total_tokens)
    bucket.total_cost_usd += num(row.estimated_cost_usd)
    bucket.estimated_api_cost_usd += estimateOfficialApiCostUsd(row)
    const gid = typeof row.generation_id === 'string' ? row.generation_id.trim() : ''
    if (gid && creditsMap.has(gid)) {
      bucket.total_credits += creditsMap.get(gid) || 0
      // Consume once so multi-log same generation_id does not double-count.
      creditsMap.delete(gid)
    }
    grouped.set(key, bucket)
  }

  return [...grouped.values()]
    .map(row => ({
      ...row,
      total_cost_usd: roundCost(row.total_cost_usd),
      estimated_api_cost_usd: roundCost(row.estimated_api_cost_usd),
    }))
    .sort((a, b) => b.estimated_api_cost_usd - a.estimated_api_cost_usd || b.total_calls - a.total_calls)
}

export function aggregateDailyUsage(rows: AdminUsageLogRow[]): DailyUsageRow[] {
  const grouped = new Map<string, DailyUsageRow>()

  for (const row of rows) {
    if (isMcpToolAuditRow(row)) continue
    const day = utcDay(row.created_at)
    const model = row.model || 'unknown'
    const key = `${day}\0${model}`
    const existing = grouped.get(key)
    const bucket = existing || { day, model, total_calls: 0, total_cost_usd: 0 }
    bucket.total_calls += 1
    bucket.total_cost_usd += estimateOfficialApiCostUsd(row)
    grouped.set(key, bucket)
  }

  return [...grouped.values()]
    .map(row => ({ ...row, total_cost_usd: roundCost(row.total_cost_usd) }))
    .sort((a, b) => b.day.localeCompare(a.day) || a.model.localeCompare(b.model))
}

export function aggregateDailyTotals(rows: DailyUsageRow[]): DailyTotalRow[] {
  const grouped = new Map<string, DailyTotalRow>()
  for (const row of rows) {
    const existing = grouped.get(row.day) || { day: row.day, total_calls: 0, total_cost_usd: 0 }
    existing.total_calls += row.total_calls
    existing.total_cost_usd += row.total_cost_usd
    grouped.set(row.day, existing)
  }
  return [...grouped.values()]
    .map(row => ({ ...row, total_cost_usd: roundCost(row.total_cost_usd) }))
    .sort((a, b) => b.day.localeCompare(a.day))
}

export function findPeakUsageDay(rows: DailyTotalRow[]): DailyTotalRow | null {
  if (rows.length === 0) return null
  return rows.reduce((peak, row) => {
    if (row.total_cost_usd > peak.total_cost_usd) return row
    if (row.total_cost_usd === peak.total_cost_usd && row.total_calls > peak.total_calls) return row
    return peak
  })
}

export function aggregateUserUsageStats(rows: AdminUsageLogRow[]): UserUsageStatsRow[] {
  const grouped = new Map<string, UserUsageStatsRow>()

  for (const row of rows) {
    if (row.success !== true) continue
    if (isMcpToolAuditRow(row)) continue
    const userId = row.user_id || row.user_email || 'unknown'
    const existing = grouped.get(userId)
    const bucket = existing || {
      user_id: row.user_id || userId,
      user_email: row.user_email || '',
      total_calls: 0,
      total_cost_usd: 0,
      script_calls: 0,
      description_calls: 0,
      image_calls: 0,
      voice_calls: 0,
      ingest_calls: 0,
      other_calls: 0,
      last_active: row.created_at,
    }

    bucket.total_calls += 1
    bucket.total_cost_usd += estimateOfficialApiCostUsd(row)
    if (SCRIPT_FEATURES.has(row.feature)) bucket.script_calls += 1
    else if (row.feature === 'description') bucket.description_calls += 1
    else if (IMAGE_FEATURES.has(row.feature)) bucket.image_calls += 1
    else if (row.feature === 'voice_transcription') bucket.voice_calls += 1
    else if (INGEST_FEATURES.has(row.feature)) bucket.ingest_calls += 1
    else bucket.other_calls += 1

    if (Date.parse(row.created_at) > Date.parse(bucket.last_active)) {
      bucket.last_active = row.created_at
    }
    if (!bucket.user_email && row.user_email) bucket.user_email = row.user_email
    grouped.set(userId, bucket)
  }

  return [...grouped.values()]
    .map(row => ({ ...row, total_cost_usd: roundCost(row.total_cost_usd) }))
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd || b.total_calls - a.total_calls)
}

export function resolveAdminUsageWindow(opts: {
  startDate?: string
  endDate?: string
  lifetime?: boolean
}): { startIso: string | null; endIso: string; lifetime: boolean } {
  const endDate = opts.endDate ? new Date(opts.endDate) : new Date()
  if (Number.isNaN(endDate.getTime())) {
    throw new Error('Invalid end_date')
  }
  if (opts.lifetime) {
    return { startIso: null, endIso: endDate.toISOString(), lifetime: true }
  }
  const startDate = opts.startDate
    ? new Date(opts.startDate)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('Invalid start_date')
  }
  return { startIso: startDate.toISOString(), endIso: endDate.toISOString(), lifetime: false }
}

export async function fetchAllPagedRows<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = []
  let from = 0
  while (from < ADMIN_USAGE_MAX_ROWS) {
    const to = Math.min(from + ADMIN_USAGE_PAGE_SIZE - 1, ADMIN_USAGE_MAX_ROWS - 1)
    const { data, error } = await fetchPage(from, to)
    if (error) throw new Error(error.message)
    const batch = data || []
    rows.push(...batch)
    if (batch.length < ADMIN_USAGE_PAGE_SIZE) {
      return { rows, truncated: false }
    }
    from += ADMIN_USAGE_PAGE_SIZE
  }
  return { rows, truncated: true }
}

export function buildUsageCoverage(options: {
  rows: Array<{ created_at: string }>
  startIso: string | null
  endIso: string
  lifetime: boolean
  truncated: boolean
  oldestCreatedAt?: string | null
}): UsageCoverage {
  const oldestFromRows = options.rows.reduce<string | null>((min, row) => {
    if (!row.created_at) return min
    if (!min || row.created_at < min) return row.created_at
    return min
  }, null)
  return {
    from: options.oldestCreatedAt || oldestFromRows || options.startIso,
    to: options.endIso,
    rowCount: options.rows.length,
    truncated: options.truncated,
    lifetime: options.lifetime,
  }
}

export function paginateUsageLogs(
  rows: AdminUsageLogRow[],
  opts: { search?: string; offset?: number; limit?: number; source?: string }
): { logs: RecentLogRow[]; hasMore: boolean } {
  const search = (opts.search || '').trim().toLowerCase()
  const source = (opts.source || '').trim().toLowerCase()
  const offset = Math.max(0, opts.offset || 0)
  const limit = Math.max(1, opts.limit || 20)

  const filtered = rows.filter((row) => {
    if (search && !(row.user_email || '').toLowerCase().includes(search)) return false
    if (source && source !== 'all' && resolveUsageLogSource(row) !== source) return false
    return true
  })

  const ordered = [...filtered].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const slice = ordered.slice(offset, offset + limit)

  return {
    logs: slice.map(toRecentLog),
    hasMore: offset + slice.length < ordered.length,
  }
}
