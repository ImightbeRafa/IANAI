/**
 * Ad Pack asset storage: Supabase bucket `post-images` (same as bulk/store.ts).
 * Path: `${userId}/adpack/${packId}/${itemIndex}-${kind}-${uuid}.{png|jpg}` → public URL.
 */
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../supabase-admin.js'
import type { AdPackStorage, UploadInput } from './runner-types.js'

export const ADPACK_BUCKET = 'post-images'

export function adpackAssetPath(input: Pick<UploadInput, 'userId' | 'packId' | 'itemIndex' | 'kind' | 'contentType'>, id = randomUUID()): string {
  const ext = input.contentType === 'image/png' ? 'png' : 'jpg'
  const kind = input.kind.replace(/[^a-z0-9_-]/gi, '_')
  return `${input.userId}/adpack/${input.packId}/${input.itemIndex}-${kind}-${id}.${ext}`
}

export function createSupabaseAdPackStorage(client?: SupabaseClient | null): AdPackStorage {
  const db = client ?? getSupabaseAdmin()
  if (!db) throw new Error('adpack_storage_unavailable: Supabase service role is not configured')
  return {
    async upload(input) {
      const path = adpackAssetPath(input)
      const { error } = await db.storage.from(ADPACK_BUCKET).upload(path, input.bytes, {
        contentType: input.contentType,
        upsert: false,
      })
      if (error) throw new Error(`adpack_upload_failed: ${error.message}`)
      const { data } = db.storage.from(ADPACK_BUCKET).getPublicUrl(path)
      return { url: data.publicUrl }
    },
  }
}
