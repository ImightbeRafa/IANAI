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
  planPack,
  quotePack,
  regenerateItem,
  resizeItem,
  summarizePack,
  type PackProgress,
} from './pack-runner.js'
import { AnglePlanError, DEFAULT_PACK_SIZE, MAX_PACK_SIZE, resolvePackAngles } from './plan-angles.js'
import { findForbiddenHits } from './check-copy.js'
import { normalizeLocale, VOSEO_LOCALES } from './ian-rules.js'
import { createDefaultRenderer } from './render-adapter.js'
import type { AdPackStorage, ChargeFn, Renderer } from './runner-types.js'
import { createSupabaseAdPackStorage } from './storage.js'
import { buildStatusExtras } from './status-summary.js'
import { createSupabasePackStore } from './store-supabase.js'
import { getSupabaseAdmin } from '../supabase-admin.js'
import type { AdAngle, AdLanguage, AspectRatio, BrandDna, CopyCheckIssue, ModelGateway, OfferInput, Pack, PackItem, PackStatus, PackStore } from './types.js'
import type { DnaPart } from './dna/part.js'

export const ADPACK_IMAGE_MODEL = 'grok-imagine'
/** Background advance budget (waitUntil / MCP scheduler). */
export const ADPACK_BACKGROUND_BUDGET_MS = 50_000
/** Inline advance budget when a status poll finds no active worker. */
export const ADPACK_INLINE_BUDGET_MS = 8_000
export const ADPACK_MAX_UPLOADS = 12

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RATIOS: ReadonlySet<AspectRatio> = new Set(['1:1', '4:5', '9:16'])
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
    refreshWebsite: (url, language) => ingestWebsite({ url, gateway, language }),
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
  return offer
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

function parseStringList(raw: unknown, label: string): string[] | undefined {
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
  const phrases = parseStringList(input.forbiddenPhrases, 'forbiddenPhrases')
  const claims = parseStringList(input.forbiddenClaims, 'forbiddenClaims')
  if (phrases?.length) out.forbiddenPhrases = [...new Set([...(dna.forbiddenPhrases ?? []), ...phrases])]
  if (claims?.length) out.forbiddenClaims = [...new Set([...(dna.forbiddenClaims ?? []), ...claims])]
  return out
}

/** Plan summary for a count of ads (credits = per-ad × count). */
export function adPackPlanSummary(items: number): AdPackPlanSummary {
  const q = quotePack(items)
  return { items, unitCost: q.perAd, total: q.credits, currency: 'credits' }
}

/** E1: one rejection per issue with its exact location, rule and limit / actual / token. */
export function toCopyRejections(issues: CopyCheckIssue[]): AdPackCopyRejection[] {
  return issues.map((i) => ({ ...i, rule: i.code, field: i.path ?? i.field, baseField: i.field }))
}

function planError(err: unknown): never {
  if (err instanceof AnglePlanError) throw new AdPackError('BAD_INPUT', err.message, { reason: err.reason, ...err.details })
  throw err
}

