import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin } from '../supabase-admin.js'
import type { RecentScriptSummary, StyleDna } from './types.js'
import { parseStyleDnas, upsertStyleDnaList } from './style-dna.js'

export async function listRecentScriptSummaries(
  userId: string,
  offerId: string,
  limit = 8
): Promise<RecentScriptSummary[]> {
  const db = getSupabaseAdmin()
  if (!db || !userId || !offerId) return []
  const { data, error } = await db
    .from('scripts')
    .select('id, title, content, created_at')
    .eq('product_id', offerId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data.map((row) => {
    const content = typeof row.content === 'string' ? row.content.replace(/\s+/g, ' ').trim() : ''
    return {
      id: String(row.id),
      title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : 'script',
      summary: content.slice(0, 220),
    }
  })
}

export async function listProductRefUrls(
  userId: string,
  offerId: string,
  limit = 8
): Promise<string[]> {
  const db = getSupabaseAdmin()
  if (!db || !userId || !offerId) return []
  const { data, error } = await db
    .from('product_images')
    .select('image_url, kind')
    .eq('product_id', offerId)
    .eq('user_id', userId)
    .in('kind', ['product', 'context'])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data.map((row) => row.image_url as string).filter(Boolean)
}

export async function saveExpandedProductRef(options: {
  userId: string
  offerId: string
  imageDataUrl: string
  label: string
}): Promise<{ productImageId: string; imageUrl: string }> {
  const db = getSupabaseAdmin()
  if (!db) throw new Error('Storage is not configured')
  const match = /^data:([^;]+);base64,(.+)$/i.exec(options.imageDataUrl.trim())
  if (!match) throw new Error('Expected image data URL')
  const contentType = match[1] || 'image/png'
  const bytes = Buffer.from(match[2], 'base64')
  const ext = contentType.includes('jpeg') || contentType.includes('jpg')
    ? 'jpg'
    : contentType.includes('webp')
      ? 'webp'
      : 'png'
  const path = `${options.userId}/${options.offerId}/product-refs/bulk-expand-${randomUUID()}.${ext}`
  const { error: upErr } = await db.storage.from('post-images').upload(path, bytes, {
    contentType,
    upsert: false,
  })
  if (upErr) throw upErr
  const { data: pub } = db.storage.from('post-images').getPublicUrl(path)
  const imageUrl = pub.publicUrl
  const { data, error } = await db
    .from('product_images')
    .insert({
      product_id: options.offerId,
      user_id: options.userId,
      image_url: imageUrl,
      label: options.label,
      kind: 'context',
    })
    .select('id')
    .single()
  if (error) throw error
  return { productImageId: data.id as string, imageUrl }
}

export async function listStyleDnasForBrand(userId: string, brandId: string): Promise<{
  kitId: string | null
  styleDnas: StyleDna[]
}> {
  const db = getSupabaseAdmin()
  if (!db || !userId || !brandId) return { kitId: null, styleDnas: [] }
  const query = db
    .from('brand_kits')
    .select('id, style_dnas')
    .eq('business_id', brandId)
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const { data, error } = await query
  if (error) {
    if (/style_dnas/i.test(error.message || '')) return { kitId: null, styleDnas: [] }
    return { kitId: null, styleDnas: [] }
  }
  if (!data) return { kitId: null, styleDnas: [] }
  return {
    kitId: data.id as string,
    styleDnas: parseStyleDnas(data.style_dnas),
  }
}

export async function saveStyleDnaForBrand(options: {
  userId: string
  brandId: string
  dna: StyleDna
}): Promise<{ kitId: string; styleDnas: StyleDna[] }> {
  const db = getSupabaseAdmin()
  if (!db) throw new Error('Brand kit storage is not configured')
  const current = await listStyleDnasForBrand(options.userId, options.brandId)
  if (!current.kitId) throw new Error('Brand kit not found — create a kit before saving Style DNA')
  const next = upsertStyleDnaList(current.styleDnas, options.dna)
  const { error } = await db
    .from('brand_kits')
    .update({ style_dnas: next, updated_at: new Date().toISOString() })
    .eq('id', current.kitId)
    .eq('user_id', options.userId)
  if (error) throw error
  return { kitId: current.kitId, styleDnas: next }
}
