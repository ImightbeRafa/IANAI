/**
 * Supabase `SavedBrandDb` (service-role client, explicit owner filter on EVERY
 * query — same pattern as api/lib/mcp/supabase-adapter.ts). Not exercised
 * against a live DB in tests; `saved-brand.ts` is tested with fakes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../supabase-admin.js'
import type { SiteAnalysisResult } from '../site-analysis.js'
import type { SavedBrandDb, StoredSiteAnalysis } from './saved-brand.js'
import { isMissingColumnError } from '../db-missing-column.js'

const KIT_SELECT =
  'id, name, business_id, user_id, is_default, is_active, is_primary_for_business, primary_color, secondary_color, accent_color, logo_url, tagline, brand_voice, tone_keywords, must_use_phrases, forbidden_phrases, target_audience, visual_style_notes, font_primary, font_secondary, industry, reference_images, style_dnas, created_at'
/** Fallback when 079/081 columns are missing (older DBs). */
const KIT_SELECT_LEGACY =
  'id, name, business_id, user_id, is_default, is_active, primary_color, secondary_color, accent_color, logo_url, tagline, brand_voice, tone_keywords, must_use_phrases, forbidden_phrases, target_audience, visual_style_notes, font_primary, font_secondary, industry, reference_images, created_at'

function isSiteAnalysis(raw: unknown): raw is SiteAnalysisResult {
  if (!raw || typeof raw !== 'object') return false
  const r = raw as Record<string, unknown>
  return Boolean(r.facts && typeof r.facts === 'object') && Array.isArray(r.pages)
}

export function createSupabaseSavedBrandDb(client?: SupabaseClient | null): SavedBrandDb {
  const db = client ?? getSupabaseAdmin()
  if (!db) throw new Error('adpack_saved_brand_unavailable: Supabase service role is not configured')
  return {
    async getBusiness(userId, businessId) {
      if (!userId || !businessId) return null
      let { data, error } = await db
        .from('businesses')
        .select('*, target_audiences:business_target_audiences(*)')
        .eq('id', businessId)
        .eq('owner_id', userId)
        .maybeSingle()
      if (error && /business_target_audiences|relationship/i.test(error.message || '')) {
        const retry = await db.from('businesses').select('*').eq('id', businessId).eq('owner_id', userId).maybeSingle()
        data = retry.data
        error = retry.error
      }
      if (error) throw error
      return (data as Record<string, unknown> | null) ?? null
    },

    async listBrandKits(userId, businessId) {
      if (!userId || !businessId) return []
      const run = (select: string, primaryOrder = true) => db
        .from('brand_kits')
        .select(select)
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .order(primaryOrder ? 'is_primary_for_business' : 'is_default', { ascending: false })
        .order('created_at', { ascending: true })
      // 085 brand_profile: optional (feature-detected so an unapplied migration never breaks packs).
      let res = await run(`${KIT_SELECT}, brand_profile`)
      if (res.error && isMissingColumnError(res.error, 'brand_profile')) res = await run(KIT_SELECT)
      if (res.error && /is_primary_for_business|style_dnas/i.test(res.error.message || '')) {
        const retry = await run(KIT_SELECT_LEGACY, false)
        if (retry.error) throw retry.error
        return ((retry.data || []) as unknown as Array<Record<string, unknown>>).map((row) => ({ ...row, is_primary_for_business: false, style_dnas: [] }))
      }
      if (res.error) throw res.error
      return (res.data || []) as unknown as Array<Record<string, unknown>>
    },

    async getProduct(userId, businessId, productId) {
      if (!userId || !businessId) return null
      let query = db.from('products').select('*').eq('business_id', businessId).eq('owner_id', userId)
      query = productId ? query.eq('id', productId) : query.order('created_at', { ascending: false }).limit(1)
      const { data, error } = await query.maybeSingle()
      if (error) throw error
      return (data as Record<string, unknown> | null) ?? null
    },

    async listProductImages(userId, productId) {
      if (!userId || !productId) return []
      const run = (select: string) => db
        .from('product_images')
        .select(select)
        .eq('product_id', productId)
        .eq('user_id', userId)
        .in('kind', ['product', 'context'])
        .order('created_at', { ascending: false })
        .limit(24)
      // 085 adds is_primary / tags / role / quality (ordering hints); older DBs fall back.
      let { data, error } = await run('id, image_url, kind, label, message_id, created_at, is_primary, tags, role, quality')
      if (error && isMissingColumnError(error)) ({ data, error } = await run('id, image_url, kind, label, message_id, created_at'))
      if (error) throw error
      return (data || []) as unknown as Array<Record<string, unknown>>
    },

    async getLatestSiteAnalysis(userId, businessId): Promise<StoredSiteAnalysis | null> {
      if (!userId || !businessId) return null
      const { data, error } = await db
        .from('mcp_url_intakes')
        .select('source_url, status, completed_at, analysis_result')
        .eq('user_id', userId)
        .eq('business_id', businessId)
        .eq('status', 'ready')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error || !data || !isSiteAnalysis(data.analysis_result)) return null
      return {
        sourceUrl: String(data.source_url),
        analysis: data.analysis_result,
        completedAt: (data.completed_at as string | null) ?? null,
      }
    },
  }
}
