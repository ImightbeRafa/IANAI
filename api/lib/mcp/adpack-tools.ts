/**
 * MCP door for the Ad Pack engine (`adpack_*`). Thin wrappers over the same
 * `AdPackService` the web endpoint (`api/ad-pack.ts`) uses.
 *
 * - adpack_start / adpack_regenerate spend credits: in-chat approval
 *   (approval_required → confirm_execute → retry with approvalRequestId).
 *   The approval id doubles as the packId, so retries are idempotent.
 * - F1: the approval stores the exact plan (items × unitCost = total, as quotedCreditCost).
 *   Before running, the plan is recomputed; any difference in count or credits answers
 *   PLAN_CHANGED { approved, planned } and the approval is retired — never a silent downgrade.
 * - adpack_resize (free): re-render a finished ad into more ratios, renderer only.
 * - Background work goes through the MCP execute scheduler (waitUntil in
 *   api/mcp.ts); adpack_status also advances inline when no worker holds a
 *   lease, so a dropped background task never stalls the pack.
 */
import {
  ADPACK_BACKGROUND_BUDGET_MS,
  ADPACK_INLINE_BUDGET_MS,
  AdPackError,
  adPackPlanSummary,
  deepLinkForAdPack,
  isAdPackError,
  type AdPackService,
} from '../adpack/service.js'
import type { AdPackItemView, AdPackPlanSummary, AdPackStatusResponse } from '../adpack/http-types.js'
import {
  assertMcpApprovalReady,
  consumeMcpApprovalRequest,
  denyMcpApprovalRequest,
  replayMcpApprovalResult,
  storeMcpApprovalResult,
  type McpApprovalRecord,
  type McpApprovalStore,
} from './approval.js'
import { issueMcpChatApproval } from './approval-prompt.js'
import { scheduleMcpExecuteWork, withStatusMessage } from './execute-job.js'
import type { McpAuthUser } from './user-tools.js'
import { isAdPackMcpTool, type AdPackMcpToolName } from './adpack-tool-names.js'

export { ADPACK_MCP_TOOLS, isAdPackMcpTool, type AdPackMcpToolName } from './adpack-tool-names.js'

type Args = Record<string, unknown>

/** Errors keep the machine code (INSUFFICIENT_CREDITS, NOT_FOUND, …) for the host. */
function rethrow(err: unknown): never {
  if (isAdPackError(err)) {
    const e = new Error(err.message) as Error & { code: string; details?: unknown }
    e.code = err.code
    if (err.details) e.details = err.details
    throw e
  }
  throw err
}

function scheduleAdvance(service: AdPackService, userId: string, packId: string): void {
  scheduleMcpExecuteWork(async () => {
    await service.advance({ userId, packId, budgetMs: ADPACK_BACKGROUND_BUDGET_MS })
  })
}

/** Poll cadence suggested to the host while a pack runs (background work continues between polls). */
export const ADPACK_POLL_AFTER_MS = 20_000

/** Compact per-ad row (no copy blocks / DNA): captions live once, in `deliverable`. */
function compactItem(item: AdPackItemView) {
  return {
    itemId: item.id,
    index: item.index,
    status: item.status,
    format: item.format,
    headline: item.headline ?? null,
    // Stable public storage URLs (never signed / expiring) with explicit size + format (G4).
    renders: item.renders.map((r) => ({ ratio: r.ratio, imageUrl: r.imageUrl, width: r.width, height: r.height, format: 'png' as const })),
    charged: item.charged,
    savedToLibrary: Boolean(item.libraryImageIds?.length) && (item.libraryImageIds?.length ?? 0) >= item.renders.length,
    ...(item.forbiddenHits?.length ? { forbiddenHits: item.forbiddenHits } : {}),
    ...(item.error ? { error: item.error.slice(0, 160) } : {}),
  }
}

