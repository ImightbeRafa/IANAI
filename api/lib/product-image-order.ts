/**
 * Product photo selection order (owner feedback C3): the newest upload is not
 * automatically the hero — a blurry WhatsApp photo must not beat the studio shot.
 *
 * Order: is_primary → 'hero' tag → sharper (quality.sharpness, filled by another
 * workstream) → newest. Rows without the 085 columns keep "newest first".
 */

export const PRODUCT_IMAGE_TAGS = ['hero', 'contenido-kit', 'caja', 'en-uso', 'detalle', 'part'] as const
export type ProductImageTag = typeof PRODUCT_IMAGE_TAGS[number]

export interface OrderableImageRow {
  id?: unknown
  is_primary?: unknown
  tags?: unknown
  quality?: unknown
  created_at?: unknown
}

function sharpness(row: OrderableImageRow): number | null {
  const q = row.quality
  if (!q || typeof q !== 'object') return null
  const s = (q as Record<string, unknown>).sharpness
  return typeof s === 'number' && Number.isFinite(s) ? s : null
}

function hasTag(row: OrderableImageRow, tag: string): boolean {
  return Array.isArray(row.tags) && row.tags.includes(tag)
}

function createdMs(row: OrderableImageRow): number {
  const t = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN
  return Number.isFinite(t) ? t : 0
}

/** Stable sort (input order breaks ties). Does not mutate. */
export function orderProductImages<T extends OrderableImageRow>(rows: T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const p = Number(b.row.is_primary === true) - Number(a.row.is_primary === true)
      if (p) return p
      const h = Number(hasTag(b.row, 'hero')) - Number(hasTag(a.row, 'hero'))
      if (h) return h
      const sa = sharpness(a.row)
      const sb = sharpness(b.row)
      if (sa !== null || sb !== null) {
        const d = (sb ?? -1) - (sa ?? -1)
        if (Math.abs(d) > 1e-9) return d
      }
      const c = createdMs(b.row) - createdMs(a.row)
      if (c) return c
      return a.index - b.index
    })
    .map((x) => x.row)
}
