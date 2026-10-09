/**
 * Supabase PackStore (service-role client). Tables + lease RPC: migration 082_ad_packs.sql.
 * Not exercised against a live DB in tests; the in-memory store mirrors its semantics.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../supabase-admin.js'
import type { Pack, PackItem, PackStore } from './types.js'

type Row = Record<string, unknown>

const opt = <T>(v: unknown): T | undefined => (v === null || v === undefined ? undefined : (v as T))
const iso = (v: unknown): string | undefined => (v ? new Date(String(v)).toISOString() : undefined)

export function packToRow(pack: Pack): Row {
  return {
    id: pack.id,
    user_id: pack.userId,
    business_id: pack.businessId ?? null,
    brand_kit_id: pack.brandKitId ?? null,
    status: pack.status,
    size: pack.size,
    ratios: pack.ratios,
    quoted_credits: pack.quotedCredits,
    source: pack.source,
    dna: pack.dna,
    // Render options (product fidelity) ride inside the offer jsonb until a dedicated column exists.
    offer: pack.render ? { ...pack.offer, [PACK_RENDER_KEY]: pack.render } : pack.offer,
    // Column from migration 083; only sent when set so packs without a brief insert on 082 alone.
    ...(pack.brief ? { brief: pack.brief } : {}),
    created_at: pack.createdAt,
    updated_at: pack.updatedAt,
  }
}

/** Key of the pack render options inside `ad_packs.offer` (no migration needed). */
export const PACK_RENDER_KEY = 'packRender'

function splitOffer(raw: unknown): { offer: Pack['offer']; render?: Pack['render'] } {
  if (!raw || typeof raw !== 'object') return { offer: raw as Pack['offer'] }
  const { [PACK_RENDER_KEY]: render, ...offer } = raw as Record<string, unknown>
  return { offer: offer as unknown as Pack['offer'], ...(render && typeof render === 'object' ? { render: render as Pack['render'] } : {}) }
}

export function rowToPack(r: Row): Pack {
  const { offer, render } = splitOffer(r.offer)
  return {
    id: String(r.id),
    userId: String(r.user_id),
    businessId: opt<string>(r.business_id),
    brandKitId: opt<string>(r.brand_kit_id),
    status: r.status as Pack['status'],
    size: Number(r.size),
    ratios: (r.ratios as Pack['ratios']) ?? [],
    quotedCredits: Number(r.quoted_credits ?? 0),
    source: (r.source as Pack['source']) ?? 'web',
    dna: r.dna as Pack['dna'],
    offer,
    ...(render ? { render } : {}),
    ...(typeof r.brief === 'string' && r.brief ? { brief: r.brief } : {}),
    createdAt: iso(r.created_at) ?? '',
    updatedAt: iso(r.updated_at) ?? '',
  }
}

const PACK_PATCH_COLUMNS: Partial<Record<keyof Pack, string>> = {
  businessId: 'business_id',
  brandKitId: 'brand_kit_id',
  status: 'status',
  size: 'size',
  ratios: 'ratios',
  quotedCredits: 'quoted_credits',
  source: 'source',
  dna: 'dna',
  offer: 'offer',
  brief: 'brief',
}

const ITEM_PATCH_COLUMNS: Partial<Record<keyof PackItem, string>> = {
  status: 'status',
  angle: 'angle',
  copy: 'ad_copy',
  copyCheck: 'copy_check',
  scene: 'scene',
  sceneCheck: 'scene_check',
  renders: 'renders',
  attempts: 'attempts',
  error: 'error',
  generationId: 'generation_id',
  leaseUntil: 'lease_until',
  costUsd: 'cost_usd',
  timings: 'timings',
  sceneAttempts: 'scene_attempts',
  chargedAt: 'charged_at',
  libraryImages: 'library_images',
}

export function itemToRow(item: PackItem, userId: string): Row {
  const row: Row = { id: item.id, pack_id: item.packId, user_id: userId, item_index: item.index, updated_at: item.updatedAt }
  for (const [k, col] of Object.entries(ITEM_PATCH_COLUMNS)) {
    const v = (item as unknown as Row)[k]
    // library_images (migration 083) has a DB default; never sent on insert so 082 alone still works.
    if (col === 'library_images') continue
    if (col === 'renders') row[col] = v ?? []
    else if (col === 'cost_usd') row[col] = v ?? 0
    else row[col!] = v ?? null
  }
  return row
}

