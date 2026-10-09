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
  AdPackError,
  adPackPlanSummary,
  deepLinkForAdPack,
  retryAfterSecondsFor,
  isAdPackError,
  type AdPackService,
} from '../adpack/service.js'
import type { AdPackItemView, AdPackPlanSummary, AdPackStatusResponse } from '../adpack/http-types.js'
import {
  adPackApprovalTtlMs,
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
import type { McpAuthUser, McpDbClient } from './user-tools.js'
import { isAdPackMcpTool, type AdPackMcpToolName } from './adpack-tool-names.js'
import type { BrandDna } from '../adpack/types.js'
import { mcpUpdateOffer, type McpOfferStore } from './offer-tools.js'
import { mcpUpdateBrandKit, resolveMcpBrandKit, type McpBrandKitStore } from './brand-kit-tools.js'
import type { RehostFn } from './asset-rehost.js'

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

/**
 * #14: kick the self-continuing background loop (slice after slice, no poll needed). A second kick
 * while this process already runs the pack's loop is a no-op; leases keep other workers apart.
 */
function scheduleAdvance(service: AdPackService, userId: string, packId: string): void {
  service.kickAdvance({ userId, packId, schedule: scheduleMcpExecuteWork })
}

/** Default poll cadence suggested to the host while a pack runs (background work continues between polls). */
export const ADPACK_POLL_AFTER_MS = 20_000

/** #13: the pack is still working unless it reached a terminal state. */
const TERMINAL_PACK_STATUSES = new Set(['done', 'partial', 'failed', 'cancelled'])
export function jobStatusForPack(packStatus: string): 'running' | 'completed' {
  return TERMINAL_PACK_STATUSES.has(packStatus) ? 'completed' : 'running'
}

/** Compact per-ad row (no copy blocks / DNA): captions live once, in `deliverable`. */
function compactItem(item: AdPackItemView) {
  return {
    itemId: item.id,
    index: item.index,
    status: item.status,
    format: item.format,
    headline: item.headline ?? null,
    angleId: item.angleId ?? null,
    category: item.category ?? null,
    hookType: item.hookType,
    rationale: item.rationale ?? null,
    layoutFamily: item.layoutFamily ?? null,
    ...(item.variation !== undefined ? { variation: item.variation } : {}),
    // Stable public storage URLs (never signed / expiring) with explicit size + format (G4).
    renders: item.renders.map((r) => ({ ratio: r.ratio, imageUrl: r.imageUrl, ...(r.jpgUrl ? { jpgUrl: r.jpgUrl } : {}), width: r.width, height: r.height, format: 'png' as const })),
    charged: item.charged,
    ...(item.autoRetries ? { autoRetries: item.autoRetries } : {}),
    ...(item.fontsUsed ? { fontsUsed: item.fontsUsed } : {}),
    savedToLibrary: Boolean(item.libraryImageIds?.length) && (item.libraryImageIds?.length ?? 0) >= item.renders.length,
    ...(item.forbiddenHits?.length ? { forbiddenHits: item.forbiddenHits } : {}),
    ...(item.fidelity ? { fidelity: item.fidelity } : {}),
    // P0 #3: ratios not delivered (product changed) — regenerate one free with adpack_regenerate { ratio }.
    ...(item.rejectedRatios?.length ? { rejectedRatios: item.rejectedRatios } : {}),
    // A free ratio regeneration of this ad still running in the background.
    ...(item.regenerating ? { regenerating: item.regenerating } : {}),
    // P1 #8: the real photo this ad used (+ parts).
    ...(item.photo ? { photo: item.photo } : {}),
    ...(item.parts?.length ? { parts: item.parts } : {}),
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
  /** Why (e.g. preview_changed / preview_expired when the previewed copy no longer matches). */
  reason?: string
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
    ...(options.reason ? { reason: options.reason } : {}),
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
      ? ' Para los que fallaron: Advance ya los reintentó solo dentro de esta aprobación (failures[].attempts, sin cobrar). Explicá el motivo y ofrecé reintentar con la llamada exacta de failures[].retry.call (cuesta 1 anuncio de créditos, requiere confirmación).'
      : ' For failed ads: Advance already retried them inside this approval (failures[].attempts, not charged). Explain the reason and offer to retry with the exact failures[].retry.call (costs one ad of credits, needs confirmation).'
    : ''
  const forbidden = (status.deliverable?.ads ?? []).filter((a) => a.forbiddenHits.length)
  const forbiddenHint = forbidden.length
    ? es
      ? ` Atención: ${forbidden.length} anuncio(s) contienen frases prohibidas de la marca (forbiddenHits); no los publiques sin corregirlos con adpack_edit_text.`
      : ` Warning: ${forbidden.length} ad(s) contain forbidden brand phrases (forbiddenHits); do not publish them before fixing with adpack_edit_text.`
    : ''
  // Free ratio regenerations still running (the pack itself may be finished): one more status read later.
  const regen = status.regenerating?.length ? status.regenerating : null
  const regenHint = regen
    ? es
      ? ` Se está regenerando gratis ${regen.map((r) => `el ${r.ratio} del anuncio ${r.index}`).join(', ')}: volvé a llamar adpack_status en ~${status.retryAfterSeconds ?? 30} s para el archivo nuevo.`
      : ` Still regenerating (free) ${regen.map((r) => `${r.ratio} of ad ${r.index}`).join(', ')}: call adpack_status again in ~${status.retryAfterSeconds ?? 30} s for the new file.`
    : ''
  return {
    packId: status.packId,
    status: status.status,
    summary: status.summary,
    productFidelity: status.productFidelity,
    progress: status.progress,
    quotedCredits: status.quotedCredits,
    chargedCredits: status.chargedCredits,
    moreWork: status.moreWork,
    ...(status.etaSeconds !== undefined ? { etaSeconds: status.etaSeconds } : {}),
    ...(status.retryAfterSeconds !== undefined ? { retryAfterSeconds: status.retryAfterSeconds } : {}),
    ...(status.backgroundKicked ? { backgroundKicked: true } : {}),
    ...(status.regenerating?.length ? { regenerating: status.regenerating } : {}),
    // While running: per-ad rows (finished ads already have links). Once finished: the deliverable replaces them.
    ...(finished ? {} : { items: status.items.map(compactItem) }),
    ...(status.failures?.length ? { failures: status.failures } : {}),
    ...(status.deliverable ? { deliverable: status.deliverable } : {}),
    ...(status.deepLink ? { deepLink: status.deepLink } : {}),
    statusMessage: status.summary,
    ...(status.moreWork
      ? {
        retryAfterMs: (status.retryAfterSeconds ?? ADPACK_POLL_AFTER_MS / 1000) * 1000,
        nextTool: 'adpack_status',
        instructionsForGrok: es
          ? `Decile al usuario el resumen ("${status.summary}"). El pack avanza solo en segundo plano (no hace falta consultar para que avance). Si querés novedades, volvé a llamar adpack_status con este packId en ~${status.retryAfterSeconds ?? 20} s (no más seguido). Pará cuando moreWork=false.${failedHint}`
          : `Tell the user the summary ("${status.summary}"). The pack advances on its own in the background (polling is not needed for progress). For an update, call adpack_status again with this packId in ~${status.retryAfterSeconds ?? 20} s (not more often). Stop when moreWork=false.${failedHint}`,
      }
      : finished && regen
        ? {
          retryAfterMs: (status.retryAfterSeconds ?? 30) * 1000,
          nextTool: 'adpack_status',
          instructionsForGrok: es
            ? `Pack terminado: presentá deliverable.ads (files + caption por anuncio).${regenHint}${failedHint}${forbiddenHint}`
            : `Pack finished: present deliverable.ads (files + caption per ad).${regenHint}${failedHint}${forbiddenHint}`,
        }
      : finished
        ? {
          instructionsForGrok: es
            ? `Pack terminado. Presentá deliverable.ads como lista: por cada anuncio "N. titular" + ángulo (category, hookType) y por qué (rationale) + sus files (url PNG full-res y jpgUrl por ratio: 4:5 feed, 9:16 historia; 1:1 si se pidió) + su caption. Ofrecé deliverable.captionsText para copiar todo junto. Otro formato (p. ej. 1:1) sale gratis con adpack_resize.${status.deepLink ? ` Todo quedó guardado en la carpeta de la marca: ${status.deepLink}` : ''} No vuelvas a llamar adpack_status.${failedHint}${forbiddenHint}`
            : `Pack finished. Present deliverable.ads as a list: for each ad "N. headline" + angle (category, hookType) and why (rationale) + its files (full-res PNG url and jpgUrl per ratio: 4:5 feed, 9:16 story; 1:1 if requested) + its caption. Offer deliverable.captionsText to copy all captions at once. Another ratio (e.g. 1:1) is free with adpack_resize.${status.deepLink ? ` Everything is saved in the brand folder: ${status.deepLink}` : ''} Do not poll adpack_status again.${failedHint}${forbiddenHint}`,
        }
        : { instructionsForGrok: es ? 'No hay más trabajo en este pack. No vuelvas a llamar adpack_status.' : 'No more work on this pack. Do not poll adpack_status again.' }),
  }
}

/** A replayed start/regenerate answer with the pack's CURRENT state (running until terminal). */
function withLivePackStatus(stored: Record<string, unknown>, status: AdPackStatusResponse | null, toolName: string): Record<string, unknown> {
  if (!status) return stored
  const job = jobStatusForPack(status.status)
  return withStatusMessage({
    ...stored,
    status: job,
    packStatus: status.status,
    moreWork: status.moreWork,
    chargedCredits: status.chargedCredits,
    ...(status.etaSeconds !== undefined ? { etaSeconds: status.etaSeconds } : {}),
    ...(status.retryAfterSeconds !== undefined ? { pollAfterSeconds: status.retryAfterSeconds, retryAfterMs: status.retryAfterSeconds * 1000 } : {}),
    summary: status.summary,
    statusMessage: undefined,
    ...(status.deliverable ? { deliverable: status.deliverable } : {}),
  }, toolName)
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
  /** Extra fields on the approval payload (e.g. the per-ad plan). */
  extra?: Record<string, unknown>
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
        // #15: 24 h (configurable) and an identical re-quote reuses the open approval.
        ttlMs: adPackApprovalTtlMs(),
        reuseIdentical: true,
        ...(options.extra ? { extra: options.extra } : {}),
      }),
    }
  }
  const replay = await replayMcpApprovalResult(options.approvalStore, {
    approvalRequestId: options.approvalRequestId,
    userId: options.user.id,
    toolName: options.toolName,
    input: options.input,
  })
  const replayedStatus = replay.ok && replay.result && typeof replay.result === 'object' ? (replay.result as { status?: unknown }).status : undefined
  if (replay.ok && (replayedStatus === 'completed' || replayedStatus === 'running')) {
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

/** Start-shaped arguments shared by adpack_start, the approval quote and adpack_preview (one plan). */
function startLikeArgs(args: Args) {
  return {
    dna: args.dna,
    offer: args.offer,
    brandId: args.brandId,
    offerId: args.offerId,
    brief: args.brief,
    size: args.size,
    angleIds: args.angleIds,
    angles: args.angles,
    variations: args.variations,
    creativeFreedom: args.creativeFreedom,
    layoutFamily: args.layoutFamily,
    styleDnaId: args.styleDnaId,
    useStyleDna: args.useStyleDna,
    ratios: args.ratios,
    businessId: args.businessId,
    brandKitId: args.brandKitId,
    productImageIds: args.productImageIds,
    productImageIdsByAd: args.productImageIdsByAd,
    photoPerAd: args.photoPerAd,
    heroRequired: args.heroRequired,
    locale: args.locale,
    register: args.register,
    forbiddenPhrases: args.forbiddenPhrases,
    forbiddenClaims: args.forbiddenClaims,
    productFidelity: args.productFidelity,
    relight: args.relight,
    allowedProps: args.allowedProps,
    immutableAttributes: args.immutableAttributes,
    mustAppear: args.mustAppear,
    previewId: args.previewId,
  }
}

function startBoundInput(args: Args): Record<string, unknown> {
  const bound: Record<string, unknown> = { dna: args.dna, offer: args.offer }
  for (const key of [
    'size', 'ratios', 'businessId', 'brandKitId', 'brandId', 'offerId', 'brief', 'angleIds',
    'angles', 'variations', 'creativeFreedom', 'layoutFamily', 'styleDnaId', 'useStyleDna',
    'productImageIds', 'productImageIdsByAd', 'photoPerAd', 'heroRequired', 'saveToOffer', 'offerPatch', 'saveToBrandKit', 'brandKitPatch',
    'locale', 'register', 'forbiddenPhrases', 'forbiddenClaims',
    'productFidelity', 'relight', 'allowedProps', 'immutableAttributes',
    // P0 #2d / #5: the approval is bound to the previewed copy and the required-facts override.
    'mustAppear', 'previewId',
  ] as const) {
    if (args[key] !== undefined) bound[key] = args[key]
  }
  return bound
}

const linkedBrandId = (args: Args): string | undefined =>
  (typeof args.businessId === 'string' && args.businessId) || (typeof args.brandId === 'string' && args.brandId) || undefined

const usesSavedBrand = (args: Args) => args.dna === undefined && args.offer === undefined && typeof args.brandId === 'string' && args.brandId !== ''

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/** G2: compact DNA view (the full DNA is only echoed with includeDna: true). */
export function dnaSummary(dna: BrandDna): Record<string, unknown> {
  return {
    brandName: dna.brandName,
    category: dna.category,
    language: dna.language,
    register: dna.register,
    ...(dna.oneLiner ? { oneLiner: dna.oneLiner } : {}),
    ...(dna.voice ? { voice: dna.voice } : {}),
    audience: dna.audience ?? [],
    confirmedFacts: dna.facts.filter((f) => f.confirmed).map((f) => ({ key: f.key, value: f.value })),
    unconfirmedFactCount: dna.facts.filter((f) => !f.confirmed).length,
    forbiddenPhraseCount: dna.forbiddenPhrases?.length ?? 0,
    productPhotoCount: dna.productImageUrls?.length ?? 0,
    visual: dna.visual,
  }
}

function badInput(message: string): Error {
  return Object.assign(new Error(message), { code: 'BAD_INPUT' })
}

/**
 * B2: persist corrections typed during a pack conversation into the saved offer / brand kit
 * (same owner-scoped writers as update_offer / update_brand_kit), BEFORE the DNA is rebuilt.
 */
async function persistCorrections(options: {
  args: Args
  user: McpAuthUser
  db?: McpDbClient | null
  offerStore?: McpOfferStore | null
  brandKitStore?: McpBrandKitStore | null
  rehost?: RehostFn | null
}): Promise<Record<string, unknown> | undefined> {
  const { args, user } = options
  const wantsOffer = args.saveToOffer === true
  const wantsKit = args.saveToBrandKit === true
  if (args.offerPatch !== undefined && !wantsOffer) throw badInput('offerPatch is only applied with saveToOffer: true (packs are built from the saved offer)')
  if (args.brandKitPatch !== undefined && !wantsKit) throw badInput('brandKitPatch is only applied with saveToBrandKit: true (packs are built from the saved brand kit)')
  if (!wantsOffer && !wantsKit) return undefined
  const brandId = typeof args.brandId === 'string' ? args.brandId : ''
  if (!brandId || !usesSavedBrand(args)) throw badInput('saveToOffer / saveToBrandKit need the saved-brand path: brandId (+ offerId), not dna/offer')
  const saved: Record<string, unknown> = {}
  if (wantsOffer) {
    if (!isObj(args.offerPatch) || !Object.keys(args.offerPatch).length) throw badInput('saveToOffer needs offerPatch { …fields as in update_offer }')
    const offerId = typeof args.offerId === 'string' ? args.offerId : ''
    if (!offerId) throw badInput('saveToOffer needs offerId (create the offer first with create_offer)')
    if (!options.offerStore || !options.db) throw new Error('Offer store not configured')
    const { brandId: _b, offerId: _o, ...patch } = args.offerPatch
    void _b
    void _o
    const res = await mcpUpdateOffer({ db: options.db, store: options.offerStore, user, args: { ...patch, brandId, offerId } })
    saved.offer = {
      status: res.status,
      offerId,
      adProfileSaved: res.adProfileSaved,
      ...(res.ignoredPlaceholders ? { ignoredPlaceholders: res.ignoredPlaceholders } : {}),
      ...(res.warnings ? { warnings: res.warnings } : {}),
    }
  }
  if (wantsKit) {
    if (!isObj(args.brandKitPatch) || !Object.keys(args.brandKitPatch).length) throw badInput('saveToBrandKit needs brandKitPatch { …fields as in update_brand_kit }')
    if (!options.brandKitStore) throw new Error('Brand kit store not configured')
    let kitId = typeof args.brandKitId === 'string' ? args.brandKitId : ''
    if (!kitId) {
      const resolved = await resolveMcpBrandKit({ store: options.brandKitStore, userId: user.id, brandId })
      kitId = resolved.brandKit?.id ?? ''
    }
    if (!kitId) throw badInput('This brand has no primary brand kit: create_brand_kit first')
    const { brandId: _b, kitId: _k, ...patch } = args.brandKitPatch
    void _b
    void _k
    const res = await mcpUpdateBrandKit({ store: options.brandKitStore, user, args: { ...patch, brandId, kitId }, rehost: options.rehost })
    saved.brandKit = {
      status: res.status,
      brandKitId: kitId,
      ...(res.ignoredPlaceholders ? { ignoredPlaceholders: res.ignoredPlaceholders } : {}),
      ...(res.warnings ? { warnings: res.warnings } : {}),
    }
  }
  return saved
}

export async function dispatchAdPackTool(options: {
  name: AdPackMcpToolName
  args: Args
  user: McpAuthUser
  service: AdPackService
  approvalStore?: McpApprovalStore | null
  appOrigin?: string
  /** B2 saveToOffer / saveToBrandKit writers (owner-scoped). */
  db?: McpDbClient | null
  offerStore?: McpOfferStore | null
  brandKitStore?: McpBrandKitStore | null
  rehost?: RehostFn | null
}): Promise<Record<string, unknown>> {
  const { name, args, user, service } = options
  const persist = () => persistCorrections({ args, user, db: options.db, offerStore: options.offerStore, brandKitStore: options.brandKitStore, rehost: options.rehost })
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
        const saved = await persist()
        const full = await service.dnaFromBrand({
          userId,
          source: 'mcp',
          brandId: args.brandId,
          offerId: args.offerId,
          brandKitId: args.brandKitId,
          productImageIds: args.productImageIds,
          productImageIdsByAd: args.productImageIdsByAd,
          photoPerAd: args.photoPerAd,
          refresh: args.refresh,
          useStyleDna: args.useStyleDna,
        })
        // G2: the server resolves the profile by id; the full DNA (~3 KB) is only echoed on request.
        const { dna, ...rest } = full
        const res = { ...rest, ...(args.includeDna === true ? { dna } : { dnaSummary: dnaSummary(dna) }), ...(saved ? { saved } : {}) }
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
      case 'adpack_angles': {
        const res = await service.planAngles({ userId, dna: args.dna, offer: args.offer, size: args.size, brief: args.brief, brandId: args.brandId, offerId: args.offerId, brandKitId: args.brandKitId, productImageIds: args.productImageIds, productImageIdsByAd: args.productImageIdsByAd, useStyleDna: args.useStyleDna })
        return {
          ...res,
          nextStep: 'Each angle has id (stable catalog id <category>-<hookType>-<format>), category, hookType, format and rationale. Pass the ids you want as adpack_start {angleIds}; ids from guide_bulk_angles (adpackAngleId) and legacy aNN-… ids work too.',
        }
      }
      case 'adpack_quote':
        return {
          ...(await service.quote({ userId, ...startLikeArgs(args), source: 'mcp', withPlan: true })),
        }
      case 'adpack_start': {
        if (!options.approvalStore) throw new Error('Approval store not configured')
        const input = startBoundInput(args)
        // Validate + quote before asking for approval (same parser as the web door).
        // Saved-brand path: build DNA + offer from the owner's saved data (owner-scoped → NOT_FOUND otherwise).
        const approvalRequestId = typeof args.approvalRequestId === 'string' ? args.approvalRequestId : ''
        if (!approvalRequestId && args.previewId !== undefined && !(await service.getPreview({ userId, previewId: args.previewId }))) {
          throw new AdPackError('BAD_INPUT', 'previewId not found or expired (previews last 24 h): run adpack_preview again with the same arguments')
        }
        // B2: corrections are written once, on the first call (the approved retry repeats the same arguments).
        const saved = approvalRequestId ? undefined : await persist()
        const preview = usesSavedBrand(args)
          ? await service.dnaFromBrand({ userId, source: 'mcp', brandId: args.brandId, offerId: args.offerId, brandKitId: args.brandKitId, productImageIds: args.productImageIds, productImageIdsByAd: args.productImageIdsByAd, photoPerAd: args.photoPerAd, useStyleDna: args.useStyleDna })
          : null
        // The quote resolves the exact angles start will run (angleIds included): what the user approves is what runs.
        // Relighting (exact mode, 'auto' or 'ai') is included and free: it never changes the price.
        // #15: ONE plan — the quote runs the same prepareRun as start / adpack_preview (saved brand, Style
        // DNA, hero guarantee, per-ad photos, handheld substitution, ratios) and returns plan[] + planHash.
        const quote = await service.quote({ userId, ...startLikeArgs(args), source: 'mcp', withPlan: true })
        // The approval is bound to the arguments (previewId included) AND the per-ad plan (planHash).
        let approvedPlanHash: string | undefined
        if (approvalRequestId) {
          // The approved call binds to the plan stored on the approval (so the hash check is about the args);
          // a different plan now is reported as PLAN_CHANGED below, never a bare input mismatch.
          const record = await options.approvalStore.findById(approvalRequestId).catch(() => null)
          const stored = record?.inputJson && typeof record.inputJson === 'object' ? (record.inputJson as Record<string, unknown>).planHash : undefined
          approvedPlanHash = typeof stored === 'string' ? stored : undefined
          if (approvedPlanHash) input.planHash = approvedPlanHash
        } else if (quote.planHash) {
          input.planHash = quote.planHash
        }
        const plan = adPackPlanSummary(quote.size)
        const target = preview ? ` — ${preview.offer.name} (${preview.dna.brandName})` : ''
        const vary = quote.variations && quote.variations > 1 ? { es: ` (${quote.angles} ángulos × ${quote.variations} variaciones)`, en: ` (${quote.angles} angles × ${quote.variations} variations)` } : { es: '', en: '' }
        const ratios = Array.isArray(args.ratios) && args.ratios.length ? (args.ratios as string[]).join(' + ') : '4:5 + 9:16'
        const gate = await approvedOrPrompt({
          approvalStore: options.approvalStore,
          user,
          toolName: 'adpack_start',
          input,
          approvalRequestId,
          plan,
          summaryEs: `${quote.size} ${quote.size === 1 ? 'anuncio estático' : 'anuncios estáticos'}${vary.es}${target} · formatos ${ratios}`,
          summaryEn: `${quote.size} static ${quote.size === 1 ? 'ad' : 'ads'}${vary.en}${target} · ratios ${ratios}`,
          appOrigin: options.appOrigin,
          language: args.language === 'en' ? 'en' : undefined,
          ...(quote.plan?.length ? { extra: { plan: quote.plan } } : {}),
        })
        if ('prompt' in gate) {
          return {
            ...gate.prompt,
            quote,
            ...(quote.plan?.length
              ? { planNote: 'plan[] = what each ad will be (angle, why, layout family, planned photo, format, ratios). Show it with the cost; the approved run follows it. The photo is the planned pick; a blurry/unusable photo is swapped for the next best one at run time.' }
              : {}),
            ...(preview ? { brandName: preview.dna.brandName, offerName: preview.offer.name, gaps: preview.gaps, notes: preview.notes } : {}),
            ...(saved ? { saved } : {}),
            ...(args.includeDna === true && preview ? { dna: preview.dna } : {}),
          }
        }
        if ('replay' in gate) {
          const packId = String(gate.replay.packId || '')
          if (!packId) return gate.replay
          scheduleAdvance(service, userId, packId)
          return withLivePackStatus(gate.replay, await service.getStatus({ userId, packId, appOrigin: options.appOrigin }).catch(() => null), 'adpack_start')
        }
        if (gate.approved && !samePlan(gate.approved, plan)) {
          return planChanged({ approvalStore: options.approvalStore, user, toolName: 'adpack_start', approvalRequestId, approved: gate.approved, planned: plan })
        }
        if (gate.approved && approvedPlanHash && quote.planHash && approvedPlanHash !== quote.planHash) {
          // Same price, different per-ad plan (angle / layout / photo / format / ratios): fresh approval.
          return { ...(await planChanged({ approvalStore: options.approvalStore, user, toolName: 'adpack_start', approvalRequestId, approved: gate.approved, planned: plan, reason: 'plan_changed' })), ...(quote.plan ? { plan: quote.plan } : {}) }
        }
        let started: Awaited<ReturnType<AdPackService['startPack']>>
        try {
          started = await service.startPack({
            userId,
            ...startLikeArgs(args),
            source: 'mcp',
            packId: approvalRequestId,
            // F1: the service recomputes the plan and refuses (PLAN_CHANGED, nothing created) on any difference.
            ...(gate.approved ? { approved: { items: gate.approved.items, total: gate.approved.total } } : {}),
            ...(approvedPlanHash ? { approvedPlanHash } : {}),
            expectedAds: quote.size,
          })
        } catch (err) {
          if (isAdPackError(err) && err.code === 'PLAN_CHANGED' && gate.approved) {
            const reason = typeof err.details?.reason === 'string' ? err.details.reason : undefined
            return planChanged({ approvalStore: options.approvalStore, user, toolName: 'adpack_start', approvalRequestId, approved: gate.approved, planned: (err.details?.planned as AdPackPlanSummary) ?? plan, ...(reason ? { reason } : {}) })
          }
          throw err
        }
        const etaSeconds = started.etaSeconds ?? Math.max(60, Math.round(started.quote.size * 12))
        const pollAfterSeconds = retryAfterSecondsFor(etaSeconds)
        // #13: work has begun, nothing is finished — never "completed" until the pack is terminal.
        const result = withStatusMessage({
          status: jobStatusForPack(started.status),
          jobId: approvalRequestId,
          approvalRequestId,
          packId: started.packId,
          packStatus: started.status,
          moreWork: jobStatusForPack(started.status) === 'running',
          etaSeconds,
          pollAfterSeconds,
          quote: started.quote,
          quotedCreditCost: started.quote.credits,
          ...(started.creativeFreedom ? { creativeFreedom: started.creativeFreedom } : {}),
          ...(started.angles ? { plan: started.angles } : {}),
          ...(started.styleProfile ? { styleProfile: started.styleProfile } : {}),
          ...(started.notes?.length ? { notes: started.notes } : {}),
          ...(started.previewId ? { previewId: started.previewId, previewAds: started.previewAds } : {}),
          // Credits are charged per finished ad while the pack runs.
          chargedCredits: 0,
          nextTool: 'adpack_status',
          estimatedSeconds: etaSeconds,
          ...(linkedBrandId(args) ? { deepLink: deepLinkForAdPack(options.appOrigin, linkedBrandId(args) as string, started.packId) } : {}),
          retryAfterMs: pollAfterSeconds * 1000,
          message: `Pack running in the background (~${etaSeconds} s). Tell the user it is RUNNING (not finished). It advances without polling; check adpack_status with this packId in ~${pollAfterSeconds} s (not more often) until moreWork=false. Credits are charged per finished ad only. When done, present deliverable.ads (links + captions), captionsText and the brand-folder deepLink.`,
        }, 'adpack_start')
        await finalize({ approvalStore: options.approvalStore, user, toolName: 'adpack_start', input, approvalRequestId, result })
        scheduleAdvance(service, userId, started.packId)
        return result
      }
      case 'adpack_status': {
        // #14: cheap read; at most kicks a background loop when nobody holds a lease.
        const status = await service.pollStatus({ userId, packId: args.packId, appOrigin: options.appOrigin, language: args.language, schedule: scheduleMcpExecuteWork })
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
      case 'adpack_preview': {
        // FREE dry run (P0 #2d): same arguments as create_ads / adpack_start; model text only, no images, no credits.
        const saved = await persist()
        const size = args.size !== undefined ? args.size : args.count
        const res = await service.previewPack({ userId, ...startLikeArgs(args), size, source: 'mcp' })
        const es = args.language !== 'en'
        const failing = res.ads.filter((a) => !a.check.ok).map((a) => a.index)
        return {
          status: 'preview',
          ...res,
          ...(saved ? { saved } : {}),
          nextTool: 'create_ads',
          instructionsForGrok: es
            ? `Mostrá al usuario cada anuncio: ángulo + por qué (rationale), layout, foto planeada y el texto (headline, subline, bullets, offerLine, cta, caption).${failing.length ? ` Los anuncios ${failing.join(', ')} no pasan las reglas (check.issues: frase, tokens y dato más cercano); corregí la oferta (update_offer) o volvé a previsualizar.` : ''} Si lo aprueba, llamá create_ads (o adpack_start) con LOS MISMOS argumentos y previewId "${res.previewId}": ese texto es el que se entrega. Gratis, sin créditos.`
            : `Show the user each ad: angle + why (rationale), layout, planned photo and the copy (headline, subline, bullets, offerLine, cta, caption).${failing.length ? ` Ads ${failing.join(', ')} do not pass the rules (check.issues: sentence, tokens and nearest fact); fix the offer (update_offer) or preview again.` : ''} If they approve, call create_ads (or adpack_start) with THE SAME arguments plus previewId "${res.previewId}": that copy is what ships. Free, no credits.`,
        }
      }
      case 'adpack_resize': {
        const res = await service.resize({ userId, packId: args.packId, itemId: args.itemId, ratios: args.ratios })
        return {
          status: 'resized',
          item: compactItem(res.item),
          added: res.added,
          chargedCredits: 0,
          ...(res.method ? { method: res.method } : {}),
          ...(res.rejected?.length ? { rejected: res.rejected } : {}),
          message: res.added.length
            ? res.method === 'composite'
              ? `Rendered ${res.added.join(', ')} from the same real-product cut-out, background and text (free, no model calls; fidelity re-checked).`
              : `Rendered ${res.added.join(', ')} from the same scene and text (free, no model calls).`
            : res.rejected?.length
              ? `Nothing delivered: the product did not stay identical in ${res.rejected.map((r) => r.ratio).join(', ')}.`
              : 'The ad already has these ratios; nothing to render.',
        }
      }
      case 'adpack_regenerate': {
        if (args.ratio !== undefined && args.ratio !== null) {
          // P0 #3: one ratio of a delivered ad — free (charged once with the ad), no approval needed.
          // #14: the re-plate (~30 s) runs in the background — never inside the MCP request (-32001).
          const res = await service.regenerate({ userId, packId: args.packId, itemId: args.itemId, mode: args.mode, ratio: args.ratio, schedule: scheduleMcpExecuteWork })
          const r = res.ratio
          if (res.status === 'running') {
            const pollAfterSeconds = res.pollAfterSeconds ?? 30
            return {
              status: 'running',
              packId: args.packId,
              item: compactItem(res.item),
              ratio: r?.ratio,
              chargedCredits: 0,
              etaSeconds: pollAfterSeconds,
              pollAfterSeconds,
              retryAfterMs: pollAfterSeconds * 1000,
              nextTool: 'adpack_status',
              message: `Regenerating ${r?.ratio ?? 'the ratio'} in the background (free; the other ratios are unchanged). Tell the user it is RUNNING; check adpack_status with this packId in ~${pollAfterSeconds} s: the item leaves \`regenerating\` with the new file, or lists the ratio under rejectedRatios if the product still did not stay identical.`,
            }
          }
          return {
            status: r?.delivered ? 'regenerated' : 'rejected',
            packId: args.packId,
            item: compactItem(res.item),
            ...(r ? { ratio: r.ratio, method: r.method, delivered: r.delivered } : {}),
            ...(r?.rejected ? { rejected: [r.rejected] } : {}),
            chargedCredits: 0,
            message: r?.delivered
              ? `${r.ratio} regenerated (${r.method === 'replate' ? 'new background for this ratio' : 're-composited on the same background'}); the other ratios are unchanged. Free.`
              : `${r?.ratio ?? 'The ratio'} still did not keep the real product identical (${r?.rejected?.reason ?? 'fidelity'}); nothing was delivered for it. Free.`,
          }
        }
        if (!options.approvalStore) throw new Error('Approval store not configured')
        const input: Record<string, unknown> = { packId: args.packId, itemId: args.itemId, mode: args.mode ?? 'scene' }
        if (typeof args.packId !== 'string' || typeof args.itemId !== 'string') throw new AdPackError('BAD_INPUT', 'packId and itemId are required')
        // Ownership check before issuing an approval.
        const current = await service.getStatus({ userId, packId: args.packId })
        if (!current) throw new AdPackError('NOT_FOUND', 'Pack not found')
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
        if ('replay' in gate) {
          scheduleAdvance(service, userId, args.packId)
          return withLivePackStatus(gate.replay, await service.getStatus({ userId, packId: args.packId, appOrigin: options.appOrigin }).catch(() => null), 'adpack_regenerate')
        }
        if (gate.approved && !samePlan(gate.approved, plan)) {
          return planChanged({ approvalStore: options.approvalStore, user, toolName: 'adpack_regenerate', approvalRequestId, approved: gate.approved, planned: plan })
        }
        const regen = await service.regenerate({ userId, packId: args.packId, itemId: args.itemId, mode: input.mode })
        const result = withStatusMessage({
          status: 'running',
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
