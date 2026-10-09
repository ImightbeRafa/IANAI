/**
 * MCP GUIDE URL analysis worker — claim → analyze → fill-only merge → ready|failed.
 * No Advance credits. Service-role only.
 *
 * Two drivers share `processClaimedMcpUrlIntake`:
 * - cron (`processNextMcpUrlIntake`, api/mcp-guide-analysis.ts): claims the oldest pending row.
 * - inline (`runMcpUrlIntakeInline`, G3): claims ONE row by id for its owner, so
 *   workspace_save_url_context / workspace_url_context_status work with no cron at all
 *   (poll-driven resume, same lease guards).
 */

import { getSupabaseAdmin } from '../supabase-admin.js'
import { runSiteAnalysis, SITE_ANALYSIS_MODEL } from '../site-analysis.js'
import { logApiUsage } from '../usage-logger.js'
import { assertPublicHttpUrl } from '../url-safety.js'
import {
  buildFillOnlyBrandKitPatchWithReview,
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
  claimed_at: string
}

export type UrlAnalysisWorkerResult =
  | { processed: false; reason: 'empty' | 'db_unavailable' }
  | { processed: true; intakeId: string; status: 'ready' | 'failed'; brandKitId?: string | null }
  // Round-6 operator review, item G: a clean early stop with no kit write,
  // no final status update, and no usage log — either because a second
  // runner's stale-reclaim has already taken this row (lease_lost), or
  // because the per-route deadline (api/lib/request-deadline.ts) fired
  // first (deadline_exceeded). Either way the row is simply left at
  // status='processing' with its original claimed_at, same as a crash
  // would leave it — the existing stale-reclaim window is what picks it
  // back up, not this function.
  | { processed: true; intakeId: string; status: 'skipped'; reason: 'lease_lost' | 'deadline_exceeded' }

export async function processNextMcpUrlIntake(signal?: AbortSignal): Promise<UrlAnalysisWorkerResult> {
  const db = getSupabaseAdmin()
  if (!db) return { processed: false, reason: 'db_unavailable' }

  const { data: claimed, error: claimError } = await db.rpc('claim_mcp_url_intake', {
    p_stale_after_seconds: MCP_URL_ANALYSIS_STALE_SECONDS,
  })
  if (claimError) throw claimError
  const row = (Array.isArray(claimed) ? claimed[0] : claimed) as ClaimedUrlIntake | null
  if (!row?.id) return { processed: false, reason: 'empty' }
  return processClaimedMcpUrlIntake(db, row, signal, 'cron')
}

type WorkerDb = NonNullable<ReturnType<typeof getSupabaseAdmin>>

export type InlineUrlIntakeResult =
  | { processed: false; reason: 'db_unavailable' | 'not_found' | 'already_final' | 'in_progress' | 'lease_lost' }
  | Extract<UrlAnalysisWorkerResult, { processed: true }>

/**
 * Claim one intake by id for its owner (no cron, no RPC): pending, or processing with a stale
 * lease. Compare-and-set on (status, claimed_at) so two pollers never both claim it.
 */
export async function claimMcpUrlIntakeById(
  db: WorkerDb,
  input: { id: string; userId: string; nowMs?: number; staleAfterSeconds?: number }
): Promise<ClaimedUrlIntake | { skipped: Exclude<InlineUrlIntakeResult, { processed: true }>['reason'] }> {
  const nowMs = input.nowMs ?? Date.now()
  const staleMs = Math.max(60, input.staleAfterSeconds ?? MCP_URL_ANALYSIS_STALE_SECONDS) * 1000
  const { data: current, error } = await db
    .from('mcp_url_intakes')
    .select('id, user_id, business_id, source_url, status, attempt_count, claimed_at')
    .eq('id', input.id)
    .eq('user_id', input.userId)
    .maybeSingle()
  if (error) throw error
  if (!current) return { skipped: 'not_found' }
  const row = current as ClaimedUrlIntake & { claimed_at: string | null }
  if (row.status === 'ready' || row.status === 'failed') return { skipped: 'already_final' }
  if (row.status === 'processing' && row.claimed_at && nowMs - Date.parse(row.claimed_at) < staleMs) return { skipped: 'in_progress' }
  const claimedAt = new Date(nowMs).toISOString()
  let update = db
    .from('mcp_url_intakes')
    .update({
      status: 'processing',
      claimed_at: claimedAt,
      last_attempt_at: claimedAt,
      attempt_count: (Number(row.attempt_count) || 0) + 1,
      updated_at: claimedAt,
    })
    .eq('id', row.id)
    .eq('user_id', input.userId)
    .eq('status', row.status)
  update = row.claimed_at ? update.eq('claimed_at', row.claimed_at) : update.is('claimed_at', null)
  const { data: claimed, error: claimError } = await update.select('id, user_id, business_id, source_url, status, attempt_count, claimed_at')
  if (claimError) throw claimError
  const won = Array.isArray(claimed) ? claimed[0] : claimed
  if (!won) return { skipped: 'lease_lost' }
  return won as ClaimedUrlIntake
}

