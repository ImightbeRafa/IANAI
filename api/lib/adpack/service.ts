/**
 * Ad Pack engine — the single application service behind both doors.
 *
 *   web  `api/ad-pack.ts`       ─┐
 *                                ├─► createAdPackService(deps) ─► engine (pack-runner, dna, plan-angles)
 *   MCP  `adpack_*` (protocol)  ─┘
 *
 * Every operation takes `{ userId, ... }`; packs are always read through
 * `store.getPack(packId, userId)` so another user's packId is NOT_FOUND.
 * Dependencies are injected so tests run with memory store + fakes.
 */
import { randomUUID } from 'node:crypto'
import { checkUsageLimit, incrementUsage } from '../auth.js'
import { logApiUsage, type FeatureType } from '../usage-logger.js'
import { usageTimingMetadata } from '../usage-timings.js'
import { confirmFacts, type FactEdit } from './dna/confirm.js'
import { ingestBrandDna, type IngestBrandDnaInput, type IngestBrandDnaResult } from './dna/ingest.js'
import type { UploadItem } from './dna/uploads.js'
import { createModelGateway } from './gateway.js'
import type {
  AdPackAnglesResponse,
  AdPackCancelResponse,
  AdPackConfirmDnaResponse,
  AdPackCopyPatch,
  AdPackEditTextResponse,
  AdPackErrorCode,
  AdPackIngestDnaRequest,
  AdPackIngestDnaResponse,
  AdPackItemView,
  AdPackQuote,
  AdPackRegenerateResponse,
  AdPackStartResponse,
  AdPackStatusResponse,
} from './http-types.js'
import {
  advancePack,
  DEFAULT_RATIOS,
  editItemText,
  planPack,
  quotePack,
  regenerateItem,
  summarizePack,
  type PackProgress,
} from './pack-runner.js'
import { DEFAULT_PACK_SIZE, MAX_PACK_SIZE, planAngles } from './plan-angles.js'
import { createDefaultRenderer } from './render-adapter.js'
import type { AdPackStorage, ChargeFn, Renderer } from './runner-types.js'
import { createSupabaseAdPackStorage } from './storage.js'
import { createSupabasePackStore } from './store-supabase.js'
import type { AspectRatio, BrandDna, ModelGateway, OfferInput, Pack, PackItem, PackStatus, PackStore } from './types.js'

export const ADPACK_IMAGE_MODEL = 'grok-imagine'
/** Background advance budget (waitUntil / MCP scheduler). */
export const ADPACK_BACKGROUND_BUDGET_MS = 50_000
/** Inline advance budget when a status poll finds no active worker. */
export const ADPACK_INLINE_BUDGET_MS = 8_000
export const ADPACK_MAX_UPLOADS = 12

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RATIOS: ReadonlySet<AspectRatio> = new Set(['1:1', '4:5', '9:16'])
const TERMINAL_PACK: ReadonlySet<PackStatus> = new Set(['done', 'partial', 'failed', 'cancelled'])
const UPLOAD_KINDS = new Set(['product_photo', 'logo', 'reference_ad', 'review_screenshot', 'document'])
const FACT_EDIT_OPS = new Set(['confirm', 'edit', 'add', 'remove'])

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const HTTP_STATUS: Record<AdPackErrorCode, number> = {
  BAD_INPUT: 400,
  NOT_FOUND: 404,
  INSUFFICIENT_CREDITS: 402,
  NOT_READY: 409,
  BUSY: 409,
  COPY_REJECTED: 422,
  UNAVAILABLE: 503,
}

export class AdPackError extends Error {
  readonly code: AdPackErrorCode
  readonly status: number
  readonly details?: Record<string, unknown>
  constructor(code: AdPackErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AdPackError'
    this.code = code
    this.status = HTTP_STATUS[code]
    this.details = details
  }
}

export function isAdPackError(err: unknown): err is AdPackError {
  return err instanceof AdPackError
}

const bad = (message: string) => new AdPackError('BAD_INPUT', message)

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export type AdPackSource = Pack['source']

export interface AdPackChargeInput {
  userId: string
  generationId: string
  packId: string
  source: AdPackSource
}

