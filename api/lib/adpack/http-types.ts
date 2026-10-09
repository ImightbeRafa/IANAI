/**
 * Ad Pack engine — wire contract shared by both doors (web `api/ad-pack.ts`,
 * MCP `adpack_*`) and the SPA client (`src/features/chat-shell/adPackApi.ts`).
 *
 * Pure types only (type-only imports): the SPA imports this file with
 * `import type`, so no server code can leak into the bundle.
 */
import type {
  AdAngle,
  AdCopy,
  AdLanguage,
  AspectRatio,
  FidelityMethod,
  ProductFidelityMode,
  BrandDna,
  CopyCheckIssue,
  DnaFact,
  FactKey,
  OfferInput,
  Pack,
  PackItemStatus,
  PackStatus,
  RenderedAd,
} from './types.js'
import type { AdPackDeliverable, AdPackFailureView } from './status-summary.js'

export type { AdPackDeliverable, AdPackDeliverableAd, AdPackFailureView, AdPackRetryCall } from './status-summary.js'

export type AdPackErrorCode =
  | 'BAD_INPUT'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_CREDITS'
  | 'NOT_READY'
  | 'BUSY'
  | 'COPY_REJECTED'
  | 'UNAVAILABLE'

export interface AdPackErrorBody {
  error: string
  code: AdPackErrorCode
  issues?: CopyCheckIssue[]
  creditsRequired?: number
  remaining?: number
}

export type AdPackUploadKind = 'product_photo' | 'logo' | 'reference_ad' | 'review_screenshot' | 'document'

export interface AdPackUpload {
  kind: AdPackUploadKind
  url?: string
  text?: string
  name?: string
}

export interface AdPackOfferForm {
  name?: string
  brandName?: string
  facts?: Partial<Record<FactKey, string>> | DnaFact[]
  productImageUrls?: string[]
}

export type AdPackFactEdit =
  | { op: 'confirm'; key: FactKey; value?: string }
  | { op: 'edit'; key: FactKey; value: string; previousValue?: string }
  | { op: 'add'; key: FactKey; value: string; evidence?: string }
  | { op: 'remove'; key: FactKey; value?: string }

export type AdPackCopyPatch = Partial<Pick<AdCopy, 'headline' | 'subline' | 'bullets' | 'offerLine' | 'cta' | 'caption' | 'script'>>

// ---------------------------------------------------------------------------
// Requests (web body = { action, ...fields }; MCP arguments = same fields)
// ---------------------------------------------------------------------------

export interface AdPackIngestDnaRequest {
  websiteUrl?: string
  instagramUrl?: string
  uploads?: AdPackUpload[]
  offerForm?: AdPackOfferForm
  userFacts?: Array<{ key: FactKey; value: string; evidence?: string }>
  language?: AdLanguage
}

export interface AdPackConfirmDnaRequest {
  dna: BrandDna
  edits: AdPackFactEdit[]
}

/** Saved-brand alternative to `dna` + `offer` (angles / quote / start). */
export interface AdPackSavedBrandRef {
  brandId?: string
  offerId?: string
  brandKitId?: string
}

export interface AdPackAnglesRequest extends AdPackSavedBrandRef {
  dna?: BrandDna
  offer?: OfferInput
  size?: number
}

export interface AdPackQuoteRequest extends AdPackSavedBrandRef {
  size?: number
  dna?: BrandDna
  offer?: OfferInput
}

/**
 * Build DNA + offer from what the owner already saved (business, brand kit, offer
 * form, product photos, stored URL analysis). No URLs/uploads needed, no credits.
 */
export interface AdPackFromBrandRequest {
  /** businesses.id (brand folder). */
  brandId: string
  /** products.id; omitted → the brand's most recent offer. */
  offerId?: string
  /** Linked brand kit; omitted → the brand's primary kit. */
  brandKitId?: string
  /** Re-read the stored website live (model call). Default false. */
  refresh?: boolean
}

export interface AdPackFromBrandResponse {
  dna: BrandDna
  offer: OfferInput
  gaps: FactKey[]
  notes: string[]
  brandId: string
  offerId?: string
  brandKitId?: string
  websiteUrl?: string
  /** Quote for the default pack size. */
  quote: AdPackQuote
}

/**
 * Either `dna` + `offer` (from dna_ingest / dna_confirm) or `brandId` (+ `offerId`,
 * `brandKitId`): the server builds DNA + offer from the saved brand.
 */