/** Approved plan from the approval row: total = quotedCreditCost, items = total / unitCost. */
export function approvedPlanFromRecord(record: Pick<McpApprovalRecord, 'quotedCreditCost'>, unitCost: number): AdPackPlanSummary | null {
  const total = record.quotedCreditCost
  if (typeof total !== 'number' || !Number.isFinite(total) || unitCost <= 0) return null
  return { items: Math.round(total / unitCost), unitCost, total, currency: 'credits' }
}

/**
 * F1: the plan that would run now differs from what the user approved. Nothing ran; the old
 * approval is retired (denied) so it can never run the other plan; the agent must ask again.
 */
async function planChanged(options: {
  approvalStore: McpApprovalStore
  user: McpAuthUser
  toolName: string
  approvalRequestId: string
  approved: AdPackPlanSummary
  planned: AdPackPlanSummary
  language?: 'es' | 'en'
}): Promise<Record<string, unknown>> {
  await denyMcpApprovalRequest(options.approvalStore, { approvalRequestId: options.approvalRequestId, userId: options.user.id }).catch(() => undefined)
  const { approved, planned } = options
  const es = options.language !== 'en'
  return {
    status: 'plan_changed',
    code: 'PLAN_CHANGED',
    toolName: options.toolName,
    approvalRequestId: options.approvalRequestId,
    approved,
    planned,
    chargedCredits: 0,
    message: es
      ? `No se ejecutó nada: se aprobaron ${approved.items} por ${approved.total} créditos y el plan actual es ${planned.items} por ${planned.total} créditos. Hace falta una aprobación nueva.`
      : `Nothing ran: ${approved.items} for ${approved.total} credits was approved but the plan is now ${planned.items} for ${planned.total} credits. A fresh approval is needed.`,
    nextStep: `Tell the user the plan changed (approved vs planned), then call ${options.toolName} again WITHOUT approvalRequestId to get a fresh approval.`,
  }
}

const samePlan = (a: AdPackPlanSummary, b: AdPackPlanSummary) => a.items === b.items && a.total === b.total

/** Same `summary` / `etaSeconds` / `failures` / `deliverable` as the web `status` (built once in the service). */
function statusPayload(status: AdPackStatusResponse) {
  const es = status.language !== 'en'
  const finished = Boolean(status.deliverable)
  const failedHint = status.failures?.length
    ? es
      ? ' Para los que fallaron, explicá el motivo y ofrecé reintentar con la llamada exacta de failures[].retry.call (cuesta 1 anuncio de créditos, requiere confirmación).'
      : ' For failed ads, explain the reason and offer to retry with the exact failures[].retry.call (costs one ad of credits, needs confirmation).'
    : ''
  const forbidden = (status.deliverable?.ads ?? []).filter((a) => a.forbiddenHits.length)
  const forbiddenHint = forbidden.length
    ? es
      ? ` Atención: ${forbidden.length} anuncio(s) contienen frases prohibidas de la marca (forbiddenHits); no los publiques sin corregirlos con adpack_edit_text.`
      : ` Warning: ${forbidden.length} ad(s) contain forbidden brand phrases (forbiddenHits); do not publish them before fixing with adpack_edit_text.`
    : ''
  return {
    packId: status.packId,
    status: status.status,
    summary: status.summary,
    progress: status.progress,
    quotedCredits: status.quotedCredits,
    chargedCredits: status.chargedCredits,
    moreWork: status.moreWork,
    ...(status.etaSeconds !== undefined ? { etaSeconds: status.etaSeconds } : {}),
    // While running: per-ad rows (finished ads already have links). Once finished: the deliverable replaces them.
    ...(finished ? {} : { items: status.items.map(compactItem) }),
    ...(status.failures?.length ? { failures: status.failures } : {}),
    ...(status.deliverable ? { deliverable: status.deliverable } : {}),
    ...(status.deepLink ? { deepLink: status.deepLink } : {}),
    statusMessage: status.summary,
    ...(status.moreWork
      ? {
        retryAfterMs: ADPACK_POLL_AFTER_MS,
        nextTool: 'adpack_status',
        instructionsForGrok: es
          ? `Decile al usuario el resumen ("${status.summary}"). Volvé a llamar adpack_status con este packId en ~20-30 s (no más seguido); el trabajo sigue en segundo plano. Pará cuando moreWork=false.${failedHint}`
          : `Tell the user the summary ("${status.summary}"). Call adpack_status again with this packId in ~20-30 s (not more often); work continues in the background. Stop when moreWork=false.${failedHint}`,
      }
      : finished
        ? {
          instructionsForGrok: es
            ? `Pack terminado. Presentá deliverable.ads como lista: por cada anuncio "N. titular" + sus files (url full-res por ratio: 4:5 feed, 9:16 historia; 1:1 si se pidió) + su caption. Ofrecé deliverable.captionsText para copiar todo junto. Otro formato (p. ej. 1:1) sale gratis con adpack_resize.${status.deepLink ? ` Todo quedó guardado en la carpeta de la marca: ${status.deepLink}` : ''} No vuelvas a llamar adpack_status.${failedHint}${forbiddenHint}`
            : `Pack finished. Present deliverable.ads as a list: for each ad "N. headline" + its files (full-res url per ratio: 4:5 feed, 9:16 story; 1:1 if requested) + its caption. Offer deliverable.captionsText to copy all captions at once. Another ratio (e.g. 1:1) is free with adpack_resize.${status.deepLink ? ` Everything is saved in the brand folder: ${status.deepLink}` : ''} Do not poll adpack_status again.${failedHint}${forbiddenHint}`,
        }
        : { instructionsForGrok: es ? 'No hay más trabajo en este pack. No vuelvas a llamar adpack_status.' : 'No more work on this pack. Do not poll adpack_status again.' }),
  }
}

