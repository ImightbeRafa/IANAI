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

export function createMcpSupabaseAdapter(): McpDbClient | null {
  const db = getSupabaseAdmin()
  if (!db) return null

  return {
    async listBusinessesForUser(userId: string): Promise<McpBrandSummary[]> {
      if (!userId) return []
      const { data, error } = await db
        .from('businesses')
        .select('id, name')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        type: null,
      }))
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
      const { data, error } = await db
        .from('products')
        .select('id, name, type')
        .eq('business_id', brandId)
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        type: (row.type as string | null) ?? null,
      }))
    },

    async getBrandKitForBrand(
      userId: string,
      brandId: string
    ): Promise<McpBrandKitContext | null> {
      if (!userId || !brandId) return null
      const kitSelect = 'id, name, primary_color, secondary_color, accent_color, logo_url, tagline, brand_voice, tone_keywords, target_audience, visual_style_notes, font_primary, reference_images, style_dnas'
      let { data, error } = await db
        .from('brand_kits')
        .select(kitSelect)
        .eq('business_id', brandId)
        .eq('user_id', userId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (error && /style_dnas/i.test(error.message || '')) {
        const retry = await db
          .from('brand_kits')
          .select('id, name, primary_color, secondary_color, accent_color, logo_url, tagline, brand_voice, tone_keywords, target_audience, visual_style_notes, font_primary, reference_images')
          .eq('business_id', brandId)
          .eq('user_id', userId)
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        data = retry.data
        error = retry.error
      }
      if (error) throw error
      if (!data) return null
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
        styleDnas: parseStyleDnas((data as { style_dnas?: unknown }).style_dnas),
      }
    },

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
        .limit(5)
      if (error) throw error
      return (data || [])
        .map((row) => row.image_url as string)
        .filter(Boolean)
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
