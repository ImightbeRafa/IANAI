/**
 * Ad Pack copy previews (P0 #2d): the free dry run's planned copy, cached so `adpack_start` with the
 * same arguments delivers exactly the approved copy.
 *
 * No migration: the Supabase store keeps each preview as an `mcp_workspace_notes` row
 * (migration 074; kind 'adpack_preview', note = previewId, metadata = the preview), which also
 * gives the per-user rate limit (rows in the last hour). Previews without a brand folder
 * (dna + offer path: business_id is required there) live in a process-local map.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../supabase-admin.js'
import type { AdAngle, AdCopy, CopyCheckIssue, CopyCheckResult } from './types.js'

/** Previews are reusable for 24 h. */
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000
/** Model-token cost guard: previews per user per hour. */
export const PREVIEW_RATE_LIMIT_PER_HOUR = 10
export const PREVIEW_NOTE_KIND = 'adpack_preview'

export interface StoredPreviewAd {
  /** 0-based plan index. */
  index: number
  angle: AdAngle
  copy?: AdCopy
  copyCheck?: CopyCheckResult
  /** True when the copy passed every blocking rule (it is reused as is by start). */
  ok: boolean
  blocking?: CopyCheckIssue[]
  costUsd: number
  repairRounds: number
}

export interface StoredPreview {
  previewId: string
  userId: string
  businessId?: string
  /** Hash of the copy-relevant start arguments (brand/offer ids, selection, brief, language rules, mustAppear). */
  argsHash: string
  /** Hash of the resolved DNA + offer facts the copy was written from (stale previews are never reused). */
  factsHash: string
  createdAt: string
  expiresAt: string
  ads: StoredPreviewAd[]
  costUsd: number
}

export interface PreviewStore {
  save(preview: StoredPreview): Promise<void>
  get(previewId: string, userId: string): Promise<StoredPreview | null>
  /** Newest unexpired preview of this user with these exact arguments. */
  findLatest(userId: string, argsHash: string, nowMs: number): Promise<StoredPreview | null>
  /** Previews this user ran since `sinceIso` (rate limit). */
  countSince(userId: string, sinceIso: string): Promise<number>
}

const clone = <T>(v: T): T => structuredClone(v)

export function createMemoryPreviewStore(): PreviewStore & { previews: Map<string, StoredPreview> } {
  const previews = new Map<string, StoredPreview>()
  return {
    previews,
    async save(p) {
      previews.set(p.previewId, clone(p))
    },
    async get(previewId, userId) {
      const p = previews.get(previewId)
      return p && p.userId === userId ? clone(p) : null
    },
    async findLatest(userId, argsHash, nowMs) {
      const hits = [...previews.values()]
        .reverse()
        .filter((p) => p.userId === userId && p.argsHash === argsHash && Date.parse(p.expiresAt) > nowMs)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      return hits[0] ? clone(hits[0]) : null
    },
    async countSince(userId, sinceIso) {
      return [...previews.values()].filter((p) => p.userId === userId && p.createdAt >= sinceIso).length
    },
  }
}

type Row = Record<string, unknown>

/** Supabase store over `mcp_workspace_notes` (service role). Brand-less previews fall back to memory. */
export function createSupabasePreviewStore(client?: SupabaseClient | null): PreviewStore {
  const db = client ?? getSupabaseAdmin()
  if (!db) throw new Error('adpack_preview_store_unavailable: Supabase service role is not configured')
  const local = createMemoryPreviewStore()
  const fromRow = (r: Row): StoredPreview | null => {
    const m = r.metadata as StoredPreview | null
    return m && typeof m === 'object' && typeof m.previewId === 'string' ? m : null
  }
  return {
    async save(p) {
      if (!p.businessId) return local.save(p)
      const { error } = await db.from('mcp_workspace_notes').insert({
        user_id: p.userId,
        business_id: p.businessId,
        kind: PREVIEW_NOTE_KIND,
        note: p.previewId,
        metadata: p,
      })
      if (error) throw new Error(`adpack_preview_save_failed: ${error.message}`)
    },
    async get(previewId, userId) {
      const { data, error } = await db
        .from('mcp_workspace_notes')
        .select('metadata')
        .eq('user_id', userId)
        .eq('kind', PREVIEW_NOTE_KIND)
        .eq('note', previewId)
        .order('created_at', { ascending: false })
        .limit(1)
      const row = !error && data?.[0] ? fromRow(data[0] as Row) : null
      return row ?? local.get(previewId, userId)
    },
    async findLatest(userId, argsHash, nowMs) {
      const { data, error } = await db
        .from('mcp_workspace_notes')
        .select('metadata')
        .eq('user_id', userId)
        .eq('kind', PREVIEW_NOTE_KIND)
        .eq('metadata->>argsHash', argsHash)
        .gte('created_at', new Date(nowMs - PREVIEW_TTL_MS).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
      const row = !error && data?.[0] ? fromRow(data[0] as Row) : null
      return row ?? local.findLatest(userId, argsHash, nowMs)
    },
    async countSince(userId, sinceIso) {
      const { count, error } = await db
        .from('mcp_workspace_notes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('kind', PREVIEW_NOTE_KIND)
        .gte('created_at', sinceIso)
      return (error ? 0 : count ?? 0) + (await local.countSince(userId, sinceIso))
    },
  }
}