/** Idempotent per `generationId`; throw to fail the item's charge step. */
export type AdPackChargeFn = (input: AdPackChargeInput) => Promise<{ charged: boolean; credits?: number } | void>

export type AdPackCreditCheck = (input: { userId: string; ads: number }) => Promise<{ allowed: boolean; remaining: number; creditsRequired?: number }>

export interface AdPackUsageEntry {
  userId: string
  feature: FeatureType
  model: string
  generationId?: string
  costUsd: number
  source: AdPackSource
  durationMs: number
  metadata: Record<string, unknown>
}

export interface AdPackDeps {
  store: PackStore
  gateway: ModelGateway
  renderer: Renderer
  storage: AdPackStorage
  charge: AdPackChargeFn
  checkCredits: AdPackCreditCheck
  /** Usage log (logApiUsage in prod). Failures are swallowed. */
  logUsage?: (entry: AdPackUsageEntry) => Promise<void>
  now?: () => number
  /** DNA ingest seam (tests); defaults to `ingestBrandDna`. */
  ingest?: (input: IngestBrandDnaInput) => Promise<IngestBrandDnaResult>
  /** Advance concurrency (default 4). */
  concurrency?: number
}

/** Lazily create on first use so a missing env var fails the call that needs it, not module load. */
function lazy<T extends object>(make: () => T): T {
  let inst: T | null = null
  const get = () => (inst ??= make())
  return new Proxy({} as T, {
    get(_t, prop) {
      const target = get() as Record<PropertyKey, unknown>
      const value = target[prop]
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })
}

export function createDefaultAdPackDeps(): AdPackDeps {
  return {
    store: lazy(() => createSupabasePackStore()),
    gateway: lazy(() => createModelGateway()),
    renderer: createDefaultRenderer(),
    storage: lazy(() => createSupabaseAdPackStorage()),
    // Same path as every other grok-imagine image: image → image_standard, idempotent by generationId.
    async charge({ userId, generationId }) {
      const result = await incrementUsage(userId, 'image', { generationId, imageModel: ADPACK_IMAGE_MODEL })
      if (result && result.creditsError) throw new Error(`credit_charge_failed: ${result.creditsError}`)
      return { charged: true, credits: result?.creditsCharged }
    },
    async checkCredits({ userId, ads }) {
      const r = await checkUsageLimit(userId, 'image', { imageModel: ADPACK_IMAGE_MODEL, units: Math.max(1, ads) })
      return { allowed: r.allowed, remaining: r.remaining, creditsRequired: r.creditsRequired }
    },
    async logUsage(entry) {
      await logApiUsage({
        userId: entry.userId,
        feature: entry.feature,
        model: entry.model,
        generationId: entry.generationId,
        costOverrideUsd: entry.costUsd,
        costSource: 'adpack_estimate',
        success: true,
        source: entry.source,
        metadata: usageTimingMetadata({ durationMs: entry.durationMs, extra: { ...entry.metadata, source: entry.source } }),
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Input parsing (shared by both doors)
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max = 2_000): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

function isAllowedImageUrl(url: string): boolean {
  return /^https:\/\//i.test(url) || /^data:image\/(png|jpe?g|webp);base64,/i.test(url)
}

export function parsePackId(raw: unknown): string {
  const id = str(raw, 64)
  if (!id) throw bad('packId is required')
  // Non-UUID ids can never exist (uuid pk); answer NOT_FOUND without touching the DB.
  if (!UUID_RE.test(id)) throw new AdPackError('NOT_FOUND', 'Pack not found')
  return id
}

function parseItemId(raw: unknown): string {
  const id = str(raw, 64)
  if (!id) throw bad('itemId is required')
  if (!UUID_RE.test(id)) throw new AdPackError('NOT_FOUND', 'Ad not found')
  return id
}

export function parseSize(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_PACK_SIZE
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) throw bad('size must be a number')
  return Math.min(MAX_PACK_SIZE, Math.max(1, Math.round(n)))
}

export function parseRatios(raw: unknown): AspectRatio[] {
  if (raw === undefined || raw === null) return [...DEFAULT_RATIOS]
  if (!Array.isArray(raw) || !raw.length) throw bad('ratios must be a non-empty array')
  const out: AspectRatio[] = []
  for (const r of raw) {
    if (typeof r !== 'string' || !RATIOS.has(r as AspectRatio)) throw bad(`Unsupported ratio: ${String(r)} (use 1:1, 4:5, 9:16)`)
    if (!out.includes(r as AspectRatio)) out.push(r as AspectRatio)
  }
  return out
}

function parseFacts(raw: unknown, label: string): OfferInput['facts'] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw bad(`${label} must be an array`)
  return raw.slice(0, 200).map((f, i) => {
    if (!isObj(f) || typeof f.key !== 'string' || typeof f.value !== 'string') throw bad(`${label}[${i}] needs key and value`)
    return {
      key: f.key as OfferInput['facts'][number]['key'],
      value: f.value.slice(0, 500),
      source: (typeof f.source === 'string' ? f.source : 'user') as OfferInput['facts'][number]['source'],
      confirmed: f.confirmed === true,
      ...(typeof f.evidence === 'string' ? { evidence: f.evidence.slice(0, 500) } : {}),
    }
  })
}

function parseImageUrls(raw: unknown, label: string): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw bad(`${label} must be an array of URLs`)
  return raw.slice(0, 8).map((u, i) => {
    if (typeof u !== 'string' || !isAllowedImageUrl(u)) throw bad(`${label}[${i}] must be an https or data:image URL`)
    return u
  })
}

export function parseDna(raw: unknown): BrandDna {
  if (!isObj(raw)) throw bad('dna is required (run dna_ingest first)')
  if (raw.version !== 1) throw bad('dna.version must be 1')
  if (typeof raw.brandName !== 'string' || !raw.brandName.trim()) throw bad('dna.brandName is required')
  if (raw.language !== 'es' && raw.language !== 'en') throw bad('dna.language must be es or en')
  if (!Array.isArray(raw.facts)) throw bad('dna.facts must be an array')
  const facts = parseFacts(raw.facts, 'dna.facts')
  const visual = isObj(raw.visual) ? raw.visual : {}
  if (typeof visual.logoUrl === 'string' && !isAllowedImageUrl(visual.logoUrl)) throw bad('dna.visual.logoUrl must be an https or data:image URL')
  const dna = { ...raw, facts, visual, gaps: Array.isArray(raw.gaps) ? raw.gaps : [], sources: Array.isArray(raw.sources) ? raw.sources : [] } as unknown as BrandDna
  if (raw.productImageUrls !== undefined) dna.productImageUrls = parseImageUrls(raw.productImageUrls, 'dna.productImageUrls')
  if (raw.referenceImageUrls !== undefined) dna.referenceImageUrls = parseImageUrls(raw.referenceImageUrls, 'dna.referenceImageUrls')
  return dna
}

export function parseOffer(raw: unknown): OfferInput {
  if (!isObj(raw)) throw bad('offer is required')
  const name = str(raw.name, 200)
  if (!name) throw bad('offer.name is required')
  const offer: OfferInput = {
    name,
    facts: parseFacts(raw.facts, 'offer.facts'),
    productImageUrls: parseImageUrls(raw.productImageUrls, 'offer.productImageUrls'),
  }
  const productId = str(raw.productId, 64)
  if (productId) offer.productId = productId
  if (raw.productCutoutUrl !== undefined) {
    const cut = str(raw.productCutoutUrl, 4_000_000)
    if (!cut || !isAllowedImageUrl(cut)) throw bad('offer.productCutoutUrl must be an https or data:image URL')
    offer.productCutoutUrl = cut
  }
  return offer
}

function parseOptionalUuid(raw: unknown, label: string): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const id = str(raw, 64)
  if (!id || !UUID_RE.test(id)) throw bad(`${label} must be a UUID`)
  return id
}

function parseUploads(raw: unknown): UploadItem[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) throw bad('uploads must be an array')
  if (raw.length > ADPACK_MAX_UPLOADS) throw bad(`At most ${ADPACK_MAX_UPLOADS} uploads`)
  return raw.map((u, i) => {
    if (!isObj(u) || typeof u.kind !== 'string' || !UPLOAD_KINDS.has(u.kind)) throw bad(`uploads[${i}].kind is invalid`)
    const url = str(u.url, 8_000_000)
    const text = str(u.text, 20_000)
    if (!url && !text) throw bad(`uploads[${i}] needs url or text`)
    if (url && !/^https:\/\//i.test(url) && !/^data:(image\/(png|jpe?g|webp)|application\/pdf);base64,/i.test(url)) {
      throw bad(`uploads[${i}].url must be an https or data URL`)
    }
    return { kind: u.kind as UploadItem['kind'], ...(url ? { url } : {}), ...(text ? { text } : {}), ...(str(u.name, 200) ? { name: str(u.name, 200) } : {}) }
  })
}