/** The exact angles a pack will run (quote, approval and start share it). */
function resolveAngles(dna: BrandDna, offer: OfferInput, size: number, angleIds?: string[]): AdAngle[] {
  try {
    return resolvePackAngles({ dna, offer, size, language: dna.language, angleIds })
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
    ...(item.copy ? { headline: item.copy.headline, copy: item.copy } : {}),
    ...(item.scene ? { sceneUrl: item.scene.imageUrl } : {}),
    renders: item.renders ?? [],
    attempts: item.attempts,
    charged: Boolean(item.chargedAt),
    ...(libraryIdsFor(item).length ? { libraryImageIds: libraryIdsFor(item) } : {}),
    ...(dna && item.copy ? { forbiddenHits: findForbiddenHits(item.copy, dna).map((h) => ({ phrase: h.phrase, field: h.field })) } : {}),
    ...(item.error ? { error: item.error } : {}),
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
  planAngles(input: { userId: string; dna?: unknown; offer?: unknown; size?: unknown } & SavedBrandRefInput): Promise<AdPackAnglesResponse>
  /** Quote for exactly the ads start would run (same resolver; `angleIds` = that selection). */
  quote(input: { userId?: string; size?: unknown; dna?: unknown; offer?: unknown; angleIds?: unknown } & SavedBrandRefInput): Promise<AdPackQuote>
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
    /** Angle-board selection: ids from planAngles with the same size. */
    angleIds?: unknown
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
  } & DnaOverridesInput): Promise<AdPackStartResponse>
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
        quote: quoteFor(planned.length),
      }
    },

    async confirmDna(input) {
      const dna = parseDna(input.dna)
      return { dna: confirmFacts(dna, parseFactEdits(input.edits)) }
    },

    async planAngles(input) {
      const { dna, offer } = await resolveDnaOffer(input.userId, input, 'web')
      const angles = resolveAngles(dna, offer, parseSize(input.size))
      return { size: angles.length, angles }
    },

    async quote(input) {
      const size = parseSize(input.size)
      const angleIds = parseAngleIds(input.angleIds)
      if ((input.dna !== undefined && input.offer !== undefined) || (input.dna === undefined && input.offer === undefined && hasValue(input.brandId))) {
        const { dna, offer } = await resolveDnaOffer(input.userId, input, 'web')
        const angles = resolveAngles(dna, offer, size, angleIds)
        return { ...quoteFor(angles.length), angleIds: angles.map((a) => a.id) }
      }
      if (angleIds) throw bad('angleIds need dna + offer or brandId to resolve')
      return quoteFor(size)
    },

    async startPack(input) {
      const fromSaved = input.dna === undefined && input.offer === undefined && hasValue(input.brandId)
      // dna path: validate the payload first (cheap, no I/O), as before.
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
      const packId = input.packId ? parsePackId(input.packId) : randomUUID()
      if (input.packId) {
        const existing = await deps.store.getPack(packId, input.userId)
        if (existing) {
          return { packId, status: existing.pack.status, quote: quoteFor(existing.pack.size), existing: true }
        }
      }
      if (fromSaved) {
        // Owner-scoped load: another user's brandId / offerId / kit → NOT_FOUND.
        const saved = await fromBrand(input.userId, { brandId: input.brandId, offerId: input.offerId, brandKitId: input.brandKitId, productImageIds: input.productImageIds, productImageIdsByAd: input.productImageIdsByAd }, input.source)
        if (businessId && businessId !== saved.brandId) throw bad('businessId must match brandId')
        dna = saved.dna
        offer = saved.offer
        businessId = saved.brandId
        brandKitId = saved.brandKitId
      }
      if (!dna || !offer) throw bad('Provide brandId (+ offerId) or dna + offer')
      dna = applyDnaOverrides(dna, input)
      const angleIds = parseAngleIds(input.angleIds)
      const approved = parseApproved(input.approved)
      let planned: ReturnType<typeof planPack>
      try {
        planned = planPack({ dna, offer, size, angleIds, ratios, userId: input.userId, source: input.source, businessId, brandKitId, brief, ids: { packId } })
      } catch (err) {
        return planError(err)
      }
      if (!planned.items.length) throw bad('No angles could be planned for this offer')
      // F1: never run (or silently shrink) a plan the user did not approve.
      const current = adPackPlanSummary(planned.items.length)
      if (approved && (approved.items !== current.items || approved.total !== current.total)) {
        throw new AdPackError('PLAN_CHANGED', `Approved ${approved.items} ads for ${approved.total} credits, but the plan is now ${current.items} ads for ${current.total} credits. Nothing ran; ask for a fresh approval.`, {
          approved: adPackPlanSummaryFrom(approved),
          planned: current,
        })
      }
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
      const res = await editItemText({ store: deps.store, renderer: deps.renderer, storage: deps.storage, packId, itemId, userId: input.userId, copyPatch })
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
      const res = await resizeItem({ store: deps.store, renderer: deps.renderer, storage: deps.storage, packId, itemId, userId: input.userId, ratios })
      if (!res.ok) {
        if (res.error === 'pack_not_found') throw new AdPackError('NOT_FOUND', 'Pack not found')
        if (res.error === 'item_not_found') throw new AdPackError('NOT_FOUND', 'Ad not found')
        throw new AdPackError('NOT_READY', 'This ad is not rendered yet')
      }
      const loaded = await deps.store.getPack(packId, input.userId)
      // New renders go to the offer library like any finished render (idempotent per URL).
      if (res.added.length && (await persistLibrary(input.userId, packId))) {
        const fresh = (await deps.store.getPack(packId, input.userId))?.items.find((i) => i.id === itemId)
        if (fresh) return { item: toItemView(fresh, loaded?.pack.dna), added: res.added, chargedCredits: 0 }
      }
      return { item: toItemView(res.item, loaded?.pack.dna), added: res.added, chargedCredits: 0 }
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
