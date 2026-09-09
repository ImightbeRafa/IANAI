import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './lib/supabase-admin.js'
import { resolveAdminDashboardAccess } from './lib/preview-admin.js'
import {
  estimateOfficialApiCostUsd,
  fetchAllPagedRows,
  resolveAdminUsageWindow,
  type AdminUsageLogRow,
} from './lib/admin-usage.js'

type UsageLogRow = Pick<
  AdminUsageLogRow,
  'id' | 'generation_id' | 'model' | 'feature' | 'total_tokens' | 'estimated_cost_usd' | 'success' | 'created_at' | 'input_tokens' | 'output_tokens' | 'metadata'
>

type PostRow = {
  id: string
  generation_id: string | null
  model: string | null
  rating: number | null
  status: string | null
  created_at: string
}

type PerformanceRow = {
  model: string
  attempts: number
  successes: number
  failures: number
  total_tokens: number
  total_cost_usd: number
  avg_cost_success_usd: number
  posts_generated: number
  upvotes: number
  downvotes: number
  rated_count: number
  upvote_rate: number | null
  cost_per_upvote_usd: number | null
  uncorrelated_logs: number
  uncorrelated_posts: number
}

function emptyRow(model: string): PerformanceRow {
  return {
    model,
    attempts: 0,
    successes: 0,
    failures: 0,
    total_tokens: 0,
    total_cost_usd: 0,
    avg_cost_success_usd: 0,
    posts_generated: 0,
    upvotes: 0,
    downvotes: 0,
    rated_count: 0,
    upvote_rate: null,
    cost_per_upvote_usd: null,
    uncorrelated_logs: 0,
    uncorrelated_posts: 0,
  }
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
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' })

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
      startDate: typeof req.query.start_date === 'string' ? req.query.start_date : '',
      endDate: typeof req.query.end_date === 'string' ? req.query.end_date : '',
      lifetime: req.query.lifetime === '1',
    })
  } catch {
    return res.status(400).json({ error: 'Invalid start_date or end_date' })
  }
  const { startIso, endIso } = window

  const imageFeatures = ['image', 'logo', 'edit', 'enhance']

  let logs: UsageLogRow[]
  let posts: PostRow[]
  try {
    const [logPage, postPage] = await Promise.all([
      fetchAllPagedRows<UsageLogRow>(async (from, to) => {
        let query = supabase
          .from('api_usage_logs')
          .select('id, generation_id, model, feature, input_tokens, output_tokens, total_tokens, estimated_cost_usd, success, created_at, metadata')
          .in('feature', imageFeatures)
          .order('created_at', { ascending: false })
        if (startIso) query = query.gte('created_at', startIso)
        query = query.lte('created_at', endIso)
        return query.range(from, to)
      }),
      fetchAllPagedRows<PostRow>(async (from, to) => {
        let query = supabase
          .from('posts')
          .select('id, generation_id, model, rating, status, created_at')
          .order('created_at', { ascending: false })
        if (startIso) query = query.gte('created_at', startIso)
        query = query.lte('created_at', endIso)
        return query.range(from, to)
      }),
    ])
    logs = logPage.rows
    posts = postPage.rows
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch image performance'
    return res.status(500).json({ error: message })
  }

  const rows = new Map<string, PerformanceRow>()
  const getRow = (model: string) => {
    const key = model || 'unknown'
    if (!rows.has(key)) rows.set(key, emptyRow(key))
    return rows.get(key)!
  }

  const logsByGeneration = new Map<string, UsageLogRow[]>()
  for (const log of (logs || []) as UsageLogRow[]) {
    const row = getRow(log.model)
    row.attempts += 1
    if (log.success) row.successes += 1
    else row.failures += 1
    row.total_tokens += Number(log.total_tokens || 0)
    row.total_cost_usd += estimateOfficialApiCostUsd(log)
    if (!log.generation_id) row.uncorrelated_logs += 1
    else {
      const existing = logsByGeneration.get(log.generation_id) || []
      existing.push(log)
      logsByGeneration.set(log.generation_id, existing)
    }
  }

  for (const post of (posts || []) as PostRow[]) {
    const correlatedLog = post.generation_id ? logsByGeneration.get(post.generation_id)?.[0] : null
    const model = correlatedLog?.model || post.model || 'unknown'
    const row = getRow(model)

    if (post.status === 'completed') row.posts_generated += 1
    if (post.rating === 5) row.upvotes += 1
    if (post.rating === 1) row.downvotes += 1
    if (post.rating === 5 || post.rating === 1) row.rated_count += 1
    if (!post.generation_id) row.uncorrelated_posts += 1
  }

  const performance = [...rows.values()]
    .map(row => ({
      ...row,
      total_cost_usd: Number(row.total_cost_usd.toFixed(6)),
      avg_cost_success_usd: row.successes > 0 ? Number((row.total_cost_usd / row.successes).toFixed(6)) : 0,
      upvote_rate: row.rated_count > 0 ? Number((row.upvotes / row.rated_count).toFixed(4)) : null,
      cost_per_upvote_usd: row.upvotes > 0 ? Number((row.total_cost_usd / row.upvotes).toFixed(6)) : null,
    }))
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd)

  return res.status(200).json({ performance })
}
