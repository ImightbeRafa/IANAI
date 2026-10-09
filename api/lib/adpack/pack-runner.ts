/**
 * Ad Pack engine — durable per-ad state machine.
 *
 *   planned → copy_ready → scene_ready → rendered → done   (or failed)
 *
 * Product fidelity (pack.render.productFidelity):
 * - 'exact' (default when a product photo exists): the scene step makes real-product cut-outs
 *   (fidelity/segment.ts, cached by hash) and a product-free background plate (props-checked,
 *   ≤ 2 retries → scene_props_failed); the render step composites the real pixels per ratio and
 *   scores fidelity (masked SSIM + ΔE). A failed cut-out → cutout_failed; a low score →
 *   fidelity_failed. A model-redrawn product is never delivered in exact mode.
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
import { quoteCredits } from '../credits/catalog.js'
import { deterministicGenerationUuid, generationUuidFromApproval } from '../credits/generation-id.js'
import { checkAdCopy, repairAdCopy } from './check-copy.js'
import { checkScene, type CheckSceneOutput } from './check-scene.js'
import { generateAdCopy } from './copy.js'
import { resolvePackAngles } from './plan-angles.js'
import { generateScene, stripCopyText, type GeneratedScene } from './scene.js'
import { errorMessage } from './util.js'
import { storageBlobCache, type BlobCache } from './fidelity/cache.js'
import { prepareProductCutouts, resolveProductPhotos, defaultImageLoader, type ImageLoader, type LoadedCutout } from './fidelity/pipeline.js'
import { checkPlate, generatePlate, plateLight, PLATE_RETRY_HINT_PLACEMENT, PLATE_RETRY_HINT_PROPS, type PlateCheckResult, type PlateRegion, type PropsReference } from './fidelity/plate.js'
import { relightComposite } from './fidelity/relight.js'
import { scoreFidelity, toFidelityResult, worstFidelity } from './fidelity/score.js'
import { planProductBoxes } from './render/render.js'
import { RATIO_SIZE } from './render/frame.js'
import { cachedLogo } from './render/logo.js'
import type { AdPackStorage, ChargeFn, Renderer, RenderOutput } from './runner-types.js'
import type {
  AdCopy,
  AspectRatio,
  BrandDna,
  CopyCheckIssue,
  CopyCheckResult,
  FidelityResult,
  LightDirection,
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
  SceneCheckResult,
} from './types.js'

/** Feed (4:5) + story (9:16) by default (H6); '1:1' stays available on request or via a free resize. */
export const DEFAULT_RATIOS: AspectRatio[] = ['4:5', '9:16']
export const ANCHOR_INDEX = 0
export const MAX_SCENE_RETRIES = 2

/** Copy issues that block shipping after the one repair (facts, compliance, broken text). */
export const BLOCKING_COPY_CODES: ReadonlySet<CopyCheckIssue['code']> = new Set([
  'unconfirmed_fact',
  'number_mismatch',
  'compliance',
  'forbidden_phrase',
  'placeholder',
  'empty_field',
  'locale_register',
])
/** User text edits are also rejected when they break length limits. */
export const EDIT_BLOCKING_COPY_CODES: ReadonlySet<CopyCheckIssue['code']> = new Set([...BLOCKING_COPY_CODES, 'too_long'])

const TERMINAL: ReadonlySet<PackItemStatus> = new Set(['done', 'failed'])
const ANCHOR_SETTLED: ReadonlySet<PackItemStatus> = new Set(['scene_ready', 'rendered', 'done', 'failed'])

const nowIso = () => new Date().toISOString()

// ---------------------------------------------------------------------------
// Plan + quote
// ---------------------------------------------------------------------------

export interface PlanPackInput {
  dna: BrandDna
  offer: OfferInput
  size?: number
  /** Keep only these planned angle ids (angle-board selection). Ids are deterministic and prefix-stable for the same dna/offer/seed. */
  angleIds?: string[]
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
}

/** Formats that may place real parts next to the hero (H3). */
export const PARTS_FORMATS = new Set(['offer_graphic', 'explainer'])

export function itemGenerationId(packId: string, index: number, attempt = 0): string {
  return generationUuidFromApproval(packId, attempt > 0 ? `adpack:${index}:r${attempt}` : `adpack:${index}`)
}