/** G3: analyze one intake now (owner-scoped), same pipeline and lease guards as the cron. */
export async function runMcpUrlIntakeInline(input: { id: string; userId: string; signal?: AbortSignal }): Promise<InlineUrlIntakeResult> {
  const db = getSupabaseAdmin()
  if (!db) return { processed: false, reason: 'db_unavailable' }
  const claim = await claimMcpUrlIntakeById(db, { id: input.id, userId: input.userId })
  if ('skipped' in claim) return { processed: false, reason: claim.skipped }
  return processClaimedMcpUrlIntake(db, claim, input.signal, 'mcp')
}

export async function processClaimedMcpUrlIntake(
  db: WorkerDb,
  row: ClaimedUrlIntake,
  signal: AbortSignal | undefined,
  usageSource: 'cron' | 'mcp'
): Promise<Extract<UrlAnalysisWorkerResult, { processed: true }>> {
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

    const kitMerge = buildFillOnlyBrandKitPatchWithReview(
      existingKit as Record<string, unknown> | null,
      analysis,
      (business.name as string) || 'Brand'
    )
    const kitPatch = kitMerge.patch
    if (kitMerge.reviewRequired) {
      analysis.warnings = [
        ...(analysis.warnings || []),
        ...kitMerge.warnings,
        'High-risk marketing claims held for human review — not auto-stamped into brand_voice/must_use_phrases.',
      ]
    }

    // Round-6 operator review, item G: re-check the lease right before
    // writing anything brand-kit-shaped. runSiteAnalysis above can take
    // long enough (no maxDuration kill on the container, §8 of the ops
    // doc) to run past the stale-reclaim window; a second runner may have
    // already reclaimed this same row and be mid-flight on it. Writing the
    // kit here without rechecking would race or duplicate that work, same
    // class of bug SD-06 already fixed for the final status update — this
    // closes the same gap one step earlier, before any write happens at
    // all (not just before the LAST write).
    if (signal?.aborted) {
      return { processed: true, intakeId: row.id, status: 'skipped', reason: 'deadline_exceeded' }
    }
    const { data: stillLeased, error: leaseCheckError } = await db
      .from('mcp_url_intakes')
      .select('id')
      .eq('id', row.id)
      .eq('status', 'processing')
      .eq('claimed_at', row.claimed_at)
      .maybeSingle()
    if (leaseCheckError) throw leaseCheckError
    if (!stillLeased) {
      return { processed: true, intakeId: row.id, status: 'skipped', reason: 'lease_lost' }
    }

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

    // Round-6 operator review, item G: honor the deadline right before the
    // final write too — the kit write above may itself have taken a while.
    if (signal?.aborted) {
      return { processed: true, intakeId: row.id, status: 'skipped', reason: 'deadline_exceeded' }
    }

    // Lease-guarded: only write if this row is still the one we claimed
    // (same id, still 'processing', same claimed_at). If a stale-reclaim by
    // another runner has since claimed it again, claimed_at will have
    // moved and this update matches zero rows instead of clobbering the
    // newer runner's in-flight work. `.select('id')` (round-6 operator
    // review, item G) makes that "zero rows" case observable instead of
    // silently falling through to logApiUsage as if the write had landed.
    const { data: doneRows, error: doneError } = await db
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
      .eq('status', 'processing')
      .eq('claimed_at', row.claimed_at)
      .select('id')
    if (doneError) throw doneError
    if (!doneRows || doneRows.length === 0) {
      return { processed: true, intakeId: row.id, status: 'skipped', reason: 'lease_lost' }
    }

    await logApiUsage({
      userId: row.user_id,
      feature: 'brand_extraction',
      model: SITE_ANALYSIS_MODEL,
      inputTokens: usage.input,
      outputTokens: usage.output,
      thinkingTokens: usage.thinking,
      success: true,
      source: usageSource,
      metadata: {
        action: 'mcp_guide_url_analysis',
        source: usageSource,
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
    // Same lease guard as the success path: only write if this is still
    // the row (and the claim) we started with. `.select('id')` (round-6
    // operator review, item G) surfaces a lease-lost zero-row result the
    // same way the success path does, instead of logging usage for a
    // write that never actually landed.
    const { data: failRows, error: failError } = await db
      .from('mcp_url_intakes')
      .update({
        status: terminal ? 'failed' : 'pending_analysis',
        error_message: message,
        claimed_at: null,
        completed_at: terminal ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'processing')
      .eq('claimed_at', row.claimed_at)
      .select('id')
    if (failError) console.error('failed to mark intake failure', failError)
    const leaseLostOnFailure = !failError && (!failRows || failRows.length === 0)

    if (!leaseLostOnFailure) {
      await logApiUsage({
        userId: row.user_id,
        feature: 'brand_extraction',
        model: SITE_ANALYSIS_MODEL,
        success: false,
        errorMessage: message,
        source: usageSource,
        metadata: {
          action: 'mcp_guide_url_analysis',
          source: usageSource,
          intakeId: row.id,
          businessId: row.business_id,
          attempt: attempts,
          terminal,
        },
      }).catch(() => undefined)
    }

    if (leaseLostOnFailure) {
      return { processed: true, intakeId: row.id, status: 'skipped', reason: 'lease_lost' }
    }

    if (!terminal) {
      // Leave as pending for next cron tick
      return { processed: true, intakeId: row.id, status: 'failed' }
    }
    return { processed: true, intakeId: row.id, status: 'failed' }
  }
}
