/**
 * Ad Pack engine — durable per-ad state machine.
 *
 *   planned → copy_ready → scene_ready → rendered → done   (or failed)
 *
 * Product fidelity (pack.render.productFidelity):
 * - 'exact' (default when a product photo exists): the scene step makes real-product cut-outs
 *   (fidelity/segment.ts, cached by hash) and a product-free background plate (props-checked,
 *   ≤ 2 retries → scene_props_failed); the render step composites the real pixels per ratio with
 *   the relight stage INCLUDED (deterministic harmonization: shading, white balance + grade,
 *   light wrap, shadows, reflection, grain — no model call, no extra credits; `relight: 'ai'` adds
 *   a free, fidelity-guarded image-edit pass) and scores fidelity (detail SSIM + silhouette IoU +
 *   identity color after removing the light gradient). A failed cut-out → cutout_failed; a
 *   cut-out that dropped product pieces (recall < 95%) → cutout_incomplete. Fidelity is judged
 *   PER RATIO: passing ratios ship (one charge), failing ones are listed in `rejectedRatios`
 *   (reason + full-res diff) and can be regenerated alone for free (`regenerateRatio`); an AI
 *   relight that broke a ratio is retried with 'auto' first; no passing ratio → fidelity_failed.
 *   Flat-lay / kit-contents heroes get an overhead plate (top-down shadows, never perspective).
 *   A model-redrawn product is never delivered in exact mode.
 * - 'generated': the image model draws the product from the reference (legacy); the vision check
 *   also rejects invented parts/accessories and returns the product bbox the text avoids.
 *
 * `advancePack` is poll-driven and runtime-agnostic: it leases items from the
 * PackStore, runs each one as far as the time budget allows, persists after
 * every step and releases the lease. Any caller (web endpoint `waitUntil`, MCP
 * poll, CF container) can call it again to resume; expired leases are reclaimed.
 *
 * - Style anchor: the item with index 0 settles its scene (scene_ready/failed)
 *   before any other item starts a scene; its scene is passed as a style ref.
 * - Credits: charged once per item via the injected idempotent `charge`, keyed by
 *   the item's deterministic `generationId` (`:r<attempt>` after a regenerate).
 * - Partial success: a single item never throws out of the runner.
 */
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { quoteCredits } from '../credits/catalog.js'
import { deterministicGenerationUuid, generationUuidFromApproval } from '../credits/generation-id.js'
import { checkAdCopy } from './check-copy.js'
import { checkScene, type CheckSceneOutput } from './check-scene.js'
import { alternateHook, blockingIssuesFor, EDIT_BLOCKING_COPY_CODES, writeAdCopy } from './copy-stage.js'
import { assignLayoutFamilies } from './layout-plan.js'
import { resolvePackAngles } from './plan-angles.js'
import { generateScene, stripCopyText, type GeneratedScene } from './scene.js'
import { errorMessage } from './util.js'
import { storageBlobCache, type BlobCache } from './fidelity/cache.js'
import { prepareProductCutouts, resolveProductPhotos, defaultImageLoader, type ImageLoader, type LoadedCutout } from './fidelity/pipeline.js'
import { checkPlate, generatePlate, plateLight, plateSurface, PLATE_RETRY_HINT_PLACEMENT, PLATE_RETRY_HINT_PROPS, type PlateCheckResult, type PlateRegion, type PropsReference } from './fidelity/plate.js'
import { relightComposite } from './fidelity/relight.js'
import { analyzeAssetQuality } from './fidelity/asset-quality.js'
import { upscaleProductPhoto } from './fidelity/upscale.js'
import { analyzeStudioBackdrop, buildStudioBleed, studioCanvas, STUDIO_SHADOW_MIN } from './fidelity/bleed.js'
import { runQaGate, type QaGateResult, type QaRequiredFact } from './qa-gate.js'
import { buildCopyContext } from './copy-shared.js'
import { textCarriesFact } from './claims.js'
import { BACKGROUND_LEAK_MAX, fidelityFailReason, scoreFidelity, toFidelityResult, worstFidelity } from './fidelity/score.js'
import { planProductBoxes } from './render/render.js'
import { RATIO_SIZE } from './render/frame.js'
import { cachedLogo } from './render/logo.js'
import type { AdPackStorage, ChargeFn, Renderer, RenderOutput } from './runner-types.js'
import type {
  AdAngle,
  AdCopy,
  AspectRatio,
  CreativeFreedom,
  LayoutFamily,
  StyleRenderProfile,
  BrandDna,
  CopyCheckIssue,
  CopyCheckResult,
  FidelityResult,
  LightDirection,
  PlateSurface,
  ModelGateway,
  OfferInput,
  Pack,
  PackItem,
  PackItemStatus,
  PackStatus,
  PackStore,
  PackRenderOptions,
  ProductPhoto,
  ProductPhotoRole,
  RenderedAd,
  RejectedRatio,
  AdPhotoRef,
  SceneCheckResult,
  QaGateSummary,
} from './types.js'

/** Feed (4:5) + story (9:16) by default (H6); '1:1' stays available on request or via a free resize. */
export const DEFAULT_RATIOS: AspectRatio[] = ['4:5', '9:16']
export const ANCHOR_INDEX = 0
export const MAX_SCENE_RETRIES = 2

export { BLOCKING_COPY_CODES, EDIT_BLOCKING_COPY_CODES, MAX_COPY_REPAIR_ROUNDS } from './copy-stage.js'

const TERMINAL: ReadonlySet<PackItemStatus> = new Set(['done', 'failed'])
const ANCHOR_SETTLED: ReadonlySet<PackItemStatus> = new Set(['scene_ready', 'rendered', 'done', 'failed'])

const nowIso = () => new Date().toISOString()

// ---------------------------------------------------------------------------
// Plan + quote
// ---------------------------------------------------------------------------

export const MAX_VARIATIONS = 3

export interface PlanPackInput {
  dna: BrandDna
  offer: OfferInput
  size?: number
  /**
   * Angle selection: planner ids from adpack_angles (prefix-stable, resolved against the full
   * board) OR any catalog id (`<category>-<hook>-<format>`, e.g. guide_bulk_angles' adpackAngleId;
   * legacy `aNN-…` ids parse too). An id that cannot be honored is an error (never silently dropped).
   */
  angleIds?: string[]
  /** Full angles from guide_bulk_angles (`adpackAngle`), validated by the caller. Kept in order, before angleIds. */
  angles?: AdAngle[]
  /** Ads per angle (1–3): same angle and copy, different scene / composition / layout family. */
  variations?: number
  /** high (default without a selection) = planner decides angle, hook, format, layout and scene; guided = keep the agent's picks. */
  creativeFreedom?: CreativeFreedom
  /** Force one layout family (agent / brand setting). Variations still differ. */
  layoutFamily?: LayoutFamily
  /** Style DNA render profile (families, copy density, preferred hook). */
  styleProfile?: StyleRenderProfile
  ratios?: AspectRatio[]
  userId: string
  source: Pack['source']
  businessId?: string
  brandKitId?: string
  /** Fixed ids (tests / idempotent create). Item ids default to deterministic UUIDs from packId. */
  ids?: { packId?: string; itemIds?: string[] }
  seed?: string | number
  /** Owner's campaign brief (already sanitized). Copy-prompt context only, never facts. */
  brief?: string
  /** Product fidelity options. Omitted → legacy generated mode (callers decide the default). */
  render?: PackRenderOptions
  /** Angle ids of the latest packs of this offer: the planner prefers others (P1 #10). Planner picks only. */
  avoidAngleIds?: string[]
  /** P1 #8: the hero / primary photo appears in at least one ad (default true; false = no guarantee). */
  heroRequired?: boolean
}

/**
 * P1 #8: make sure the offer's hero (role 'hero', else the primary photo) is the photo of at least
 * one ad — the first ad without a per-ad pick — unless the owner turned it off (heroRequired false)
 * or a per-ad pick already uses it. Deterministic, decided at plan time (before any credit).
 */
export function ensureHeroUsage(offer: OfferInput, adCount: number, heroRequired = true): OfferInput {
  if (!heroRequired || adCount < 1) return offer
  const photos = resolveProductPhotos(offer)
  const hero = photos.find((p) => p.role === 'hero') ?? photos.find((p) => p.primary)
  if (!hero) return offer
  const byAd = offer.productImageUrlsByAd ?? {}
  if (Object.values(byAd).some((urls) => urls?.[0] === hero.url)) return offer
  for (let i = 0; i < adCount; i++) {
    if (byAd[String(i)]?.length) continue
    return { ...offer, productImageUrlsByAd: { ...byAd, [String(i)]: [hero.url] } }
  }
  return offer
}

/** Formats that may place real parts next to the hero (H3). */
export const PARTS_FORMATS = new Set(['offer_graphic', 'explainer'])

export function itemGenerationId(packId: string, index: number, attempt = 0): string {
  return generationUuidFromApproval(packId, attempt > 0 ? `adpack:${index}:r${attempt}` : `adpack:${index}`)
}

export interface PlannedAngles {
  angles: AdAngle[]
  creativeFreedom: CreativeFreedom
}

/**
 * Base angles of a pack (before variations) + the creative-freedom mode. One resolver
 * (plan-angles `resolvePackAngles`) serves quote, approval and start: same inputs → same list,
 * unusable ids throw AnglePlanError (BAD_INPUT `rejectedAngles` at the doors).
 */
export function resolvePlannedAngles(input: Pick<PlanPackInput, 'dna' | 'offer' | 'size' | 'angleIds' | 'angles' | 'creativeFreedom' | 'seed' | 'brief' | 'styleProfile' | 'avoidAngleIds' | 'render'>): PlannedAngles {
  const selected = Boolean(input.angleIds?.length || input.angles?.length)
  const creativeFreedom: CreativeFreedom = input.creativeFreedom ?? (selected ? 'guided' : 'high')
  const angles = resolvePackAngles({
    dna: input.dna,
    offer: input.offer,
    size: input.size,
    language: input.dna.language,
    seed: input.seed,
    brief: input.brief,
    preferHook: input.styleProfile?.hookType,
    angleIds: input.angleIds,
    angles: input.angles,
    ...(!selected && creativeFreedom === 'high' && input.avoidAngleIds?.length ? { avoidAngleIds: input.avoidAngleIds } : {}),
    // Legacy packs without render options are generated mode (person formats stay available).
    productFidelity: input.render?.productFidelity ?? 'generated',
  })
  return { angles, creativeFreedom }
}

/** Ads a selection runs: base angles × variations (1–3). */
export function packAdCount(baseAngles: number, variations = 1): number {
  return baseAngles * Math.max(1, Math.min(MAX_VARIATIONS, Math.floor(variations) || 1))
}

export function planPack(input: PlanPackInput): { pack: Pack; items: PackItem[]; creativeFreedom: CreativeFreedom } {
  const packId = input.ids?.packId ?? randomUUID()
  // Same resolver as the quote/approval: exactly `size` angles, or exactly the selection (throws otherwise).
  const { angles: baseAngles, creativeFreedom } = resolvePlannedAngles(input)
  const variations = Math.max(1, Math.min(MAX_VARIATIONS, Math.floor(input.variations ?? 1) || 1))
  const expanded: AdAngle[] = []
  for (const a of baseAngles) for (let v = 0; v < variations; v++) expanded.push(variations > 1 ? { ...a, variation: v } : { ...a })
  const families = assignLayoutFamilies({
    slots: expanded.map((a) => ({ format: a.format, angleId: a.id })),
    // Same inputs → same families through both doors (parity), whatever the packId.
    seed: input.seed ?? `${input.dna.brandName}|${input.offer.name}|families`,
    profile: input.styleProfile,
    family: input.layoutFamily,
  })
  const angles = expanded.map((a, i) => ({ ...a, layoutFamily: families[i] }))
  const ratios = input.ratios?.length ? [...new Set(input.ratios)] : [...DEFAULT_RATIOS]
  const ts = nowIso()
  const pack: Pack = {
    id: packId,
    userId: input.userId,
    businessId: input.businessId,
    brandKitId: input.brandKitId,
    // Exact mode (real product photos): the hero photo is guaranteed in at least one ad (P1 #8).
    offer: input.render?.productFidelity === 'exact' ? ensureHeroUsage(input.offer, angles.length, input.heroRequired ?? input.offer.heroRequired ?? true) : input.offer,
    dna: input.dna,
    status: 'planned',
    size: angles.length,
    ratios,
    quotedCredits: quotePack(angles.length).credits,
    source: input.source,
    ...(input.brief ? { brief: input.brief } : {}),
    ...(input.render ? { render: input.render } : {}),
    createdAt: ts,
    updatedAt: ts,
  }
  const items: PackItem[] = angles.map((angle, index) => ({
    id: input.ids?.itemIds?.[index] ?? deterministicGenerationUuid(packId, `adpack-item:${index}`),
    packId,
    index,
    status: 'planned',
    angle,
    renders: [],
    attempts: 0,
    generationId: itemGenerationId(packId, index),
    updatedAt: ts,
    costUsd: 0,
  }))
  return { pack, items, creativeFreedom }
}

/**
 * Credits for a pack: one `image_standard` per ad (copy included). Relighting is included and
 * free in every mode (owner decision: the deterministic stage always runs in exact mode, and the
 * optional AI pass costs nothing extra); productFidelity never changes the price either.
 */
export function quotePack(size: number): { credits: number; perAd: number } {
  const perAd = quoteCredits('image_standard', 1)
  return { credits: quoteCredits('image_standard', Math.max(0, Math.floor(size))), perAd }
}