export function planPack(input: PlanPackInput): { pack: Pack; items: PackItem[] } {
  const packId = input.ids?.packId ?? randomUUID()
  // Same resolver as the quote/approval: exactly `size` angles, or exactly the selected ids (throws otherwise).
  const angles = resolvePackAngles({ dna: input.dna, offer: input.offer, size: input.size, language: input.dna.language, seed: input.seed, angleIds: input.angleIds })
  const ratios = input.ratios?.length ? [...new Set(input.ratios)] : [...DEFAULT_RATIOS]
  const ts = nowIso()
  const pack: Pack = {
    id: packId,
    userId: input.userId,
    businessId: input.businessId,
    brandKitId: input.brandKitId,
    offer: input.offer,
    dna: input.dna,
    status: 'planned',
    size: angles.length,
    ratios,
    quotedCredits: quotePack(angles.length, { relight: input.render?.relight }).credits,
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
  return { pack, items }
}

/**
 * Image-tier model calls billed per ad by the optional relight pass (exact mode): relight sends
 * the composite to the image-edit model, so it is quoted (and charged) as one more
 * `image_standard` per ad. productFidelity itself never changes the price.
 */
export const RELIGHT_UNITS_PER_AD = 1

/** Credits for a pack: one `image_standard` per ad (copy included), + relight when requested. */
export function quotePack(size: number, opts: { relight?: boolean } = {}): { credits: number; perAd: number } {
  const units = 1 + (opts.relight ? RELIGHT_UNITS_PER_AD : 0)
  const perAd = quoteCredits('image_standard', units)
  return { credits: quoteCredits('image_standard', Math.max(0, Math.floor(size)) * units), perAd }
}

/** Charge id of an ad's relight units (idempotent per attempt, like the ad's own generationId). */
export function relightGenerationId(generationId: string): string {
  return generationUuidFromApproval(generationId, 'adpack:relight')
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
  /** Product photo bytes / quality by URL (one download per call). */
  photoMemo: Map<string, { bytes: Uint8Array; quality?: import('./fidelity/asset-quality.js').AssetQuality }>
  /** Background-removed logo bytes for this pack (null = none / failed). */
  logo: Promise<Uint8Array | null> | null
  anchorWait: Promise<void> | null
  advanced: Set<string>
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
    photoMemo: new Map(),
    logo: null,
    anchorWait: null,
    advanced: new Set(),
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

async function fail(ctx: RunCtx, item: PackItem, error: string, patch: Partial<PackItem> = {}): Promise<PackItem> {
  return save(ctx, item, { ...patch, status: 'failed', error: error.slice(0, 500), leaseUntil: undefined })
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
      case 'planned':
        item = await stepCopy(ctx, item)
        break
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

function blockingIssues(check: CopyCheckResult, codes: ReadonlySet<CopyCheckIssue['code']>): CopyCheckIssue[] {
  return check.issues.filter((i) => codes.has(i.code))
}

async function stepCopy(ctx: RunCtx, item: PackItem): Promise<PackItem> {
  const { gateway } = ctx.input
  const { dna, offer } = ctx.pack
  const language = dna.language
  const t0 = Date.now()
  let cost = 0
  let gen: Awaited<ReturnType<typeof generateAdCopy>> | null = null
  let lastError = ''
  for (let attempt = 0; attempt < 2 && !gen; attempt++) {
    try {
      gen = await generateAdCopy({ gateway, dna, offer, angle: item.angle, language, model: ctx.input.copyModel, otherCopies: otherCopies(ctx, item), brief: ctx.pack.brief })
    } catch (error) {
      lastError = errorMessage(error)
    }
  }
  if (!gen) return fail(ctx, item, `copy_failed: ${lastError}`, { timings: { ...item.timings, copyMs: Date.now() - t0 } })
  cost += gen.costUsd
  let copy = gen.copy
  let check = gen.check
  if (!check.ok) {
    const rep = await repairAdCopy({ gateway, copy, issues: check.issues, dna, offer, angle: item.angle, language, otherCopies: otherCopies(ctx, item), model: ctx.input.copyModel })
    cost += rep.costUsd
    copy = rep.copy
    check = rep.check
  }
  const costUsd = (item.costUsd ?? 0) + cost
  const timings = { ...item.timings, copyMs: Date.now() - t0 }
  const blocking = blockingIssues(check, BLOCKING_COPY_CODES)
  if (blocking.length) {
    return fail(ctx, item, `copy_check_failed: ${blocking.map((i) => `${i.code}(${i.path ?? i.field})`).join(', ')}`, { copy, copyCheck: check, costUsd, timings })
  }
  return save(ctx, item, { status: 'copy_ready', copy, copyCheck: check, costUsd, timings, error: undefined })
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
  const variation = [...ctx.known.values()].filter((i) => i.angle.format === item.angle.format && i.index < item.index).length
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
export function plateRegionFor(input: { pack: Pick<Pack, 'ratios' | 'dna'>; format: PackItem['angle']['format']; copy: AdCopy; product: { width: number; height: number } }): PlateRegion {
  const boxes = planProductBoxes({
    format: input.format,
    ratios: input.pack.ratios,
    copy: input.copy,
    visual: input.pack.dna.visual,
    language: input.pack.dna.language,
    product: input.product,
  })
  let x0 = 1
  let y0 = 1
  let x1 = 0
  let y1 = 0
  for (const [ratio, b] of Object.entries(boxes) as Array<[AspectRatio, { x: number; y: number; w: number; h: number }]>) {
    const { width: W, height: H } = RATIO_SIZE[ratio]
    const s = Math.max(W / PLATE_SIZE.width, H / PLATE_SIZE.height)
    const ox = (PLATE_SIZE.width * s - W) / 2
    const oy = (PLATE_SIZE.height * s - H) / 2
    x0 = Math.min(x0, (b.x + ox) / s / PLATE_SIZE.width)
    y0 = Math.min(y0, (b.y + oy) / s / PLATE_SIZE.height)
    x1 = Math.max(x1, (b.x + b.w + ox) / s / PLATE_SIZE.width)
    y1 = Math.max(y1, (b.y + b.h + oy) / s / PLATE_SIZE.height)
  }
  if (x1 <= x0 || y1 <= y0) return { x0: 0.25, y0: 0.4, x1: 0.75, y1: 0.8 }
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000
  return { x0: c(x0), y0: c(y0), x1: c(x1), y1: c(y1) }
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
  const photos = resolveProductPhotos(offer)
  const cut = await prepareProductCutouts({
    photos,
    // A per-ad pick is the hero whatever the format would prefer (hero role ranks first by default).
    format: perAd ? undefined : format,
    language: dna.language,
    withParts: PARTS_FORMATS.has(format),
    gateway,
    cache: cutoutCacheFor(ctx),
    load: ctx.input.loadImage,
    memo: ctx.photoMemo,
  })
  if (!cut.ok) {
    return fail(ctx, item, cut.error.startsWith('cutout_failed') ? cut.error : `cutout_failed: ${cut.error}`, { timings: { ...item.timings, sceneMs: Date.now() - t0 } })
  }
  const cutouts: LoadedCutout[] = [cut.hero, ...cut.parts]
  const variation = [...ctx.known.values()].filter((i) => i.angle.format === format && i.index < item.index).length
  const light = plateLight(item.index)
  const placement = plateRegionFor({ pack: ctx.pack, format, copy, product: { width: cut.hero.width, height: cut.hero.height } })
  const allowedProps = ctx.pack.render?.allowedProps ?? offer.allowedProps
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
      plate = await generatePlate({ gateway, format, dna, offer, placement, light, variation, allowedProps, sceneBrief: stripCopyText(copy.sceneBrief ?? '', copy), draft: ctx.input.draft ?? true, promptSuffix: hint })
    } catch (error) {
      lastError = errorMessage(error)
      continue
    }
    cost += plate.costUsd
    const c0 = Date.now()
    let check: PlateCheckResult | null
    try {
      check = await checkPlate({ gateway, plateImage: toDataUrl(plate.bytes, plate.mimeType), refs, allowedProps, placement, language: dna.language })
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
      cutouts: cutouts.map((c) => c.stored),
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

interface ExactRenderInputs {
  cutouts: Uint8Array[]
  light?: LightDirection
}

/** Cut-out bytes for an item (this call's memory, else the stored cut-out URLs). */
async function exactInputsFromScene(item: PackItem, load: ImageLoader, memory?: Uint8Array[]): Promise<ExactRenderInputs> {
  if (memory?.length) return { cutouts: memory, light: item.scene?.light }
  const stored = item.scene?.cutouts ?? []
  if (!stored.length) throw new Error('cutout_missing: no stored cut-out for this ad')
  const cutouts: Uint8Array[] = []
  for (const c of stored) cutouts.push(await load(c.url))
  return { cutouts, light: item.scene?.light }
}

function scenePlacementAvoid(check: SceneCheckResult | undefined): { x0: number; y0: number; x1: number; y1: number } | undefined {
  const b = check?.productBox
  if (!b) return undefined
  return { y0: b[0] / 1000, x0: b[1] / 1000, y1: b[2] / 1000, x1: b[3] / 1000 }
}

/** Fidelity of one exact render: every placed cut-out is scored, the worst wins. */
async function scoreRender(r: RenderOutput, ratio: AspectRatio, diff: boolean): Promise<{ fidelity: FidelityResult; diffPng?: Buffer } | null> {
  if (!r.productPlacements?.length) return null
  let worst: Awaited<ReturnType<typeof scoreFidelity>> | null = null
  for (const p of r.productPlacements) {
    const s = await scoreFidelity({ image: r.png, box: p.box, reference: p.placed, method: r.relit ? 'relit' : 'composite', diff })
    if (!worst || (worst.passed && !s.passed) || (worst.passed === s.passed && s.score < worst.score)) worst = s
  }
  if (!worst) return null
  return { fidelity: toFidelityResult(worst, { ratio }), ...(worst.diffPng ? { diffPng: worst.diffPng } : {}) }
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
}): Promise<{ renders: RenderedAd[]; fidelity?: FidelityResult }> {
  const { renderer, storage, pack, item, copy, sceneImage, exact } = args
  const out: RenderedAd[] = []
  const outputs: Array<{ ratio: AspectRatio; r: RenderOutput }> = []
  const relightOn = Boolean(exact && pack.render?.relight && args.gateway?.edit)
  const gateway = args.gateway
  for (const ratio of args.ratios ?? pack.ratios) {
    const r = await renderer.render({
      format: item.angle.format,
      ratio,
      sceneImage,
      copy,
      visual: pack.dna.visual ?? {},
      language: pack.dna.language,
      ...(args.logo ? { logo: args.logo } : {}),
      ...(exact
        ? {
            productMode: 'exact' as const,
            productCutout: exact.cutouts[0],
            ...(exact.cutouts.length > 1 ? { productParts: exact.cutouts.slice(1) } : {}),
            ...(exact.light ? { light: exact.light } : {}),
            ...(relightOn && gateway
              ? {
                  relight: async (composite: Uint8Array, placements: NonNullable<RenderOutput['productPlacements']>, rr: AspectRatio) => {
                    const res = await relightComposite({
                      gateway,
                      composite: Buffer.from(composite),
                      placements: placements.map((p) => ({ box: p.box, placed: Buffer.from(p.placed), role: p.role })),
                      ratio: rr,
                    })
                    return res.relit ? new Uint8Array(res.png) : null
                  },
                }
              : {}),
          }
        : {
            productCutout: pack.offer.productCutoutUrl,
            ...(scenePlacementAvoid(item.sceneCheck) ? { productAvoid: scenePlacementAvoid(item.sceneCheck) } : {}),
          }),
    })
    const { url } = await storage.upload({
      userId: pack.userId,
      packId: pack.id,
      itemIndex: item.index,
      kind: `render-${ratio.replace(':', 'x')}`,
      bytes: r.png,
      contentType: 'image/png',
    })
    const scored = exact ? await scoreRender(r, ratio, false) : null
    out.push({ ratio, imageUrl: url, width: r.width, height: r.height, ...(scored ? { fidelity: scored.fidelity } : {}) })
    outputs.push({ ratio, r })
  }
  if (!exact) {
    // Generated mode: no pixel alignment — fidelity is the vision verdict on the scene.
    const sc = item.sceneCheck
    if (!sc || sc.productMatches === null || sc.productMatches === undefined) return { renders: out }
    const fidelity: FidelityResult = { score: Math.round(sc.score * 1000) / 1000, ssim: null, deltaE: null, passed: sc.productMatches !== false, method: 'generated' }
    return { renders: out, fidelity }
  }
  const worst = worstFidelity(out)
  if (!worst) return { renders: out }
  // Heatmap of the worst ratio (A4), best-effort.
  let diffImageUrl: string | undefined
  const w = outputs.find((o) => o.ratio === worst.ratio)
  if (w) {
    try {
      const again = await scoreRender(w.r, w.ratio, true)
      if (again?.diffPng) {
        diffImageUrl = (await storage.upload({ userId: pack.userId, packId: pack.id, itemIndex: item.index, kind: `fidelity-${w.ratio.replace(':', 'x')}`, bytes: new Uint8Array(again.diffPng), contentType: 'image/png' })).url
      }
    } catch {
      diffImageUrl = undefined
    }
  }
  return { renders: out, fidelity: { ...worst, ...(diffImageUrl ? { diffImageUrl } : {}) } }
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
      exact = await exactInputsFromScene(item, ctx.input.loadImage ?? defaultImageLoader, ctx.cutoutBytes.get(item.id))
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
    const sceneCheck = fidelity ? { ...(item.sceneCheck ?? { ok: true, productMatches: null, strayText: null, score: 0.5 }), fidelity } : item.sceneCheck
    if (exactMode && fidelity && !fidelity.passed) {
      // Never deliver an altered product: the renders are not kept.
      return fail(ctx, item, `fidelity_failed: ssim ${fidelity.ssim} / ΔE ${fidelity.deltaE} (${fidelity.ratio ?? 'render'})`, { fidelity, sceneCheck, renders: [], timings })
    }
    if (exactMode && !fidelity) return fail(ctx, item, 'fidelity_failed: product placement missing in render', { renders: [], timings })
    return save(ctx, item, { status: 'rendered', renders: rendered.renders, ...(fidelity ? { fidelity, sceneCheck } : {}), timings, error: undefined })
  }
  return fail(ctx, item, `render_failed: ${lastError}`, { timings: { ...item.timings, renderMs: Date.now() - t0 } })
}

async function stepCharge(ctx: RunCtx, item: PackItem): Promise<PackItem> {
  const t0 = Date.now()
  try {
    await ctx.input.charge({ userId: ctx.pack.userId, generationId: item.generationId })
    // Relight was quoted per ad (RELIGHT_UNITS_PER_AD): charge it under its own idempotent id.
    if (ctx.pack.render?.relight) await ctx.input.charge({ userId: ctx.pack.userId, generationId: relightGenerationId(item.generationId) })
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
  const blocking = blockingIssues(check, EDIT_BLOCKING_COPY_CODES)
  if (blocking.length) return { ok: false, error: 'copy_rejected', issues: blocking }

  const t0 = Date.now()
  // Keep every ratio the ad has (pack ratios + any added by a free resize).
  const ratios = [...new Set([...pack.ratios, ...(item.renders ?? []).map((r) => r.ratio)])]
  const rendered = await renderAllRatios({
    renderer: input.renderer,
    storage: input.storage,
    pack,
    item,
    copy,
    sceneImage: item.scene.imageUrl,
    ratios,
    exact: packMode(pack) === 'exact' ? await exactInputsFromScene(item, input.loadImage ?? defaultImageLoader) : null,
  })
  // Same scene and cut-out: fidelity is re-measured on the new renders.
  const renders = rendered.renders
  const fidelity = rendered.fidelity ?? item.fidelity
  const next: Partial<PackItem> = {
    copy,
    copyCheck: check,
    renders,
    timings: { ...item.timings, renderMs: Date.now() - t0 },
    ...(fidelity ? { fidelity, sceneCheck: { ...(item.sceneCheck ?? { ok: true, productMatches: null, strayText: null, score: 0.5 }), fidelity } } : {}),
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
      rejected?: Array<{ ratio: AspectRatio; fidelity: FidelityResult }>
    }
  | { ok: false; error: 'pack_not_found' | 'item_not_found' | 'item_not_rendered' | 'cutout_missing' }

/**
 * Render an already-finished ad into more ratios from its stored scene + copy. No model calls,
 * no credits (H6). Ratios the ad already has are kept as they are; the item's renders become
 * the union (existing ratios first).
 *
 * Exact mode: the stored product-free plate + the stored real-product cut-outs are composited
 * again (same light, product box reserved so text never covers the product) and every new ratio
 * is fidelity-scored; a ratio that fails is not delivered. No relight (it would be a model call).
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
  const rejected: Array<{ ratio: AspectRatio; fidelity: FidelityResult }> = []
  if (exact) {
    // Never deliver an altered product: a new ratio without a passing fidelity is dropped.
    fresh = fresh.filter((r) => {
      if (r.fidelity?.passed) return true
      rejected.push({ ratio: r.ratio, fidelity: r.fidelity ?? { score: 0, ssim: null, deltaE: null, passed: false, method: 'composite', ratio: r.ratio } })
      return false
    })
  } else {
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
  const patch: Partial<PackItem> = {
    status: keepCopy ? 'copy_ready' : 'planned',
    attempts,
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
  }
  await input.store.updateItem(item.id, patch)
  if (loaded.pack.status !== 'running') await input.store.updatePack(loaded.pack.id, { status: 'running' })
  const next = { ...item, ...patch, updatedAt: nowIso() }
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k]
  return { ok: true, item: next }
}