async function approvedOrPrompt(options: {
  approvalStore: McpApprovalStore
  user: McpAuthUser
  toolName: 'adpack_start' | 'adpack_regenerate'
  input: Record<string, unknown>
  approvalRequestId: string
  /** The exact plan: items × unitCost = total (stored as quotedCreditCost). */
  plan: AdPackPlanSummary
  summaryEs: string
  summaryEn: string
  appOrigin?: string
  language?: 'es' | 'en'
}): Promise<{ prompt: Record<string, unknown> } | { replay: Record<string, unknown> } | { approved: AdPackPlanSummary | null }> {
  if (!options.approvalRequestId) {
    return {
      prompt: await issueMcpChatApproval({
        approvalStore: options.approvalStore,
        userId: options.user.id,
        toolName: options.toolName,
        input: options.input,
        quotedCreditCost: options.plan.total,
        items: options.plan.items,
        unitCost: options.plan.unitCost,
        appOrigin: options.appOrigin,
        summaryEs: options.summaryEs,
        summaryEn: options.summaryEn,
        language: options.language,
      }),
    }
  }
  const replay = await replayMcpApprovalResult(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    userId: options.user.id,
    toolName: options.toolName,
    input: options.input,
  })
  if (replay.ok && replay.result && typeof replay.result === 'object' && (replay.result as { status?: unknown }).status === 'completed') {
    return { replay: { ...(replay.result as Record<string, unknown>), replayed: true } }
  }
  const ready = await assertMcpApprovalReady(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    userId: options.user.id,
    toolName: options.toolName,
    input: options.input,
  })
  if (!ready.ok) throw new Error(ready.reason)
  return { approved: approvedPlanFromRecord(ready.record, options.plan.unitCost) }
}

async function finalize(options: {
  approvalStore: McpApprovalStore
  user: McpAuthUser
  toolName: string
  input: Record<string, unknown>
  approvalRequestId: string
  result: Record<string, unknown>
}): Promise<void> {
  await storeMcpApprovalResult(options.approvalStore, { approvalRequestId: options.approvalRequestId, result: options.result })
  const consumed = await consumeMcpApprovalRequest(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    userId: options.user.id,
    toolName: options.toolName,
    input: options.input,
  })
  if (!consumed.ok) throw new Error(consumed.reason)
}