export function rowToItem(r: Row): PackItem {
  const item: PackItem = {
    id: String(r.id),
    packId: String(r.pack_id),
    index: Number(r.item_index),
    status: r.status as PackItem['status'],
    angle: r.angle as PackItem['angle'],
    renders: (r.renders as PackItem['renders']) ?? [],
    attempts: Number(r.attempts ?? 0),
    generationId: String(r.generation_id),
    updatedAt: iso(r.updated_at) ?? '',
  }
  const extra: Partial<PackItem> = {
    copy: opt(r.ad_copy),
    copyCheck: opt(r.copy_check),
    scene: opt(r.scene),
    sceneCheck: opt(r.scene_check),
    error: opt(r.error),
    leaseUntil: iso(r.lease_until),
    costUsd: r.cost_usd === null || r.cost_usd === undefined ? undefined : Number(r.cost_usd),
    timings: opt(r.timings),
    sceneAttempts: r.scene_attempts === null || r.scene_attempts === undefined ? undefined : Number(r.scene_attempts),
    chargedAt: iso(r.charged_at),
    libraryImages: Array.isArray(r.library_images) && r.library_images.length ? (r.library_images as PackItem['libraryImages']) : undefined,
    // Fidelity is persisted inside scene_check (no dedicated column yet).
    fidelity: (r.scene_check as { fidelity?: PackItem['fidelity'] } | null)?.fidelity ?? undefined,
    // Ratios not delivered (P0 #3) also ride inside scene_check (no migration).
    rejectedRatios: (r.scene_check as { rejectedRatios?: PackItem['rejectedRatios'] } | null)?.rejectedRatios?.length
      ? (r.scene_check as { rejectedRatios: PackItem['rejectedRatios'] }).rejectedRatios
      : undefined,
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) (item as unknown as Row)[k] = v
  return item
}

function patchToRow<T>(patch: Partial<T>, columns: Partial<Record<keyof T, string>>): Row {
  const row: Row = {}
  for (const [k, v] of Object.entries(patch)) {
    const col = columns[k as keyof T]
    if (!col) continue
    row[col] = v === undefined ? null : v
  }
  row.updated_at = new Date().toISOString()
  return row
}

export function createSupabasePackStore(client?: SupabaseClient | null): PackStore {
  const db = client ?? getSupabaseAdmin()
  if (!db) throw new Error('adpack_store_unavailable: Supabase service role is not configured')

  return {
    async createPack(pack, items) {
      const { error } = await db.from('ad_packs').insert(packToRow(pack))
      if (error) throw new Error(`adpack_create_pack_failed: ${error.message}`)
      if (!items.length) return
      const { error: itemsError } = await db.from('ad_pack_items').insert(items.map((i) => itemToRow(i, pack.userId)))
      if (itemsError) {
        await db.from('ad_packs').delete().eq('id', pack.id)
        throw new Error(`adpack_create_items_failed: ${itemsError.message}`)
      }
    },

    async getPack(packId, userId) {
      const { data: pack, error } = await db.from('ad_packs').select('*').eq('id', packId).eq('user_id', userId).maybeSingle()
      if (error) throw new Error(`adpack_get_pack_failed: ${error.message}`)
      if (!pack) return null
      const { data: rows, error: itemsError } = await db
        .from('ad_pack_items')
        .select('*')
        .eq('pack_id', packId)
        .order('item_index', { ascending: true })
      if (itemsError) throw new Error(`adpack_get_items_failed: ${itemsError.message}`)
      return { pack: rowToPack(pack as Row), items: (rows ?? []).map((r) => rowToItem(r as Row)) }
    },

    async updatePack(packId, patch) {
      const { error } = await db.from('ad_packs').update(patchToRow<Pack>(patch, PACK_PATCH_COLUMNS)).eq('id', packId)
      if (error) throw new Error(`adpack_update_pack_failed: ${error.message}`)
    },

    async leaseItems(packId, limit, leaseMs, opts) {
      const { data, error } = await db.rpc('adpack_lease_items', {
        p_pack_id: packId,
        p_limit: limit,
        p_lease_ms: Math.round(leaseMs),
        p_exclude: opts?.excludeIds ?? [],
      })
      if (error) throw new Error(`adpack_lease_failed: ${error.message}`)
      return ((data as Row[] | null) ?? []).map(rowToItem).sort((a, b) => a.index - b.index)
    },

    async updateItem(itemId, patch) {
      const { error } = await db.from('ad_pack_items').update(patchToRow<PackItem>(patch, ITEM_PATCH_COLUMNS)).eq('id', itemId)
      if (error) throw new Error(`adpack_update_item_failed: ${error.message}`)
    },
  }
}
