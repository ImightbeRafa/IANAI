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

export interface AdPackAnglesRequest {
  dna: BrandDna
  offer: OfferInput
  size?: number
}

export interface AdPackQuoteRequest {
  size?: number
  dna?: BrandDna
  offer?: OfferInput
}

export interface AdPackStartRequest {
  dna: BrandDna
  offer: OfferInput
  size?: number
  /** Angle-board selection (ids from `angles` with the same `size`). */
  angleIds?: string[]
  ratios?: AspectRatio[]
  businessId?: string
  brandKitId?: string
}

export interface AdPackStatusRequest {
  packId: string
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
  error?: string
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