function startBoundInput(args: Args): Record<string, unknown> {
  const bound: Record<string, unknown> = { dna: args.dna, offer: args.offer }
  for (const key of ['size', 'ratios', 'businessId', 'brandKitId', 'brandId', 'offerId', 'brief', 'angleIds', 'locale', 'register', 'forbiddenPhrases', 'forbiddenClaims'] as const) {
    if (args[key] !== undefined) bound[key] = args[key]
  }
  return bound
}

const linkedBrandId = (args: Args): string | undefined =>
  (typeof args.businessId === 'string' && args.businessId) || (typeof args.brandId === 'string' && args.brandId) || undefined

const usesSavedBrand = (args: Args) => args.dna === undefined && args.offer === undefined && typeof args.brandId === 'string' && args.brandId !== ''

export async function dispatchAdPackTool(options: {
  name: AdPackMcpToolName
  args: Args
  user: McpAuthUser
  service: AdPackService
  approvalStore?: McpApprovalStore | null
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const { name, args, user, service } = options
  const userId = user.id
  try {
    switch (name) {
      case 'adpack_dna_ingest': {
        const res = await service.ingestDna({
          userId,
          source: 'mcp',
          websiteUrl: args.websiteUrl as string | undefined,
          instagramUrl: args.instagramUrl as string | undefined,
          uploads: args.uploads as never,
          offerForm: args.offerForm as never,
          userFacts: args.userFacts as never,
          language: args.language as never,
        })
        return {
          ...res,
          nextStep: 'Show dna.facts and dna.gaps to the user; confirm or fix facts with adpack_dna_confirm (only confirmed facts become claims).',
        }
      }
      case 'adpack_from_brand': {
        const res = await service.dnaFromBrand({
          userId,
          source: 'mcp',
          brandId: args.brandId,
          offerId: args.offerId,
          brandKitId: args.brandKitId,
          refresh: args.refresh,
        })
        const missingPrice = res.gaps.includes('price')
        const startCall = `adpack_start { brandId: "${res.brandId}"${res.offerId ? `, offerId: "${res.offerId}"` : ''}, size, brief? }`
        return {
          ...res,
          missingPrice,
          nextTool: 'adpack_start',
          nextStep: missingPrice
            ? `BEFORE starting: tell the user the offer has no concrete price, so no ad will show a price${res.gaps.length > 1 ? `, and that these facts are also missing: ${res.gaps.filter((g) => g !== 'price').join(', ')}` : ''}. Ask if they want to add the price to the offer in AdvanceAI first or continue without it. Only then call ${startCall} (use these exact ids; no dna/offer needed).`
            : res.gaps.length
              ? `Tell the user which facts are missing (${res.gaps.join(', ')}) — ads will simply not mention them. Then call ${startCall} (use these exact ids; no dna/offer needed).`
              : `Ready. Call ${startCall} (use these exact ids; no dna/offer needed).`,
        }
      }
      case 'adpack_dna_confirm':
        return { ...(await service.confirmDna({ userId, dna: args.dna, edits: args.edits })) }
      case 'adpack_angles':
        return { ...(await service.planAngles({ userId, dna: args.dna, offer: args.offer, size: args.size, brandId: args.brandId, offerId: args.offerId, brandKitId: args.brandKitId })) }
      case 'adpack_quote':
        return { ...(await service.quote({ userId, size: args.size, dna: args.dna, offer: args.offer, brandId: args.brandId, offerId: args.offerId, brandKitId: args.brandKitId, angleIds: args.angleIds })) }
      case 'adpack_start': {
        if (!options.approvalStore) throw new Error('Approval store not configured')
        const input = startBoundInput(args)
        // Validate + quote before asking for approval (same parser as the web door).
        // Saved-brand path: build DNA + offer from the owner's saved data (owner-scoped → NOT_FOUND otherwise).
        const preview = usesSavedBrand(args)
          ? await service.dnaFromBrand({ userId, source: 'mcp', brandId: args.brandId, offerId: args.offerId, brandKitId: args.brandKitId })
          : null
        // The quote resolves the exact angles start will run (angleIds included): what the user approves is what runs.
        const quote = preview
          ? await service.quote({ userId, size: args.size, dna: preview.dna, offer: preview.offer, angleIds: args.angleIds })
          : await service.quote({ userId, size: args.size, dna: args.dna, offer: args.offer, angleIds: args.angleIds })
        const plan = adPackPlanSummary(quote.size)
        const target = preview ? ` — ${preview.offer.name} (${preview.dna.brandName})` : ''
        const approvalRequestId = typeof args.approvalRequestId === 'string' ? args.approvalRequestId : ''
        const ratios = Array.isArray(args.ratios) && args.ratios.length ? (args.ratios as string[]).join(' + ') : '4:5 + 9:16'
        const gate = await approvedOrPrompt({
          approvalStore: options.approvalStore,
          user,
          toolName: 'adpack_start',
          input,
          approvalRequestId,
          plan,
          summaryEs: `${quote.size} ${quote.size === 1 ? 'anuncio estático' : 'anuncios estáticos'}${target} · formatos ${ratios}`,
          summaryEn: `${quote.size} static ${quote.size === 1 ? 'ad' : 'ads'}${target} · ratios ${ratios}`,
          appOrigin: options.appOrigin,
          language: args.language === 'en' ? 'en' : undefined,
        })
        if ('prompt' in gate) {
          return {
            ...gate.prompt,
            quote,
            ...(preview ? { brandName: preview.dna.brandName, offerName: preview.offer.name, gaps: preview.gaps, notes: preview.notes } : {}),
          }
        }
        if ('replay' in gate) {
          const packId = String(gate.replay.packId || '')
          if (packId) scheduleAdvance(service, userId, packId)
          return gate.replay
        }
        if (gate.approved && !samePlan(gate.approved, plan)) {
          return planChanged({ approvalStore: options.approvalStore, user, toolName: 'adpack_start', approvalRequestId, approved: gate.approved, planned: plan })
        }
        let started: Awaited<ReturnType<AdPackService['startPack']>>
        try {
          started = await service.startPack({
            userId,
            dna: args.dna,
            offer: args.offer,
            brandId: args.brandId,
            offerId: args.offerId,
            brief: args.brief,
            size: args.size,
            angleIds: args.angleIds,
            ratios: args.ratios,
            businessId: args.businessId,
            brandKitId: args.brandKitId,
            locale: args.locale,
            register: args.register,
            forbiddenPhrases: args.forbiddenPhrases,
            forbiddenClaims: args.forbiddenClaims,
            source: 'mcp',
            packId: approvalRequestId,
            ...(gate.approved ? { approved: { items: gate.approved.items, total: gate.approved.total } } : {}),
          })
        } catch (err) {
          if (isAdPackError(err) && err.code === 'PLAN_CHANGED' && gate.approved) {
            return planChanged({ approvalStore: options.approvalStore, user, toolName: 'adpack_start', approvalRequestId, approved: gate.approved, planned: (err.details?.planned as AdPackPlanSummary) ?? plan })
          }
          throw err
        }
        const result = withStatusMessage({
          status: 'completed',
          jobId: approvalRequestId,
          approvalRequestId,
          packId: started.packId,
          packStatus: started.status,
          quote: started.quote,
          quotedCreditCost: started.quote.credits,
          // Credits are charged per finished ad while the pack runs.
          chargedCredits: 0,
          nextTool: 'adpack_status',
          estimatedSeconds: Math.max(60, Math.round(started.quote.size * 12)),
          ...(linkedBrandId(args) ? { deepLink: deepLinkForAdPack(options.appOrigin, linkedBrandId(args) as string, started.packId) } : {}),
          retryAfterMs: ADPACK_POLL_AFTER_MS,
          message: 'Pack started (~2 min per 10 ads). Tell the user it is running, then poll adpack_status with this packId every ~20-30 s until moreWork=false; credits are charged per finished ad. When done, present deliverable.ads (links + captions), captionsText and the brand-folder deepLink.',
        }, 'adpack_start')
        await finalize({ approvalStore: options.approvalStore, user, toolName: 'adpack_start', input, approvalRequestId, result })
        scheduleAdvance(service, userId, started.packId)
        return result
      }
      case 'adpack_status': {
        const status = await service.pollStatus({ userId, packId: args.packId, inlineBudgetMs: ADPACK_INLINE_BUDGET_MS, appOrigin: options.appOrigin, language: args.language })
        if (status.moreWork) scheduleAdvance(service, userId, status.packId)
        return statusPayload(status)
      }
      case 'adpack_edit_text': {
        try {
          const res = await service.editText({ userId, packId: args.packId, itemId: args.itemId, copy: args.copy })
          return { status: 'edited', item: compactItem(res.item), copy: res.item.copy ?? null, chargedCredits: 0 }
        } catch (err) {
          // E1: a rejection is an answer, not a crash — say exactly which field broke which rule.
          if (isAdPackError(err) && err.code === 'COPY_REJECTED') {
            return {
              status: 'rejected',
              code: 'COPY_REJECTED',
              message: err.message,
              issues: (err.details?.issues as unknown[]) ?? [],
              chargedCredits: 0,
              nextStep: 'Show each issue (field, rule, limit vs actual or the offending token) and propose a corrected text; nothing was changed.',
            }
          }
          throw err
        }
      }
      case 'adpack_resize': {
        const res = await service.resize({ userId, packId: args.packId, itemId: args.itemId, ratios: args.ratios })
        return {
          status: 'resized',
          item: compactItem(res.item),
          added: res.added,
          chargedCredits: 0,
          message: res.added.length
            ? `Rendered ${res.added.join(', ')} from the same scene and text (free, no model calls).`
            : 'The ad already has these ratios; nothing to render.',
        }
      }
      case 'adpack_regenerate': {
        if (!options.approvalStore) throw new Error('Approval store not configured')
        const input: Record<string, unknown> = { packId: args.packId, itemId: args.itemId, mode: args.mode ?? 'scene' }
        if (typeof args.packId !== 'string' || typeof args.itemId !== 'string') throw new AdPackError('BAD_INPUT', 'packId and itemId are required')
        // Ownership check before issuing an approval.
        await service.getStatus({ userId, packId: args.packId })
        const plan = adPackPlanSummary(1)
        const approvalRequestId = typeof args.approvalRequestId === 'string' ? args.approvalRequestId : ''
        const gate = await approvedOrPrompt({
          approvalStore: options.approvalStore,
          user,
          toolName: 'adpack_regenerate',
          input,
          approvalRequestId,
          plan,
          summaryEs: 'Regenerar un anuncio del pack',
          summaryEn: 'Regenerate one ad in the pack',
          appOrigin: options.appOrigin,
        })
        if ('prompt' in gate) return gate.prompt
        if ('replay' in gate) return gate.replay
        if (gate.approved && !samePlan(gate.approved, plan)) {
          return planChanged({ approvalStore: options.approvalStore, user, toolName: 'adpack_regenerate', approvalRequestId, approved: gate.approved, planned: plan })
        }
        const regen = await service.regenerate({ userId, packId: args.packId, itemId: args.itemId, mode: input.mode })
        const result = withStatusMessage({
          status: 'completed',
          jobId: approvalRequestId,
          approvalRequestId,
          packId: args.packId,
          item: compactItem(regen.item),
          quotedCreditCost: regen.quote.credits,
          chargedCredits: 0,
          nextTool: 'adpack_status',
          message: 'Ad queued for regeneration. Poll adpack_status; credits are charged when the new version finishes.',
        }, 'adpack_regenerate')
        await finalize({ approvalStore: options.approvalStore, user, toolName: 'adpack_regenerate', input, approvalRequestId, result })
        scheduleAdvance(service, userId, args.packId)
        return result
      }
    }
  } catch (err) {
    rethrow(err)
  }
}
