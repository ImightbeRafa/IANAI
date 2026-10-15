import { supabase } from '../lib/supabase'
import { BRAND_LOGO_MAX_DIM, BRAND_REFERENCE_MAX_DIM, compressBrandImage } from '../utils/imageCompression'

export const CANONICAL_IMAGE_BUCKET = 'post-images'

let ensurePromise: Promise<void> | null = null

export function isMissingImageBucketError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { message?: unknown; statusCode?: unknown; error?: unknown }
  const text = [candidate.message, candidate.error, candidate.statusCode].filter(Boolean).join(' ')
  return /bucket.*not found|not found.*bucket|no such bucket/i.test(text)
}

function apiUrl(path: string): string {
  return import.meta.env.PROD ? path : `http://localhost:3000${path}`
}

/**
 * Migrations remain the source of truth. This authenticated, idempotent fallback
 * repairs Preview/Vercel environments where the storage migration was skipped.
 */
export function ensureCanonicalImageBucket(): Promise<void> {
  if (ensurePromise) return ensurePromise

  ensurePromise = (async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Not authenticated')

    const response = await fetch(apiUrl('/api/ensure-image-bucket'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const json = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) {
      throw new Error(json.error || 'Could not initialize image storage')
    }
  })().catch((error) => {
    ensurePromise = null
    throw error
  })

  return ensurePromise
}

export async function uploadBrandKitAsset(
  file: File,
  kind: 'logo' | 'reference'
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Image too large (max 10MB)')
  }
  // MCP 0.26.0: reference images keep their full resolution (up to 4096 px, high quality) so they can pass the ≥ 1600 px
  // reference rule (docs/mcp-quality.md); logos stay small.
  const compressed = kind === 'logo'
    ? await compressBrandImage(file, BRAND_LOGO_MAX_DIM, 0.85)
    : await compressBrandImage(file, BRAND_REFERENCE_MAX_DIM, 0.95)
  const path = `${session.user.id}/brand-kit/${kind === 'logo' ? 'logo' : 'ref'}-${Date.now()}.webp`
  const upload = () => supabase.storage.from(CANONICAL_IMAGE_BUCKET).upload(path, compressed, {
    contentType: 'image/webp',
    upsert: false,
  })
  let { error } = await upload()
  if (error && isMissingImageBucketError(error)) {
    await ensureCanonicalImageBucket()
    ;({ error } = await upload())
  }
  if (error) throw error
  return supabase.storage.from(CANONICAL_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}
