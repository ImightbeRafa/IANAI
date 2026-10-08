/**
 * Ad Pack → offer library. Finished renders are saved as `product_images`
 * rows (kind 'generated', linked to the offer) so the owner finds them in the
 * brand folder of the web app without opening the Ad Pack studio.
 *
 * Idempotent per render URL: the service skips URLs already recorded on the
 * item (`PackItem.libraryImages`) and the Supabase impl re-checks existing rows
 * by (product_id, user_id, image_url) before inserting.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../supabase-admin.js'
import type { AspectRatio } from './types.js'

export interface SaveRendersInput {
  userId: string
  /** products.id of the offer (must be owned by userId). */
  productId: string
  packId: string
  itemIndex: number
  headline?: string
  renders: Array<{ ratio: AspectRatio; imageUrl: string }>
}

export interface AdPackLibrary {
  /** Returns one entry per render URL (existing or newly inserted row). */
  saveRenders(input: SaveRendersInput): Promise<Array<{ ratio: AspectRatio; imageUrl: string; productImageId: string }>>
}

export function libraryLabel(input: { packId: string; itemIndex: number; ratio: AspectRatio; headline?: string }): string {
  const head = (input.headline ?? '').replace(/\s+/g, ' ').trim()
  return `Ad Pack ${input.packId.slice(0, 8)} #${input.itemIndex + 1} ${input.ratio}${head ? ` — ${head}` : ''}`.slice(0, 160)
}

export function createSupabaseAdPackLibrary(client?: SupabaseClient | null): AdPackLibrary {
  const db = client ?? getSupabaseAdmin()
  if (!db) throw new Error('adpack_library_unavailable: Supabase service role is not configured')
  return {
    async saveRenders(input) {
      if (!input.renders.length) return []
      const { data: product, error: productErr } = await db
        .from('products')
        .select('id')
        .eq('id', input.productId)
        .eq('owner_id', input.userId)
        .maybeSingle()
      if (productErr) throw new Error(`adpack_library_failed: ${productErr.message}`)
      if (!product) throw new Error('adpack_library_failed: offer not found for this user')

      const urls = input.renders.map((r) => r.imageUrl)
      const { data: existing, error: existingErr } = await db
        .from('product_images')
        .select('id, image_url')
        .eq('product_id', input.productId)
        .eq('user_id', input.userId)
        .in('image_url', urls)
      if (existingErr) throw new Error(`adpack_library_failed: ${existingErr.message}`)
      const byUrl = new Map((existing || []).map((row) => [row.image_url as string, row.id as string]))

      const missing = input.renders.filter((r) => !byUrl.has(r.imageUrl))
      if (missing.length) {
        const { data: inserted, error: insertErr } = await db
          .from('product_images')
          .insert(missing.map((r) => ({
            product_id: input.productId,
            user_id: input.userId,
            image_url: r.imageUrl,
            label: libraryLabel({ packId: input.packId, itemIndex: input.itemIndex, ratio: r.ratio, headline: input.headline }),
            kind: 'generated',
          })))
          .select('id, image_url')
        if (insertErr) throw new Error(`adpack_library_failed: ${insertErr.message}`)
        for (const row of inserted || []) byUrl.set(row.image_url as string, row.id as string)
      }
      return input.renders
        .filter((r) => byUrl.has(r.imageUrl))
        .map((r) => ({ ratio: r.ratio, imageUrl: r.imageUrl, productImageId: byUrl.get(r.imageUrl) as string }))
    },
  }
}
