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
import { createHash, randomUUID } from 'node:crypto'
import { checkUsageLimit, incrementUsage } from '../auth.js'
import { logApiUsage, type FeatureType } from '../usage-logger.js'
import { usageTimingMetadata } from '../usage-timings.js'
import { confirmFacts, type FactEdit } from './dna/confirm.js'
import { ingestBrandDna, type IngestBrandDnaInput, type IngestBrandDnaResult } from './dna/ingest.js'
import type { UploadItem } from './dna/uploads.js'
import { ingestWebsite } from './dna/website.js'
import { BRIEF_MAX_CHARS, sanitizeBrief } from './copy-shared.js'
import { createModelGateway } from './gateway.js'
import { createSupabaseAdPackLibrary, type AdPackLibrary } from './library.js'
import { buildDnaFromSavedBrand, SavedBrandError, type SavedBrandDb, type SavedBrandResult } from './saved-brand.js'
import { createSupabaseSavedBrandDb } from './saved-brand-supabase.js'
import type {
  AdPackAnglesResponse,
  AdPackCancelResponse,
  AdPackConfirmDnaResponse,
  AdPackCopyPatch,
  AdPackCopyRejection,
  AdPackEditTextResponse,
  AdPackErrorCode,
  AdPackFromBrandResponse,
  AdPackIngestDnaRequest,
  AdPackIngestDnaResponse,
  AdPackItemView,
  AdPackPlanSummary,
  AdPackPreviewResponse,
  AdPackQuote,
  AdPackRegenerateResponse,
  AdPackResizeResponse,
  AdPackStartResponse,
  AdPackStatusResponse,
} from './http-types.js'
import {
  advancePack,
  DEFAULT_RATIOS,
  editItemText,
  MAX_VARIATIONS,
  packAdCount,
  packRelightMode,
  planPack,
  quotePack,
  regenerateItem,
  resizeItem,
  summarizePack,
  type PackProgress,
} from './pack-runner.js'
import { AnglePlanError, angleFromId, DEFAULT_PACK_SIZE, MAX_PACK_SIZE, resolvePackAngles } from './plan-angles.js'
import { findForbiddenHits } from './check-copy.js'
import { normalizeLocale, VOSEO_LOCALES } from './ian-rules.js'
import { angleId, HOOK_DEFAULT_CATEGORY } from './angle-catalog.js'
import { parseAdpackAngleInputs, type AdpackAngleInput } from './guide-angles.js'
import { isLayoutFamily } from './render/families.js'
import { resolveStyleProfile } from './style-profile.js'
import { saveStyleDnaForBrand } from '../bulk/store.js'
import type { StyleDna } from '../bulk/types.js'
import { createDefaultRenderer } from './render-adapter.js'
import type { AdPackStorage, ChargeFn, Renderer } from './runner-types.js'
import { createSupabaseAdPackStorage } from './storage.js'
import { buildStatusExtras } from './status-summary.js'
import { createSupabasePackStore } from './store-supabase.js'
import { writeAdCopy } from './copy-stage.js'
import { offerForItem } from './pack-runner.js'
import { MUST_APPEAR_KEYS } from './offer-profile.js'
import { createSupabasePreviewStore, PREVIEW_RATE_LIMIT_PER_HOUR, PREVIEW_TTL_MS, type PreviewStore, type StoredPreview, type StoredPreviewAd } from './preview-store.js'
import { issueView } from './status-summary.js'
import { mapWithConcurrency } from './util.js'
import { pickProductImage } from './fidelity/asset-quality.js'
import { resolveProductPhotos } from './fidelity/photos.js'
import { getSupabaseAdmin } from '../supabase-admin.js'
import type { AdAngle, AdLanguage, AspectRatio, BrandDna, CopyCheckIssue, CreativeFreedom, LayoutFamily, ModelGateway, MustAppearKey, OfferInput, Pack, PackItem, PackRenderOptions, PackStatus, PackStore, ProductPhoto, RelightMode } from './types.js'
import { hasUsableProductPhoto, isProductPhotoRole } from './fidelity/photos.js'
import type { ImageLoader } from './fidelity/pipeline.js'
import type { DnaPart } from './dna/part.js'

export const ADPACK_IMAGE_MODEL = 'grok-imagine'
/** Background advance budget (waitUntil / MCP scheduler). */
export const ADPACK_BACKGROUND_BUDGET_MS = 50_000
/** Inline advance budget when a status poll finds no active worker. */
export const ADPACK_INLINE_BUDGET_MS = 8_000
export const ADPACK_MAX_UPLOADS = 12

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RATIOS: ReadonlySet<AspectRatio> = new Set(['1:1', '4:5', '9:16', '16:9'])
const TERMINAL_PACK: ReadonlySet<PackStatus> = new Set(['done', 'partial', 'failed', 'cancelled'])
/** Packs whose finished ads are saved to the offer library. */
const COMPLETE_PACK: ReadonlySet<PackStatus> = new Set(['done', 'partial'])
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
  PLAN_CHANGED: 409,
  RATE_LIMITED: 429,
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
  /** Verify the user owns the business / brand kit they attach. Omitted → no linked ids allowed. */
  verifyLinks?: (input: { userId: string; businessId?: string; brandKitId?: string }) => Promise<boolean>
  /** Owner-scoped reads of saved brands/offers (dna_from_brand, start by brandId). Omitted → brandId path unavailable. */
  savedBrandDb?: SavedBrandDb
  /** Live website re-read for `refresh: true` (model + network). */
  refreshWebsite?: (url: string, language: AdLanguage) => Promise<DnaPart>
  /** Saves finished renders to the offer library (product_images kind 'generated'). Omitted → no persistence. */
  library?: AdPackLibrary
  /** Web-app origin for deep links (default https://advanceai.studio). */
  appOrigin?: string
  /** Product photo / cut-out loader for exact mode (tests inject; default fetches data/https URLs). */
  loadImage?: ImageLoader
  /** Persist a fresh Style DNA analysis on the brand kit's `style_dnas` jsonb entry. Omitted → not persisted. */
  saveStyleDnaAnalysis?: (input: { userId: string; brandId: string; styleDna: StyleDna }) => Promise<void>
  /** Copy previews (free dry run, reused by start). Omitted → preview unavailable. */
  previews?: PreviewStore
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
  const gateway = lazy(() => createModelGateway())
  return {
    store: lazy(() => createSupabasePackStore()),
    gateway,
    renderer: createDefaultRenderer(),
    storage: lazy(() => createSupabaseAdPackStorage()),
    savedBrandDb: lazy(() => createSupabaseSavedBrandDb()),
    library: lazy(() => createSupabaseAdPackLibrary()),
    previews: lazy(() => createSupabasePreviewStore()),
    refreshWebsite: (url, language) => ingestWebsite({ url, gateway, language }),
    async saveStyleDnaAnalysis({ userId, brandId, styleDna }) {
      await saveStyleDnaForBrand({ userId, brandId, dna: styleDna })
    },
    appOrigin: process.env.APP_ORIGIN || process.env.VITE_APP_ORIGIN || undefined,
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
    async verifyLinks({ userId, businessId, brandKitId }) {
      const db = getSupabaseAdmin()
      if (!db) return false
      if (businessId) {
        const { data, error } = await db.from('businesses').select('id').eq('id', businessId).eq('owner_id', userId).maybeSingle()
        if (error || !data) return false
      }
      if (brandKitId) {
        const { data, error } = await db.from('brand_kits').select('id').eq('id', brandKitId).eq('user_id', userId).maybeSingle()
        if (error || !data) return false
      }
      return true
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
    if (typeof r !== 'string' || !RATIOS.has(r as AspectRatio)) throw bad(`Unsupported ratio: ${String(r)} (use 1:1, 4:5, 9:16, 16:9)`)
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
  if (raw.notIncluded !== undefined) {
    if (!Array.isArray(raw.notIncluded) || raw.notIncluded.some((v) => typeof v !== 'string')) throw bad('offer.notIncluded must be an array of strings')
    const items = (raw.notIncluded as string[]).map((v) => v.trim().slice(0, 160)).filter(Boolean).slice(0, 20)
    if (items.length) offer.notIncluded = items
  }
  if (raw.strictClaims === true) offer.strictClaims = true
  if (isObj(raw.productLock)) {
    const lock = raw.productLock
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, 160)).slice(0, 20) : [])
    offer.productLock = { lockProductAppearance: lock.lockProductAppearance === true, immutableAttributes: strs(lock.immutableAttributes), allowedProps: strs(lock.allowedProps) }
  }
  if (raw.productImageUrlsByAd !== undefined) {
    if (!isObj(raw.productImageUrlsByAd)) throw bad('offer.productImageUrlsByAd must be an object { "<ad index>": [urls] }')
    const byAd: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(raw.productImageUrlsByAd).slice(0, MAX_PACK_SIZE)) {
      if (!/^\d{1,2}$/.test(k)) throw bad('offer.productImageUrlsByAd keys must be ad indexes')
      byAd[k] = parseImageUrls(v, `offer.productImageUrlsByAd.${k}`)
    }
    if (Object.keys(byAd).length) offer.productImageUrlsByAd = byAd
  }
  if (raw.productPhotos !== undefined) offer.productPhotos = parseProductPhotos(raw.productPhotos, 'offer.productPhotos')
  const allowed = parseStringList(raw.allowedProps, 'offer.allowedProps')
  if (allowed) offer.allowedProps = allowed
  const immutable = parseStringList(raw.immutableAttributes, 'offer.immutableAttributes')
  if (immutable) offer.immutableAttributes = immutable
  if (raw.lockProductAppearance === true) offer.lockProductAppearance = true
  return offer
}

