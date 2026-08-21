export const ADMIN_USAGE_MAX_ROWS = 10000

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
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  estimated_cost_usd: number | string | null
  success: boolean | null
  created_at: string
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
  total_cost_usd: number
}

export type DailyUsageRow = {
  day: string
  model: string
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
  total_tokens: number
  estimated_cost_usd: number
  success: boolean
  created_at: string
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

function toRecentLog(row: AdminUsageLogRow): RecentLogRow {
  return {
    id: row.id,
    user_email: row.user_email || '',
    feature: row.feature,
    model: row.model,
    total_tokens: num(row.total_tokens),
    estimated_cost_usd: roundCost(num(row.estimated_cost_usd)),
    success: row.success !== false,
    created_at: row.created_at,
  }
}

export function aggregateUsageSummary(rows: AdminUsageLogRow[]): UsageSummaryRow[] {
  const grouped = new Map<string, UsageSummaryRow>()

  for (const row of rows) {
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
    }

    bucket.total_calls += 1
    if (row.success) bucket.successful_calls += 1
    else bucket.failed_calls += 1
    bucket.total_input_tokens += num(row.input_tokens)
    bucket.total_output_tokens += num(row.output_tokens)
    bucket.total_tokens += num(row.total_tokens)
    bucket.total_cost_usd += num(row.estimated_cost_usd)
    grouped.set(key, bucket)
  }

  return [...grouped.values()]
    .map(row => ({ ...row, total_cost_usd: roundCost(row.total_cost_usd) }))
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd || b.total_calls - a.total_calls)
}

export function aggregateDailyUsage(rows: AdminUsageLogRow[]): DailyUsageRow[] {
  const grouped = new Map<string, DailyUsageRow>()

  for (const row of rows) {
    const day = utcDay(row.created_at)
    const model = row.model || 'unknown'
    const key = `${day}\0${model}`
    const existing = grouped.get(key)
    const bucket = existing || { day, model, total_calls: 0, total_cost_usd: 0 }
    bucket.total_calls += 1
    bucket.total_cost_usd += num(row.estimated_cost_usd)
    grouped.set(key, bucket)
  }

  return [...grouped.values()]
    .map(row => ({ ...row, total_cost_usd: roundCost(row.total_cost_usd) }))
    .sort((a, b) => b.day.localeCompare(a.day) || a.model.localeCompare(b.model))
}

export function aggregateUserUsageStats(rows: AdminUsageLogRow[]): UserUsageStatsRow[] {
  const grouped = new Map<string, UserUsageStatsRow>()

  for (const row of rows) {
    if (row.success !== true) continue
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
    bucket.total_cost_usd += num(row.estimated_cost_usd)
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

export function paginateUsageLogs(
  rows: AdminUsageLogRow[],
  opts: { search?: string; offset?: number; limit?: number }
): { logs: RecentLogRow[]; hasMore: boolean } {
  const search = (opts.search || '').trim().toLowerCase()
  const offset = Math.max(0, opts.offset || 0)
  const limit = Math.max(1, opts.limit || 20)

  const filtered = search
    ? rows.filter(row => (row.user_email || '').toLowerCase().includes(search))
    : rows

  const ordered = [...filtered].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const slice = ordered.slice(offset, offset + limit)

  return {
    logs: slice.map(toRecentLog),
    hasMore: offset + slice.length < ordered.length,
  }
}
