/**
 * Ad Pack engine — durable per-ad state machine.
 *
 *   planned → copy_ready → scene_ready → rendered → done   (or failed)
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
import { generateScene, type GeneratedScene } from './scene.js'
import { errorMessage } from './util.js'
import type { AdPackStorage, ChargeFn, Renderer } from './runner-types.js'
import type {
  AdCopy,
  AspectRatio,
  BrandDna,
  CopyCheckIssue,
  CopyCheckResult,
  ModelGateway,
  OfferInput,
  Pack,
  PackItem,
  PackItemStatus,
  PackStatus,
  PackStore,
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
}

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
    quotedCredits: quotePack(angles.length).credits,
    source: input.source,
    ...(input.brief ? { brief: input.brief } : {}),
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

/** Credits for a pack: one `image_standard` per ad (copy included). */
export function quotePack(size: number): { credits: number; perAd: number } {
  const perAd = quoteCredits('image_standard', 1)
  return { credits: quoteCredits('image_standard', Math.max(0, Math.floor(size))), perAd }
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
  return check.productMatches === false || check.strayText === true || check.borders === true
}

function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}`
}

async function stepScene(ctx: RunCtx, item: PackItem, anchorUrl?: string): Promise<PackItem> {
  const { gateway, storage } = ctx.input
  const { dna, offer } = ctx.pack
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
      const res = await checkScene({ gateway, sceneImage: toDataUrl(scene.bytes, scene.mimeType), productRef, language: dna.language })
      cost += res.costUsd
      check = res
    } catch (error) {
      check = { ok: true, productMatches: null, strayText: null, score: 0.5, notes: `scene_check_unavailable: ${errorMessage(error)}`.slice(0, 300) }
    }
    checkMs += Date.now() - c0
    candidates.push({ scene, check })
    if (!needsRegeneration(check)) break
    hint = check.productMatches === false ? RETRY_HINT_PRODUCT : check.strayText === true ? RETRY_HINT_TEXT : RETRY_HINT_BORDERS
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
  }
  if (best.check.productMatches === false) {
    return fail(ctx, item, `scene_product_mismatch after ${attempts} attempts`, { sceneCheck, costUsd, timings, sceneAttempts: attempts })
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

async function renderAllRatios(args: {
  renderer: Renderer
  storage: AdPackStorage
  pack: Pack
  item: PackItem
  copy: AdCopy
  sceneImage: Uint8Array | string
  /** Defaults to the pack's ratios. */
  ratios?: AspectRatio[]
}): Promise<RenderedAd[]> {
  const { renderer, storage, pack, item, copy, sceneImage } = args
  const out: RenderedAd[] = []
  for (const ratio of args.ratios ?? pack.ratios) {
    const r = await renderer.render({
      format: item.angle.format,
      ratio,
      sceneImage,
      copy,
      visual: pack.dna.visual ?? {},
      productCutout: pack.offer.productCutoutUrl,
      language: pack.dna.language,
    })
    const { url } = await storage.upload({
      userId: pack.userId,
      packId: pack.id,
      itemIndex: item.index,
      kind: `render-${ratio.replace(':', 'x')}`,
      bytes: r.png,
      contentType: 'image/png',
    })
    out.push({ ratio, imageUrl: url, width: r.width, height: r.height })
  }
  return out
}

async function stepRender(ctx: RunCtx, item: PackItem): Promise<PackItem> {
  if (!item.copy || !item.scene) return fail(ctx, item, 'render_missing_inputs')
  const t0 = Date.now()
  const cached = ctx.sceneBytes.get(item.id)
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const renders = await renderAllRatios({
        renderer: ctx.input.renderer,
        storage: ctx.input.storage,
        pack: ctx.pack,
        item,
        copy: item.copy,
        sceneImage: cached?.bytes ?? item.scene.imageUrl,
      })
      return save(ctx, item, { status: 'rendered', renders, timings: { ...item.timings, renderMs: Date.now() - t0 }, error: undefined })
    } catch (error) {
      lastError = errorMessage(error)
    }
  }
  return fail(ctx, item, `render_failed: ${lastError}`, { timings: { ...item.timings, renderMs: Date.now() - t0 } })
}

async function stepCharge(ctx: RunCtx, item: PackItem): Promise<PackItem> {
  const t0 = Date.now()
  try {
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
  const renders = await renderAllRatios({ renderer: input.renderer, storage: input.storage, pack, item, copy, sceneImage: item.scene.imageUrl, ratios })
  const next: Partial<PackItem> = { copy, copyCheck: check, renders, timings: { ...item.timings, renderMs: Date.now() - t0 } }
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
}

export type ResizeItemResult =
  | { ok: true; item: PackItem; added: AspectRatio[] }
  | { ok: false; error: 'pack_not_found' | 'item_not_found' | 'item_not_rendered' }

/**
 * Render an already-finished ad into more ratios from its stored scene + copy. No model calls,
 * no credits (H6). Ratios the ad already has are kept as they are; the item's renders become
 * the union (existing ratios first).
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
  const fresh = await renderAllRatios({ renderer: input.renderer, storage: input.storage, pack, item, copy: item.copy, sceneImage: item.scene.imageUrl, ratios: missing })
  const renders = [...(item.renders ?? []), ...fresh]
  const next: Partial<PackItem> = { renders, timings: { ...item.timings, renderMs: Date.now() - t0 } }
  await input.store.updateItem(item.id, next)
  return { ok: true, item: { ...item, ...next, updatedAt: nowIso() }, added: missing }
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
  }
  await input.store.updateItem(item.id, patch)
  if (loaded.pack.status !== 'running') await input.store.updatePack(loaded.pack.id, { status: 'running' })
  const next = { ...item, ...patch, updatedAt: nowIso() }
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k]
  return { ok: true, item: next }
}
