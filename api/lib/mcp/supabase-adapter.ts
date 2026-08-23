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
      const { data, error } = await db
        .from('brand_kits')
        .select('id, name, primary_color, secondary_color, accent_color, logo_url, tagline, brand_voice, tone_keywords, target_audience, visual_style_notes, font_primary, reference_images')
        .eq('business_id', brandId)
        .eq('user_id', userId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
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
          metadata: { mimeType: row.mimeType, status: 'upload_required' },
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
  }
}
