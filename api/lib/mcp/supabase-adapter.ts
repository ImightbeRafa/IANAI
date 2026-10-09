/**
 * Server-only AIIAN adapter for per-user MCP read tools + URL intake.
 * Uses the admin client with explicit owner/user filters on every query.
 */

import { getSupabaseAdmin } from '../supabase-admin.js'
import type {
  McpBrandKitContext,
  McpBrandSummary,
  McpDbClient,
  McpGuideIntakeSummary,
} from './user-tools.js'
import type { McpUrlIntakeStore } from './url-intake.js'
import type { McpWorkspaceStore } from './workspace-ops.js'
import type { McpAdminStore, McpAdminTicket, McpAdminUsageRow } from './admin-tools.js'
import { parseStyleDnas } from '../bulk/style-dna.js'
import type { McpDeleteStore } from './delete-tools.js'
import { MCP_BRAND_ARCHIVED_NOTE_KIND } from './delete-tools.js'
import {
  resolveBrandKitForBusiness,
  type BrandKitRowLike,
} from '../brand-kit-resolve.js'
import type { McpBrandKitStore } from './brand-kit-tools.js'
import type { McpOfferStore, McpStoreCapabilities } from './offer-tools.js'
import { isMissingColumnError } from '../db-missing-column.js'
import { readBrandProfile } from '../brand-profile.js'
import { UPLOAD_BUCKET } from './asset-rehost.js'
import { UPLOAD_NOTE_KIND } from './upload-tools.js'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Migration 085 feature detection (cached; re-probed every 5 min so applying the
// migration is picked up without a deploy).
// ---------------------------------------------------------------------------

const CAPABILITY_TTL_MS = 5 * 60 * 1000
const capabilityCache = new Map<string, { value: boolean; at: number }>()

export async function hasColumn(db: SupabaseClient, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`
  const hit = capabilityCache.get(key)
  if (hit && Date.now() - hit.at < CAPABILITY_TTL_MS) return hit.value
  const { error } = await db.from(table).select(column).limit(1)
  if (error && !isMissingColumnError(error)) return false // transient: do not cache, degrade this call
  const value = !error
  capabilityCache.set(key, { value, at: Date.now() })
  return value
}

/** Tests / after applying a migration. */
export function resetMcpCapabilityCache(): void {
  capabilityCache.clear()
}

export async function probeMcpCapabilities(db: SupabaseClient): Promise<McpStoreCapabilities> {
  const [adProfile, imageMeta, archive, brandProfile] = await Promise.all([
    hasColumn(db, 'products', 'ad_profile'),
    hasColumn(db, 'product_images', 'is_primary'),
    hasColumn(db, 'businesses', 'archived_at'),
    hasColumn(db, 'brand_kits', 'brand_profile'),
  ])
  return { adProfile, imageMeta, archive, brandProfile }
}

function mapBrandKitRow(data: Record<string, unknown>): McpBrandKitContext {
  return {
    id: data.id as string,
    name: data.name as string,
    primaryColor: (data.primary_color as string | null) ?? null,
    secondaryColor: (data.secondary_color as string | null) ?? null,
    accentColor: (data.accent_color as string | null) ?? null,
    logoUrl: (data.logo_url as string | null) ?? null,
    tagline: (data.tagline as string | null) ?? null,
    brandVoice: (data.brand_voice as string | null) ?? null,
    toneKeywords: Array.isArray(data.tone_keywords) ? data.tone_keywords as string[] : [],
    targetAudience: (data.target_audience as string | null) ?? null,
    visualStyleNotes: (data.visual_style_notes as string | null) ?? null,
    fontPrimary: (data.font_primary as string | null) ?? null,
    referenceImages: Array.isArray(data.reference_images) ? data.reference_images as string[] : [],
    forbiddenPhrases: Array.isArray(data.forbidden_phrases) ? data.forbidden_phrases as string[] : [],
    mustUsePhrases: Array.isArray(data.must_use_phrases) ? data.must_use_phrases as string[] : [],
    styleDnas: parseStyleDnas(data.style_dnas),
    brandProfile: readBrandProfile(data.brand_profile),
    isPrimaryForBusiness: data.is_primary_for_business === true,
    isDefault: data.is_default === true,
    businessId: (data.business_id as string | null) ?? null,
  }
}

const BRAND_KIT_SELECT =
  'id, name, business_id, is_default, is_active, is_primary_for_business, primary_color, secondary_color, accent_color, logo_url, tagline, brand_voice, tone_keywords, must_use_phrases, forbidden_phrases, target_audience, visual_style_notes, font_primary, font_secondary, industry, reference_images, style_dnas, created_at'

/** Columns selected for MCP offer facts — must match public.products on AIIAN. */
export const MCP_PRODUCTS_OFFER_SELECT =
  'id, name, type, price_range, re_price, product_description, differentiation, main_problem, result, utility, technical_specs'

export function createMcpSupabaseAdapter(): McpDbClient | null {
  const db = getSupabaseAdmin()
  if (!db) return null

  async function resolveBrandKitsForBrand(
    userId: string,
    brandId: string,
    brandKitId?: string
  ) {
    if (!userId || !brandId) {
      return { brandKit: null, brandKits: [], brandKitResolution: 'missing' as const }
    }
    // Typed as string: the 085 column is feature-detected at runtime.
    const kitSelect: string = (await hasColumn(db!, 'brand_kits', 'brand_profile')) ? `${BRAND_KIT_SELECT}, brand_profile` : BRAND_KIT_SELECT
    const first = await db!
      .from('brand_kits')
      .select(kitSelect)
      .eq('business_id', brandId)
      .eq('user_id', userId)
      .order('is_primary_for_business', { ascending: false })
      .order('created_at', { ascending: true })
    let data = first.data as unknown as Array<Record<string, unknown>> | null
    let error = first.error
    if (error && /is_primary_for_business|style_dnas/i.test(error.message || '')) {
      const retry = await db!
        .from('brand_kits')
        .select('id, name, business_id, is_default, is_active, primary_color, secondary_color, accent_color, logo_url, tagline, brand_voice, tone_keywords, must_use_phrases, forbidden_phrases, target_audience, visual_style_notes, font_primary, font_secondary, industry, reference_images, created_at')
        .eq('business_id', brandId)
        .eq('user_id', userId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true })
      data = (retry.data || []).map((row) => ({ ...row, is_primary_for_business: false, style_dnas: [] }))
      error = retry.error
    }
    if (error) throw error
    const linked = (data || []) as unknown as BrandKitRowLike[]
    const resolved = resolveBrandKitForBusiness({ linkedKits: linked, brandKitId })
    return {
      brandKit: resolved.kit ? mapBrandKitRow(resolved.kit as unknown as Record<string, unknown>) : null,
      brandKits: linked.map((row) => ({
        id: row.id,
        name: row.name,
        businessId: row.business_id ?? null,
        isPrimaryForBusiness: row.is_primary_for_business === true,
        isDefault: row.is_default === true,
        isActive: row.is_active !== false,
        hasLogo: Boolean(row.logo_url),
      })),
      brandKitResolution: resolved.resolution,
    }
  }

  return {
    async listBusinessesForUser(userId: string, opts?: { includeArchived?: boolean }): Promise<McpBrandSummary[]> {
      if (!userId) return []
      // 085 businesses.archived_at; the pre-085 mcp_workspace_notes marker keeps working too.
      const archiveColumn = await hasColumn(db, 'businesses', 'archived_at')
      const { data, error } = await db
        .from('businesses')
        .select(archiveColumn ? 'id, name, archived_at' : 'id, name')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      const { data: archived } = await db
        .from('mcp_workspace_notes')
        .select('business_id')
        .eq('user_id', userId)
        .eq('kind', MCP_BRAND_ARCHIVED_NOTE_KIND)
      const noted = new Set((archived || []).map((row) => row.business_id as string))
      const rows = (data || []) as unknown as Array<{ id: string; name: string; archived_at?: string | null }>
      return rows
        .map((row) => ({
          id: row.id,
          name: row.name,
          type: null,
          archived: Boolean(row.archived_at) || noted.has(row.id),
        }))
        .filter((row) => opts?.includeArchived || !row.archived)
    },

    async getBusinessForUser(userId: string, brandId: string) {
      if (!userId || !brandId) return null
      const { data, error } = await db
        .from('businesses')
        .select('id, name, owner_id, location, sales_channels, does_shipping, shipping_method, icp_description')
        .eq('id', brandId)
        .eq('owner_id', userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        id: data.id as string,
        name: data.name as string,
        type: null,
        userId: data.owner_id as string,
        location: (data.location as string | null) ?? null,
        salesChannels: (data.sales_channels as string[] | null) ?? null,
        doesShipping: (data.does_shipping as boolean | null) ?? null,
        shippingMethod: (data.shipping_method as string | null) ?? null,
        icpDescription: (data.icp_description as string | null) ?? null,
      }
    },

    async listOffersForBrand(userId: string, brandId: string) {
      if (!userId || !brandId) return []
      // Only select columns that exist on public.products (AIIAN).
      // #31 regression: selecting `do_not_claim` (no such column) made PostgREST
      // fail every list_brands / list_offers / get_brand_context / GUIDE / EXECUTE path.
      const { data, error } = await db
        .from('products')
        .select(MCP_PRODUCTS_OFFER_SELECT)
        .eq('business_id', brandId)
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []).map((row) => {
        const priceRange = (row.price_range as string | null) ?? null
        const rePrice = (row.re_price as string | null) ?? null
        const description = (row.product_description as string | null) ?? null
        // Prefer explicit re_price; also accept a literal price embedded in description (e.g. ₡9.900).
        const priceFromDesc = description && /[₡$€]\s?\d/.test(description)
          ? (description.match(/[₡$€]\s?[\d.,]+/) || [])[0] || null
          : null
        const exactPrice =
          (rePrice && !/^(economico|medio|premium)$/i.test(rePrice.trim()) ? rePrice : null) ||
          priceFromDesc
        return {
          id: row.id as string,
          name: row.name as string,
          type: (row.type as string | null) ?? null,
          price: exactPrice,
          priceRange:
            priceRange && /^(economico|medio|premium)$/i.test(priceRange.trim())
              ? priceRange.trim().toLowerCase()
              : null,
          productDescription: description,
          differentiation: (row.differentiation as string | null) ?? null,
          mainProblem: (row.main_problem as string | null) ?? null,
          result: (row.result as string | null) ?? null,
          utility: (row.utility as string | null) ?? null,
          technicalSpecs: (row.technical_specs as string | null) ?? null,
          // Claims stay on brand_kit.forbidden_phrases — there is no products.do_not_claim column.
          doNotClaim: undefined,
        }
      })
    },

    async getBrandKitForBrand(
      userId: string,
      brandId: string,
      brandKitId?: string
    ): Promise<McpBrandKitContext | null> {
      const bundle = await resolveBrandKitsForBrand(userId, brandId, brandKitId)
      return bundle.brandKit
    },

    resolveBrandKitsForBrand,

    async getLatestGuideIntakeForBrand(
      userId: string,
      brandId: string
    ): Promise<McpGuideIntakeSummary | null> {
      if (!userId || !brandId) return null
      const { data, error } = await db
        .from('mcp_url_intakes')
        .select('id, source_url, status, error_message, completed_at, warnings, analysis_result')
        .eq('user_id', userId)
        .eq('business_id', brandId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const analysis = data.analysis_result && typeof data.analysis_result === 'object'
        ? data.analysis_result as { facts?: Record<string, unknown> }
        : null
      return {
        id: data.id as string,
        sourceUrl: data.source_url as string,
        status: data.status as string,
        errorMessage: (data.error_message as string | null) ?? null,
        completedAt: (data.completed_at as string | null) ?? null,
        warnings: Array.isArray(data.warnings) ? data.warnings as string[] : [],
        analysisFacts: analysis?.facts || null,
      }
    },

    async listOfferReferenceImages(userId, brandId, offerId) {
      if (!userId || !brandId || !offerId) return []
      const { data: product, error: productErr } = await db
        .from('products')
        .select('id')
        .eq('id', offerId)
        .eq('business_id', brandId)
        .eq('owner_id', userId)
        .maybeSingle()
      if (productErr) throw productErr
      if (!product) return []
      const { data, error } = await db
        .from('product_images')
        .select('image_url, kind')
        .eq('product_id', offerId)
        .eq('user_id', userId)
        .in('kind', ['product', 'context'])
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || [])
        .sort((a, b) => {
          if (a.kind === b.kind) return 0
          return a.kind === 'product' ? -1 : 1
        })
        .map((row) => row.image_url as string)
        .filter(Boolean)
        .slice(0, 5)
    },
  }
}

export function createMcpUrlIntakeStore(): McpUrlIntakeStore | null {
  const db = getSupabaseAdmin()
  if (!db) return null
  return {
    async insertPendingUrlIntake(row) {
      const { data, error } = await db
        .from('mcp_url_intakes')
        .insert({
          user_id: row.userId,
          business_id: row.businessId,
          source_url: row.sourceUrl,
          status: 'pending_analysis',
        })
        .select('id')
        .single()
      if (error) {
        // In-flight dedupe: return existing pending/processing row for same user+brand+url
        if (error.code === '23505') {
          const { data: existing, error: findError } = await db
            .from('mcp_url_intakes')
            .select('id')
            .eq('user_id', row.userId)
            .eq('business_id', row.businessId)
            .eq('source_url', row.sourceUrl)
            .in('status', ['pending_analysis', 'processing'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (findError) throw findError
          if (existing?.id) return { id: existing.id as string }
        }
        throw error
      }
      return { id: data.id as string }
    },
    // G3: owner-scoped status + inline analysis (no cron needed).
    async getUrlIntake({ id, userId }) {
      const { data, error } = await db
        .from('mcp_url_intakes')
        .select('id, business_id, source_url, status, error_message, analysis_result, warnings, applied_brand_kit_id, attempt_count')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const row = data as Record<string, unknown>
      return {
        id: String(row.id),
        businessId: String(row.business_id),
        sourceUrl: String(row.source_url),
        status: row.status as 'pending_analysis' | 'processing' | 'ready' | 'failed',
        errorMessage: (row.error_message as string | null) ?? null,
        analysis: (row.analysis_result as Record<string, unknown> | null) ?? null,
        warnings: Array.isArray(row.warnings) ? row.warnings : [],
        appliedBrandKitId: (row.applied_brand_kit_id as string | null) ?? null,
        attemptCount: Number(row.attempt_count) || 0,
      }
    },
    async runUrlIntakeInline({ id, userId }) {
      // Lazy: site analysis (model + fetch) only loads when an intake actually runs.
      const { runMcpUrlIntakeInline } = await import('./url-analysis-worker.js')
      return runMcpUrlIntakeInline({ id, userId })
    },
  }
}

export function createMcpWorkspaceStore(): McpWorkspaceStore | null {
  const db = getSupabaseAdmin()
  if (!db) return null
  return {
    async insertProvenanceNote(row) {
      const { data, error } = await db
        .from('mcp_workspace_notes')
        .insert({
          user_id: row.userId,
          business_id: row.businessId,
          kind: row.kind,
          note: row.note,
          metadata: row.metadata,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    async insertFileIntakePlaceholder(row) {
      const { data, error } = await db
        .from('mcp_workspace_notes')
        .insert({
          user_id: row.userId,
          business_id: row.businessId,
          kind: 'file_intake_placeholder',
          note: row.fileName,
          metadata: {
            mimeType: row.mimeType,
            status: 'upload_required',
            ...(row.requestId ? { requestId: row.requestId } : {}),
          },
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
  }
}

const ADMIN_TICKET_SELECT = [
  'id',
  'user_id',
  'user_email',
  'subject',
  'description',
  'category',
  'priority',
  'status',
  'page_url',
  'ui_surface',
  'app_version',
  'locale',
  'viewport',
  'browser_info',
  'screen_size',
  'console_errors',
  'breadcrumbs',
  'admin_notes',
  'notes_history',
  'product_name',
  'user_plan',
  'created_at',
  'updated_at',
].join(', ')

function mapAdminTicket(row: Record<string, unknown>): McpAdminTicket {
  const history = Array.isArray(row.notes_history)
    ? row.notes_history as { text: string; status: string; timestamp: string }[]
    : []
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    user_email: (row.user_email as string | null) ?? null,
    subject: String(row.subject || ''),
    description: String(row.description || ''),
    category: String(row.category || ''),
    priority: String(row.priority || ''),
    status: String(row.status || ''),
    page_url: (row.page_url as string | null) ?? null,
    ui_surface: (row.ui_surface as string | null) ?? null,
    app_version: (row.app_version as string | null) ?? null,
    locale: (row.locale as string | null) ?? null,
    viewport: (row.viewport as string | null) ?? null,
    browser_info: (row.browser_info as string | null) ?? null,
    screen_size: (row.screen_size as string | null) ?? null,
    console_errors: row.console_errors ?? [],
    breadcrumbs: row.breadcrumbs ?? [],
    admin_notes: (row.admin_notes as string | null) ?? null,
    notes_history: history,
    product_name: (row.product_name as string | null) ?? null,
    user_plan: (row.user_plan as string | null) ?? null,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  }
}

export function createMcpAdminStore(): McpAdminStore | null {
  const db = getSupabaseAdmin()
  if (!db) return null

  return {
    async listTickets({ status, limit }) {
      let query = db
        .from('feedback_tickets')
        .select(ADMIN_TICKET_SELECT)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (status) query = query.eq('status', status)
      const { data, error } = await query
      if (error) throw error
      return (data || []).map((row) => mapAdminTicket(row as Record<string, unknown>))
    },

    async getTicket(ticketId) {
      const { data, error } = await db
        .from('feedback_tickets')
        .select(ADMIN_TICKET_SELECT)
        .eq('id', ticketId)
        .maybeSingle()
      if (error) throw error
      return data ? mapAdminTicket(data as Record<string, unknown>) : null
    },

    async updateTicket({ ticketId, status, comment }) {
      const { data: existing, error: loadError } = await db
        .from('feedback_tickets')
        .select(ADMIN_TICKET_SELECT)
        .eq('id', ticketId)
        .maybeSingle()
      if (loadError) throw loadError
      if (!existing) throw new Error('Ticket not found')

      const current = mapAdminTicket(existing as Record<string, unknown>)
      const nextStatus = status || current.status
      const history = [...(current.notes_history || [])]
      history.push({
        text: comment || '',
        status: nextStatus,
        timestamp: new Date().toISOString(),
      })

      const update: Record<string, unknown> = {
        notes_history: history,
      }
      if (status) update.status = status
      if (comment !== undefined) update.admin_notes = comment
      if (status === 'resolved') update.resolved_at = new Date().toISOString()

      const { data, error } = await db
        .from('feedback_tickets')
        .update(update)
        .eq('id', ticketId)
        .select(ADMIN_TICKET_SELECT)
        .single()
      if (error) throw error
      return mapAdminTicket(data as Record<string, unknown>)
    },

    async listUsage({ startIso, endIso, source, limit }) {
      let query = db
        .from('api_usage_logs')
        .select('id, user_id, user_email, feature, model, generation_id, input_tokens, output_tokens, total_tokens, estimated_cost_usd, success, created_at, metadata, source')
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (source && source !== 'all') query = query.eq('source', source)
      const { data, error } = await query
      if (error) throw error
      return (data || []) as McpAdminUsageRow[]
    },
  }
}

export function createMcpDeleteStore(): McpDeleteStore | null {
  const db = getSupabaseAdmin()
  if (!db) return null

  async function clearSessionLinks(sessionId: string): Promise<void> {
    for (const table of ['product_images', 'posts'] as const) {
      const { error } = await db
        .from(table)
        .update({ message_id: null, session_id: null })
        .eq('session_id', sessionId)
      if (error) throw error
    }
  }

  return {
    async listArchivedBrandIds(userId) {
      const { data, error } = await db
        .from('mcp_workspace_notes')
        .select('business_id')
        .eq('user_id', userId)
        .eq('kind', MCP_BRAND_ARCHIVED_NOTE_KIND)
      if (error) throw error
      return [...new Set((data || []).map((row) => row.business_id as string).filter(Boolean))]
    },

    async archiveBrand({ userId, brandId, brandName }) {
      const { data: sessions, error: sessErr } = await db
        .from('chat_sessions')
        .select('id')
        .eq('business_id', brandId)
        .eq('user_id', userId)
        .neq('status', 'archived')
      if (sessErr) throw sessErr
      const ids = (sessions || []).map((row) => row.id as string)
      if (ids.length) {
        const { error: archErr } = await db
          .from('chat_sessions')
          .update({ status: 'archived', updated_at: new Date().toISOString() })
          .in('id', ids)
        if (archErr) throw archErr
      }
      if (await hasColumn(db, 'businesses', 'archived_at')) {
        const { error: flagErr } = await db
          .from('businesses')
          .update({ archived_at: new Date().toISOString() })
          .eq('id', brandId)
          .eq('owner_id', userId)
        if (flagErr && !isMissingColumnError(flagErr)) throw flagErr
      }
      const { data: note, error: noteErr } = await db
        .from('mcp_workspace_notes')
        .insert({
          user_id: userId,
          business_id: brandId,
          kind: MCP_BRAND_ARCHIVED_NOTE_KIND,
          note: `Archived ${brandName}`,
          metadata: { source: 'mcp', recoverable: true },
        })
        .select('id')
        .single()
      if (noteErr) throw noteErr
      return { noteId: note.id as string, sessionsArchived: ids.length }
    },

    async countBrandImpact({ userId, brandId }) {
      const [{ data: sessions, error: sErr }, { data: offers, error: oErr }, { count: kitCount, error: kErr }] = await Promise.all([
        db.from('chat_sessions').select('id').eq('business_id', brandId).eq('user_id', userId),
        db.from('products').select('id').eq('business_id', brandId).eq('owner_id', userId),
        db.from('brand_kits').select('id', { count: 'exact', head: true }).eq('business_id', brandId).eq('user_id', userId),
      ])
      if (sErr) throw sErr
      if (oErr) throw oErr
      if (kErr) throw kErr
      const sessionIds = (sessions || []).map((row) => row.id as string)
      const offerIds = (offers || []).map((row) => row.id as string)
      return {
        sessionCount: sessionIds.length,
        offerCount: offerIds.length,
        kitCount: kitCount ?? 0,
        sessionIds,
        offerIds,
      }
    },

    async detachBrandKits(brandId) {
      const { data, error } = await db
        .from('brand_kits')
        .update({ business_id: null, is_primary_for_business: false, updated_at: new Date().toISOString() })
        .eq('business_id', brandId)
        .select('id')
      if (error) throw error
      return (data || []).length
    },

    async deleteSession(sessionId) {
      await clearSessionLinks(sessionId)
      const { data, error } = await db
        .from('chat_sessions')
        .delete()
        .eq('id', sessionId)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Session was not deleted')
    },

    async deleteOffer({ userId, brandId, offerId }) {
      const { data, error } = await db
        .from('products')
        .delete()
        .eq('id', offerId)
        .eq('business_id', brandId)
        .eq('owner_id', userId)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Offer was not deleted')
    },

    async remainingOfferIds(brandId) {
      const { data, error } = await db
        .from('products')
        .select('id')
        .eq('business_id', brandId)
      if (error) throw error
      return (data || []).map((row) => row.id as string)
    },

    async deleteBrandRow({ userId, brandId }) {
      const { data, error } = await db
        .from('businesses')
        .delete()
        .eq('id', brandId)
        .eq('owner_id', userId)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Folder was not deleted')
    },

    async getOffer({ userId, brandId, offerId }) {
      const { data, error } = await db
        .from('products')
        .select('id, name')
        .eq('id', offerId)
        .eq('business_id', brandId)
        .eq('owner_id', userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return { id: data.id as string, name: data.name as string }
    },

    async getAsset({ userId, brandId, assetId }) {
      const { data, error } = await db
        .from('product_images')
        .select('id, image_url, product_id, user_id')
        .eq('id', assetId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const { data: product } = await db
        .from('products')
        .select('id')
        .eq('id', data.product_id)
        .eq('business_id', brandId)
        .eq('owner_id', userId)
        .maybeSingle()
      if (!product) return null
      return { id: data.id as string, imageUrl: (data.image_url as string | null) ?? null }
    },

    async deleteAsset({ userId, brandId, assetId }) {
      const asset = await this.getAsset({ userId, brandId, assetId })
      if (!asset) throw new Error('Asset not found')
      const imageUrl = asset.imageUrl || ''
      const marker = '/storage/v1/object/public/post-images/'
      const markerIndex = imageUrl.indexOf(marker)
      if (markerIndex >= 0) {
        const objectPath = decodeURIComponent(imageUrl.slice(markerIndex + marker.length).split('?')[0])
        if (objectPath.startsWith(`${userId}/`)) {
          const { error: storageError } = await db.storage.from('post-images').remove([objectPath])
          if (storageError && !/not found/i.test(storageError.message || '')) throw storageError
        }
      }
      const { data, error } = await db
        .from('product_images')
        .delete()
        .eq('id', assetId)
        .eq('user_id', userId)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Asset was not deleted')
      return { imageUrl: asset.imageUrl }
    },
  }
}

export function createMcpBrandKitStore(): McpBrandKitStore | null {
  const db = getSupabaseAdmin()
  if (!db) return null
  const kitSelect = async (): Promise<string> => ((await hasColumn(db, 'brand_kits', 'brand_profile')) ? `${BRAND_KIT_SELECT}, brand_profile` : BRAND_KIT_SELECT)

  async function fetchKit(userId: string, kitId: string): Promise<BrandKitRowLike | null> {
    const { data, error } = await db
      .from('brand_kits')
      .select(await kitSelect())
      .eq('id', kitId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    return (data as unknown as BrandKitRowLike | null) || null
  }

  return {
    async listKits({ userId, brandId, includeInactive }) {
      if (!userId) return []
      let q = db.from('brand_kits').select(await kitSelect()).eq('user_id', userId)
      if (brandId) q = q.eq('business_id', brandId)
      if (!includeInactive) q = q.neq('is_active', false)
      const { data, error } = await q
        .order('is_primary_for_business', { ascending: false })
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data || []) as unknown as BrandKitRowLike[]
    },

    async getKit({ userId, kitId }) {
      return fetchKit(userId, kitId)
    },

    async countKits(userId) {
      const { count, error } = await db
        .from('brand_kits')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      if (error) throw error
      return count || 0
    },

    async insertKit({ userId, row }) {
      const { data, error } = await db
        .from('brand_kits')
        .insert({ ...row, user_id: userId })
        .select(await kitSelect())
        .single()
      if (error) throw error
      return data as unknown as BrandKitRowLike
    },

    async updateKit({ userId, kitId, patch }) {
      const { data, error } = await db
        .from('brand_kits')
        .update(patch)
        .eq('id', kitId)
        .eq('user_id', userId)
        .select(await kitSelect())
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('Brand kit not found')
      return data as unknown as BrandKitRowLike
    },

    async clearPrimaryForBusiness({ userId, businessId, exceptKitId }) {
      let q = db
        .from('brand_kits')
        .update({ is_primary_for_business: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('business_id', businessId)
        .eq('is_primary_for_business', true)
      if (exceptKitId) q = q.neq('id', exceptKitId)
      const { error } = await q
      if (error) throw error
    },

    async deleteKit({ userId, kitId }) {
      const { data, error } = await db
        .from('brand_kits')
        .delete()
        .eq('id', kitId)
        .eq('user_id', userId)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Brand kit was not deleted')
    },

    async assertOwnsBrand(userId, brandId) {
      const { data, error } = await db
        .from('businesses')
        .select('id')
        .eq('id', brandId)
        .eq('owner_id', userId)
        .maybeSingle()
      if (error) throw error
      return Boolean(data)
    },

    async hasBrandProfile() {
      return hasColumn(db, 'brand_kits', 'brand_profile')
    },
  }
}

/**
 * Offers (products + 085 ad_profile), product photo metadata, uploads (signed URLs in
 * post-images) and upload records (mcp_workspace_notes kind mcp_upload). Service role;
 * explicit owner filter on every query.
 */
export function createMcpOfferStore(): McpOfferStore | null {
  const db = getSupabaseAdmin()
  if (!db) return null
  const IMAGE_BASE = 'id, product_id, user_id, image_url, kind, label, message_id, created_at'
  const imageSelect = async () => ((await hasColumn(db, 'product_images', 'is_primary')) ? `${IMAGE_BASE}, is_primary, tags, role, quality, source_url` : IMAGE_BASE)
  const asRow = (data: unknown) => data as unknown as Record<string, unknown>

  return {
    capabilities: () => probeMcpCapabilities(db),

    async getOffer({ userId, brandId, offerId }) {
      const { data, error } = await db.from('products').select('*').eq('id', offerId).eq('business_id', brandId).eq('owner_id', userId).maybeSingle()
      if (error) throw error
      return data ? asRow(data) : null
    },

    async getOfferById({ userId, offerId }) {
      const { data, error } = await db.from('products').select('*').eq('id', offerId).eq('owner_id', userId).maybeSingle()
      if (error) throw error
      return data ? asRow(data) : null
    },

    async insertOffer({ userId, brandId, row }) {
      const { data, error } = await db
        .from('products')
        .insert({ ...row, owner_id: userId, business_id: brandId })
        .select('*')
        .single()
      if (error) throw error
      return asRow(data)
    },

    async updateOffer({ userId, brandId, offerId, patch }) {
      const { data, error } = await db
        .from('products')
        .update(patch)
        .eq('id', offerId)
        .eq('business_id', brandId)
        .eq('owner_id', userId)
        .select('*')
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('Offer not found for this brand')
      return asRow(data)
    },

    async getProductImage({ userId, imageId }) {
      const { data, error } = await db.from('product_images').select(await imageSelect()).eq('id', imageId).eq('user_id', userId).maybeSingle()
      if (error) throw error
      return data ? asRow(data) : null
    },

    async updateProductImage({ userId, imageId, patch }) {
      const { data, error } = await db
        .from('product_images')
        .update(patch)
        .eq('id', imageId)
        .eq('user_id', userId)
        .select(await imageSelect())
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('Product image not found')
      return asRow(data)
    },

    async clearPrimaryImages({ userId, offerId, exceptImageId }) {
      let q = db.from('product_images').update({ is_primary: false }).eq('product_id', offerId).eq('user_id', userId).eq('is_primary', true)
      if (exceptImageId) q = q.neq('id', exceptImageId)
      const { error } = await q
      if (error) throw error
    },

    async insertProductImage({ userId, offerId, row }) {
      const { data: product, error: productErr } = await db.from('products').select('id').eq('id', offerId).eq('owner_id', userId).maybeSingle()
      if (productErr) throw productErr
      if (!product) throw new Error('Offer not found')
      const { data, error } = await db
        .from('product_images')
        .insert({ ...row, product_id: offerId, user_id: userId })
        .select(await imageSelect())
        .single()
      if (error) throw error
      return asRow(data)
    },

    async createSignedUpload({ path }) {
      const { data, error } = await db.storage.from(UPLOAD_BUCKET).createSignedUploadUrl(path)
      if (error) throw error
      return { signedUrl: data.signedUrl, token: data.token, path: data.path }
    },

    async statObject({ path }) {
      const slash = path.lastIndexOf('/')
      const folder = path.slice(0, slash)
      const name = path.slice(slash + 1)
      const { data, error } = await db.storage.from(UPLOAD_BUCKET).list(folder, { search: name, limit: 5 })
      if (error) throw error
      const hit = (data || []).find((f) => f.name === name)
      if (!hit) return null
      const meta = (hit.metadata || {}) as { size?: number; mimetype?: string; contentLength?: number }
      return { size: Number(meta.size ?? meta.contentLength ?? 0), contentType: meta.mimetype ?? null }
    },

    async removeObject({ path }) {
      const { error } = await db.storage.from(UPLOAD_BUCKET).remove([path])
      if (error && !/not found/i.test(error.message || '')) throw error
    },

    publicUrl(path) {
      return db.storage.from(UPLOAD_BUCKET).getPublicUrl(path).data.publicUrl
    },

    async downloadObject({ path }) {
      const { data, error } = await db.storage.from(UPLOAD_BUCKET).download(path)
      if (error || !data) return null
      return new Uint8Array(await data.arrayBuffer())
    },

    async uploadBytes({ path, bytes, contentType }) {
      const { error } = await db.storage.from(UPLOAD_BUCKET).upload(path, bytes, { contentType, upsert: false })
      if (error) throw error
      return db.storage.from(UPLOAD_BUCKET).getPublicUrl(path).data.publicUrl
    },

    async insertUploadRecord({ userId, brandId, metadata }) {
      const { data, error } = await db
        .from('mcp_workspace_notes')
        .insert({ user_id: userId, business_id: brandId, kind: UPLOAD_NOTE_KIND, note: String(metadata.filename || 'upload'), metadata })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },

    async getUploadRecord({ userId, uploadId }) {
      if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return null
      const { data, error } = await db
        .from('mcp_workspace_notes')
        .select('id, business_id, metadata')
        .eq('id', uploadId)
        .eq('user_id', userId)
        .eq('kind', UPLOAD_NOTE_KIND)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return { id: data.id as string, brandId: data.business_id as string, metadata: (data.metadata || {}) as Record<string, unknown> }
    },

    async insertBusiness({ userId, row }) {
      // Same columns as the web brand form (src/services/database.ts createBusiness); owner forced server-side.
      const allowed: Record<string, unknown> = {}
      for (const key of ['name', 'sales_channels', 'location', 'does_shipping', 'shipping_method', 'icp_description']) {
        if (row[key] !== undefined) allowed[key] = row[key]
      }
      const { data, error } = await db
        .from('businesses')
        .insert({ ...allowed, owner_id: userId, client_id: null })
        .select('id, name, location, sales_channels')
        .single()
      if (error) throw error
      return asRow(data)
    },

    async updateBusiness({ userId, brandId, patch }) {
      // #22: same columns as the web brand form; owner-scoped (another user's brand → null).
      const allowed: Record<string, unknown> = {}
      for (const key of ['name', 'sales_channels', 'location', 'does_shipping', 'shipping_method', 'icp_description']) {
        if (patch[key] !== undefined) allowed[key] = patch[key]
      }
      const { data, error } = await db
        .from('businesses')
        .update(allowed)
        .eq('id', brandId)
        .eq('owner_id', userId)
        .select('id, name, location, sales_channels, does_shipping, shipping_method, icp_description')
        .maybeSingle()
      if (error) throw error
      return data ? asRow(data) : null
    },

    async updateUploadRecord({ userId, uploadId, metadata }) {
      const { error } = await db
        .from('mcp_workspace_notes')
        .update({ metadata })
        .eq('id', uploadId)
        .eq('user_id', userId)
        .eq('kind', UPLOAD_NOTE_KIND)
      if (error) throw error
    },
  }
}