/** Role-tagged product photos (multi-part products). */
export function parseProductPhotos(raw: unknown, label: string): ProductPhoto[] {
  if (!Array.isArray(raw)) throw bad(`${label} must be an array of {url, role}`)
  return raw.slice(0, 8).map((p, i) => {
    if (!isObj(p) || typeof p.url !== 'string' || !isAllowedImageUrl(p.url)) throw bad(`${label}[${i}].url must be an https or data:image URL`)
    if (!isProductPhotoRole(p.role)) throw bad(`${label}[${i}].role must be one of hero, part, contents, box, in_use, detail`)
    const photo: ProductPhoto = { url: p.url, role: p.role }
    const lbl = str(p.label, 80)
    if (lbl) photo.label = lbl
    const id = str(p.id, 64)
    if (id) photo.id = id
    return photo
  })
}

/** Short owner strings (props, immutable attributes): ≤ 12 items × 60 chars. */
export function parseStringList(raw: unknown, label: string): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) throw bad(`${label} must be an array of strings`)
  const out = [...new Set((raw as string[]).map((v) => v.replace(/[\r\n`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean))].slice(0, 12)
  return out.length ? out : undefined
}

/**
 * Product fidelity options for a pack. Default 'exact' whenever the offer has a usable product
 * photo; 'generated' only when asked or no photo. The owner's product lock (offer
 * `lockProductAppearance`, or the saved ad_profile `productLock`) forces 'exact': a locked
 * product is never redrawn, so a request for 'generated' is upgraded to 'exact'.
 * allowedProps / immutableAttributes: request → offer → ad_profile productLock.
 */
export function resolveRenderOptions(raw: { productFidelity?: unknown; relight?: unknown; allowedProps?: unknown; immutableAttributes?: unknown }, offer: OfferInput): PackRenderOptions {
  const mode = raw.productFidelity
  if (mode !== undefined && mode !== null && mode !== 'exact' && mode !== 'generated') throw bad('productFidelity must be exact or generated')
  const relight = parseRelight(raw.relight)
  const hasPhoto = hasUsableProductPhoto(offer)
  const locked = offer.lockProductAppearance === true || offer.productLock?.lockProductAppearance === true
  if ((mode === 'exact' || locked) && !hasPhoto) {
    throw bad(locked
      ? 'This offer locks the product appearance (lockProductAppearance), which needs a real product photo: upload one or unlock the offer'
      : 'productFidelity exact needs a real product photo (offer.productImageUrls / productPhotos)')
  }
  const productFidelity = locked ? 'exact' : mode === 'generated' ? 'generated' : hasPhoto ? 'exact' : 'generated'
  const lock = offer.productLock
  const allowedProps = parseStringList(raw.allowedProps, 'allowedProps') ?? offer.allowedProps ?? (lock?.allowedProps.length ? lock.allowedProps : undefined)
  const immutableAttributes = parseStringList(raw.immutableAttributes, 'immutableAttributes') ?? offer.immutableAttributes ?? (lock?.immutableAttributes.length ? lock.immutableAttributes : undefined)
  return {
    productFidelity,
    ...(relight === 'ai' && productFidelity === 'exact' ? { relight: 'ai' as const } : {}),
    ...(allowedProps?.length ? { allowedProps } : {}),
    ...(immutableAttributes?.length ? { immutableAttributes } : {}),
  }
}

/**
 * relight (exact mode; always included and free): 'auto' (default) = deterministic photographic
 * harmonization, 'ai' = + an image-edit pass kept only when fidelity holds. Booleans from older
 * callers: true → 'ai', false → 'auto'. Never changes the price.
 */
export function parseRelight(raw: unknown): RelightMode | undefined {
  if (raw === undefined || raw === null) return undefined
  if (raw === 'auto' || raw === false) return 'auto'
  if (raw === 'ai' || raw === true) return 'ai'
  throw bad('relight must be "auto" or "ai"')
}

/** Ads per angle (1–3). Out of range is an error, never clamped (approval = what runs). */
export function parseVariations(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 1
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > MAX_VARIATIONS) throw bad(`variations must be an integer from 1 to ${MAX_VARIATIONS}`)
  return n
}

function parseCreativeFreedom(raw: unknown): CreativeFreedom | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (raw !== 'high' && raw !== 'guided') throw bad('creativeFreedom must be high or guided')
  return raw
}

function parseLayoutFamily(raw: unknown): LayoutFamily | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (!isLayoutFamily(raw)) throw bad('layoutFamily must be one of bold_pill, editorial_minimal, split_panel, full_bleed_type, badge_corner, framed_card, ugc_native')
  return raw
}

function parseStyleDnaId(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string' || raw.length > 120) throw bad('styleDnaId must be a style DNA id from list_style_dnas')
  return raw.trim()
}

function parseOptionalUuid(raw: unknown, label: string): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const id = str(raw, 64)
  if (!id || !UUID_RE.test(id)) throw bad(`${label} must be a UUID`)
  return id
}

/** Owner's campaign brief: optional plain text, sanitized, ≤ 500 chars. Never facts. */
export function parseBrief(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string') throw bad('brief must be a string')
  if (raw.length > BRIEF_MAX_CHARS * 4) throw bad(`brief is too long (max ${BRIEF_MAX_CHARS} characters)`)
  return sanitizeBrief(raw)
}

const DEFAULT_APP_ORIGIN = 'https://advanceai.studio'

/** Web-app link to the brand folder of a pack (same shape as bulk `deepLinkForPack`, no session). */
export function deepLinkForAdPack(appOrigin: string | undefined, brandId: string, packId: string): string {
  const origin = (appOrigin || DEFAULT_APP_ORIGIN).replace(/\/$/, '')
  return `${origin}/chat?brand=${encodeURIComponent(brandId)}&adpack=${encodeURIComponent(packId)}`
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

const REGISTERS = new Set(['voseo', 'tuteo', 'usted'])

/** Forbidden phrases / claims: ≤ 30 items × 120 chars (longer limits than parseStringList). */
function parsePhraseList(raw: unknown, label: string): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) throw bad(`${label} must be an array of strings`)
  return (raw as string[]).map((v) => v.trim().slice(0, 120)).filter(Boolean).slice(0, 30)
}

/** Request-level language rules for one pack (both doors): locale, register, forbidden phrases / claims. */
export interface DnaOverridesInput {
  locale?: unknown
  register?: unknown
  forbiddenPhrases?: unknown
  forbiddenClaims?: unknown
}

/**
 * Apply request-level rules to the DNA the pack runs with. `locale` makes the register a hard rule
 * (E3); without an explicit register a voseo locale (es-CR, es-AR…) means voseo. Forbidden lists
 * are merged with the kit's (E2).
 */
export function applyDnaOverrides(dna: BrandDna, input: DnaOverridesInput): BrandDna {
  const out: BrandDna = { ...dna }
  const hasRegister = input.register !== undefined && input.register !== null && input.register !== ''
  if (input.locale !== undefined && input.locale !== null && input.locale !== '') {
    const locale = normalizeLocale(input.locale)
    if (!locale) throw bad('locale must look like "es-CR"')
    out.locale = locale
    if (!hasRegister && VOSEO_LOCALES.has(locale)) out.register = 'voseo'
  }
  if (hasRegister) {
    if (typeof input.register !== 'string' || !REGISTERS.has(input.register)) throw bad('register must be voseo, tuteo or usted')
    out.register = input.register as BrandDna['register']
  }
  const phrases = parsePhraseList(input.forbiddenPhrases, 'forbiddenPhrases')
  const claims = parsePhraseList(input.forbiddenClaims, 'forbiddenClaims')
  if (phrases?.length) out.forbiddenPhrases = [...new Set([...(dna.forbiddenPhrases ?? []), ...phrases])]
  if (claims?.length) out.forbiddenClaims = [...new Set([...(dna.forbiddenClaims ?? []), ...claims])]
  return out
}

/** Plan summary for a count of ads (credits = per-ad × count; relighting is included, free). */
export function adPackPlanSummary(items: number): AdPackPlanSummary {
  const q = quotePack(items)
  return { items, unitCost: q.perAd, total: q.credits, currency: 'credits' }
}

/** E1: one rejection per issue with its exact location, rule and limit / actual / token. */
export function toCopyRejections(issues: CopyCheckIssue[]): AdPackCopyRejection[] {
  // P0 #2c: same shape as status failures[].issues — field, sentence, offendingTokens, nearestFactKey, rule, limit?, actual?
  return issues.map((i) => ({ ...i, rule: i.code, field: i.path ?? i.field, baseField: i.field, offendingTokens: i.offendingTokens?.length ? i.offendingTokens : i.token ? [i.token] : [] }))
}

function planError(err: unknown): never {
  if (err instanceof AnglePlanError) throw new AdPackError('BAD_INPUT', err.message, { reason: err.reason, ...err.details })
  throw err
}

/**
 * The exact base angles a pack will run (quote, approval and start share it): planner spread,
 * or guide angles + angleIds (planner board ids, catalog ids, legacy ids). Unusable ids → BAD_INPUT
 * with `rejectedAngles` / `unknownAngleIds`, before any approval.
 */
function resolveAngles(dna: BrandDna, offer: OfferInput, size: number, sel: { angleIds?: string[]; angles?: AdAngle[] } = {}, brief?: string): AdAngle[] {
  try {
    return resolvePackAngles({ dna, offer, size, language: dna.language, angleIds: sel.angleIds, angles: sel.angles, brief, preferHook: dna.visual?.styleProfile?.hookType })
  } catch (err) {
    return planError(err)
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function toItemView(item: PackItem, dna?: Pick<BrandDna, 'forbiddenPhrases' | 'forbiddenClaims'>): AdPackItemView {
  return {
    id: item.id,
    index: item.index,
    status: item.status,
    format: item.angle.format,
    archetype: item.angle.archetype,
    hookType: item.angle.hookType,
    message: item.angle.message,
    angleId: item.angle.id,
    ...(item.angle.category ? { category: item.angle.category } : {}),
    ...(item.angle.rationale ? { rationale: item.angle.rationale } : {}),
    ...(item.angle.layoutFamily ? { layoutFamily: item.angle.layoutFamily } : {}),
    ...(item.angle.variation !== undefined ? { variation: item.angle.variation } : {}),
    ...(item.copy ? { headline: item.copy.headline, copy: item.copy } : {}),
    ...(item.scene ? { sceneUrl: item.scene.imageUrl } : {}),
    renders: item.renders ?? [],
    attempts: item.attempts,
    charged: Boolean(item.chargedAt),
    ...(libraryIdsFor(item).length ? { libraryImageIds: libraryIdsFor(item) } : {}),
    ...(dna && item.copy ? { forbiddenHits: findForbiddenHits(item.copy, dna).map((h) => ({ phrase: h.phrase, field: h.field })) } : {}),
    ...(item.fidelity ? { fidelity: fidelityView(item.fidelity) } : {}),
    ...(item.error ? { error: item.error } : {}),
  }
}

/** Public fidelity (A4): score, passed, method, detail SSIM / silhouette IoU / hue shift / ΔE and the heatmap link. */
export function fidelityView(f: NonNullable<PackItem['fidelity']>): NonNullable<AdPackItemView['fidelity']> {
  const num = (v: number | null | undefined) => v !== null && v !== undefined
  return {
    score: f.score,
    passed: f.passed,
    method: f.method,
    ...(num(f.ssim) ? { ssim: f.ssim as number } : {}),
    ...(num(f.deltaE) ? { deltaE: f.deltaE as number } : {}),
    ...(num(f.ssimDetail) ? { ssimDetail: f.ssimDetail as number } : {}),
    ...(num(f.silhouetteIoU) ? { silhouetteIoU: f.silhouetteIoU as number } : {}),
    ...(num(f.hueShift) ? { hueShift: f.hueShift as number } : {}),
    ...(num(f.chromaRatio) ? { chromaRatio: f.chromaRatio as number } : {}),
    ...(f.diffImageUrl ? { diffImageUrl: f.diffImageUrl } : {}),
  }
}

/** Library rows of the item's CURRENT renders (an edit re-render produces new URLs). */
function libraryIdsFor(item: PackItem): string[] {
  const saved = new Map((item.libraryImages ?? []).map((l) => [l.imageUrl, l.productImageId]))
  return (item.renders ?? []).map((r) => saved.get(r.imageUrl)).filter((id): id is string => Boolean(id))
}

function toStatusView(pack: Pack, items: PackItem[], nowMs: number, appOrigin?: string, language?: AdLanguage): AdPackStatusResponse {
  const progress: PackProgress = summarizePack(pack, items)
  const perAd = quotePack(1).perAd
  // Charges for the current attempt of each ad (a regenerate clears `chargedAt` until it is re-charged).
  const chargedCredits = items.filter((i) => i.chargedAt).length * perAd
  const leaseActive = items.some((i) => i.leaseUntil && Date.parse(i.leaseUntil) > nowMs && i.status !== 'done' && i.status !== 'failed')
  const moreWork = !TERMINAL_PACK.has(pack.status) && progress.pending > 0
  const deepLink = pack.businessId ? deepLinkForAdPack(appOrigin, pack.businessId, pack.id) : undefined
  const extras = buildStatusExtras({
    packId: pack.id,
    status: pack.status,
    items,
    moreWork,
    language: language ?? (pack.dna?.language === 'en' ? 'en' : 'es'),
    deepLink,
    dna: pack.dna,
  })
  return {
    packId: pack.id,
    status: pack.status,
    size: pack.size,
    ratios: pack.ratios,
    productFidelity: pack.render?.productFidelity ?? 'generated',
    ...(pack.render?.productFidelity === 'exact' ? { relight: packRelightMode(pack) } : {}),
    source: pack.source,
    quotedCredits: pack.quotedCredits,
    chargedCredits,
    progress: { total: progress.total, done: progress.done, failed: progress.failed, pending: progress.pending, counts: progress.counts },
    items: items.map((i) => toItemView(i, pack.dna)),
    moreWork,
    leaseActive,
    ...(pack.businessId && deepLink ? { businessId: pack.businessId, deepLink } : {}),
    ...(pack.offer?.productId ? { offerId: pack.offer.productId } : {}),
    ...extras,
    createdAt: pack.createdAt,
    updatedAt: pack.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

function adPackPlanSummaryFrom(approved: { items: number; total: number }): AdPackPlanSummary {
  return { items: approved.items, unitCost: approved.items ? Math.round(approved.total / approved.items) : 0, total: approved.total, currency: 'credits' }
}

function parseApproved(raw: unknown): { items: number; total: number } | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isObj(raw) || !Number.isFinite(raw.items) || !Number.isFinite(raw.total)) throw bad('approved must be { items, total }')
  return { items: Number(raw.items), total: Number(raw.total) }
}

function parseAngleIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.length > MAX_PACK_SIZE || !value.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 120)) {
    throw bad('angleIds must be an array of angle id strings')
  }
  return value.length ? [...new Set(value as string[])] : undefined
}

/**
 * Guide angles (adpackAngle objects from guide_bulk_angles) rebuilt against this offer's
 * confirmed facts. A category the facts cannot back (e.g. no price for valor_precio) is
 * adapted to an honest neighbour with the same format — the count never changes.
 */
function guideAnglesFor(inputs: AdpackAngleInput[], dna: BrandDna, offer: OfferInput, brief?: string): AdAngle[] {
  const out: AdAngle[] = []
  const used = new Set<string>()
  for (const g of inputs) {
    const chain = [g.id, angleId(HOOK_DEFAULT_CATEGORY[g.hookType], g.hookType, g.format), angleId('uso_real', 'desire', g.format), angleId('problema_solucion', 'pain', g.format), angleId('uso_real', 'desire', 'handheld_overlay'), angleId('uso_real', 'routine', 'ugc_person')]
    let built: AdAngle | null = null
    for (const id of chain) {
      if (used.has(id)) continue
      const r = angleFromId({ id, dna, offer, language: dna.language, brief, hook: g.hook, message: g.message, target: g.target, source: 'guide' })
      if (r.ok) {
        built = id === g.id ? r.angle : { ...r.angle, rationale: `${r.angle.rationale}${dna.language === 'es' ? ' (adaptado a los datos confirmados)' : ' (adapted to the confirmed facts)'}` }
        break
      }
    }
    if (!built) throw new AdPackError('BAD_INPUT', `Angle ${g.id} cannot be used for this offer`, { rejectedAngles: [{ id: g.id, reason: 'no honest category for these facts' }] })
    if (g.rationale && built.source === 'guide' && built.id === g.id) built.rationale = g.rationale.slice(0, 300)
    used.add(built.id)
    out.push(built)
  }
  return out
}

/** Selection fields shared by quote and start (same parser → approval quote = what runs). */
function parseSelection(input: { angleIds?: unknown; angles?: unknown; variations?: unknown; creativeFreedom?: unknown; layoutFamily?: unknown }) {
  const guide = parseAdpackAngleInputs(input.angles, MAX_PACK_SIZE)
  if (!guide.ok) throw bad(guide.error)
  return {
    angleIds: parseAngleIds(input.angleIds),
    guideAngles: guide.angles,
    variations: parseVariations(input.variations),
    creativeFreedom: parseCreativeFreedom(input.creativeFreedom),
    layoutFamily: parseLayoutFamily(input.layoutFamily),
  }
}


/** Angle selection + variations (raw, validated by the service). */
export interface SelectionInput {
  angleIds?: unknown
  angles?: unknown
  variations?: unknown
  creativeFreedom?: unknown
  layoutFamily?: unknown
}

/** Saved-brand alternative to dna + offer (raw, validated by the service). */
export interface SavedBrandRefInput {
  brandId?: unknown
  offerId?: unknown
  brandKitId?: unknown
  /** C3: product_images ids of the offer to use as the photo pool (first = hero). */
  productImageIds?: unknown
  /** C3: per-ad photos { "<ad number, 1-based as in adpack_status>": [productImageId…] }. */
  productImageIdsByAd?: unknown
}

const IMAGE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function parseProductImageIds(raw: unknown, label = 'productImageIds'): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw) || raw.length > 8 || raw.some((v) => typeof v !== 'string' || !IMAGE_ID_RE.test(v))) {
    throw bad(`${label} must be an array of up to 8 productImageId strings (from list_assets)`)
  }
  return raw.length ? [...new Set(raw as string[])] : undefined
}

export function parseProductImageIdsByAd(raw: unknown): Record<string, string[]> | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isObj(raw)) throw bad('productImageIdsByAd must be an object { "<ad index>": [productImageId…] }')
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d{1,2}$/.test(k) || Number(k) < 1 || Number(k) > MAX_PACK_SIZE) throw bad(`productImageIdsByAd keys must be ad numbers 1-${MAX_PACK_SIZE} (as in adpack_status)`)
    const ids = parseProductImageIds(v, `productImageIdsByAd.${k}`)
    if (ids) out[k] = ids.slice(0, 4)
  }
  return Object.keys(out).length ? out : undefined
}

export interface AdPackService {
  ingestDna(input: { userId: string; source?: AdPackSource } & AdPackIngestDnaRequest): Promise<AdPackIngestDnaResponse>
  /** DNA + offer from the owner's saved brand / kit / offer (no URLs, no credits). */
  dnaFromBrand(input: { userId: string; source?: AdPackSource; refresh?: unknown } & SavedBrandRefInput): Promise<AdPackFromBrandResponse>
  confirmDna(input: { userId: string; dna: unknown; edits: unknown }): Promise<AdPackConfirmDnaResponse>
  planAngles(input: { userId: string; dna?: unknown; offer?: unknown; size?: unknown; brief?: unknown } & SavedBrandRefInput): Promise<AdPackAnglesResponse>
  /**
   * Quote for exactly the ads start would run: same resolver (guide angles + angleIds, or the
   * planner's `size`), × variations. Relighting (exact mode) is included and free.
   */
  quote(input: { userId?: string; size?: unknown; dna?: unknown; offer?: unknown; brief?: unknown; productFidelity?: unknown; relight?: unknown } & SelectionInput & SavedBrandRefInput): Promise<AdPackQuote>
  startPack(input: {
    userId: string
    /** dna + offer, OR brandId (+ offerId / brandKitId): the server builds them from the saved brand. */
    dna?: unknown
    offer?: unknown
    brandId?: unknown
    offerId?: unknown
    /** Owner's campaign context for prompts (≤ 500 chars, sanitized). Never facts. */
    brief?: unknown
    size?: unknown
    /** Angle selection: planner ids or catalog ids (`<category>-<hook>-<format>`, e.g. guide_bulk_angles' adpackAngleId). */
    angleIds?: unknown
    /** adpackAngle objects from guide_bulk_angles (full hooks), rebuilt against the offer's facts. */
    angles?: unknown
    /** Ads per angle (1–3): same angle/copy, different scene, composition and layout family. */
    variations?: unknown
    /** high (default) = Advance picks angle, hook, format, layout and scene; guided = keep the agent's picks. */
    creativeFreedom?: unknown
    /** Force one layout family for the pack (otherwise style DNA or rotation). */
    layoutFamily?: unknown
    /** Brand kit Style DNA id (list_style_dnas): layout family, density and weight follow its winners. */
    styleDnaId?: unknown
    ratios?: unknown
    businessId?: unknown
    brandKitId?: unknown
    productImageIds?: unknown
    productImageIdsByAd?: unknown
    source: AdPackSource
    /** Fixed id for idempotent create (MCP: the approval id). */
    packId?: string
    /** What the user approved: a different plan now → PLAN_CHANGED, nothing is created (F1). */
    approved?: unknown
    /** Approved ad count (MCP approval): a different planned count → PLAN_CHANGED, nothing is created. */
    expectedAds?: number
    /** 'exact' (default with a product photo) = real product pixels; 'generated' = model-drawn product. */
    productFidelity?: unknown
    /** Exact mode relight: 'auto' (default, deterministic) or 'ai' (+ guarded model pass). Free either way. */
    relight?: unknown
    /** Kit objects allowed in scenes besides the product. */
    allowedProps?: unknown
    /** Appearance facts that must never change (prompts + vision checks). */
    immutableAttributes?: unknown
    /** Required offer facts for this run (overrides the offer's mustAppear). */
    mustAppear?: unknown
    /** Deliver the copy of this preview (must match the args; else PLAN_CHANGED). */
    previewId?: unknown
  } & DnaOverridesInput): Promise<AdPackStartResponse>
  /**
   * FREE copy dry run (P0 #2d): planning + copy + checks with the same arguments as start — model
   * text calls only, no images, no credits. Cached; start with identical args delivers this copy.
   * Rate-limited (PREVIEW_RATE_LIMIT_PER_HOUR per user).
   */
  previewPack(input: StartLikeInput): Promise<AdPackPreviewResponse>
  /** A stored, unexpired preview of this user (null otherwise). */
  getPreview(input: { userId: string; previewId: unknown }): Promise<StoredPreview | null>
  getStatus(input: { userId: string; packId: unknown; appOrigin?: string; language?: unknown }): Promise<AdPackStatusResponse>
  /**
   * getStatus, but first runs a short inline advance when work remains and no worker holds a lease,
   * and saves finished renders to the offer library once the pack completes (idempotent).
   */
  pollStatus(input: { userId: string; packId: unknown; inlineBudgetMs?: number; appOrigin?: string; language?: unknown }): Promise<AdPackStatusResponse>
  advance(input: { userId: string; packId: unknown; budgetMs?: number }): Promise<PackProgress>
  editText(input: { userId: string; packId: unknown; itemId: unknown; copy: unknown }): Promise<AdPackEditTextResponse>
  regenerate(input: { userId: string; packId: unknown; itemId: unknown; mode?: unknown }): Promise<AdPackRegenerateResponse>
  /** Free: re-render a finished ad into more ratios from its stored scene + copy (no model calls, no credits). */
  resize(input: { userId: string; packId: unknown; itemId: unknown; ratios: unknown }): Promise<AdPackResizeResponse>
  cancel(input: { userId: string; packId: unknown }): Promise<AdPackCancelResponse>
}

/** Start-shaped input shared by start and the free preview. */
export type StartLikeInput = Omit<Parameters<AdPackService['startPack']>[0], 'packId' | 'approved' | 'expectedAds' | 'previewId'> & { previewId?: unknown }

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

  /**
   * Save finished renders of a completed pack (done / partial) to the offer library.
   * Idempotent per render URL (item.libraryImages + the library's own existence check).
   * Never throws: a library failure must not break status / advance. Returns true when
   * something new was recorded.
   */
  const persistLibrary = async (userId: string, packId: string): Promise<boolean> => {
    if (!deps.library) return false
    const loaded = await deps.store.getPack(packId, userId).catch(() => null)
    if (!loaded) return false
    const { pack, items } = loaded
    const productId = pack.offer?.productId
    if (!productId || !COMPLETE_PACK.has(pack.status)) return false
    let changed = false
    for (const item of items) {
      if (item.status !== 'done' || !item.renders?.length) continue
      const have = new Set((item.libraryImages ?? []).map((l) => l.imageUrl))
      const missing = item.renders.filter((r) => !have.has(r.imageUrl))
      if (!missing.length) continue
      try {
        const saved = await deps.library.saveRenders({
          userId,
          productId,
          packId,
          itemIndex: item.index,
          headline: item.copy?.headline,
          renders: missing.map((r) => ({ ratio: r.ratio, imageUrl: r.imageUrl })),
        })
        const fresh = saved.filter((s) => !have.has(s.imageUrl))
        if (!fresh.length) continue
        await deps.store.updateItem(item.id, { libraryImages: [...(item.libraryImages ?? []), ...fresh] })
        changed = true
      } catch (err) {
        console.error('[adpack] library save failed', item.id, err instanceof Error ? err.message : err)
      }
    }
    return changed
  }

  const fromBrand = async (userId: string | undefined, ref: SavedBrandRefInput & { refresh?: unknown }, source: AdPackSource): Promise<SavedBrandResult> => {
    if (!userId) throw bad('userId is required')
    const brandId = parseOptionalUuid(ref.brandId, 'brandId')
    if (!brandId) throw bad('brandId is required')
    const offerId = parseOptionalUuid(ref.offerId, 'offerId')
    const brandKitId = parseOptionalUuid(ref.brandKitId, 'brandKitId')
    const productImageIds = parseProductImageIds(ref.productImageIds)
    const productImageIdsByAd = parseProductImageIdsByAd(ref.productImageIdsByAd)
    if (!deps.savedBrandDb) throw new AdPackError('UNAVAILABLE', 'Saved brands are not available in this runtime')
    const t0 = now()
    try {
      const res = await buildDnaFromSavedBrand({
        db: deps.savedBrandDb,
        userId,
        brandId,
        offerId,
        brandKitId,
        refresh: ref.refresh === true,
        refreshWebsite: deps.refreshWebsite,
        productImageIds,
        productImageIdsByAd,
      })
      if (res.costUsd > 0) {
        await log({
          userId,
          feature: 'brand_extraction',
          model: 'adpack-dna',
          costUsd: res.costUsd,
          source,
          durationMs: now() - t0,
          metadata: { feature: 'adpack_dna_from_brand', refresh: true },
        })
      }
      return res
    } catch (err) {
      if (err instanceof SavedBrandError) throw new AdPackError(err.code, err.message)
      throw err
    }
  }

  const hasValue = (v: unknown) => v !== undefined && v !== null && v !== ''

  /** dna + offer from the request, or built from the saved brand when only brandId is given. */
  const resolveDnaOffer = async (
    userId: string | undefined,
    input: { dna?: unknown; offer?: unknown } & SavedBrandRefInput,
    source: AdPackSource,
  ): Promise<{ dna: BrandDna; offer: OfferInput; saved?: SavedBrandResult }> => {
    if (input.dna === undefined && input.offer === undefined && hasValue(input.brandId)) {
      const saved = await fromBrand(userId, input, source)
      return { dna: saved.dna, offer: saved.offer, saved }
    }
    if (input.dna === undefined && input.offer === undefined) throw bad('Provide brandId (+ offerId) or dna + offer')
    return { dna: parseDna(input.dna), offer: parseOffer(input.offer) }
  }

  const advance: AdPackService['advance'] = async (input) => {
    const packId = parsePackId(input.packId)
    const { pack } = await load(input.userId, packId)
    const progress = await advancePack({
      store: deps.store,
      gateway: deps.gateway,
      renderer: deps.renderer,
      storage: deps.storage,
      charge: chargeFor(pack),
      packId,
      userId: input.userId,
      budgetMs: input.budgetMs ?? ADPACK_BACKGROUND_BUDGET_MS,
      concurrency: deps.concurrency,
      ...(deps.loadImage ? { loadImage: deps.loadImage } : {}),
    })
    if (COMPLETE_PACK.has(progress.status)) await persistLibrary(input.userId, packId)
    return progress
  }

  const getStatus: AdPackService['getStatus'] = async (input) => {
    const packId = parsePackId(input.packId)
    const { pack, items } = await load(input.userId, packId)
    const language = input.language === 'es' || input.language === 'en' ? input.language : undefined
    return toStatusView(pack, items, now(), input.appOrigin ?? deps.appOrigin, language)
  }

  const quoteFor = (size: number, opts: { variations?: number; angleIds?: string[] } = {}): AdPackQuote => {
    const q = quotePack(size)
    const variations = opts.variations ?? 1
    return {
      size,
      credits: q.credits,
      perAd: q.perAd,
      ...(opts.angleIds ? { angleIds: opts.angleIds } : {}),
      ...(variations > 1 ? { variations, angles: Math.round(size / variations) } : {}),
    }
  }

  /** Angle ids of the latest packs of this offer (cross-pack diversity, planner picks only). */
  const recentAnglesFor = async (userId: string, offer: OfferInput, sel: { angleIds?: string[]; guideAngles: unknown[]; creativeFreedom?: CreativeFreedom }): Promise<string[] | undefined> => {
    if (sel.angleIds?.length || sel.guideAngles.length || sel.creativeFreedom === 'guided') return undefined
    if (!offer.productId || !deps.store.recentAngleIds) return undefined
    try {
      const ids = await deps.store.recentAngleIds(userId, offer.productId, RECENT_PACKS_FOR_DIVERSITY)
      return ids.length ? ids : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Everything start and the free preview share: DNA + offer (saved brand or payload), request
   * rules (locale, register, forbidden lists, mustAppear), selection, render options, Style DNA,
   * cross-pack angle diversity and the exact plan (planPack).
   */
  const prepareRun = async (input: StartLikeInput, packId: string) => {
    const fromSaved = input.dna === undefined && input.offer === undefined && hasValue(input.brandId)
    let dna = fromSaved ? undefined : parseDna(input.dna)
    let offer = fromSaved ? undefined : parseOffer(input.offer)
    const size = parseSize(input.size)
    const ratios = parseRatios(input.ratios)
    const brief = parseBrief(input.brief)
    let businessId = parseOptionalUuid(input.businessId ?? (fromSaved ? undefined : input.brandId), 'businessId')
    let brandKitId = parseOptionalUuid(input.brandKitId, 'brandKitId')
    if (!fromSaved && (businessId || brandKitId)) {
      const owned = deps.verifyLinks ? await deps.verifyLinks({ userId: input.userId, businessId, brandKitId }) : false
      if (!owned) throw new AdPackError('NOT_FOUND', 'Brand or brand kit not found')
    }
    let savedStyleDnas: StyleDna[] | undefined
    if (fromSaved) {
      // Owner-scoped load: another user's brandId / offerId / kit → NOT_FOUND.
      const saved = await fromBrand(input.userId, { brandId: input.brandId, offerId: input.offerId, brandKitId: input.brandKitId, productImageIds: input.productImageIds, productImageIdsByAd: input.productImageIdsByAd }, input.source)
      if (businessId && businessId !== saved.brandId) throw bad('businessId must match brandId')
      savedStyleDnas = saved.styleDnas ?? []
      dna = saved.dna
      offer = saved.offer
      businessId = saved.brandId
      brandKitId = saved.brandKitId
    }
    if (!dna || !offer) throw bad('Provide brandId (+ offerId) or dna + offer')
    dna = applyDnaOverrides(dna, input)
    const mustAppear = parseMustAppear(input.mustAppear)
    if (mustAppear) offer = { ...offer, mustAppear }
    const sel = parseSelection(input)
    const render = resolveRenderOptions(input, offer)
    const styleDnaId = parseStyleDnaId(input.styleDnaId)
    let styleNote: string | undefined
    if (styleDnaId) {
      if (!savedStyleDnas) throw bad('styleDnaId needs brandId (the style DNA lives on the brand kit)')
      const t0 = now()
      const resolved = await resolveStyleProfile({ styleDnas: savedStyleDnas, styleDnaId, gateway: deps.gateway, language: dna.language })
      if (!resolved) throw new AdPackError('NOT_FOUND', 'Style DNA not found on this brand kit (use list_style_dnas)')
      styleNote = resolved.note
      if (resolved.analyzed && resolved.analysis) {
        await log({ userId: input.userId, feature: 'brand_extraction', model: 'adpack-style-dna', costUsd: resolved.costUsd, source: input.source, durationMs: now() - t0, metadata: { feature: 'adpack_style_dna', styleDnaId } })
        if (deps.saveStyleDnaAnalysis && businessId) {
          await deps.saveStyleDnaAnalysis({ userId: input.userId, brandId: businessId, styleDna: resolved.styleDna }).catch((err) => {
            console.error('[adpack] style DNA analysis not saved', err instanceof Error ? err.message : err)
          })
        }
      }
      dna = { ...dna, visual: { ...(dna.visual ?? {}), styleProfile: resolved.profile } }
    }
    const guideAngles = guideAnglesFor(sel.guideAngles, dna, offer, brief)
    const avoidAngleIds = await recentAnglesFor(input.userId, offer, sel)
    let planned: ReturnType<typeof planPack>
    try {
      planned = planPack({
        dna,
        offer,
        size,
        angleIds: sel.angleIds,
        angles: guideAngles,
        variations: sel.variations,
        creativeFreedom: sel.creativeFreedom,
        layoutFamily: sel.layoutFamily,
        styleProfile: dna.visual?.styleProfile,
        ratios,
        userId: input.userId,
        source: input.source,
        businessId,
        brandKitId,
        brief,
        render,
        ...(avoidAngleIds ? { avoidAngleIds } : {}),
        ids: { packId },
      })
    } catch (err) {
      return planError(err)
    }
    if (!planned.items.length) throw bad(sel.angleIds ? 'None of the selected angles match this offer; re-plan angles' : 'No angles could be planned for this offer')
    if (planned.items.length > MAX_PACK_SIZE) throw bad(`angles × variations = ${planned.items.length} ads; the maximum per pack is ${MAX_PACK_SIZE}`)
    return { dna, offer, businessId, brandKitId, sel, brief, ratios, render, styleNote, planned }
  }

  /**
   * The preview whose copy this start delivers: the explicit `previewId` (must match the args,
   * the facts and the planned angles, else PLAN_CHANGED — nothing runs), or the newest unexpired
   * preview with identical arguments (silently skipped when stale).
   */
  const previewForStart = async (input: StartLikeInput & { previewId?: unknown }, run: Awaited<ReturnType<typeof prepareRun>>, current: AdPackPlanSummary): Promise<StoredPreview | null> => {
    if (!deps.previews) {
      if (hasValue(input.previewId)) throw new AdPackError('PLAN_CHANGED', 'Copy previews are not available in this runtime; start without previewId.', { reason: 'preview_unavailable', planned: current })
      return null
    }
    const argsHash = previewArgsHash(input)
    const factsHash = previewFactsHash(run.dna, run.offer)
    const plannedIds = run.planned.items.filter((i) => !i.angle.variation).map((i) => i.angle.id)
    const matches = (p: StoredPreview) => p.argsHash === argsHash && p.factsHash === factsHash && p.ads.map((a) => a.angle.id).join('|') === plannedIds.join('|')
    if (hasValue(input.previewId)) {
      const id = str(input.previewId, 64)
      const p = id && UUID_RE.test(id) ? await deps.previews.get(id, input.userId) : null
      const why = !p ? 'preview_not_found' : Date.parse(p.expiresAt) <= now() ? 'preview_expired' : !matches(p) ? 'preview_changed' : null
      if (why) {
        throw new AdPackError('PLAN_CHANGED', why === 'preview_changed'
          ? 'The previewed copy no longer matches this request (arguments, offer facts or planned angles changed). Nothing ran; preview again and ask for a fresh approval.'
          : 'The copy preview was not found or expired. Nothing ran; preview again (adpack_preview) and ask for a fresh approval.', { reason: why, previewId: id, planned: current })
      }
      return p
    }
    try {
      const p = await deps.previews.findLatest(input.userId, argsHash, now())
      return p && matches(p) ? p : null
    } catch {
      return null
    }
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

    async dnaFromBrand(input) {
      const saved = await fromBrand(input.userId, input, input.source ?? 'web')
      let planned: AdAngle[] = []
      try {
        planned = resolvePackAngles({ dna: saved.dna, offer: saved.offer, size: DEFAULT_PACK_SIZE, language: saved.dna.language })
      } catch (err) {
        if (!(err instanceof AnglePlanError)) throw err
      }
      return {
        dna: saved.dna,
        offer: saved.offer,
        gaps: saved.gaps,
        notes: saved.notes,
        brandId: saved.brandId,
        ...(saved.offerId ? { offerId: saved.offerId } : {}),
        ...(saved.brandKitId ? { brandKitId: saved.brandKitId } : {}),
        ...(saved.websiteUrl ? { websiteUrl: saved.websiteUrl } : {}),
        ...(saved.styleDnas?.length ? { styleDnas: saved.styleDnas.map((d) => ({ id: d.id, name: d.name, kind: d.kind, references: d.referenceUrls.length, analyzed: Boolean(d.analysis) })) } : {}),
        quote: quoteFor(planned.length),
      }
    },

    async confirmDna(input) {
      const dna = parseDna(input.dna)
      return { dna: confirmFacts(dna, parseFactEdits(input.edits)) }
    },

    async planAngles(input) {
      const { dna, offer } = await resolveDnaOffer(input.userId, input, 'web')
      const angles = resolveAngles(dna, offer, parseSize(input.size), {}, parseBrief(input.brief))
      return { size: angles.length, angles }
    },

    async quote(input) {
      const size = parseSize(input.size)
      const sel = parseSelection(input)
      if ((input.dna !== undefined && input.offer !== undefined) || (input.dna === undefined && input.offer === undefined && hasValue(input.brandId))) {
        const { dna, offer } = await resolveDnaOffer(input.userId, input, 'web')
        const brief = parseBrief(input.brief)
        const guideAngles = guideAnglesFor(sel.guideAngles, dna, offer, brief)
        const angles = resolveAngles(dna, offer, size, { angleIds: sel.angleIds, angles: guideAngles }, brief)
        const ads = packAdCount(angles.length, sel.variations)
        if (ads > MAX_PACK_SIZE) throw bad(`angles × variations = ${ads} ads; the maximum per pack is ${MAX_PACK_SIZE}`)
        // Same render resolution as start (validates productFidelity / relight; relight is free).
        resolveRenderOptions({ productFidelity: input.productFidelity, relight: input.relight }, offer)
        return quoteFor(ads, { variations: sel.variations, angleIds: angles.map((a) => a.id) })
      }
      if (sel.angleIds || sel.guideAngles.length) throw bad('angleIds / angles need dna + offer or brandId to resolve')
      parseRelight(input.relight)
      const ads = packAdCount(size, sel.variations)
      if (ads > MAX_PACK_SIZE) throw bad(`angles × variations = ${ads} ads; the maximum per pack is ${MAX_PACK_SIZE}`)
      return quoteFor(ads, { variations: sel.variations })
    },

    async startPack(input) {
      const fromSaved = input.dna === undefined && input.offer === undefined && hasValue(input.brandId)
      // dna path: validate the payload first (cheap, no I/O), as before.
      if (!fromSaved) {
        parseDna(input.dna)
        parseOffer(input.offer)
      }
      const packId = input.packId ? parsePackId(input.packId) : randomUUID()
      if (input.packId) {
        const existing = await deps.store.getPack(packId, input.userId)
        if (existing) {
          return { packId, status: existing.pack.status, quote: quoteFor(existing.pack.size), existing: true }
        }
      }
      const run = await prepareRun(input, packId)
      const { planned, dna, sel, styleNote } = run
      const approved = parseApproved(input.approved)
      // F1: never run (or silently shrink) a plan the user did not approve. The plan is recomputed
      // here with the quote's resolver (ads × variations; relighting is included and free).
      const current = adPackPlanSummary(planned.items.length)
      const approvedCount = input.expectedAds !== undefined ? Number(input.expectedAds) : undefined
      if ((approved && (approved.items !== current.items || approved.total !== current.total)) || (approvedCount !== undefined && approvedCount !== current.items)) {
        const was = approved ?? { items: approvedCount as number, total: (approvedCount as number) * current.unitCost }
        throw new AdPackError('PLAN_CHANGED', `Approved ${was.items} ads for ${was.total} credits, but the plan is now ${current.items} ads for ${current.total} credits. Nothing ran; ask for a fresh approval.`, {
          approved: adPackPlanSummaryFrom(was),
          planned: current,
          plannedAds: current.items,
          approvedAds: was.items,
        })
      }
      // P0 #2d: the copy the user previewed is the copy that ships (same args, same facts, same angles).
      const reused = await previewForStart(input, run, current)
      await requireCredits(input.userId, planned.pack.size)
      try {
        await deps.store.createPack(planned.pack, reused ? applyPreview(planned.items, reused) : planned.items)
      } catch (err) {
        // Concurrent retry with the same fixed id won the insert: return that pack.
        const existing = input.packId ? await deps.store.getPack(packId, input.userId).catch(() => null) : null
        if (!existing) throw err
        return { packId, status: existing.pack.status, quote: quoteFor(existing.pack.size), existing: true }
      }
      const previewAds = reused ? reused.ads.filter((a) => a.ok && a.copy).map((a) => a.index + 1) : []
      return {
        packId,
        status: planned.pack.status,
        quote: quoteFor(planned.pack.size, { variations: sel.variations, angleIds: [...new Set(planned.items.map((i) => i.angle.id))] }),
        existing: false,
        creativeFreedom: planned.creativeFreedom,
        variations: sel.variations,
        angles: planned.items.map((i) => ({ index: i.index + 1, angleId: i.angle.id, category: i.angle.category, hookType: i.angle.hookType, format: i.angle.format, layoutFamily: i.angle.layoutFamily, ...(i.angle.variation !== undefined ? { variation: i.angle.variation } : {}), rationale: i.angle.rationale })),
        ...(dna.visual?.styleProfile ? { styleProfile: dna.visual.styleProfile } : {}),
        ...(styleNote ? { notes: [styleNote] } : {}),
        ...(reused ? { previewId: reused.previewId, previewAds } : {}),
      }
    },

    async previewPack(input) {
      if (!deps.previews) throw new AdPackError('UNAVAILABLE', 'Copy previews are not available in this runtime')
      const nowMs = now()
      const used = await deps.previews.countSince(input.userId, new Date(nowMs - 60 * 60 * 1000).toISOString())
      if (used >= PREVIEW_RATE_LIMIT_PER_HOUR) {
        throw new AdPackError('RATE_LIMITED', `At most ${PREVIEW_RATE_LIMIT_PER_HOUR} copy previews per hour (they use model tokens). Try again later or start the pack.`, { limit: PREVIEW_RATE_LIMIT_PER_HOUR, retryAfterSeconds: 3600 })
      }
      const previewId = randomUUID()
      const run = await prepareRun(input, previewId)
      const { dna, offer, planned, brief } = run
      const language = dna.language
      const t0 = now()
      // Planning + copy + checks only: no scene, no image, no credits. Variations share their base copy.
      const bases = planned.items.filter((i) => !i.angle.variation)
      const done = new Map<number, StoredPreviewAd>()
      await mapWithConcurrency(bases, deps.concurrency ?? 4, async (item) => {
        const others = [...done.values()].map((a) => a.copy).filter((c): c is NonNullable<typeof c> => Boolean(c))
        const res = await writeAdCopy({ gateway: deps.gateway, dna, offer, angle: item.angle, language, otherCopies: others, brief })
        done.set(item.index, {
          index: item.index,
          angle: res.retryAngle ?? item.angle,
          ...(res.copy ? { copy: res.copy } : {}),
          ...(res.check ? { copyCheck: res.check } : {}),
          ok: res.ok,
          ...(res.blocking.length ? { blocking: res.blocking } : {}),
          costUsd: res.costUsd,
          repairRounds: res.repairRounds,
        })
      })
      const ads = bases.map((i) => done.get(i.index) ?? { index: i.index, angle: i.angle, ok: false, costUsd: 0, repairRounds: 0 })
      const costUsd = Number(ads.reduce((s, a) => s + a.costUsd, 0).toFixed(6))
      const stored: StoredPreview = {
        previewId,
        userId: input.userId,
        ...(run.businessId ? { businessId: run.businessId } : {}),
        argsHash: previewArgsHash(input),
        factsHash: previewFactsHash(dna, offer),
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + PREVIEW_TTL_MS).toISOString(),
        ads,
        costUsd,
      }
      await deps.previews.save(stored)
      if (costUsd > 0) {
        await log({ userId: input.userId, feature: 'script', model: 'adpack-copy-preview', costUsd, source: input.source, durationMs: now() - t0, metadata: { feature: 'adpack_preview', previewId, ads: ads.length } })
      }
      const byIndex = new Map(ads.map((a) => [a.index, a]))
      const views = planned.items.map((item) => {
        const base = item.angle.variation ? ads.find((a) => a.angle.id === item.angle.id) : byIndex.get(item.index)
        return previewAdView(item, base, offerForItem(offer, item.index), Boolean(offer.productImageUrlsByAd?.[String(item.index)]?.length))
      })
      return {
        previewId,
        quote: quoteFor(planned.items.length, { variations: run.sel.variations, angleIds: [...new Set(planned.items.map((i) => i.angle.id))] }),
        ads: views,
        costUsd,
        chargedCredits: 0 as const,
        expiresAt: stored.expiresAt,
        remainingThisHour: Math.max(0, PREVIEW_RATE_LIMIT_PER_HOUR - used - 1),
      }
    },

    async getPreview(input) {
      if (!deps.previews) return null
      const id = str(input.previewId, 64)
      if (!id || !UUID_RE.test(id)) return null
      const p = await deps.previews.get(id, input.userId)
      return p && Date.parse(p.expiresAt) > now() ? p : null
    },

    getStatus,

    async pollStatus(input) {
      let status = await getStatus(input)
      if (status.moreWork && !status.leaseActive) {
        try {
          await advance({ userId: input.userId, packId: status.packId, budgetMs: input.inlineBudgetMs ?? ADPACK_INLINE_BUDGET_MS })
        } catch (err) {
          if (isAdPackError(err)) throw err
          console.error('[adpack] inline advance failed', err instanceof Error ? err.message : err)
        }
        status = await getStatus(input)
      }
      // A dropped background task may have finished the pack without saving: retry here (idempotent).
      const unsaved = status.items.some((i) => i.status === 'done' && i.renders.length && (i.libraryImageIds?.length ?? 0) < i.renders.length)
      if (COMPLETE_PACK.has(status.status) && status.offerId && unsaved && (await persistLibrary(input.userId, status.packId))) {
        status = await getStatus(input)
      }
      return status
    },

    advance,

    async editText(input) {
      const packId = parsePackId(input.packId)
      const itemId = parseItemId(input.itemId)
      const copyPatch = parseCopyPatch(input.copy)
      const res = await editItemText({ store: deps.store, renderer: deps.renderer, storage: deps.storage, packId, itemId, userId: input.userId, copyPatch, ...(deps.loadImage ? { loadImage: deps.loadImage } : {}) })
      if (res.ok) {
        // The edited version replaces the renders: save it to the offer library too.
        if (await persistLibrary(input.userId, packId)) {
          const fresh = (await deps.store.getPack(packId, input.userId))?.items.find((i) => i.id === itemId)
          if (fresh) return { item: toItemView(fresh) }
        }
        return { item: toItemView(res.item) }
      }
      if (res.error === 'pack_not_found') throw new AdPackError('NOT_FOUND', 'Pack not found')
      if (res.error === 'item_not_found') throw new AdPackError('NOT_FOUND', 'Ad not found')
      if (res.error === 'item_not_rendered') throw new AdPackError('NOT_READY', 'This ad is not rendered yet')
      const issues = toCopyRejections(res.issues ?? [])
      const first = issues[0]
      const why = first
        ? `${first.field}: ${first.rule}${first.limit !== undefined ? ` (limit ${first.limit}, actual ${first.actual})` : first.token ? ` ("${first.token}")` : ''}`
        : 'facts or length rules'
      throw new AdPackError('COPY_REJECTED', `The edited text was rejected — ${why}${issues.length > 1 ? ` and ${issues.length - 1} more` : ''}`, { issues })
    },

    async resize(input) {
      const packId = parsePackId(input.packId)
      const itemId = parseItemId(input.itemId)
      const ratios = parseRatios(input.ratios)
      const res = await resizeItem({ store: deps.store, renderer: deps.renderer, storage: deps.storage, packId, itemId, userId: input.userId, ratios, ...(deps.loadImage ? { loadImage: deps.loadImage } : {}) })
      if (!res.ok) {
        if (res.error === 'pack_not_found') throw new AdPackError('NOT_FOUND', 'Pack not found')
        if (res.error === 'item_not_found') throw new AdPackError('NOT_FOUND', 'Ad not found')
        if (res.error === 'cutout_missing') throw new AdPackError('NOT_READY', 'The stored product cut-out of this ad is missing; regenerate its scene to resize it with the real product')
        throw new AdPackError('NOT_READY', 'This ad is not rendered yet')
      }
      const loaded = await deps.store.getPack(packId, input.userId)
      const extra = {
        ...(res.method ? { method: res.method } : {}),
        ...(res.rejected?.length ? { rejected: res.rejected.map((r) => ({ ratio: r.ratio, fidelity: fidelityView(r.fidelity) })) } : {}),
      }
      // New renders go to the offer library like any finished render (idempotent per URL).
      if (res.added.length && (await persistLibrary(input.userId, packId))) {
        const fresh = (await deps.store.getPack(packId, input.userId))?.items.find((i) => i.id === itemId)
        if (fresh) return { item: toItemView(fresh, loaded?.pack.dna), added: res.added, chargedCredits: 0, ...extra }
      }
      return { item: toItemView(res.item, loaded?.pack.dna), added: res.added, chargedCredits: 0, ...extra }
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
// Copy preview (P0 #2d) + required facts + cross-pack diversity helpers
// ---------------------------------------------------------------------------

/** Latest packs of the same offer whose angles the planner avoids (P1 #10). */
export const RECENT_PACKS_FOR_DIVERSITY = 2

/** Request override of the offer's required facts (create_ads / adpack_start `mustAppear`). */
export function parseMustAppear(raw: unknown): MustAppearKey[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) throw bad(`mustAppear must be an array of: ${MUST_APPEAR_KEYS.join(', ')}`)
  const out: MustAppearKey[] = []
  for (const k of raw) {
    if (typeof k !== 'string' || !(MUST_APPEAR_KEYS as readonly string[]).includes(k)) throw bad(`mustAppear: unknown key ${JSON.stringify(k)} (use ${MUST_APPEAR_KEYS.join(', ')})`)
    if (!out.includes(k as MustAppearKey)) out.push(k as MustAppearKey)
  }
  return out
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

const sha = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex')

/** Arguments that change the copy (ratios / render options do not): preview ↔ start identity. */
export const PREVIEW_ARG_KEYS = [
  'brandId', 'offerId', 'brandKitId', 'dna', 'offer', 'size', 'angleIds', 'angles', 'variations', 'creativeFreedom', 'layoutFamily',
  'styleDnaId', 'brief', 'locale', 'register', 'forbiddenPhrases', 'forbiddenClaims', 'productImageIds', 'productImageIdsByAd', 'mustAppear',
] as const

export function previewArgsHash(input: Record<string, unknown>): string {
  const picked: Record<string, unknown> = {}
  for (const k of PREVIEW_ARG_KEYS) if (input[k] !== undefined && input[k] !== null && input[k] !== '') picked[k] = input[k]
  if (picked.size !== undefined) picked.size = parseSize(picked.size)
  return sha(picked)
}

/** The facts + language rules the copy was written from (a preview is stale once they change). */
export function previewFactsHash(dna: BrandDna, offer: OfferInput): string {
  return sha({
    brand: dna.brandName,
    language: dna.language,
    register: dna.register,
    locale: dna.locale,
    allowUrgency: dna.allowUrgency === true,
    forbidden: [...(dna.forbiddenPhrases ?? []), ...(dna.forbiddenClaims ?? [])],
    facts: dna.facts.filter((f) => f.confirmed).map((f) => [f.key, f.value]),
    offer: offer.name,
    offerFacts: offer.facts.map((f) => [f.key, f.value, f.confirmed]),
    notIncluded: offer.notIncluded ?? [],
    strictClaims: offer.strictClaims === true,
    mustAppear: offer.mustAppear ?? null,
  })
}

/** Planned items with the previewed copy (passing ads start at copy_ready; the rest are written at run time). */
export function applyPreview(items: PackItem[], preview: StoredPreview): PackItem[] {
  const byIndex = new Map(preview.ads.map((a) => [a.index, a]))
  return items.map((item) => {
    if (item.angle.variation) return item
    const ad = byIndex.get(item.index)
    if (!ad || !ad.ok || !ad.copy || ad.angle.id !== item.angle.id) return item
    return {
      ...item,
      status: 'copy_ready' as const,
      angle: { ...item.angle, ...(ad.angle.retry ? { retry: ad.angle.retry } : {}) },
      copy: ad.copy,
      ...(ad.copyCheck ? { copyCheck: ad.copyCheck } : {}),
      timings: { copyMs: 0 },
    }
  })
}

/** One preview row: angle, rationale, layout family, planned photo, the copy fields and its check. */
export function previewAdView(item: PackItem, ad: StoredPreviewAd | undefined, offer: OfferInput, perAd: boolean): AdPackPreviewResponse['ads'][number] {
  const photos = resolveProductPhotos(offer)
  const pick = photos.length ? pickProductImage(photos.map((p) => ({ url: p.url, role: p.role, label: p.label })), perAd ? {} : { format: item.angle.format }) : null
  const photo = perAd && photos[0] ? photos[0] : pick ? photos.find((p) => p.url === pick.url) : undefined
  const copy = ad?.copy
  const issues = ad?.blocking ?? []
  const warnings = (ad?.copyCheck?.issues ?? []).filter((i) => !issues.includes(i))
  return {
    index: item.index + 1,
    angleId: item.angle.id,
    ...(item.angle.category ? { category: item.angle.category } : {}),
    hookType: ad?.angle.retry?.hookType ?? item.angle.hookType,
    format: item.angle.format,
    ...(item.angle.rationale ? { rationale: item.angle.rationale } : {}),
    ...(item.angle.layoutFamily ? { layoutFamily: item.angle.layoutFamily } : {}),
    ...(item.angle.variation !== undefined ? { variation: item.angle.variation } : {}),
    ...(photo ? { photo: { url: photo.url, role: photo.role, ...(photo.label ? { label: photo.label } : {}) } } : {}),
    ...(copy
      ? {
          headline: copy.headline,
          ...(copy.subline ? { subline: copy.subline } : {}),
          bullets: copy.bullets,
          ...(copy.offerLine ? { offerLine: copy.offerLine } : {}),
          cta: copy.cta,
          caption: copy.caption,
        }
      : {}),
    check: { ok: Boolean(ad?.ok), repairRounds: ad?.repairRounds ?? 0, issues: issues.map(issueView), warnings: warnings.slice(0, 8).map(issueView) },
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
