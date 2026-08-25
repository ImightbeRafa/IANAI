import { supabase } from '../../lib/supabase'

export type AngleBoardItem = {
  id: string
  title: string
  niche: string
  whyItBuys: string
  hookStyle: string
  frameworkHint: string
}

export type BulkQuote = {
  totalCredits: number
  note: string
}

export type StyleDna = {
  id: string
  name: string
  kind: 'organic' | 'ads'
  referenceUrls: string[]
  notes: string
}

function bulkApiUrl(name: 'bulk-angles' | 'bulk-scripts' | 'bulk-posts' | 'bulk-campaign'): string {
  return import.meta.env.PROD ? `/api/${name}` : `http://localhost:3000/api/${name}`
}

async function authHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
}

export type BulkAnglesResponse = {
  brandId: string
  offerId: string
  angles: AngleBoardItem[]
  count: number
  source: 'model' | 'fallback'
  styleDnas: StyleDna[]
  quoteScripts: BulkQuote
  quotePosts: BulkQuote
  quoteCampaign: BulkQuote
}

export type BulkScriptsResponse = {
  packId: string
  sessionId: string
  charged: number
  succeeded: number
  items: Array<{ angleId: string; title: string; scriptId?: string; error?: string; charged: number }>
  deepLink: string
  partial?: boolean
}

export type BulkCampaignResponse = {
  packId: string
  sessionId: string
  charged: number
  succeededScripts: number
  succeededPosts: number
  deepLink: string
  partial?: boolean
}

async function postJson<T>(name: Parameters<typeof bulkApiUrl>[0], body: Record<string, unknown>): Promise<T> {
  const response = await fetch(bulkApiUrl(name), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(json.error || `Request failed (${response.status})`)
  return json
}

export function clampComposerBulkCount(value: unknown): number {
  if (value == null || value === '') return 10
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n)) return 10
  return Math.min(25, Math.max(2, Math.round(n)))
}

export async function fetchBulkAngles(body: {
  brandId: string
  offerId?: string
  sessionId?: string
  count: number
  language: 'es' | 'en'
}): Promise<BulkAnglesResponse> {
  return postJson('bulk-angles', body)
}

export async function runBulkScriptsRequest(body: {
  brandId: string
  offerId?: string
  sessionId?: string
  count: number
  language: 'es' | 'en'
  angles: AngleBoardItem[]
  angleIds: string[]
}): Promise<BulkScriptsResponse> {
  return postJson('bulk-scripts', body)
}

export async function runBulkCampaignRequest(body: {
  brandId: string
  offerId?: string
  sessionId?: string
  count: number
  language: 'es' | 'en'
  angles: AngleBoardItem[]
  angleIds: string[]
  styleDnaId?: string
}): Promise<BulkCampaignResponse> {
  return postJson('bulk-campaign', body)
}