/** The pack's relight mode ('auto' unless the AI pass was asked for; legacy `true` = 'ai'). */
export function packRelightMode(pack: Pick<Pack, 'render'>): 'auto' | 'ai' {
  const r = pack.render?.relight as unknown
  return r === 'ai' || r === true ? 'ai' : 'auto'
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface PackProgress {
  packId: string
  status: PackStatus
  total: number
  counts: Record<PackItemStatus, number>
  done: number
  failed: number
  pending: number
  costUsd: number
  /** Items this call moved forward at least one step. */
  advanced: number
  /** True when this call stopped because the time budget ran out. */
  stoppedForBudget: boolean
  items: Array<{ id: string; index: number; status: PackItemStatus; error?: string; costUsd?: number; timings?: PackItem['timings'] }>
}

export function packStatusFor(items: PackItem[], current: PackStatus): PackStatus {
  if (current === 'cancelled') return current
  if (!items.length) return current
  const done = items.filter((i) => i.status === 'done').length
  const failed = items.filter((i) => i.status === 'failed').length
  if (done + failed < items.length) return current === 'planned' ? current : 'running'
  if (failed === 0) return 'done'
  if (done === 0) return 'failed'
  return 'partial'
}

export function summarizePack(pack: Pack, items: PackItem[], extra: { advanced?: number; stoppedForBudget?: boolean } = {}): PackProgress {
  const counts: Record<PackItemStatus, number> = { planned: 0, copy_ready: 0, scene_ready: 0, rendered: 0, done: 0, failed: 0 }
  for (const i of items) counts[i.status]++
  return {
    packId: pack.id,
    status: pack.status,
    total: items.length,
    counts,
    done: counts.done,
    failed: counts.failed,
    pending: items.length - counts.done - counts.failed,
    costUsd: Number(items.reduce((s, i) => s + (i.costUsd ?? 0), 0).toFixed(6)),
    advanced: extra.advanced ?? 0,
    stoppedForBudget: extra.stoppedForBudget ?? false,
    items: items.map((i) => ({ id: i.id, index: i.index, status: i.status, error: i.error, costUsd: i.costUsd, timings: i.timings })),
  }
}

// ---------------------------------------------------------------------------
// Advance
// ---------------------------------------------------------------------------

export interface AdvancePackInput {
  store: PackStore
  gateway: ModelGateway
  renderer: Renderer
  storage: AdPackStorage
  charge: ChargeFn
  packId: string
  userId: string
  /** Stop leasing new work / starting new steps after this many ms. */
  budgetMs?: number
  concurrency?: number
  /** Lease length; default budget + 60 s so a crashed call frees items soon after. */
  leaseMs?: number
  /** Draft scenes (1k). Default true. */
  draft?: boolean
  maxSceneRetries?: number
  /** Optional text model override for copy. */
  copyModel?: string
  /**
   * Pass item 0's scene as a style reference to every other scene (and wait for it).
   * Default false: the live benchmark showed the anchor cloned its background into the
   * whole pack (monotony; a garden anchor put a kitchen cleaner in 10 gardens), cost
   * +$0.01 per scene and serialized the first scene. Cohesion now comes from the brand
   * palette + per-format setting rotation in the scene prompt.
   */
  styleAnchor?: boolean
  /** Exact mode: content-addressed cut-out cache (default: storage at `<userId>/adpack/cutouts/<sha256>.png`). */
  cutoutCache?: BlobCache | null
  /** Fetch product photos / cut-outs (default: data URL or https fetch). Tests inject fakes. */
  loadImage?: ImageLoader
  /** #16: automatic retries per failed ad (default MAX_AUTO_RETRIES = 2; 0 disables). */
  maxAutoRetries?: number
  /** Exact mode: re-plate a rejected ratio once at that ratio before listing it (default true; false = list it directly). */
  ratioReplate?: boolean
}

type StepOutcome = 'finished' | 'deferred' | 'budget'

interface RunCtx {
  input: AdvancePackInput
  pack: Pack
  deadline: number
  leaseMs: number
  /** Latest known state of every item (this call's view). */
  known: Map<string, PackItem>
  sceneBytes: Map<string, { bytes: Uint8Array; mimeType: string }>
  /** Exact mode: cut-out bytes per item (hero first) from this call's scene step. */
  cutoutBytes: Map<string, Uint8Array[]>
  /** Round 1b: studio-bleed layer bytes per item from this call's scene step. */
  bleedBytes: Map<string, Uint8Array>
  /** Product photo bytes / quality by URL (one download per call). */
  photoMemo: Map<string, { bytes: Uint8Array; quality?: import('./fidelity/asset-quality.js').AssetQuality }>
  /** Background-removed logo bytes for this pack (null = none / failed). */
  logo: Promise<Uint8Array | null> | null
  anchorWait: Promise<void> | null
  advanced: Set<string>
  /** Base items (variation 0) whose copy is being written in this call. */
  copyWaits: Map<string, Promise<void>>
}

class DeferredSignal {
  promise: Promise<void>
  resolve!: () => void
  constructor() {
    this.promise = new Promise<void>((r) => (this.resolve = r))
  }
}

export async function advancePack(input: AdvancePackInput): Promise<PackProgress> {
  const started = Date.now()
  const budgetMs = input.budgetMs ?? 50_000
  const concurrency = Math.max(1, Math.floor(input.concurrency ?? 4))
  const loaded = await input.store.getPack(input.packId, input.userId)
  if (!loaded) throw new Error('pack_not_found')
  let { pack } = loaded
  if (pack.status === 'cancelled') return summarizePack(pack, loaded.items)
  if (pack.status === 'planned') {
    await input.store.updatePack(pack.id, { status: 'running' })
    pack = { ...pack, status: 'running' }
  }

  const ctx: RunCtx = {
    input,
    pack,
    deadline: started + budgetMs,
    leaseMs: input.leaseMs ?? budgetMs + 60_000,
    known: new Map(loaded.items.map((i) => [i.id, i])),
    sceneBytes: new Map(),
    cutoutBytes: new Map(),
    bleedBytes: new Map(),
    photoMemo: new Map(),
    logo: null,
    anchorWait: null,
    advanced: new Set(),
    copyWaits: new Map(),
  }
  const deferred = new Set<string>()
  let stoppedForBudget = false

  const worker = async () => {
    while (true) {
      if (Date.now() >= ctx.deadline) {
        stoppedForBudget = true
        return
      }
      const leased = await input.store.leaseItems(pack.id, 1, ctx.leaseMs, { excludeIds: [...deferred] })
      const item = leased[0]
      if (!item) return
      ctx.known.set(item.id, item)
      let anchorSignal: DeferredSignal | null = null
      if (item.index === ANCHOR_INDEX && !ANCHOR_SETTLED.has(item.status)) {
        anchorSignal = new DeferredSignal()
        ctx.anchorWait = anchorSignal.promise
      }
      let outcome: StepOutcome
      try {
        outcome = await runItem(ctx, item, () => anchorSignal?.resolve())
      } catch (error) {
        // Store/infra failure: leave the item for the next poll (lease expires).
        console.error('[adpack] runItem failed', item.id, errorMessage(error))
        outcome = 'deferred'
      } finally {
        if (anchorSignal) {
          anchorSignal.resolve()
          ctx.anchorWait = null
        }
      }
      if (outcome === 'deferred') deferred.add(item.id)
      if (outcome === 'budget') {
        stoppedForBudget = true
        return
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const fresh = await input.store.getPack(pack.id, input.userId)
  const items = fresh?.items ?? [...ctx.known.values()].sort((a, b) => a.index - b.index)
  const current = fresh?.pack.status ?? pack.status
  const status = packStatusFor(items, current)
  if (status !== current) await input.store.updatePack(pack.id, { status })
  return summarizePack({ ...(fresh?.pack ?? pack), status }, items, { advanced: ctx.advanced.size, stoppedForBudget })
}

async function save(ctx: RunCtx, item: PackItem, patch: Partial<PackItem>): Promise<PackItem> {
  await ctx.input.store.updateItem(item.id, patch)
  const next: PackItem = { ...item, ...patch, updatedAt: nowIso() }
  ctx.known.set(item.id, next)
  ctx.advanced.add(item.id)
  return next
}

async function release(ctx: RunCtx, item: PackItem): Promise<void> {
  await ctx.input.store.updateItem(item.id, { leaseUntil: undefined })
  ctx.known.set(item.id, { ...item, leaseUntil: undefined })
}

/** #16: automatic retries per ad inside the same approval before it is reported failed. */
export const MAX_AUTO_RETRIES = 2

/**
 * Which failures are retried automatically, and how: copy failures write new copy (different
 * hook/wording, the checker's issues fed back); scene / fidelity / render failures keep the copy
 * and re-plate with another setting + light. A failed cut-out (same photo, same cut-out) and
 * charge problems are not retried.
 */
export function autoRetryMode(error: string): 'copy' | 'scene' | null {
  if (/^copy_(check_)?failed/.test(error)) return 'copy'
  // Round 1b QA gate: copy problems rewrite the copy; pixel / layout problems re-run the scene.
  if (/^qa_gate_failed: studio_required/.test(error)) return null // no studio photo: a re-run cannot help
  if (/^qa_gate_failed: [^(]*\b(headline|required_facts)\b/.test(error)) return 'copy'
  if (/^qa_gate_failed/.test(error)) return 'scene'
  if (/^(fidelity_failed|scene_props_failed|scene_failed|scene_product_mismatch|scene_upload_failed|render_failed)/.test(error)) return 'scene'
  return null
}

async function fail(ctx: RunCtx, item: PackItem, error: string, patch: Partial<PackItem> = {}): Promise<PackItem> {
  const mode = autoRetryMode(error)
  // The copy stage may hand back the angle it last wrote for (round-2 hook swap): keep it.
  const angle = patch.angle ?? item.angle
  const used = angle.autoRetry?.count ?? 0
  const max = Math.max(0, ctx.input.maxAutoRetries ?? MAX_AUTO_RETRIES)
  if (mode && used < max && !item.chargedAt) {
    // Same approval, same credits: nothing is charged for a failed attempt (only delivered ads are).
    // Order: the copy stage's free repair rounds already ran; this is the item-level retry (#16).
    const autoRetry = { count: used + 1, history: [...(angle.autoRetry?.history ?? []), { attempt: used + 1, mode, error: error.slice(0, 240) }] }
    const keepCopy = mode === 'scene' && Boolean(patch.copy ?? item.copy)
    // A copy retry is a new angle variant: avoid the rejected headline(s) and use another hook (P1 #10).
    const rejectedHeadline = (patch.copy ?? item.copy)?.headline ?? ''
    const copyHint = mode === 'copy'
      ? {
          retry: {
            attempt: (angle.retry?.attempt ?? 0) + 1,
            avoidHeadlines: [...new Set([...(angle.retry?.avoidHeadlines ?? []), rejectedHeadline].filter(Boolean))].slice(-4),
            hookType: alternateHook(angle, ctx.pack.dna, ctx.pack.offer, (angle.retry?.attempt ?? 0) + 1),
          },
        }
      : {}
    console.warn('[adpack] auto-retry', item.id, `${autoRetry.count}/${max}`, mode, error.slice(0, 160))
    return save(ctx, item, {
      ...(patch.costUsd !== undefined ? { costUsd: patch.costUsd } : {}),
      ...(patch.timings ? { timings: patch.timings } : {}),
      angle: { ...angle, ...copyHint, autoRetry },
      status: keepCopy ? 'copy_ready' : 'planned',
      copy: keepCopy ? (patch.copy ?? item.copy) : undefined,
      copyCheck: keepCopy ? (patch.copyCheck ?? item.copyCheck) : undefined,
      scene: undefined,
      sceneCheck: undefined,
      renders: [],
      fidelity: undefined,
      rejectedRatios: undefined,
      sceneAttempts: undefined,
      error: undefined,
    })
  }
  return save(ctx, item, { ...patch, status: 'failed', error: error.slice(0, 500), leaseUntil: undefined })
}

/** Copy-prompt hint for an automatic copy retry: what the checker rejected, and "write it differently". */
export function copyRetryHint(retry: PackItem['angle']['autoRetry'], language: 'es' | 'en'): string | undefined {
  const last = retry?.history.filter((h) => h.mode === 'copy').at(-1)
  if (!retry || !last) return undefined
  return language === 'es'
    ? `REINTENTO ${retry.count}: la versión anterior fue rechazada (${last.error.slice(0, 180)}). Escribí un gancho y un titular distintos; cada dato concreto (precio, envío, contenido, edad, cantidades) copialo tal cual de los datos confirmados o no lo menciones; nada de urgencia ni frases prohibidas.`
    : `RETRY ${retry.count}: the previous version was rejected (${last.error.slice(0, 180)}). Write a different hook and headline; copy every concrete fact (price, shipping, contents, age, quantities) verbatim from the confirmed facts or leave it out; no urgency, no forbidden phrases.`
}

async function runItem(ctx: RunCtx, leased: PackItem, onAnchorSettled: () => void): Promise<StepOutcome> {
  let item = leased
  while (true) {
    if (TERMINAL.has(item.status)) {
      if (item.leaseUntil) await release(ctx, item)
      return 'finished'
    }
    if (Date.now() >= ctx.deadline) {
      await release(ctx, item)
      return 'budget'
    }
    switch (item.status) {
      case 'planned': {
        let signal: DeferredSignal | null = null
        if (!item.angle.variation && item.angle.variation !== undefined) {
          signal = new DeferredSignal()
          ctx.copyWaits.set(item.id, signal.promise)
        }
        try {
          const next = await stepCopy(ctx, item)
          if (next === 'defer') {
            await release(ctx, item)
            return 'deferred'
          }
          item = next
        } finally {
          if (signal) {
            signal.resolve()
            ctx.copyWaits.delete(item.id)
          }
        }
        break
      }
      case 'copy_ready': {
        const gate = await waitForAnchor(ctx, item)
        if (gate === 'defer') {
          await release(ctx, item)
          return 'deferred'
        }
        item = await stepScene(ctx, item, gate.anchorUrl)
        if (item.index === ANCHOR_INDEX) onAnchorSettled()
        break
      }
      case 'scene_ready':
        item = await stepRender(ctx, item)
        break
      case 'rendered':
        item = await stepCharge(ctx, item)
        break
      default:
        return 'finished'
    }
  }
}

function otherCopies(ctx: RunCtx, item: PackItem): AdCopy[] {
  return [...ctx.known.values()]
    .filter((i) => i.id !== item.id && i.copy && i.status !== 'failed')
    .sort((a, b) => a.index - b.index)
    .map((i) => i.copy as AdCopy)
}

/** "copy_check_failed: unconfirmed_fact(caption), missing_fact(caption)" — the full issues live on item.copyCheck. */
export function copyFailureError(blocking: CopyCheckIssue[]): string {
  return `copy_check_failed: ${blocking.map((i) => `${i.code}(${i.path ?? i.field})`).join(', ')}`
}

/** Base item (variation 0) of a variation item, from this call's view. */
function variationBase(ctx: RunCtx, item: PackItem): PackItem | undefined {
  if (!item.angle.variation) return undefined
  return [...ctx.known.values()].find((i) => i.angle.id === item.angle.id && !i.angle.variation && i.id !== item.id)
}

/**
 * Variations share the angle's copy (only scene / composition / layout family change): reuse the
 * base item's copy once it exists. Returns 'defer' while the base copy is still being written.
 */
async function variationCopy(ctx: RunCtx, item: PackItem): Promise<{ copy: AdCopy; copyCheck?: CopyCheckResult } | 'defer' | null> {
  if (!item.angle.variation) return null
  let base = variationBase(ctx, item)
  const wait = base ? ctx.copyWaits.get(base.id) : undefined
  if (wait) {
    await wait
    base = variationBase(ctx, item)
  }
  if (!base?.copy && base?.status !== 'failed') {
    // Another caller may have written it: refresh the base from the store.
    const fresh = await ctx.input.store.getPack(ctx.pack.id, ctx.input.userId)
    const b = fresh?.items.find((i) => i.angle.id === item.angle.id && !i.angle.variation && i.id !== item.id)
    if (b) {
      ctx.known.set(b.id, b)
      base = b
    }
  }
  if (!base || base.status === 'failed') return null
  if (base.copy && base.status !== 'planned') return { copy: base.copy, ...(base.copyCheck ? { copyCheck: base.copyCheck } : {}) }
  return 'defer'
}

async function stepCopy(ctx: RunCtx, item: PackItem): Promise<PackItem | 'defer'> {
  const { gateway } = ctx.input
  const { dna, offer } = ctx.pack
  const language = dna.language
  const shared = await variationCopy(ctx, item)
  if (shared === 'defer') return 'defer'
  if (shared) return save(ctx, item, { status: 'copy_ready', copy: shared.copy, copyCheck: shared.copyCheck, timings: { ...item.timings, copyMs: 0 }, error: undefined })
  const t0 = Date.now()
  // Copy stage (P0 #2b): generation + up to 2 free repair rounds fed with the checker's detailed
  // issues. Still blocking afterwards → fail() schedules an automatic item retry (#16, ≤ 2) whose
  // prompt says why the last version was rejected and asks for another hook.
  const retryHint = copyRetryHint(item.angle.autoRetry, language)
  const res = await writeAdCopy({ gateway, dna, offer, angle: item.angle, language, model: ctx.input.copyModel, otherCopies: otherCopies(ctx, item), brief: ctx.pack.brief, ...(retryHint ? { retryHint, temperature: 0.9 } : {}) })
  const costUsd = (item.costUsd ?? 0) + res.costUsd
  const timings = { ...item.timings, copyMs: Date.now() - t0 }
  if (!res.copy || !res.check) return fail(ctx, item, res.error ?? 'copy_failed', { costUsd, timings })
  const angle = res.retryAngle ? { angle: res.retryAngle } : {}
  if (!res.ok) {
    return fail(ctx, item, copyFailureError(res.blocking), { copy: res.copy, copyCheck: res.check, costUsd, timings, ...angle })
  }
  return save(ctx, item, { status: 'copy_ready', copy: res.copy, copyCheck: res.check, costUsd, timings, error: undefined, ...angle })
}

async function waitForAnchor(ctx: RunCtx, item: PackItem): Promise<{ anchorUrl?: string } | 'defer'> {
  if (!ctx.input.styleAnchor || item.index === ANCHOR_INDEX) return {}
  const anchorOf = () => [...ctx.known.values()].find((i) => i.index === ANCHOR_INDEX)
  let anchor = anchorOf()
  if (!anchor || !ANCHOR_SETTLED.has(anchor.status)) {
    if (ctx.anchorWait) {
      await ctx.anchorWait
    } else {
      // Anchor not in flight here: refresh from the store (another caller may have settled it).
      const fresh = await ctx.input.store.getPack(ctx.pack.id, ctx.input.userId)
      const a = fresh?.items.find((i) => i.index === ANCHOR_INDEX)
      if (a) ctx.known.set(a.id, a)
    }
    anchor = anchorOf()
    if (anchor && !ANCHOR_SETTLED.has(anchor.status)) return 'defer'
  }
  return { anchorUrl: anchor && anchor.status !== 'failed' ? anchor.scene?.imageUrl : undefined }
}

const RETRY_HINT_PRODUCT =
  'IMPORTANT: the previous attempt changed the product. Reproduce the product from the reference photo exactly — same shape, proportions, colors and label — and change only the surroundings.'
const RETRY_HINT_TEXT =
  'IMPORTANT: the previous attempt contained stray text. The image must contain zero added text, letters, numbers, signs or logos.'

const RETRY_HINT_BORDERS =
  'IMPORTANT: the previous attempt had blank bars or borders. Fill the entire frame edge to edge with one continuous photograph.'

function needsRegeneration(check: SceneCheckResult): boolean {
  return check.productMatches === false || check.strayText === true || check.borders === true || Boolean(check.extraObjects?.length)
}

function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}`
}

/**
 * C3: per-ad product photos (`offer.productImageUrlsByAd[index]`) override the pack-wide hero.
 * With role-tagged photos (exact mode) the first per-ad photo becomes the ad's only 'hero', the
 * other picked photos keep their roles, and the pool's kit parts / box / contents stay available
 * as part cut-outs and vision references.
 */
export function offerForItem(offer: OfferInput, index: number): OfferInput {
  const urls = offer.productImageUrlsByAd?.[String(index)]?.filter(Boolean)
  if (!urls?.length) return offer
  const next: OfferInput = { ...offer, productImageUrls: urls }
  const pool = offer.productPhotos ?? []
  if (pool.length) {
    const byUrl = new Map(pool.map((p) => [p.url, p]))
    const picked: ProductPhoto[] = urls.map((url, i) => {
      const known = byUrl.get(url)
      const role: ProductPhotoRole = i === 0 ? 'hero' : known?.role && known.role !== 'hero' ? known.role : 'detail'
      return { ...(known ?? {}), url, role }
    })
    const kit = pool.filter((p) => !urls.includes(p.url) && (p.role === 'part' || p.role === 'box' || p.role === 'contents'))
    next.productPhotos = [...picked, ...kit]
  }
  return next
}

/** The offer photo behind a URL, as reported per ad (P1 #8): product_images id, role and label when known. */
export function photoRefFor(offer: Pick<OfferInput, 'productPhotos' | 'photoIdsByUrl'>, url: string): AdPhotoRef {
  const p = offer.productPhotos?.find((x) => x.url === url)
  const id = p?.id ?? offer.photoIdsByUrl?.[url]
  return { url, ...(id ? { productImageId: id } : {}), ...(p?.role ? { role: p.role } : {}), ...(p?.label ? { label: p.label } : {}) }
}

/**
 * Round 1 (P4): fallback pool when an ad's pinned photo(s) cannot be cut out — every other product
 * photo of the offer (hero / detail / untagged first; kit parts, box and contents shots are never a
 * hero), followed by the kit parts the pinned set carried.
 */
export function pinnedPhotoFallback(offer: OfferInput, pinned: ProductPhoto[]): ProductPhoto[] {
  const pinnedUrls = new Set(pinned.filter((p) => p.role !== 'part' && p.role !== 'box' && p.role !== 'contents').map((p) => p.url))
  const all = resolveProductPhotos(offer).map((p) => (p.id || !offer.photoIdsByUrl?.[p.url] ? p : { ...p, id: offer.photoIdsByUrl[p.url] }))
  const heroes = all.filter((p) => !pinnedUrls.has(p.url) && p.role !== 'part' && p.role !== 'box' && p.role !== 'contents')
  if (!heroes.length) return []
  const parts = pinned.filter((p) => p.role === 'part')
  return [...heroes, ...parts.filter((p) => !heroes.some((h) => h.url === p.url))]
}

function photoLabel(p: ProductPhoto | undefined): string {
  if (!p) return 'photo'
  return p.id ? `${p.id.slice(0, 8)}${p.label ? ` (${p.label.slice(0, 40)})` : ''}` : p.label ? `"${p.label.slice(0, 40)}"` : p.url.slice(-40)
}

/** True when the ad's photos were picked per ad (the first one is the hero, whatever the format prefers). */
function hasPerAdPhotos(offer: OfferInput, index: number): boolean {
  return Boolean(offer.productImageUrlsByAd?.[String(index)]?.filter(Boolean).length)
}

export function packMode(pack: Pick<Pack, 'render'>): 'exact' | 'generated' {
  return pack.render?.productFidelity === 'exact' ? 'exact' : 'generated'
}

const RETRY_HINT_PROPS =
  'IMPORTANT: the previous attempt added product parts or accessories that are not in the reference photos (loose parts, cables, a different remote…). Show only the product exactly as photographed; no extra parts, cables or devices.'

/** Real photos other than the hero, as vision-check references (parts / box / contents). */
function partReferences(offer: OfferInput): PropsReference[] {
  return resolveProductPhotos(offer)
    .slice(1)
    .filter((p) => p.role === 'part' || p.role === 'box' || p.role === 'contents')
    .slice(0, 2)
    .map((p) => ({ image: p.url, role: p.role, ...(p.label ? { label: p.label } : {}) }))
}

async function stepScene(ctx: RunCtx, item: PackItem, anchorUrl?: string): Promise<PackItem> {
  if (packMode(ctx.pack) === 'exact') return stepPlate(ctx, item)
  const { gateway, storage } = ctx.input
  const { dna } = ctx.pack
  const offer = offerForItem(ctx.pack.offer, item.index)
  const copy = item.copy
  if (!copy) return save(ctx, item, { status: 'planned' })
  const maxAttempts = 1 + Math.max(0, ctx.input.maxSceneRetries ?? MAX_SCENE_RETRIES)
  const productRef = offer.productImageUrls?.[0]
  // Nth ad of this format in the pack → Nth setting variant (no two same-format ads share a backdrop).
  const variation = [...ctx.known.values()].filter((i) => i.angle.format === item.angle.format && i.index < item.index).length + (item.angle.autoRetry?.count ?? 0)
  const t0 = Date.now()
  let checkMs = 0
  let cost = 0
  let attempts = 0
  let lastError = ''
  let hint: string | undefined
  const candidates: Array<{ scene: GeneratedScene; check: CheckSceneOutput | SceneCheckResult }> = []

  for (let a = 0; a < maxAttempts; a++) {
    attempts++
    let scene: GeneratedScene
    try {
      scene = await generateScene({
        gateway,
        copy,
        angle: item.angle,
        dna,
        offer,
        anchor: anchorUrl ? { imageUrl: anchorUrl } : null,
        variation,
        immutableAttributes: ctx.pack.render?.immutableAttributes ?? offer.immutableAttributes,
        draft: ctx.input.draft ?? true,
        promptSuffix: hint,
      })
    } catch (error) {
      lastError = errorMessage(error)
      continue
    }
    cost += scene.costUsd
    const c0 = Date.now()
    let check: CheckSceneOutput | SceneCheckResult
    try {
      const res = await checkScene({
        gateway,
        sceneImage: toDataUrl(scene.bytes, scene.mimeType),
        productRef,
        partRefs: productRef ? partReferences(offer) : [],
        allowedProps: ctx.pack.render?.allowedProps ?? offer.allowedProps,
        immutableAttributes: ctx.pack.render?.immutableAttributes ?? offer.immutableAttributes,
        language: dna.language,
      })
      cost += res.costUsd
      check = res
    } catch (error) {
      check = { ok: true, productMatches: null, strayText: null, score: 0.5, notes: `scene_check_unavailable: ${errorMessage(error)}`.slice(0, 300) }
    }
    checkMs += Date.now() - c0
    candidates.push({ scene, check })
    if (!needsRegeneration(check)) break
    hint =
      check.productMatches === false
        ? RETRY_HINT_PRODUCT
        : check.extraObjects?.length
          ? RETRY_HINT_PROPS
          : check.strayText === true
            ? RETRY_HINT_TEXT
            : RETRY_HINT_BORDERS
  }

  const costUsd = (item.costUsd ?? 0) + cost
  const timings = { ...item.timings, sceneMs: Date.now() - t0 - checkMs, sceneCheckMs: checkMs }
  if (!candidates.length) return fail(ctx, item, `scene_failed: ${lastError}`, { costUsd, timings, sceneAttempts: attempts })

  const passing = candidates.filter((c) => !needsRegeneration(c.check))
  const pool = passing.length ? passing : candidates
  const best = pool.reduce((b, c) => (c.check.score > b.check.score ? c : b))
  const sceneCheck: SceneCheckResult = {
    ok: best.check.ok,
    productMatches: best.check.productMatches,
    strayText: best.check.strayText,
    ...(best.check.borders != null ? { borders: best.check.borders } : {}),
    score: best.check.score,
    ...(best.check.notes ? { notes: best.check.notes } : {}),
    ...(best.check.extraObjects?.length ? { extraObjects: best.check.extraObjects } : {}),
    ...(best.check.productBox ? { productBox: best.check.productBox } : {}),
  }
  if (best.check.productMatches === false) {
    return fail(ctx, item, `scene_product_mismatch after ${attempts} attempts`, { sceneCheck, costUsd, timings, sceneAttempts: attempts })
  }
  if (best.check.extraObjects?.length) {
    return fail(ctx, item, `scene_props_failed: ${best.check.extraObjects.join(', ')} (after ${attempts} attempts)`, { sceneCheck, costUsd, timings, sceneAttempts: attempts })
  }

  const contentType = best.scene.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  let imageUrl: string
  try {
    imageUrl = (await storage.upload({ userId: ctx.pack.userId, packId: ctx.pack.id, itemIndex: item.index, kind: 'scene', bytes: best.scene.bytes, contentType })).url
  } catch (error) {
    return fail(ctx, item, `scene_upload_failed: ${errorMessage(error)}`, { costUsd, timings, sceneAttempts: attempts })
  }
  ctx.sceneBytes.set(item.id, { bytes: best.scene.bytes, mimeType: best.scene.mimeType })
  return save(ctx, item, {
    status: 'scene_ready',
    scene: {
      imageUrl,
      width: best.scene.width,
      height: best.scene.height,
      model: best.scene.model,
      costUsd: candidates.reduce((s, c) => s + c.scene.costUsd, 0),
      productLocked: best.scene.productLocked,
      ...(productRef ? { sourcePhoto: photoRefFor(offer, productRef) } : {}),
    },
    sceneCheck,
    costUsd,
    timings,
    sceneAttempts: attempts,
    error: undefined,
  })
}

// ---------------------------------------------------------------------------
// Exact mode: cut-outs + plate (scene step), composite + fidelity (render step)
// ---------------------------------------------------------------------------

/** The plate the runner generates: 9:16, cover-fit to every pack ratio. */
const PLATE_SIZE = RATIO_SIZE['9:16']

/**
 * Union of the product boxes of every pack ratio, mapped back into the 9:16 plate through the
 * renderer's centered cover crop → where the plate must leave an empty surface.
 */
export function plateRegionFor(input: { pack: Pick<Pack, 'ratios' | 'dna'>; format: PackItem['angle']['format']; copy: AdCopy; product: { width: number; height: number }; layoutFamily?: LayoutFamily; ratios?: AspectRatio[]; plateRatio?: AspectRatio }): PlateRegion {
  const ratios = input.ratios ?? input.pack.ratios
  const boxes = planProductBoxes({
    format: input.format,
    ...(input.layoutFamily ? { layoutFamily: input.layoutFamily } : {}),
    ratios,
    copy: input.copy,
    visual: input.pack.dna.visual,
    language: input.pack.dna.language,
    product: input.product,
  })
  // The plate is 9:16 by default (cover-fit to every ratio); a ratio regenerated alone gets its own plate.
  const plate = input.plateRatio ? RATIO_SIZE[input.plateRatio] : PLATE_SIZE
  let x0 = 1
  let y0 = 1
  let x1 = 0
  let y1 = 0
  // Highest product base over the ratios (P1 #7: the surface must already be there).
  let baseY = 1
  for (const [ratio, b] of Object.entries(boxes) as Array<[AspectRatio, { x: number; y: number; w: number; h: number }]>) {
    const { width: W, height: H } = RATIO_SIZE[ratio]
    const s = Math.max(W / plate.width, H / plate.height)
    const ox = (plate.width * s - W) / 2
    const oy = (plate.height * s - H) / 2
    x0 = Math.min(x0, (b.x + ox) / s / plate.width)
    y0 = Math.min(y0, (b.y + oy) / s / plate.height)
    x1 = Math.max(x1, (b.x + b.w + ox) / s / plate.width)
    y1 = Math.max(y1, (b.y + b.h + oy) / s / plate.height)
    baseY = Math.min(baseY, (b.y + b.h + oy) / s / plate.height)
  }
  if (x1 <= x0 || y1 <= y0) return { x0: 0.25, y0: 0.4, x1: 0.75, y1: 0.8, baseY: 0.8 }
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000
  return { x0: c(x0), y0: c(y0), x1: c(x1), y1: c(y1), baseY: c(baseY) }
}

function cutoutCacheFor(ctx: RunCtx): BlobCache | null {
  if (ctx.input.cutoutCache !== undefined) return ctx.input.cutoutCache
  return storageBlobCache(ctx.input.storage, ctx.pack.userId, 'cutouts')
}

async function stepPlate(ctx: RunCtx, item: PackItem): Promise<PackItem> {
  const { gateway, storage } = ctx.input
  const { dna } = ctx.pack
  // C3: productImageIdsByAd picks this ad's hero; otherwise the pool (tags/primary order) + pickProductImage.
  const offer = offerForItem(ctx.pack.offer, item.index)
  const perAd = hasPerAdPhotos(ctx.pack.offer, item.index)
  const copy = item.copy
  if (!copy) return save(ctx, item, { status: 'planned' })
  const t0 = Date.now()
  const format = item.angle.format
  // product_images ids travel with the photos so each ad reports which photo it used (P1 #8).
  const withIds = (o: OfferInput) => resolveProductPhotos(o).map((p) => (p.id || !o.photoIdsByUrl?.[p.url] ? p : { ...p, id: o.photoIdsByUrl[p.url] }))
  let photos = withIds(offer)
  const cutoutCtx = { language: dna.language, withParts: PARTS_FORMATS.has(format), gateway, cache: cutoutCacheFor(ctx), load: ctx.input.loadImage, memo: ctx.photoMemo }
  // A per-ad pick is the hero whatever the format would prefer (hero role ranks first by default).
  let cut = await prepareProductCutouts({ photos, format: perAd ? undefined : format, ...cutoutCtx })
  if (!cut.ok && perAd) {
    // Round 1 (P4): a pinned photo whose cut-out fails no longer kills the ad — the offer's other
    // product photos (never kit/box/contents shots) are tried before failing; the ad reports the
    // photo it actually used and a note says why the pinned one was skipped.
    const fallback = pinnedPhotoFallback(ctx.pack.offer, photos)
    if (fallback.length) {
      const alt = await prepareProductCutouts({ photos: fallback, format, ...cutoutCtx })
      if (alt.ok) {
        alt.warnings.unshift(`pinned photo ${photoLabel(photos[0])} skipped (${cut.error.slice(0, 120)}); used ${photoLabel(fallback.find((p) => p.url === alt.hero.stored.sourceUrl) ?? fallback[0])} instead`)
        alt.hero = { ...alt.hero, stored: { ...alt.hero.stored, fallbackFrom: photos[0]?.id ?? photos[0]?.url ?? '' } }
        cut = alt
        photos = fallback
      }
    }
  }
  if (!cut.ok) {
    const known = cut.error.startsWith('cutout_failed') || cut.error.startsWith('cutout_incomplete')
    return fail(ctx, item, known ? cut.error : `cutout_failed: ${cut.error}`, { timings: { ...item.timings, sceneMs: Date.now() - t0 } })
  }
  // P1 #6: a flat lay (kit contents shot from above) is never placed into a perspective scene:
  // overhead plate + top-down shadows. Parts shot in perspective are not mixed into a flat lay,
  // and flat-lay parts are not stood up next to a perspective hero.
  const overhead = Boolean(cut.hero.stored.flatLay)
  const keptParts = overhead ? [] : cut.parts.filter((p) => !p.stored.flatLay)
  if (keptParts.length < cut.parts.length) cut.warnings.push(`${cut.parts.length - keptParts.length} part photo(s) skipped: ${overhead ? 'a flat lay already shows the kit' : 'top-down part photos are not placed in a perspective scene'}`)
  const cutouts: LoadedCutout[] = [cut.hero, ...keptParts]
  // #16: an automatic re-plate uses another setting and light (a fresh seed, not the same plate again).
  const retries = item.angle.autoRetry?.count ?? 0
  const variation = [...ctx.known.values()].filter((i) => i.angle.format === format && i.index < item.index).length + retries
  const light: LightDirection = overhead ? 'top' : plateLight(item.index + retries)
  const surface = overhead ? 'matte' : plateSurface(format, variation)
  // Round 1b: a studio-shot hero keeps its own backdrop, contact shadows and light (bleed into a
  // procedural canvas, no paid plate). Anything else falls through to cut-out + generated plate.
  // (Real kit parts next to the hero are composited by the cut-out path, so a part photo opts out.)
  const studioMode = ctx.pack.render?.studioBleed ?? 'auto'
  if (!overhead && !keptParts.length && studioMode !== 'off') {
    let studio = await tryStudioBleed(ctx, item, cut.hero.stored.sourceUrl, light)
    let used = cut
    if (!studio) {
      // Round 1c fallback: the chosen hero is not a studio shot (or its backdrop/shadow fails the
      // check) → another studio-shot photo of the same offer is used (still the exact product
      // pixels; never a relight or a redraw). The ad reports which photo it really used.
      for (const alt of studioFallbackCandidates(ctx.pack.offer, withIds, cut.hero.stored.sourceUrl)) {
        const c2 = await prepareProductCutouts({ photos: [alt], format, ...cutoutCtx })
        if (!c2.ok) continue
        const s2 = await tryStudioBleed(ctx, item, c2.hero.stored.sourceUrl, light)
        if (!s2) continue
        c2.warnings.unshift(`photo ${photoLabel(photos[0])} is not a studio shot (gate would reject the cut-out); used studio photo ${photoLabel(alt)} instead`)
        c2.hero = { ...c2.hero, stored: { ...c2.hero.stored, fallbackFrom: photos[0]?.id ?? photos[0]?.url ?? '' } }
        studio = s2
        used = c2
        break
      }
    }
    if (studio) {
      ctx.sceneBytes.set(item.id, { bytes: studio.canvas, mimeType: 'image/png' })
      ctx.cutoutBytes.set(item.id, [used.hero.bytes])
      ctx.bleedBytes.set(item.id, studio.layer)
      return save(ctx, item, {
        status: 'scene_ready',
        scene: { imageUrl: studio.canvasUrl, width: STUDIO_CANVAS.width, height: STUDIO_CANVAS.height, model: 'studio-canvas', costUsd: 0, productLocked: true, kind: 'plate', light, surface: 'matte', cutouts: [used.hero.stored], view: 'perspective', bleed: studio.ref },
        sceneCheck: { ok: true, productMatches: null, strayText: false, borders: false, score: 1, notes: ['studio bleed: real photo backdrop + shadows kept, procedural canvas', ...used.warnings].join(' · ').slice(0, 300) },
        timings: { ...item.timings, sceneMs: Date.now() - t0 },
        sceneAttempts: 1,
        error: undefined,
      })
    }
    if (studioMode === 'required') {
      return fail(ctx, item, 'qa_gate_failed: studio_required (no studio-shot photo: the cut-out is not shown pasted on a generated plate; add a photo on a plain light backdrop with its own soft shadow)', { timings: { ...item.timings, sceneMs: Date.now() - t0 } })
    }
  }
  const placement = plateRegionFor({ pack: ctx.pack, format, copy, product: { width: cut.hero.width, height: cut.hero.height }, layoutFamily: item.angle.layoutFamily })
  const allowedProps = ctx.pack.render?.allowedProps ?? offer.allowedProps
  const immutableAttributes = ctx.pack.render?.immutableAttributes ?? offer.immutableAttributes
  const refs: PropsReference[] = photos
    .filter((p) => p.url === cut.hero.stored.sourceUrl || p.role === 'part' || p.role === 'box' || p.role === 'contents')
    .slice(0, 3)
    .map((p) => ({ image: p.url, role: p.role, ...(p.label ? { label: p.label } : {}) }))
  const maxAttempts = 1 + Math.max(0, ctx.input.maxSceneRetries ?? MAX_SCENE_RETRIES)
  let cost = 0
  let checkMs = 0
  let attempts = 0
  let hint: string | undefined
  let lastError = ''
  let accepted: { bytes: Uint8Array; mimeType: string; width: number; height: number; model: string; check: PlateCheckResult | null } | null = null
  let lastCheck: PlateCheckResult | null = null
  for (let a = 0; a < maxAttempts && !accepted; a++) {
    attempts++
    let plate
    try {
      plate = await generatePlate({ gateway, format, dna, offer, placement, light, surface, variation, allowedProps, immutableAttributes, sceneBrief: stripCopyText(copy.sceneBrief ?? '', copy), draft: ctx.input.draft ?? true, promptSuffix: hint, ...(overhead ? { view: 'overhead' as const } : {}) })
    } catch (error) {
      lastError = errorMessage(error)
      continue
    }
    cost += plate.costUsd
    const c0 = Date.now()
    let check: PlateCheckResult | null
    try {
      check = await checkPlate({ gateway, plateImage: toDataUrl(plate.bytes, plate.mimeType), refs, allowedProps, placement, language: dna.language, immutableAttributes, ...(overhead ? { view: 'overhead' as const } : {}) })
      cost += check.costUsd
    } catch (error) {
      check = null
      lastError = `plate_check_unavailable: ${errorMessage(error)}`
    }
    checkMs += Date.now() - c0
    lastCheck = check ?? lastCheck
    if (!check || check.ok) accepted = { ...plate, check }
    else hint = check.extraObjects.length ? PLATE_RETRY_HINT_PROPS : PLATE_RETRY_HINT_PLACEMENT
  }
  const costUsd = (item.costUsd ?? 0) + cost
  const timings = { ...item.timings, sceneMs: Date.now() - t0 - checkMs, sceneCheckMs: checkMs }
  if (!accepted) {
    if (lastCheck) {
      const why = lastCheck.extraObjects.length ? lastCheck.extraObjects.join(', ') : lastCheck.notes ?? 'placement area not clear'
      return fail(ctx, item, `scene_props_failed: ${why} (after ${attempts} attempts)`, {
        sceneCheck: { ok: false, productMatches: null, strayText: lastCheck.strayText, borders: lastCheck.borders, score: lastCheck.score, extraObjects: lastCheck.extraObjects, ...(lastCheck.notes ? { notes: lastCheck.notes } : {}) },
        costUsd,
        timings,
        sceneAttempts: attempts,
      })
    }
    return fail(ctx, item, `scene_failed: ${lastError}`, { costUsd, timings, sceneAttempts: attempts })
  }
  const contentType = accepted.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  let imageUrl: string
  try {
    imageUrl = (await storage.upload({ userId: ctx.pack.userId, packId: ctx.pack.id, itemIndex: item.index, kind: 'plate', bytes: accepted.bytes, contentType })).url
  } catch (error) {
    return fail(ctx, item, `scene_upload_failed: ${errorMessage(error)}`, { costUsd, timings, sceneAttempts: attempts })
  }
  ctx.sceneBytes.set(item.id, { bytes: accepted.bytes, mimeType: accepted.mimeType })
  ctx.cutoutBytes.set(item.id, cutouts.map((c) => c.bytes))
  const pc = accepted.check
  return save(ctx, item, {
    status: 'scene_ready',
    scene: {
      imageUrl,
      width: accepted.width,
      height: accepted.height,
      model: accepted.model,
      costUsd: cost,
      productLocked: true,
      kind: 'plate',
      light,
      surface,
      cutouts: cutouts.map((c) => c.stored),
      view: overhead ? 'overhead' : 'perspective',
    },
    sceneCheck: {
      ok: true,
      productMatches: null,
      strayText: pc?.strayText ?? null,
      borders: pc?.borders ?? null,
      score: pc?.score ?? 0.5,
      ...(pc?.notes ? { notes: pc.notes } : {}),
      ...(cut.warnings.length ? { notes: [pc?.notes, ...cut.warnings].filter(Boolean).join(' · ').slice(0, 300) } : {}),
    },
    costUsd,
    timings,
    sceneAttempts: attempts,
    error: undefined,
  })
}

/** Other product photos of the offer that could be studio shots (never kit parts / box / contents). */
export function studioFallbackCandidates(offer: OfferInput, withIds: (o: OfferInput) => ProductPhoto[], heroUrl: string): ProductPhoto[] {
  const rank = (p: ProductPhoto) => (p.role === 'hero' ? 0 : p.role === 'detail' ? 1 : 2)
  return withIds(offer)
    .filter((p) => p.url !== heroUrl && p.role !== 'part' && p.role !== 'box' && p.role !== 'contents')
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 4)
}

/** Procedural studio canvas size (cover-fit to every ratio by the renderer). */
const STUDIO_CANVAS = { width: 1080, height: 1920 }

/** Canvas tone: the brand's light colour when it is a light near-neutral, else the photo's own backdrop. */
export function studioTone(secondary: string | undefined, backdrop: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(secondary ?? '').trim())
  if (m) {
    const v = parseInt(m[1], 16)
    const c = { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }
    const L = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
    const spread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
    // The brand tone is used only when it sits within ±10 % of the photo's own backdrop (else the photo's tone wins, so no visible patch).
    const near = (a: number, b: number) => Math.abs(a - b) / Math.max(1, b) <= 0.1
    if (L >= 0.82 && spread <= 34 && near(c.r, backdrop.r) && near(c.g, backdrop.g) && near(c.b, backdrop.b)) return c
  }
  return backdrop
}

/** Round 1b: studio bleed for an item's hero photo, or null when the photo is not a studio shot. */
async function tryStudioBleed(ctx: RunCtx, item: PackItem, sourceUrl: string, light: LightDirection): Promise<{ layer: Uint8Array; canvas: Uint8Array; canvasUrl: string; ref: NonNullable<NonNullable<PackItem['scene']>['bleed']> } | null> {
  try {
    const bytes = ctx.photoMemo.get(sourceUrl)?.bytes ?? (await (ctx.input.loadImage ?? defaultImageLoader)(sourceUrl))
    const an = await analyzeStudioBackdrop(bytes)
    if (!an.eligible) return null
    // Low-resolution photo: the existing deterministic step (Lanczos-3 ≤ 2× + edge-aware unsharp,
    // SSIM / silhouette verified, never redrawn) runs before the bleed. Resampling, not super-res.
    let source: Uint8Array = bytes
    let preScale = 1
    const quality = ctx.photoMemo.get(sourceUrl)?.quality ?? (await analyzeAssetQuality(bytes, ctx.pack.dna.language))
    if (quality?.lowResolution) {
      const up = await upscaleProductPhoto(bytes)
      if (up.upscaled) {
        source = up.bytes
        const [m0, m1] = await Promise.all([sharp(Buffer.from(bytes)).metadata(), sharp(Buffer.from(up.bytes)).metadata()])
        if (m0.width && m1.width) preScale = Math.max(1, m1.width / m0.width)
      }
    }
    const layer = await buildStudioBleed(source)
    if (layer.shadowShare < STUDIO_SHADOW_MIN) return null
    const tone = studioTone(ctx.pack.dna.visual?.secondaryColor, layer.backdrop)
    const canvas = await studioCanvas(STUDIO_CANVAS.width, STUDIO_CANVAS.height, tone, light)
    const storage = ctx.input.storage
    const layerUrl = (await storage.upload({ userId: ctx.pack.userId, packId: ctx.pack.id, itemIndex: item.index, kind: 'plate', bytes: new Uint8Array(layer.png), contentType: 'image/png' })).url
    const canvasUrl = (await storage.upload({ userId: ctx.pack.userId, packId: ctx.pack.id, itemIndex: item.index, kind: 'plate', bytes: new Uint8Array(canvas), contentType: 'image/png' })).url
    return { layer: new Uint8Array(layer.png), canvas: new Uint8Array(canvas), canvasUrl, ref: { url: layerUrl, productBox: layer.productBox, backdrop: layer.backdrop, edgesTouched: layer.edgesTouched, sourceUrl, ...(preScale > 1 ? { preScale: Math.round(preScale * 1000) / 1000 } : {}) } }
  } catch (error) {
    console.warn('[adpack] studio bleed skipped', item.id, errorMessage(error).slice(0, 160))
    return null
  }
}

interface ExactRenderInputs {
  cutouts: Uint8Array[]
  light?: LightDirection
  surface?: PlateSurface
  /** Overhead plate + flat lay (P1 #6). */
  topDown?: boolean
  /** Round 1b studio bleed layer (replaces the cut-out composite). */
  bleed?: { bytes: Uint8Array; ref: NonNullable<NonNullable<PackItem['scene']>['bleed']> }
}

/** Cut-out bytes for an item (this call's memory, else the stored cut-out URLs). */
async function exactInputsFromScene(item: PackItem, load: ImageLoader, memory?: Uint8Array[], bleedMemory?: Uint8Array): Promise<ExactRenderInputs> {
  const ref = item.scene?.bleed
  const bleed = ref ? { bytes: bleedMemory ?? (await load(ref.url)), ref } : undefined
  const extra = { light: item.scene?.light, ...(item.scene?.surface ? { surface: item.scene.surface } : {}), ...(item.scene?.view === 'overhead' ? { topDown: true } : {}), ...(bleed ? { bleed } : {}) }
  if (memory?.length) return { cutouts: memory, ...extra }
  const stored = item.scene?.cutouts ?? []
  if (!stored.length) throw new Error('cutout_missing: no stored cut-out for this ad')
  const cutouts: Uint8Array[] = []
  for (const c of stored) cutouts.push(await load(c.url))
  return { cutouts, ...extra }
}

/**
 * Generated mode: where the product sits in the scene (fractions x/y/w/h) — the scene's stored
 * box when present, else the vision check's [y0, x0, y1, x1] (0–1000) bbox. Exact mode never uses
 * it: there the composite's placement IS the product box.
 */
export function sceneProductBox(item: Pick<PackItem, 'scene' | 'sceneCheck'>): { x: number; y: number; w: number; h: number } | undefined {
  if (item.scene?.productBox) return item.scene.productBox
  return visionBoxToNormalized(item.sceneCheck)
}

function visionBoxToNormalized(check: SceneCheckResult | undefined): { x: number; y: number; w: number; h: number } | undefined {
  const b = check?.productBox
  if (!b) return undefined
  const [y0, x0, y1, x1] = b.map((v) => v / 1000)
  if (!(x1 > x0 && y1 > y0)) return undefined
  return { x: x0, y: y0, w: Math.round((x1 - x0) * 1000) / 1000, h: Math.round((y1 - y0) * 1000) / 1000 }
}

/** Fidelity of one exact render: every placed cut-out is scored, the worst wins. */
async function scoreRender(r: RenderOutput, ratio: AspectRatio, diff: boolean): Promise<{ fidelity: FidelityResult; diffPng?: Buffer } | null> {
  if (!r.productPlacements?.length) return null
  let worst: Awaited<ReturnType<typeof scoreFidelity>> | null = null
  for (const p of r.productPlacements) {
    const s = await scoreFidelity({ image: r.png, box: p.box, reference: p.placed, ...(p.background ? { background: p.background } : {}), method: r.relit ? 'relit' : r.harmonized ? 'harmonized' : 'composite', diff })
    if (!worst || (worst.passed && !s.passed) || (worst.passed === s.passed && s.score < worst.score)) worst = s
  }
  if (!worst) return null
  return { fidelity: toFidelityResult(worst, { ratio }), ...(worst.diffPng ? { diffPng: worst.diffPng } : {}) }
}

/**
 * Full-res JPG twin of a render (item 5 / G4): same pixels flattened on white, q92, stored next to
 * the PNG at a stable public URL. Best-effort: a failure only means no `jpgUrl` (the PNG ships).
 */
async function uploadJpgTwin(storage: AdPackStorage, pack: Pack, item: PackItem, ratio: AspectRatio, png: Uint8Array): Promise<string | undefined> {
  try {
    const jpg = await sharp(Buffer.from(png.buffer, png.byteOffset, png.byteLength)).flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
    const { url } = await storage.upload({
      userId: pack.userId,
      packId: pack.id,
      itemIndex: item.index,
      kind: `render-${ratio.replace(':', 'x')}-jpg`,
      bytes: new Uint8Array(jpg),
      contentType: 'image/jpeg',
    })
    return url
  } catch {
    return undefined
  }
}

export interface RenderAllRatiosResult {
  /** Delivered renders (exact mode: only ratios whose product passed fidelity). */
  renders: RenderedAd[]
  /** Item-level fidelity: worst DELIVERED ratio + cut-out recall (exact); vision verdict (generated). */
  fidelity?: FidelityResult
  /** Exact mode: ratios not delivered (fidelity failed), with the reason and a full-res diff (P0 #3). */
  rejected: RejectedRatio[]
}

/** Lowest cut-out recall of an item's cut-outs (hero + parts), when measured. */
function cutoutRecallOf(item: Pick<PackItem, 'scene'>): number | undefined {
  const values = (item.scene?.cutouts ?? []).map((c) => c.recall).filter((v): v is number => typeof v === 'number')
  return values.length ? Math.min(...values) : undefined
}

/** Highest backdrop share left in an item's cut-outs (round 1, P2), when measured. */
function cutoutLeakOf(item: Pick<PackItem, 'scene'>): number | undefined {
  const values = (item.scene?.cutouts ?? []).map((c) => c.backgroundLeak).filter((v): v is number => typeof v === 'number')
  return values.length ? Math.max(...values) : undefined
}

async function renderAllRatios(args: {
  renderer: Renderer
  storage: AdPackStorage
  pack: Pack
  item: PackItem
  copy: AdCopy
  sceneImage: Uint8Array | string
  /** Defaults to the pack's ratios. */
  ratios?: AspectRatio[]
  /** Exact mode inputs (cut-outs + light); null/undefined = generated mode. */
  exact?: ExactRenderInputs | null
  gateway?: ModelGateway
  logo?: Uint8Array | null
  /** Force the deterministic relight only (ratio regeneration / fallback). */
  relightAuto?: boolean
}): Promise<RenderAllRatiosResult> {
  const { renderer, storage, pack, item, copy, sceneImage, exact } = args
  const out: RenderedAd[] = []
  const rejected: RejectedRatio[] = []
  // relight 'auto' (default) = the renderer's deterministic stage; 'ai' adds the free, guarded model pass.
  const relightOn = Boolean(exact && !args.relightAuto && packRelightMode(pack) === 'ai' && args.gateway?.edit)
  const gateway = args.gateway
  const familyFor = (f?: LayoutFamily) => f ?? (exact?.bleed ? studioFamilyFor(item.index, item.angle.layoutFamily) : item.angle.layoutFamily)
  const renderRatio = (ratio: AspectRatio, withAi: boolean, family?: LayoutFamily) =>
    renderer.render({
      format: item.angle.format,
      ratio,
      sceneImage,
      copy,
      visual: pack.dna.visual ?? {},
      language: pack.dna.language,
      // Every family supports both modes; resize keeps the item's family (fonts come from dna.visual).
      ...(familyFor(family) ? { layoutFamily: familyFor(family) } : {}),
      ...(args.logo ? { logo: args.logo } : {}),
      ...(exact
        ? {
            productMode: 'exact' as const,
            productCutout: exact.cutouts[0],
            ...(exact.bleed && pack.dna.brandName ? { brandName: pack.dna.brandName } : {}),
            ...(exact.bleed ? { studioBleed: { layer: exact.bleed.bytes, productBox: exact.bleed.ref.productBox, backdrop: exact.bleed.ref.backdrop, edgesTouched: exact.bleed.ref.edgesTouched, ...(exact.bleed.ref.preScale ? { preScale: exact.bleed.ref.preScale } : {}) } } : {}),
            ...(exact.cutouts.length > 1 ? { productParts: exact.cutouts.slice(1) } : {}),
            ...(exact.light ? { light: exact.light } : {}),
            ...(exact.surface ? { surface: exact.surface } : {}),
            ...(exact.topDown ? { topDown: true } : {}),
            ...(withAi && gateway
              ? {
                  relight: async (composite: Uint8Array, placements: NonNullable<RenderOutput['productPlacements']>, rr: AspectRatio) => {
                    const res = await relightComposite({
                      gateway,
                      composite: Buffer.from(composite),
                      placements: placements.map((p) => ({ box: p.box, placed: Buffer.from(p.placed), role: p.role, ...(p.background ? { background: Buffer.from(p.background) } : {}) })),
                      ratio: rr,
                      immutableAttributes: pack.render?.immutableAttributes ?? pack.offer.immutableAttributes,
                    })
                    return res.relit ? new Uint8Array(res.png) : null
                  },
                }
              : {}),
          }
        : {
            productCutout: pack.offer.productCutoutUrl,
            // One product-avoid input: the scene's own box, else the vision-check bbox.
            ...(sceneProductBox(item) ? { productBox: sceneProductBox(item) } : {}),
          }),
    })
  const recall = exact ? cutoutRecallOf(item) : undefined
  // A studio bleed has no cut edge: the cut-out's leftover backdrop does not apply.
  const backgroundLeak = exact && !exact.bleed ? cutoutLeakOf(item) : undefined
  const gateOn = Boolean(exact) && (pack.render?.qaGate ?? 'on') !== 'off'
  const gateInputs = gateOn ? qaGateInputsFor(pack, item, copy) : null
  const outputs = new Map<AspectRatio, RenderOutput>()
  for (const ratio of args.ratios ?? pack.ratios) {
    let r = await renderRatio(ratio, relightOn)
    let scored = exact ? await scoreRender(r, ratio, false) : null
    let fallback = false
    // P0 #3: the AI relight changed the product on this ratio → retry it with 'auto' before rejecting.
    if (exact && r.relit && scored && !scored.fidelity.passed) {
      const again = await renderRatio(ratio, false)
      const againScored = await scoreRender(again, ratio, false)
      if (againScored && (againScored.fidelity.passed || againScored.fidelity.score >= scored.fidelity.score)) {
        r = again
        scored = againScored
        fallback = true
      }
    }
    const fidelity: FidelityResult | undefined = scored
      ? {
          ...scored.fidelity,
          ...(recall !== undefined ? { recall } : {}),
          ...(backgroundLeak !== undefined ? { backgroundLeak } : {}),
          // A cut-out that still carries the photo's backdrop never passes (round 1 halo scored 0.95).
          ...(backgroundLeak !== undefined && backgroundLeak > BACKGROUND_LEAK_MAX ? { passed: false } : {}),
          ...(fallback ? { relightFallback: 'auto' as const } : {}),
        }
      : undefined
    // Round 1b QA gate: alternate layouts first; a render failing a hard check is never delivered.
    let qa: QaGateSummary | undefined
    if (gateInputs && fidelity?.passed && r.qaReport) {
      const tried: LayoutFamily[] = []
      const first = familyFor(undefined)
      const order = qaFamilyOrder(first, item.angle.format, Boolean(exact?.bleed))
      let gate = await gateRender(r, ratio, gateInputs, Boolean(exact?.bleed), backgroundLeak)
      tried.push(r.layoutFamily ?? first ?? 'bold_pill')
      for (const alt of order) {
        if (gate.passed) break
        if (tried.includes(alt)) continue
        const again = await renderRatio(ratio, false, alt)
        const againScored = await scoreRender(again, ratio, false)
        tried.push(alt)
        if (!againScored?.fidelity.passed || !again.qaReport) continue
        const g2 = await gateRender(again, ratio, gateInputs, Boolean(exact?.bleed), backgroundLeak)
        if (g2.passed || g2.score > gate.score) {
          r = again
          scored = againScored
          gate = g2
        }
      }
      qa = toQaSummary(gate, tried.length, r.layoutFamily)
      if (!gate.passed) {
        const f: FidelityResult = fidelity
        rejected.push({ ratio, reason: `qa_gate_failed: ${gate.failed.join(', ')}${gate.metrics.find((m) => !m.passed)?.detail ? ` (${gate.metrics.find((m) => !m.passed)!.detail})` : ''}`.slice(0, 300), fidelity: { ...f, passed: false }, qa })
        continue
      }
    }
    if (exact && (!fidelity || !fidelity.passed)) {
      // Never deliver an altered product: this ratio is listed, not uploaded as a render.
      const f: FidelityResult = fidelity ?? { score: 0, ssim: null, deltaE: null, passed: false, method: 'composite', ratio }
      let diffImageUrl: string | undefined
      try {
        const again = await scoreRender(r, ratio, true)
        if (again?.diffPng) {
          diffImageUrl = (await storage.upload({ userId: pack.userId, packId: pack.id, itemIndex: item.index, kind: `fidelity-${ratio.replace(':', 'x')}`, bytes: new Uint8Array(again.diffPng), contentType: 'image/png' })).url
        }
      } catch {
        diffImageUrl = undefined
      }
      rejected.push({ ratio, reason: fidelity ? fidelityFailReason(fidelity) : 'product placement missing in render', fidelity: { ...f, ...(diffImageUrl ? { diffImageUrl } : {}) } })
      continue
    }
    const { url } = await storage.upload({
      userId: pack.userId,
      packId: pack.id,
      itemIndex: item.index,
      kind: `render-${ratio.replace(':', 'x')}`,
      bytes: r.png,
      contentType: 'image/png',
    })
    const jpgUrl = await uploadJpgTwin(storage, pack, item, ratio, r.png)
    out.push({ ratio, imageUrl: url, ...(jpgUrl ? { jpgUrl } : {}), width: r.width, height: r.height, ...(fidelity ? { fidelity } : {}), ...(r.fontsUsed ? { fontsUsed: r.fontsUsed } : {}), ...(qa ? { qa } : {}) })
    outputs.set(ratio, r)
  }
  if (!exact) {
    // Generated mode: no pixel alignment — fidelity is the vision verdict on the scene.
    const sc = item.sceneCheck
    if (!sc || sc.productMatches === null || sc.productMatches === undefined) return { renders: out, rejected }
    const fidelity: FidelityResult = { score: Math.round(sc.score * 1000) / 1000, ssim: null, deltaE: null, passed: sc.productMatches !== false, method: 'generated' }
    return { renders: out, fidelity, rejected }
  }
  const worst = worstFidelity(out)
  if (!worst) return { renders: out, rejected, ...(rejected.length ? { fidelity: worstRejected(rejected) } : {}) }
  // Heatmap of the worst delivered ratio (A4), at placement resolution, best-effort.
  let diffImageUrl: string | undefined
  const w = worst.ratio ? outputs.get(worst.ratio) : undefined
  if (w && worst.ratio) {
    try {
      const again = await scoreRender(w, worst.ratio, true)
      if (again?.diffPng) {
        diffImageUrl = (await storage.upload({ userId: pack.userId, packId: pack.id, itemIndex: item.index, kind: `fidelity-${worst.ratio.replace(':', 'x')}`, bytes: new Uint8Array(again.diffPng), contentType: 'image/png' })).url
      }
    } catch {
      diffImageUrl = undefined
    }
  }
  return { renders: out, fidelity: { ...worst, ...(diffImageUrl ? { diffImageUrl } : {}) }, rejected }
}

/** Round 1b: what the QA gate checks for an item (required facts + allowed claims). */
interface QaGateInputs {
  requiredFacts: QaRequiredFact[]
  caption: string
  headline: string
  claims: string[]
  brandName?: string
}

function qaGateInputsFor(pack: Pack, item: PackItem, copy: AdCopy): QaGateInputs | null {
  try {
    const cc = buildCopyContext(pack.dna, offerForItem(pack.offer, item.index), item.angle, pack.dna.language)
    const requiredFacts: QaRequiredFact[] = cc.mustAppear.map((m) => ({ key: m.group, value: m.fact.value, ...(m.group === 'price' && copy.offerLine ? { onImage: true } : {}) }))
    return { requiredFacts, caption: copy.caption ?? '', headline: copy.headline ?? '', claims: cc.confirmed.map((f) => f.value), ...(pack.dna.brandName ? { brandName: pack.dna.brandName } : {}) }
  } catch {
    return { requiredFacts: [], caption: copy.caption ?? '', headline: copy.headline ?? '', claims: [] }
  }
}

/** Round 1c: the four studio-bleed compositions, in rotation order (a pack never repeats one before using all four). */
export const STUDIO_FAMILIES = ['studio_hero', 'studio_navy_top', 'studio_top', 'studio_navy_bottom'] as const satisfies readonly LayoutFamily[]

export function isStudioFamily(f: LayoutFamily | undefined): boolean {
  return Boolean(f && (STUDIO_FAMILIES as readonly string[]).includes(f))
}

/** Studio family for the ad at `index` (the planner's own studio pick wins; otherwise rotate by position). */
export function studioFamilyFor(index: number, planned?: LayoutFamily): LayoutFamily {
  if (planned && isStudioFamily(planned)) return planned
  return STUDIO_FAMILIES[((index % STUDIO_FAMILIES.length) + STUDIO_FAMILIES.length) % STUDIO_FAMILIES.length]
}

/** Alternate families tried (in order) when a render fails the gate. */
export function qaFamilyOrder(first: LayoutFamily | undefined, format: PackItem['angle']['format'], bleed: boolean): LayoutFamily[] {
  if (bleed) {
    // Other studio compositions first, next in the rotation after `first`.
    const at = Math.max(0, STUDIO_FAMILIES.indexOf((first ?? 'studio_hero') as (typeof STUDIO_FAMILIES)[number]))
    const rest = STUDIO_FAMILIES.map((_, i) => STUDIO_FAMILIES[(at + 1 + i) % STUDIO_FAMILIES.length]).filter((f) => f !== first)
    return (['offer_graphic', 'variant_card', 'explainer'].includes(format) ? rest : (['editorial_minimal', 'full_bleed_type'] as LayoutFamily[])).slice(0, 3)
  }
  const base: LayoutFamily[] = ['badge_corner', 'editorial_minimal', 'full_bleed_type', 'split_panel']
  return base.filter((f) => f !== first).slice(0, 2)
}

async function gateRender(r: RenderOutput, ratio: AspectRatio, g: QaGateInputs, bleed: boolean, backgroundLeak?: number): Promise<QaGateResult> {
  return runQaGate({
    png: r.png,
    ratio,
    report: r.qaReport!,
    ...(r.productPlacements?.[0] && !bleed ? { heroPlaced: r.productPlacements[0].placed } : {}),
    bleed,
    ...(bleed ? { oneIdeaHeadline: true } : {}),
    ...(g.brandName ? { brandName: g.brandName } : {}),
    ...(backgroundLeak !== undefined ? { backgroundLeak } : {}),
    requiredFacts: g.requiredFacts,
    caption: g.caption,
    headline: g.headline,
    claims: g.claims,
    matchFact: (text, fact) => textCarriesFact(text, fact),
  })
}

function toQaSummary(g: QaGateResult, attempts: number, family?: LayoutFamily): QaGateSummary {
  return {
    passed: g.passed,
    score: g.score,
    failed: g.failed,
    metrics: g.metrics.map((m) => ({ id: m.id, value: m.value, threshold: m.threshold, passed: m.passed, ...(m.detail ? { detail: m.detail } : {}) })),
    attempts,
    ...(family ? { layoutFamily: family } : {}),
  }
}

/** The worst rejected ratio's fidelity (item-level value when nothing was delivered). */
function worstRejected(rejected: RejectedRatio[]): FidelityResult {
  return rejected.map((r) => r.fidelity).reduce((w, f) => (f.score < w.score ? f : w))
}

/** Background-removed logo for this pack, cached by hash in storage (prod storage only). */
function packLogo(ctx: RunCtx): Promise<Uint8Array | null> {
  if (ctx.logo) return ctx.logo
  const url = ctx.pack.dna.visual?.logoUrl
  const storage = ctx.input.storage
  // Only with a storage that supports the deterministic cache (prod); otherwise the renderer loads visual.logoUrl itself.
  if (!url || !storage.download || !storage.uploadAt) return (ctx.logo = Promise.resolve(null))
  ctx.logo = (async () => {
    try {
      const bytes = await (ctx.input.loadImage ?? defaultImageLoader)(url)
      return (await cachedLogo(bytes, storageBlobCache(storage, ctx.pack.userId, 'logos'))).png
    } catch {
      return null
    }
  })()
  return ctx.logo
}

async function stepRender(ctx: RunCtx, item: PackItem): Promise<PackItem> {
  if (!item.copy || !item.scene) return fail(ctx, item, 'render_missing_inputs')
  const t0 = Date.now()
  const cached = ctx.sceneBytes.get(item.id)
  const exactMode = packMode(ctx.pack) === 'exact'
  let exact: ExactRenderInputs | null = null
  if (exactMode) {
    try {
      exact = await exactInputsFromScene(item, ctx.input.loadImage ?? defaultImageLoader, ctx.cutoutBytes.get(item.id), ctx.bleedBytes.get(item.id))
    } catch (error) {
      return fail(ctx, item, `cutout_failed: ${errorMessage(error)}`, { timings: { ...item.timings, renderMs: Date.now() - t0 } })
    }
  }
  const logo = await packLogo(ctx)
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    let rendered: Awaited<ReturnType<typeof renderAllRatios>>
    try {
      rendered = await renderAllRatios({
        renderer: ctx.input.renderer,
        storage: ctx.input.storage,
        pack: ctx.pack,
        item,
        copy: item.copy,
        sceneImage: cached?.bytes ?? item.scene.imageUrl,
        exact,
        gateway: ctx.input.gateway,
        logo,
      })
    } catch (error) {
      lastError = errorMessage(error)
      continue
    }
    const timings = { ...item.timings, renderMs: Date.now() - t0 }
    const fidelity = rendered.fidelity
    const rejectedRatios = rendered.rejected
    const sceneCheck = fidelity
      ? { ...(item.sceneCheck ?? { ok: true, productMatches: null, strayText: null, score: 0.5 }), fidelity, ...(rejectedRatios.length ? { rejectedRatios } : { rejectedRatios: undefined }) }
      : item.sceneCheck
    if (exactMode && !rendered.renders.length) {
      // P0 #3: no ratio kept the real product → the ad fails (no charge); every ratio is listed.
      const worst = rejectedRatios[0] ? rejectedRatios.reduce((w, r) => (r.fidelity.score < w.fidelity.score ? r : w)) : null
      if (!worst) return fail(ctx, item, 'fidelity_failed: product placement missing in render', { renders: [], timings })
      const prefix = worst.qa ? '' : 'fidelity_failed: '
      return fail(ctx, item, `${prefix}${worst.reason} (${rejectedRatios.map((r) => r.ratio).join(', ')})`, { fidelity: worst.fidelity, sceneCheck, renders: [], rejectedRatios, timings })
    }
    // Fidelity order per ratio: AI relight → deterministic relight fallback (renderAllRatios) →
    // one re-plate AT that ratio (here, free, no item retry used) → listed in rejectedRatios.
    let renders = rendered.renders
    let rejectedNow = rejectedRatios
    let replateCost = 0
    if (exactMode && exact && renders.length && rejectedNow.length && ctx.input.ratioReplate !== false && Date.now() < ctx.deadline) {
      const still: RejectedRatio[] = []
      for (const rj of rejectedNow) {
        // A QA-gate rejection already tried the alternate layouts; a new plate does not fix it.
        if (rj.qa || exact.bleed) {
          still.push(rj)
          continue
        }
        try {
          const rp = await replateOneRatio({ gateway: ctx.input.gateway, renderer: ctx.input.renderer, storage: ctx.input.storage, pack: ctx.pack, item, copy: item.copy, exact, ratio: rj.ratio, maxPlateRetries: 0 })
          replateCost += rp.costUsd
          const got = rp.res?.renders[0]
          if (got) {
            renders = [...renders, { ...got, ...(rp.plateUrl ? { plateUrl: rp.plateUrl } : {}) }].sort((x, y) => ctx.pack.ratios.indexOf(x.ratio) - ctx.pack.ratios.indexOf(y.ratio))
            continue
          }
          still.push(rp.res?.rejected[0] ?? rj)
        } catch {
          still.push(rj)
        }
      }
      rejectedNow = still
    }
    const finalFidelity = rejectedNow.length === rejectedRatios.length ? fidelity : (worstFidelity(renders) ?? fidelity)
    const finalCheck = finalFidelity
      ? { ...(item.sceneCheck ?? { ok: true, productMatches: null, strayText: null, score: 0.5 }), fidelity: finalFidelity, ...(rejectedNow.length ? { rejectedRatios: rejectedNow } : { rejectedRatios: undefined }) }
      : sceneCheck
    // Partial delivery: the passing ratios ship (charged once as one ad); rejected ones are listed
    // and can be regenerated alone (adpack_regenerate { ratio }, free).
    return save(ctx, item, {
      status: 'rendered',
      renders,
      ...(finalFidelity ? { fidelity: finalFidelity, sceneCheck: finalCheck } : {}),
      rejectedRatios: rejectedNow.length ? rejectedNow : undefined,
      ...(replateCost ? { costUsd: (item.costUsd ?? 0) + replateCost } : {}),
      timings: { ...timings, renderMs: Date.now() - t0 },
      error: undefined,
    })
  }
  return fail(ctx, item, `render_failed: ${lastError}`, { timings: { ...item.timings, renderMs: Date.now() - t0 } })
}

async function stepCharge(ctx: RunCtx, item: PackItem): Promise<PackItem> {
  const t0 = Date.now()
  try {
    // One charge per ad: relighting (deterministic or AI) is included.
    await ctx.input.charge({ userId: ctx.pack.userId, generationId: item.generationId })
  } catch (error) {
    return fail(ctx, item, `charge_failed: ${errorMessage(error)}`, { timings: { ...item.timings, chargeMs: Date.now() - t0 } })
  }
  return save(ctx, item, {
    status: 'done',
    chargedAt: nowIso(),
    leaseUntil: undefined,
    error: undefined,
    timings: { ...item.timings, chargeMs: Date.now() - t0 },
  })
}

// ---------------------------------------------------------------------------
// Edit text (free) + regenerate
// ---------------------------------------------------------------------------

export type CopyTextPatch = Partial<Pick<AdCopy, 'headline' | 'subline' | 'bullets' | 'offerLine' | 'cta' | 'caption' | 'script'>>

const EDITABLE_FIELDS: Array<keyof CopyTextPatch> = ['headline', 'subline', 'bullets', 'offerLine', 'cta', 'caption', 'script']

export interface EditItemTextInput {
  store: PackStore
  renderer: Renderer
  storage: AdPackStorage
  packId: string
  itemId: string
  userId: string
  copyPatch: CopyTextPatch
  /** Exact mode: loads the stored cut-outs (tests inject). */
  loadImage?: ImageLoader
}

export type EditItemTextResult =
  | { ok: true; item: PackItem }
  | { ok: false; error: 'pack_not_found' | 'item_not_found' | 'item_not_rendered' | 'copy_rejected'; issues?: CopyCheckIssue[] }

/** Deterministic re-check + re-render only. No model calls, no credits. */
export async function editItemText(input: EditItemTextInput): Promise<EditItemTextResult> {
  const loaded = await input.store.getPack(input.packId, input.userId)
  if (!loaded) return { ok: false, error: 'pack_not_found' }
  const { pack, items } = loaded
  const item = items.find((i) => i.id === input.itemId)
  if (!item) return { ok: false, error: 'item_not_found' }
  if (!item.copy || !item.scene || (item.status !== 'rendered' && item.status !== 'done')) return { ok: false, error: 'item_not_rendered' }

  const patch: Partial<AdCopy> = {}
  for (const f of EDITABLE_FIELDS) {
    if (input.copyPatch[f] !== undefined) (patch as Record<string, unknown>)[f] = input.copyPatch[f]
  }
  const copy: AdCopy = { ...item.copy, ...patch }
  const check = checkAdCopy(copy, {
    dna: pack.dna,
    offer: pack.offer,
    angle: item.angle,
    language: pack.dna.language,
    otherCopies: items.filter((i) => i.id !== item.id && i.copy && i.status !== 'failed').map((i) => i.copy as AdCopy),
    userEdit: true,
  })
  const blocking = blockingIssuesFor(check, pack.offer, EDIT_BLOCKING_COPY_CODES)
  if (blocking.length) return { ok: false, error: 'copy_rejected', issues: blocking }

  const t0 = Date.now()
  // Keep every ratio the ad has (pack ratios + any added by a free resize).
  const ratios = [...new Set([...pack.ratios, ...(item.renders ?? []).map((r) => r.ratio)])]
  const exactInputs = packMode(pack) === 'exact' ? await exactInputsFromScene(item, input.loadImage ?? defaultImageLoader) : null
  // A ratio regenerated alone has its own plate (render.plateUrl): re-render it on that plate.
  const ownPlate = new Map((item.renders ?? []).filter((r) => r.plateUrl).map((r) => [r.ratio, r.plateUrl as string]))
  const rendered = await renderAllRatios({
    renderer: input.renderer,
    storage: input.storage,
    pack,
    item,
    copy,
    sceneImage: item.scene.imageUrl,
    ratios: ratios.filter((r) => !ownPlate.has(r)),
    exact: exactInputs,
  })
  for (const [ratio, plateUrl] of ownPlate) {
    const one = await renderAllRatios({ renderer: input.renderer, storage: input.storage, pack, item, copy, sceneImage: plateUrl, ratios: [ratio], exact: exactInputs, relightAuto: true })
    rendered.renders.push(...one.renders.map((r) => ({ ...r, plateUrl })))
    rendered.rejected.push(...one.rejected)
  }
  rendered.renders.sort((a, b) => ratios.indexOf(a.ratio) - ratios.indexOf(b.ratio))
  if (ownPlate.size && exactInputs) rendered.fidelity = worstFidelity(rendered.renders) ?? rendered.fidelity
  // Same scene and cut-out: fidelity is re-measured on the new renders. A ratio that no longer
  // passes is listed in rejectedRatios (never shipped); ratios regenerated alone keep their plate.
  const renders = rendered.renders
  const fidelity = rendered.fidelity ?? item.fidelity
  const rejectedRatios = [...(item.rejectedRatios ?? []).filter((r) => !renders.some((x) => x.ratio === r.ratio) && !rendered.rejected.some((x) => x.ratio === r.ratio)), ...rendered.rejected]
  const next: Partial<PackItem> = {
    copy,
    copyCheck: check,
    renders,
    timings: { ...item.timings, renderMs: Date.now() - t0 },
    rejectedRatios: rejectedRatios.length ? rejectedRatios : undefined,
    ...(fidelity ? { fidelity, sceneCheck: { ...(item.sceneCheck ?? { ok: true, productMatches: null, strayText: null, score: 0.5 }), fidelity, rejectedRatios: rejectedRatios.length ? rejectedRatios : undefined } } : {}),
  }
  await input.store.updateItem(item.id, next)
  return { ok: true, item: { ...item, ...next, updatedAt: nowIso() } }
}

// ---------------------------------------------------------------------------
// Resize (free): same scene + same copy, new ratios — renderer only
// ---------------------------------------------------------------------------


export interface ResizeItemInput {
  store: PackStore
  renderer: Renderer
  storage: AdPackStorage
  packId: string
  itemId: string
  userId: string
  ratios: AspectRatio[]
  /** Exact mode: loads the stored cut-outs (tests inject). */
  loadImage?: ImageLoader
}

export type ResizeItemResult =
  | {
      ok: true
      item: PackItem
      added: AspectRatio[]
      /** How the new ratios were made: 'composite' (stored plate + cut-outs) or 'scene' (stored final scene). */
      method?: 'composite' | 'scene'
      /** New ratios not delivered because the real product did not survive the re-composite. */
      rejected?: RejectedRatio[]
    }
  | { ok: false; error: 'pack_not_found' | 'item_not_found' | 'item_not_rendered' | 'cutout_missing' }

/**
 * Render an already-finished ad into more ratios from its stored scene + copy. No model calls,
 * no credits (H6). Ratios the ad already has are kept as they are; the item's renders become
 * the union (existing ratios first).
 *
 * Exact mode: the stored product-free plate + the stored real-product cut-outs are composited
 * again (same light, product box reserved so text never covers the product) and every new ratio
 * is fidelity-scored; a ratio that fails is not delivered. The deterministic relight stage runs
 * (no model call); the AI relight pass does not (resize stays model-free).
 * When the cut-outs are not stored (legacy / generated scene) the stored final scene is
 * re-rendered and each new file carries fidelity.method 'generated' (vision verdict, no pixels).
 * A plate whose cut-outs can no longer be loaded is refused (a plate alone has no product).
 */
export async function resizeItem(input: ResizeItemInput): Promise<ResizeItemResult> {
  const loaded = await input.store.getPack(input.packId, input.userId)
  if (!loaded) return { ok: false, error: 'pack_not_found' }
  const { pack, items } = loaded
  const item = items.find((i) => i.id === input.itemId)
  if (!item) return { ok: false, error: 'item_not_found' }
  if (!item.copy || !item.scene || (item.status !== 'rendered' && item.status !== 'done')) return { ok: false, error: 'item_not_rendered' }
  const have = new Set((item.renders ?? []).map((r) => r.ratio))
  const missing = [...new Set(input.ratios)].filter((r) => !have.has(r))
  if (!missing.length) return { ok: true, item, added: [] }
  const t0 = Date.now()
  const isPlate = item.scene.kind === 'plate'
  let exact: ExactRenderInputs | null = null
  if (packMode(pack) === 'exact' && (isPlate || item.scene.cutouts?.length)) {
    try {
      exact = await exactInputsFromScene(item, input.loadImage ?? defaultImageLoader)
    } catch {
      exact = null
    }
    if (!exact && isPlate) return { ok: false, error: 'cutout_missing' }
  }
  const rendered = await renderAllRatios({ renderer: input.renderer, storage: input.storage, pack, item, copy: item.copy, sceneImage: item.scene.imageUrl, ratios: missing, exact })
  let fresh = rendered.renders
  // Exact mode: a new ratio without a passing fidelity was not delivered (renderAllRatios lists it).
  const rejected: RejectedRatio[] = exact ? rendered.rejected : []
  if (!exact) {
    const sc = item.sceneCheck
    const verdict: FidelityResult = {
      score: Math.round((sc?.score ?? 0.5) * 1000) / 1000,
      ssim: null,
      deltaE: null,
      passed: sc?.productMatches !== false,
      method: 'generated',
    }
    fresh = fresh.map((r) => ({ ...r, fidelity: { ...verdict, ratio: r.ratio } }))
  }
  const renders = [...(item.renders ?? []), ...fresh]
  const next: Partial<PackItem> = { renders, timings: { ...item.timings, renderMs: Date.now() - t0 } }
  if (exact && (rejected.length || item.rejectedRatios?.length)) {
    // Keep the item's rejected list in sync: delivered ratios leave it, newly failed ones join it.
    const list = [...(item.rejectedRatios ?? []).filter((r) => !renders.some((x) => x.ratio === r.ratio) && !rejected.some((x) => x.ratio === r.ratio)), ...rejected]
    next.rejectedRatios = list.length ? list : undefined
    next.sceneCheck = { ...(item.sceneCheck ?? { ok: true, productMatches: null, strayText: null, score: 0.5 }), rejectedRatios: list.length ? list : undefined }
  }
  await input.store.updateItem(item.id, next)
  return {
    ok: true,
    item: { ...item, ...next, updatedAt: nowIso() },
    added: fresh.map((r) => r.ratio),
    method: exact ? 'composite' : 'scene',
    ...(rejected.length ? { rejected } : {}),
  }
}

export interface RegenerateItemInput {
  store: PackStore
  packId: string
  itemId: string
  userId: string
  /** 'copy' = new copy + scene (→ planned); 'scene' = keep copy, new scene (→ copy_ready). */
  mode: 'copy' | 'scene'
}

export type RegenerateItemResult = { ok: true; item: PackItem } | { ok: false; error: 'pack_not_found' | 'item_not_found' | 'item_busy' }

/** Reset one ad for another run. attempts+1 and a new `:r<attempt>` generationId (charged once more). */
export async function regenerateItem(input: RegenerateItemInput): Promise<RegenerateItemResult> {
  const loaded = await input.store.getPack(input.packId, input.userId)
  if (!loaded) return { ok: false, error: 'pack_not_found' }
  const item = loaded.items.find((i) => i.id === input.itemId)
  if (!item) return { ok: false, error: 'item_not_found' }
  if (item.leaseUntil && Date.parse(item.leaseUntil) > Date.now() && !TERMINAL.has(item.status)) return { ok: false, error: 'item_busy' }

  const attempts = item.attempts + 1
  const keepCopy = input.mode === 'scene' && Boolean(item.copy)
  // P1 #10: new copy never repeats the previous headline; after a copy rejection it also switches hook type.
  const rejected = item.status === 'failed' && (item.error ?? '').startsWith('copy')
  const retryAngle: AdAngle | undefined = !keepCopy && (item.copy?.headline || rejected)
    ? {
        ...item.angle,
        retry: {
          attempt: (item.angle.retry?.attempt ?? 0) + 1,
          avoidHeadlines: [...new Set([...(item.angle.retry?.avoidHeadlines ?? []), item.copy?.headline ?? ''].filter(Boolean))].slice(-4),
          ...(rejected
            ? { hookType: alternateHook(item.angle, loaded.pack.dna, loaded.pack.offer, (item.angle.retry?.attempt ?? 0) + 1) }
            : item.angle.retry?.hookType ? { hookType: item.angle.retry.hookType } : {}),
        },
      }
    : undefined
  const patch: Partial<PackItem> = {
    status: keepCopy ? 'copy_ready' : 'planned',
    attempts,
    ...(retryAngle ? { angle: retryAngle } : {}),
    generationId: itemGenerationId(loaded.pack.id, item.index, attempts),
    copy: keepCopy ? item.copy : undefined,
    copyCheck: keepCopy ? item.copyCheck : undefined,
    scene: undefined,
    sceneCheck: undefined,
    renders: [],
    error: undefined,
    chargedAt: undefined,
    leaseUntil: undefined,
    sceneAttempts: undefined,
    timings: undefined,
    fidelity: undefined,
    rejectedRatios: undefined,
  }
  await input.store.updateItem(item.id, patch)
  if (loaded.pack.status !== 'running') await input.store.updatePack(loaded.pack.id, { status: 'running' })
  const next = { ...item, ...patch, updatedAt: nowIso() }
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k]
  return { ok: true, item: next }
}

// ---------------------------------------------------------------------------
// Regenerate ONE ratio of a delivered ad (P0 #3): free, the ad was charged once
// ---------------------------------------------------------------------------

export interface RegenerateRatioInput {
  store: PackStore
  gateway: ModelGateway
  renderer: Renderer
  storage: AdPackStorage
  packId: string
  itemId: string
  userId: string
  ratio: AspectRatio
  /** Exact mode: loads the stored cut-outs (tests inject). */
  loadImage?: ImageLoader
  /** Plate retries for the new plate (default 1). */
  maxPlateRetries?: number
}

export type RegenerateRatioResult =
  | {
      ok: true
      item: PackItem
      ratio: AspectRatio
      delivered: boolean
      /** recomposite = same plate, deterministic relight; replate = a new background plate for this ratio only. */
      method: 'recomposite' | 'replate'
      /** Present when the ratio still did not keep the real product. */
      rejected?: RejectedRatio
      costUsd: number
    }
  | { ok: false; error: 'pack_not_found' | 'item_not_found' | 'item_not_rendered' | 'not_exact' | 'cutout_missing' | 'ratio_not_in_pack' | 'item_busy' }

/**
 * Regenerate only one ratio of an exact-mode ad that was delivered in other ratios (P0 #3). No
 * credits (the ad was charged once when delivered). First the stored plate is re-composited with
 * the deterministic relight; when the product still does not survive, a NEW plate is generated for
 * that ratio alone (one model call + props check), composited and fidelity-checked. The other
 * ratios are never touched. A ratio that still fails stays in `rejectedRatios` (not delivered).
 */
/**
 * A new background plate generated AT one ratio, then that ratio re-composited on it (exact mode).
 * Shared by the free ratio regeneration and the runner's per-ratio retry (before a ratio is listed
 * as rejected). Never touches the other ratios.
 */
async function replateOneRatio(args: {
  gateway: ModelGateway
  renderer: Renderer
  storage: AdPackStorage
  pack: Pack
  item: PackItem
  copy: AdCopy
  exact: ExactRenderInputs
  ratio: AspectRatio
  maxPlateRetries: number
}): Promise<{ res: RenderAllRatiosResult | null; plateUrl?: string; costUsd: number }> {
  const { pack, item, copy, exact, ratio } = args
  let costUsd = 0
  let res: RenderAllRatiosResult | null = null
  let plateUrl: string | undefined
  const hero = await sharp(Buffer.from(exact.cutouts[0])).metadata()
  const placement = plateRegionFor({ pack, format: item.angle.format, copy, product: { width: hero.width ?? 1, height: hero.height ?? 1 }, layoutFamily: item.angle.layoutFamily, ratios: [ratio], plateRatio: ratio })
  const offer = offerForItem(pack.offer, item.index)
  const view = item.scene?.view === 'overhead' ? ('overhead' as const) : undefined
  const refs: PropsReference[] = (item.scene?.cutouts ?? []).slice(0, 3).map((c) => ({ image: c.sourceUrl, role: c.role, ...(c.label ? { label: c.label } : {}) }))
  const allowedProps = pack.render?.allowedProps ?? offer.allowedProps
  const immutableAttributes = pack.render?.immutableAttributes ?? offer.immutableAttributes
  let hint: string | undefined
  for (let a = 0; a <= Math.max(0, args.maxPlateRetries); a++) {
    let plate
    try {
      plate = await generatePlate({
        gateway: args.gateway,
        format: item.angle.format,
        dna: pack.dna,
        offer,
        placement,
        light: exact.light ?? 'left',
        surface: exact.surface ?? 'matte',
        variation: item.attempts + a + 1,
        allowedProps,
        immutableAttributes,
        sceneBrief: stripCopyText(copy.sceneBrief ?? '', copy),
        draft: true,
        ratio,
        promptSuffix: hint,
        ...(view ? { view } : {}),
      })
    } catch {
      continue
    }
    costUsd += plate.costUsd
    let check: PlateCheckResult | null = null
    try {
      check = await checkPlate({ gateway: args.gateway, plateImage: toDataUrl(plate.bytes, plate.mimeType), refs, allowedProps, placement, language: pack.dna.language, immutableAttributes, ...(view ? { view } : {}) })
      costUsd += check.costUsd
    } catch {
      check = null
    }
    if (check && !check.ok) {
      hint = check.extraObjects.length ? PLATE_RETRY_HINT_PROPS : PLATE_RETRY_HINT_PLACEMENT
      continue
    }
    const contentType = plate.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    plateUrl = (await args.storage.upload({ userId: pack.userId, packId: pack.id, itemIndex: item.index, kind: 'plate', bytes: plate.bytes, contentType })).url
    res = await renderAllRatios({ renderer: args.renderer, storage: args.storage, pack, item, copy, ratios: [ratio], exact, relightAuto: true, sceneImage: plate.bytes })
    if (res.renders.length) break
  }
  return { res, ...(plateUrl ? { plateUrl } : {}), costUsd }
}

/** Cheap pre-checks of a ratio regeneration (no image I/O): the reason it cannot run, or null. */
export function ratioRegenBlocker(pack: Pack, item: PackItem, ratio: AspectRatio): 'item_busy' | 'item_not_rendered' | 'not_exact' | 'ratio_not_in_pack' | null {
  if (item.leaseUntil && Date.parse(item.leaseUntil) > Date.now() && !TERMINAL.has(item.status)) return 'item_busy'
  if (!item.copy || !item.scene || (item.status !== 'rendered' && item.status !== 'done') || !item.renders.length) return 'item_not_rendered'
  if (packMode(pack) !== 'exact' || item.scene.kind !== 'plate') return 'not_exact'
  if (!pack.ratios.includes(ratio) && !(item.rejectedRatios ?? []).some((r) => r.ratio === ratio) && !item.renders.some((r) => r.ratio === ratio)) return 'ratio_not_in_pack'
  return null
}

export async function regenerateRatio(input: RegenerateRatioInput): Promise<RegenerateRatioResult> {
  const loaded = await input.store.getPack(input.packId, input.userId)
  if (!loaded) return { ok: false, error: 'pack_not_found' }
  const { pack, items } = loaded
  const item = items.find((i) => i.id === input.itemId)
  if (!item) return { ok: false, error: 'item_not_found' }
  const ratio = input.ratio
  const blocked = ratioRegenBlocker(pack, item, ratio)
  if (blocked) return { ok: false, error: blocked }
  if (!item.copy || !item.scene) return { ok: false, error: 'item_not_rendered' }
  let exact: ExactRenderInputs
  try {
    exact = await exactInputsFromScene(item, input.loadImage ?? defaultImageLoader)
  } catch {
    return { ok: false, error: 'cutout_missing' }
  }
  const t0 = Date.now()
  let costUsd = 0
  const copy = item.copy
  const base = { renderer: input.renderer, storage: input.storage, pack, item, copy, ratios: [ratio], exact, relightAuto: true }
  // 1) Same plate, deterministic relight only (cheap, no model call).
  let method: 'recomposite' | 'replate' = 'recomposite'
  let res = await renderAllRatios({ ...base, sceneImage: item.scene.imageUrl })
  let plateUrl: string | undefined
  // 2) A new plate for this ratio alone.
  if (!res.renders.length) {
    method = 'replate'
    const rp = await replateOneRatio({ gateway: input.gateway, renderer: input.renderer, storage: input.storage, pack, item, copy, exact, ratio, maxPlateRetries: input.maxPlateRetries ?? 1 })
    costUsd += rp.costUsd
    plateUrl = rp.plateUrl
    if (rp.res) res = rp.res
  }
  const delivered = res.renders[0]
  const renders = delivered
    ? [...item.renders.filter((r) => r.ratio !== ratio), { ...delivered, ...(plateUrl ? { plateUrl } : {}) }].sort((a, b) => pack.ratios.indexOf(a.ratio) - pack.ratios.indexOf(b.ratio))
    : item.renders
  const failedNow = res.rejected[0]
  const list = [...(item.rejectedRatios ?? []).filter((r) => r.ratio !== ratio), ...(delivered ? [] : failedNow ? [failedNow] : [])]
  const fidelity = worstFidelity(renders) ?? item.fidelity
  const next: Partial<PackItem> = {
    renders,
    rejectedRatios: list.length ? list : undefined,
    costUsd: (item.costUsd ?? 0) + costUsd,
    timings: { ...item.timings, renderMs: Date.now() - t0 },
    ...(fidelity ? { fidelity } : {}),
    // The background marker (adpack_regenerate {ratio}) is cleared with the result.
    sceneCheck: { ...withoutRegenMarker(item.sceneCheck ?? { ok: true, productMatches: null, strayText: null, score: 0.5 }), ...(fidelity ? { fidelity } : {}), rejectedRatios: list.length ? list : undefined },
  }
  await input.store.updateItem(item.id, next)
  const fresh = { ...item, ...next, updatedAt: nowIso() }
  for (const [k, v] of Object.entries(next)) if (v === undefined) delete (fresh as unknown as Record<string, unknown>)[k]
  return { ok: true, item: fresh, ratio, delivered: Boolean(delivered), method, ...(delivered ? {} : failedNow ? { rejected: failedNow } : {}), costUsd }
}

/** scene_check without the background ratio-regeneration marker. */
export function withoutRegenMarker<T extends { regenerating?: unknown }>(check: T): Omit<T, 'regenerating'> {
  const { regenerating: _r, ...rest } = check
  void _r
  return rest
}