export interface AdPackStartRequest {
  dna?: BrandDna
  offer?: OfferInput
  brandId?: string
  offerId?: string
  /** Owner's campaign context ("Black Friday, focus on bundles"), ≤ 500 chars. Direction only, never facts. */
  brief?: string
  size?: number
  /** Angle-board selection (ids from `angles` with the same `size`). */
  angleIds?: string[]
  ratios?: AspectRatio[]
  businessId?: string
  brandKitId?: string
  /** 'exact' (default when a product photo exists): real product pixels on a generated plate. 'generated': model-drawn product. */
  productFidelity?: ProductFidelityMode
  /** Optional relight pass (exact mode); kept only when fidelity still passes. */
  relight?: boolean
  /** Kit objects allowed in scenes besides the product (ambient props are always allowed). */
  allowedProps?: string[]
  /** Appearance facts that must never change, e.g. "hélices blancas". */
  immutableAttributes?: string[]
}

export interface AdPackStatusRequest {
  packId: string
  /** Language of `summary` / failure reasons (default: the pack's DNA language). */
  language?: AdLanguage
}

export interface AdPackEditTextRequest {
  packId: string
  itemId: string
  copy: AdPackCopyPatch
}

export interface AdPackRegenerateRequest {
  packId: string
  itemId: string
  /** 'copy' = new copy + scene; 'scene' = keep copy, new scene. Default 'scene'. */
  mode?: 'copy' | 'scene'
}

export interface AdPackCancelRequest {
  packId: string
}

export type AdPackAction =
  | 'dna_ingest'
  | 'dna_from_brand'
  | 'dna_confirm'
  | 'angles'
  | 'quote'
  | 'start'
  | 'status'
  | 'edit_text'
  | 'regenerate'
  | 'cancel'

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface AdPackIngestDnaResponse {
  dna: BrandDna
  costUsd: number
  timingsMs: { website?: number; instagram?: number; uploads?: number; classify?: number; total: number }
}

export interface AdPackConfirmDnaResponse {
  dna: BrandDna
}

export interface AdPackAnglesResponse {
  size: number
  angles: AdAngle[]
}

export interface AdPackQuote {
  /** Ads in the pack. */
  size: number
  /** Total credits for the pack. */
  credits: number
  /** Credits per ad (one `image_standard`, copy included). */
  perAd: number
}

export interface AdPackStartResponse {
  packId: string
  status: PackStatus
  quote: AdPackQuote
  /** True when this call returned an already-created pack (idempotent retry). */
  existing: boolean
}

export interface AdPackItemView {
  id: string
  index: number
  status: PackItemStatus
  format: AdAngle['format']
  archetype: AdAngle['archetype']
  hookType: AdAngle['hookType']
  message: string
  headline?: string
  copy?: AdCopy
  sceneUrl?: string
  renders: RenderedAd[]
  attempts: number
  charged: boolean
  /** product_images ids of renders saved to the offer library (kind 'generated'). */
  libraryImageIds?: string[]
  /** Product fidelity (A4): exact = masked SSIM/ΔE vs the real cut-out; generated = vision verdict. */
  fidelity?: AdPackFidelityView
  error?: string
}

export interface AdPackFidelityView {
  score: number
  passed: boolean
  method: FidelityMethod
  ssim?: number
  deltaE?: number
  diffImageUrl?: string
}

export interface AdPackProgressView {
  total: number
  done: number
  failed: number
  pending: number
  counts: Record<PackItemStatus, number>
}

export interface AdPackStatusResponse {
  packId: string
  status: PackStatus
  size: number
  ratios: AspectRatio[]
  /** How the product reaches the images (exact = real product pixels). */
  productFidelity: ProductFidelityMode
  source: Pack['source']
  quotedCredits: number
  /** Credits charged so far (charged items × per-ad credits). */
  chargedCredits: number
  progress: AdPackProgressView
  items: AdPackItemView[]
  /** True while items still need work (pack not terminal / cancelled). */
  moreWork: boolean
  /** True when another worker currently holds a lease on some item. */
  leaseActive: boolean
  /** Brand folder (businesses.id) and offer (products.id) the pack belongs to, when linked. */
  businessId?: string
  offerId?: string
  /** Web-app link to the brand folder where the finished ads are saved (when linked to a brand). */
  deepLink?: string
  /** Language of `summary` and failure reasons. */
  language: AdLanguage
  /** One short human line: "7/10 listos · 1 falló (producto no coincidía) · ~40 s restantes". */
  summary: string
  /** Estimated seconds left (from this pack's per-step timings), only while moreWork. */
  etaSeconds?: number
  /** Failed ads: plain-language reason + the exact adpack_regenerate call to retry. */
  failures?: AdPackFailureView[]
  /** Once finished (done / partial): links per ratio + captions per ad, numbered captionsText, deepLink. */
  deliverable?: AdPackDeliverable
  createdAt: string
  updatedAt: string
}

export interface AdPackEditTextResponse {
  item: AdPackItemView
}

export interface AdPackRegenerateResponse {
  item: AdPackItemView
  quote: AdPackQuote
}

export interface AdPackCancelResponse {
  packId: string
  status: PackStatus
}