function parseHttpsUrl(raw: unknown, label: string): string | undefined {
  const url = str(raw, 2_000)
  if (!url) return undefined
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme')
    return u.toString()
  } catch {
    throw bad(`${label} is not a valid URL`)
  }
}

function parseFactEdits(raw: unknown): FactEdit[] {
  if (!Array.isArray(raw)) throw bad('edits must be an array')
  return raw.slice(0, 200).map((e, i) => {
    if (!isObj(e) || typeof e.op !== 'string' || !FACT_EDIT_OPS.has(e.op) || typeof e.key !== 'string' || !e.key) {
      throw bad(`edits[${i}] needs op (confirm|edit|add|remove) and key`)
    }
    if ((e.op === 'edit' || e.op === 'add') && (typeof e.value !== 'string' || !e.value.trim())) throw bad(`edits[${i}].value is required`)
    return e as unknown as FactEdit
  })
}

function parseCopyPatch(raw: unknown): AdPackCopyPatch {
  if (!isObj(raw)) throw bad('copy is required')
  const patch: AdPackCopyPatch = {}
  for (const f of ['headline', 'subline', 'offerLine', 'cta', 'caption'] as const) {
    if (raw[f] === undefined) continue
    if (typeof raw[f] !== 'string') throw bad(`copy.${f} must be a string`)
    patch[f] = (raw[f] as string).slice(0, 2_000)
  }
  if (raw.bullets !== undefined) {
    if (!Array.isArray(raw.bullets) || raw.bullets.some((b) => typeof b !== 'string')) throw bad('copy.bullets must be an array of strings')
    patch.bullets = (raw.bullets as string[]).slice(0, 4)
  }
  if (raw.script !== undefined) {
    const s = raw.script
    if (!isObj(s) || typeof s.hook !== 'string' || typeof s.development !== 'string' || typeof s.cta !== 'string') {
      throw bad('copy.script needs hook, development and cta strings')
    }
    patch.script = { hook: s.hook, development: s.development, cta: s.cta }
  }
  if (!Object.keys(patch).length) throw bad('copy has no editable fields')
  return patch
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function toItemView(item: PackItem): AdPackItemView {
  return {
    id: item.id,
    index: item.index,
    status: item.status,
    format: item.angle.format,
    archetype: item.angle.archetype,
    hookType: item.angle.hookType,
    message: item.angle.message,
    ...(item.copy ? { headline: item.copy.headline, copy: item.copy } : {}),
    ...(item.scene ? { sceneUrl: item.scene.imageUrl } : {}),
    renders: item.renders ?? [],
    attempts: item.attempts,
    charged: Boolean(item.chargedAt),
    ...(item.error ? { error: item.error } : {}),
  }
}

function toStatusView(pack: Pack, items: PackItem[], nowMs: number): AdPackStatusResponse {
  const progress: PackProgress = summarizePack(pack, items)
  const perAd = quotePack(1).perAd
  // Charges for the current attempt of each ad (a regenerate clears `chargedAt` until it is re-charged).
  const chargedCredits = items.filter((i) => i.chargedAt).length * perAd
  const leaseActive = items.some((i) => i.leaseUntil && Date.parse(i.leaseUntil) > nowMs && i.status !== 'done' && i.status !== 'failed')
  return {
    packId: pack.id,
    status: pack.status,
    size: pack.size,
    ratios: pack.ratios,
    source: pack.source,
    quotedCredits: pack.quotedCredits,
    chargedCredits,
    progress: { total: progress.total, done: progress.done, failed: progress.failed, pending: progress.pending, counts: progress.counts },
    items: items.map(toItemView),
    moreWork: !TERMINAL_PACK.has(pack.status) && progress.pending > 0,
    leaseActive,
    createdAt: pack.createdAt,
    updatedAt: pack.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface AdPackService {
  ingestDna(input: { userId: string; source?: AdPackSource } & AdPackIngestDnaRequest): Promise<AdPackIngestDnaResponse>
  confirmDna(input: { userId: string; dna: unknown; edits: unknown }): Promise<AdPackConfirmDnaResponse>
  planAngles(input: { userId: string; dna: unknown; offer: unknown; size?: unknown }): Promise<AdPackAnglesResponse>
  quote(input: { userId?: string; size?: unknown; dna?: unknown; offer?: unknown }): Promise<AdPackQuote>
  startPack(input: {
    userId: string
    dna: unknown
    offer: unknown
    size?: unknown
    ratios?: unknown
    businessId?: unknown
    brandKitId?: unknown
    source: AdPackSource
    /** Fixed id for idempotent create (MCP: the approval id). */
    packId?: string
  }): Promise<AdPackStartResponse>
  getStatus(input: { userId: string; packId: unknown }): Promise<AdPackStatusResponse>
  /** getStatus, but first runs a short inline advance when work remains and no worker holds a lease. */
  pollStatus(input: { userId: string; packId: unknown; inlineBudgetMs?: number }): Promise<AdPackStatusResponse>
  advance(input: { userId: string; packId: unknown; budgetMs?: number }): Promise<PackProgress>
  editText(input: { userId: string; packId: unknown; itemId: unknown; copy: unknown }): Promise<AdPackEditTextResponse>
  regenerate(input: { userId: string; packId: unknown; itemId: unknown; mode?: unknown }): Promise<AdPackRegenerateResponse>
  cancel(input: { userId: string; packId: unknown }): Promise<AdPackCancelResponse>
}

export function createAdPackService(deps: AdPackDeps): AdPackService {
  const now = deps.now ?? (() => Date.now())
  const ingest = deps.ingest ?? ingestBrandDna

  const log = async (entry: AdPackUsageEntry) => {
    if (!deps.logUsage) return
    try {
      await deps.logUsage(entry)
    } catch (err) {
      console.error('[adpack] usage log failed', err instanceof Error ? err.message : err)
    }
  }

  const load = async (userId: string, packId: string) => {
    const loaded = await deps.store.getPack(packId, userId)
    if (!loaded) throw new AdPackError('NOT_FOUND', 'Pack not found')
    return loaded
  }

  const requireCredits = async (userId: string, ads: number) => {
    const check = await deps.checkCredits({ userId, ads })
    if (!check.allowed) {
      throw new AdPackError('INSUFFICIENT_CREDITS', 'Not enough AI credits for this pack', {
        creditsRequired: check.creditsRequired ?? quotePack(ads).credits,
        remaining: check.remaining,
      })
    }
  }

  /** Runner ChargeFn bound to one pack: charge, then log real model cost + timings for that ad. */
  const chargeFor = (pack: Pack): ChargeFn => async ({ userId, generationId }) => {
    const t0 = now()
    const result = await deps.charge({ userId, generationId, packId: pack.id, source: pack.source })
    const item = (await deps.store.getPack(pack.id, userId).catch(() => null))?.items.find((i) => i.generationId === generationId)
    await log({
      userId,
      feature: 'image',
      model: item?.scene?.model || ADPACK_IMAGE_MODEL,
      generationId,
      costUsd: item?.costUsd ?? 0,
      source: pack.source,
      durationMs: Object.values(item?.timings ?? {}).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0) + (now() - t0),
      metadata: {
        feature: 'adpack',
        packId: pack.id,
        itemIndex: item?.index,
        format: item?.angle.format,
        attempts: item?.attempts,
        sceneAttempts: item?.sceneAttempts,
        timings: item?.timings,
      },
    })
    return result ?? { charged: true }
  }

  const advance: AdPackService['advance'] = async (input) => {
    const packId = parsePackId(input.packId)
    const { pack } = await load(input.userId, packId)
    return advancePack({
      store: deps.store,
      gateway: deps.gateway,
      renderer: deps.renderer,
      storage: deps.storage,
      charge: chargeFor(pack),
      packId,
      userId: input.userId,
      budgetMs: input.budgetMs ?? ADPACK_BACKGROUND_BUDGET_MS,
      concurrency: deps.concurrency,
    })
  }

  const getStatus: AdPackService['getStatus'] = async (input) => {
    const packId = parsePackId(input.packId)
    const { pack, items } = await load(input.userId, packId)
    return toStatusView(pack, items, now())
  }

  const quoteFor = (size: number): AdPackQuote => {
    const q = quotePack(size)
    return { size, credits: q.credits, perAd: q.perAd }
  }

  return {
    async ingestDna(input) {
      const websiteUrl = parseHttpsUrl(input.websiteUrl, 'websiteUrl')
      const instagramUrl = str(input.instagramUrl, 300)
      const uploads = parseUploads(input.uploads)
      if (input.offerForm !== undefined && !isObj(input.offerForm)) throw bad('offerForm must be an object')
      const offerForm = input.offerForm === undefined ? undefined : { ...input.offerForm }
      const userFacts = input.userFacts === undefined ? undefined : parseFacts(input.userFacts, 'userFacts').map((f) => ({ key: f.key, value: f.value, ...(f.evidence ? { evidence: f.evidence } : {}) }))
      if (offerForm?.productImageUrls !== undefined) offerForm.productImageUrls = parseImageUrls(offerForm.productImageUrls, 'offerForm.productImageUrls')
      if (!websiteUrl && !instagramUrl && !uploads?.length && !offerForm && !userFacts?.length) {
        throw bad('Provide at least one of websiteUrl, instagramUrl, uploads, offerForm or userFacts')
      }
      const language = input.language === 'en' || input.language === 'es' ? input.language : undefined
      const t0 = now()
      const result = await ingest({ gateway: deps.gateway, websiteUrl, instagramUrl, uploads, offerForm, userFacts, language })
      await log({
        userId: input.userId,
        feature: 'brand_extraction',
        model: 'adpack-dna',
        costUsd: result.costUsd,
        source: input.source ?? 'web',
        durationMs: now() - t0,
        metadata: { feature: 'adpack_dna', timingsMs: result.timingsMs, sources: result.dna.sources.map((s) => ({ kind: s.kind, ok: s.ok })) },
      })
      return { dna: result.dna, costUsd: result.costUsd, timingsMs: result.timingsMs }
    },

    async confirmDna(input) {
      const dna = parseDna(input.dna)
      return { dna: confirmFacts(dna, parseFactEdits(input.edits)) }
    },

    async planAngles(input) {
      const dna = parseDna(input.dna)
      const offer = parseOffer(input.offer)
      const angles = planAngles({ dna, offer, size: parseSize(input.size), language: dna.language })
      return { size: angles.length, angles }
    },

    async quote(input) {
      const size = parseSize(input.size)
      if (input.dna !== undefined && input.offer !== undefined) {
        const dna = parseDna(input.dna)
        const offer = parseOffer(input.offer)
        return quoteFor(planAngles({ dna, offer, size, language: dna.language }).length)
      }
      return quoteFor(size)
    },

    async startPack(input) {
      const dna = parseDna(input.dna)
      const offer = parseOffer(input.offer)
      const size = parseSize(input.size)
      const ratios = parseRatios(input.ratios)
      const businessId = parseOptionalUuid(input.businessId, 'businessId')
      const brandKitId = parseOptionalUuid(input.brandKitId, 'brandKitId')
      const packId = input.packId ? parsePackId(input.packId) : randomUUID()
      if (input.packId) {
        const existing = await deps.store.getPack(packId, input.userId)
        if (existing) {
          return { packId, status: existing.pack.status, quote: quoteFor(existing.pack.size), existing: true }
        }
      }
      const planned = planPack({ dna, offer, size, ratios, userId: input.userId, source: input.source, businessId, brandKitId, ids: { packId } })
      if (!planned.items.length) throw bad('No angles could be planned for this offer')
      await requireCredits(input.userId, planned.pack.size)
      try {
        await deps.store.createPack(planned.pack, planned.items)
      } catch (err) {
        // Concurrent retry with the same fixed id won the insert: return that pack.
        const existing = input.packId ? await deps.store.getPack(packId, input.userId).catch(() => null) : null
        if (!existing) throw err
        return { packId, status: existing.pack.status, quote: quoteFor(existing.pack.size), existing: true }
      }
      return { packId, status: planned.pack.status, quote: quoteFor(planned.pack.size), existing: false }
    },

    getStatus,

    async pollStatus(input) {
      const status = await getStatus(input)
      if (!status.moreWork || status.leaseActive) return status
      try {
        await advance({ userId: input.userId, packId: status.packId, budgetMs: input.inlineBudgetMs ?? ADPACK_INLINE_BUDGET_MS })
      } catch (err) {
        if (isAdPackError(err)) throw err
        console.error('[adpack] inline advance failed', err instanceof Error ? err.message : err)
      }
      return getStatus(input)
    },

    advance,

    async editText(input) {
      const packId = parsePackId(input.packId)
      const itemId = parseItemId(input.itemId)
      const copyPatch = parseCopyPatch(input.copy)
      const res = await editItemText({ store: deps.store, renderer: deps.renderer, storage: deps.storage, packId, itemId, userId: input.userId, copyPatch })
      if (res.ok) return { item: toItemView(res.item) }
      if (res.error === 'pack_not_found') throw new AdPackError('NOT_FOUND', 'Pack not found')
      if (res.error === 'item_not_found') throw new AdPackError('NOT_FOUND', 'Ad not found')
      if (res.error === 'item_not_rendered') throw new AdPackError('NOT_READY', 'This ad is not rendered yet')
      throw new AdPackError('COPY_REJECTED', 'The edited text breaks the facts or length rules', { issues: res.issues ?? [] })
    },

    async regenerate(input) {
      const packId = parsePackId(input.packId)
      const itemId = parseItemId(input.itemId)
      const mode = input.mode === undefined || input.mode === 'scene' ? 'scene' : input.mode === 'copy' ? 'copy' : (() => { throw bad('mode must be copy or scene') })()
      const { pack, items } = await load(input.userId, packId)
      if (pack.status === 'cancelled') throw new AdPackError('NOT_READY', 'Pack was cancelled')
      if (!items.some((i) => i.id === itemId)) throw new AdPackError('NOT_FOUND', 'Ad not found')
      await requireCredits(input.userId, 1)
      const res = await regenerateItem({ store: deps.store, packId, itemId, userId: input.userId, mode })
      if (!res.ok) {
        if (res.error === 'item_busy') throw new AdPackError('BUSY', 'This ad is still being generated')
        throw new AdPackError('NOT_FOUND', res.error === 'pack_not_found' ? 'Pack not found' : 'Ad not found')
      }
      return { item: toItemView(res.item), quote: quoteFor(1) }
    },

    async cancel(input) {
      const packId = parsePackId(input.packId)
      const { pack } = await load(input.userId, packId)
      if (TERMINAL_PACK.has(pack.status)) return { packId, status: pack.status }
      await deps.store.updatePack(packId, { status: 'cancelled' })
      return { packId, status: 'cancelled' }
    },
  }
}

// ---------------------------------------------------------------------------
// Process-wide default (both doors) + test override
// ---------------------------------------------------------------------------

let defaultService: AdPackService | null = null

export function getDefaultAdPackService(): AdPackService {
  return (defaultService ??= createAdPackService(createDefaultAdPackDeps()))
}

/** Tests / alternate runtimes: replace (or reset with null) the shared service. */
export function setDefaultAdPackService(service: AdPackService | null): void {
  defaultService = service
}

/** Map any error to `{ status, body }` for a door. */
export function adPackErrorResponse(err: unknown): { status: number; body: { error: string; code: AdPackErrorCode } & Record<string, unknown> } {
  if (isAdPackError(err)) return { status: err.status, body: { error: err.message, code: err.code, ...(err.details ?? {}) } }
  const message = err instanceof Error ? err.message : String(err)
  if (/_unavailable|missing_env/.test(message)) return { status: 503, body: { error: 'Ad pack service is not configured', code: 'UNAVAILABLE' } }
  console.error('[adpack] request failed', message)
  return { status: 500, body: { error: 'Ad pack request failed', code: 'UNAVAILABLE' } }
}
