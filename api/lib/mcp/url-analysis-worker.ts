/**
 * MCP GUIDE URL analysis worker — claim → analyze → fill-only merge → ready|failed.
 * No Advance credits. Service-role only.
 */

import { getSupabaseAdmin } from '../supabase-admin.js'
import { runSiteAnalysis, SITE_ANALYSIS_MODEL } from '../site-analysis.js'
import { logApiUsage } from '../usage-logger.js'
import { assertPublicHttpUrl } from '../url-safety.js'
import {
  buildFillOnlyBrandKitPatch,
  buildFillOnlyBusinessPatch,
  sanitizeWorkerError,
} from './url-analysis-merge.js'

export const MCP_URL_ANALYSIS_MAX_ATTEMPTS = 3
export const MCP_URL_ANALYSIS_STALE_SECONDS = 300

export type ClaimedUrlIntake = {
  id: string
  user_id: string
  business_id: string
  source_url: string
  status: string
  attempt_count: number
}

export type UrlAnalysisWorkerResult =
  | { processed: false; reason: 'empty' | 'db_unavailable' }
  | { processed: true; intakeId: string; status: 'ready' | 'failed'; brandKitId?: string | null }

export async function processNextMcpUrlIntake(): Promise<UrlAnalysisWorkerResult> {
  const db = getSupabaseAdmin()
  if (!db) return { processed: false, reason: 'db_unavailable' }

  const { data: claimed, error: claimError } = await db.rpc('claim_mcp_url_intake', {
    p_stale_after_seconds: MCP_URL_ANALYSIS_STALE_SECONDS,
  })
  if (claimError) throw claimError
  const row = (Array.isArray(claimed) ? claimed[0] : claimed) as ClaimedUrlIntake | null
  if (!row?.id) return { processed: false, reason: 'empty' }

  try {
    assertPublicHttpUrl(row.source_url)
    const { data: business, error: bizError } = await db
      .from('businesses')
      .select('id, owner_id, name, location, shipping_method, does_shipping, sales_channels, icp_description')
      .eq('id', row.business_id)
      .eq('owner_id', row.user_id)
      .maybeSingle()
    if (bizError) throw bizError
    if (!business) throw new Error('Brand not found for intake owner')

    const { analysis, usage } = await runSiteAnalysis({
      url: row.source_url,
      language: 'es',
      rehostLogoForUserId: row.user_id,
    })

    const businessPatch = buildFillOnlyBusinessPatch(business as Record<string, unknown>, analysis)
    if (Object.keys(businessPatch).length > 0) {
      const { error: updBiz } = await db
        .from('businesses')
        .update({ ...businessPatch, updated_at: new Date().toISOString() })
        .eq('id', row.business_id)
        .eq('owner_id', row.user_id)
      if (updBiz) throw updBiz
    }

    const { data: existingKit, error: kitReadError } = await db
      .from('brand_kits')
      .select('id, name, logo_url, primary_color, secondary_color, accent_color, font_primary, tagline, brand_voice, tone_keywords, must_use_phrases, forbidden_phrases, visual_style_notes, target_audience, reference_images, business_id, user_id')
      .eq('business_id', row.business_id)
      .eq('user_id', row.user_id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (kitReadError) throw kitReadError

    const kitPatch = buildFillOnlyBrandKitPatch(
      existingKit as Record<string, unknown> | null,
      analysis,
      (business.name as string) || 'Brand'
    )

    let appliedBrandKitId: string | null = existingKit?.id ?? null
    if (existingKit?.id) {
      if (Object.keys(kitPatch).length > 0) {
        const { error: kitUpd } = await db
          .from('brand_kits')
          .update({ ...kitPatch, updated_at: new Date().toISOString() })
          .eq('id', existingKit.id)
          .eq('user_id', row.user_id)
        if (kitUpd) throw kitUpd
      }
    } else {
      const insertRow = {
        user_id: row.user_id,
        business_id: row.business_id,
        name: kitPatch.name || (business.name as string) || 'Brand',
        logo_url: kitPatch.logo_url || null,
        primary_color: kitPatch.primary_color || null,
        secondary_color: kitPatch.secondary_color || null,
        accent_color: kitPatch.accent_color || null,
        font_primary: kitPatch.font_primary || null,
        tagline: kitPatch.tagline || null,
        brand_voice: kitPatch.brand_voice || null,
        tone_keywords: kitPatch.tone_keywords || [],
        must_use_phrases: kitPatch.must_use_phrases || [],
        forbidden_phrases: kitPatch.forbidden_phrases || [],
        visual_style_notes: kitPatch.visual_style_notes || null,
        target_audience: kitPatch.target_audience || null,
        reference_images: kitPatch.reference_images || [],
        is_active: true,
        is_default: false,
      }
      const { data: created, error: kitIns } = await db
        .from('brand_kits')
        .insert(insertRow)
        .select('id')
        .single()
      if (kitIns) throw kitIns
      appliedBrandKitId = created.id as string
    }

    const boundedResult = {
      facts: analysis.facts,
      evidence: analysis.evidence,
      pages: analysis.pages.slice(0, 8),
      assets: {
        logoCandidates: analysis.assets.logoCandidates.slice(0, 8),
        faviconCandidates: analysis.assets.faviconCandidates.slice(0, 8),
        imageCandidates: analysis.assets.imageCandidates.slice(0, 16),
        colors: analysis.assets.colors.slice(0, 16),
        fonts: analysis.assets.fonts.slice(0, 8),
      },
      warnings: analysis.warnings.slice(0, 20),
    }

    const { error: doneError } = await db
      .from('mcp_url_intakes')
      .update({
        status: 'ready',
        analysis_result: boundedResult,
        warnings: analysis.warnings.slice(0, 20),
        applied_brand_kit_id: appliedBrandKitId,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', row.id)
    if (doneError) throw doneError

    await logApiUsage({
      userId: row.user_id,
      feature: 'brand_extraction',
      model: SITE_ANALYSIS_MODEL,
      inputTokens: usage.input,
      outputTokens: usage.output,
      thinkingTokens: usage.thinking,
      success: true,
      source: 'cron',
      metadata: {
        action: 'mcp_guide_url_analysis',
        source: 'cron',
        intakeId: row.id,
        businessId: row.business_id,
        host: new URL(row.source_url).hostname,
      },
    })

    return { processed: true, intakeId: row.id, status: 'ready', brandKitId: appliedBrandKitId }
  } catch (err) {
    const message = sanitizeWorkerError(err)
    const attempts = Number(row.attempt_count) || 1
    const terminal = attempts >= MCP_URL_ANALYSIS_MAX_ATTEMPTS
    const { error: failError } = await db
      .from('mcp_url_intakes')
      .update({
        status: terminal ? 'failed' : 'pending_analysis',
        error_message: message,
        claimed_at: null,
        completed_at: terminal ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    if (failError) console.error('failed to mark intake failure', failError)

    await logApiUsage({
      userId: row.user_id,
      feature: 'brand_extraction',
      model: SITE_ANALYSIS_MODEL,
      success: false,
      errorMessage: message,
      source: 'cron',
      metadata: {
        action: 'mcp_guide_url_analysis',
        source: 'cron',
        intakeId: row.id,
        businessId: row.business_id,
        attempt: attempts,
        terminal,
      },
    }).catch(() => undefined)

    if (!terminal) {
      // Leave as pending for next cron tick
      return { processed: true, intakeId: row.id, status: 'failed' }
    }
    return { processed: true, intakeId: row.id, status: 'failed' }
  }
}
