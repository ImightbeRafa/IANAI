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
  AngleCategory,
  CreativeFreedom,
  HookType,
  LayoutFamily,
  StyleRenderProfile,
  AdLanguage,
  AspectRatio,
  FidelityMethod,
  ProductFidelityMode,
  RelightMode,
  BrandDna,
  CopyCheckIssue,
  DnaFact,
  FactKey,
  OfferInput,
  Pack,
  PackItemStatus,
  PackStatus,
  RenderedAd,
  FontsUsed,
} from './types.js'
import type { AdPackDeliverable, AdPackFailureView } from './status-summary.js'

export type { AdPackDeliverable, AdPackDeliverableAd, AdPackDeliverableFile, AdPackFailureView, AdPackRetryCall } from './status-summary.js'

export type AdPackErrorCode =
  | 'BAD_INPUT'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_CREDITS'
  | 'NOT_READY'
  | 'BUSY'
  | 'COPY_REJECTED'
  | 'UNAVAILABLE'
  /** The plan at execution differs from the approved one (count or credits): nothing ran, ask for a fresh approval. */
  | 'PLAN_CHANGED'

/** Count + credits a user approved / the server would run now. */
export interface AdPackPlanSummary {
  items: number
  unitCost: number
  total: number
  currency: 'credits'
}

/**
 * One reason an owner edit was rejected (E1): exact location, rule, and for length rules the
 * limit vs actual value; for fact rules the offending token.
 */
export interface AdPackCopyRejection extends Omit<CopyCheckIssue, 'field'> {
  /** Same as `code`. */
  rule: CopyCheckIssue['code']
  /** Exact location ("bullets[2]", "script.hook"); `baseField` is the copy key ("bullets"). */
  field: string
  baseField: CopyCheckIssue['field']
}

export interface AdPackErrorBody {
  error: string
  code: AdPackErrorCode
  issues?: AdPackCopyRejection[]
  creditsRequired?: number
  remaining?: number
  approved?: AdPackPlanSummary
  planned?: AdPackPlanSummary
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
  /** Same selection as start: the quote is for exactly these angles. */
  angleIds?: string[]
  /** Same render options as start (neither changes the price: relighting is included). */
  productFidelity?: ProductFidelityMode
  relight?: RelightMode | boolean
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
  /** Style DNAs on the brand kit (pass one as styleDnaId to adpack_start). */
  styleDnas?: Array<{ id: string; name: string; kind: string; references: number; analyzed: boolean }>
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
  /**
   * Angle selection: ids from `angles` (planner) or any shared catalog id
   * `<category>-<hookType>-<format>` (e.g. guide_bulk_angles' adpackAngleId). Unusable ids are an error.
   */
  angleIds?: string[]
  /** adpackAngle objects from guide_bulk_angles (full hooks), rebuilt against the offer's confirmed facts. */
  angles?: AdPackAngleInput[]
  /** Ads per angle, 1–3 (same angle/copy, different scene, composition and layout family). Quote = ads × variations. */
  variations?: number
  /** high (default without a selection) = Advance picks angle, hook, format, layout and scene; guided = keep the agent's picks. */
  creativeFreedom?: CreativeFreedom
  /** Force one layout family (else Style DNA, else rotation ≤ 2 per family per 10 ads). */
  layoutFamily?: LayoutFamily
  /** Brand kit Style DNA (winners) to follow: layout family, copy density, type weight. Needs brandId. */
  styleDnaId?: string
  /** Default ['4:5', '9:16'] (feed + story); '1:1' on request or later via a free `resize`. */
  ratios?: AspectRatio[]
  businessId?: string
  brandKitId?: string
  /** e.g. "es-CR": makes the register a hard rule (voseo by default for CR/AR/UY…). */
  locale?: string
  register?: BrandDna['register']
  /** Extra brand phrases / claims the ads must never contain (merged with the kit's). */
  forbiddenPhrases?: string[]
  forbiddenClaims?: string[]
  /**
   * What the user approved. When the plan computed now differs (count or credits) nothing is
   * created and the call fails with PLAN_CHANGED { approved, planned }.
   */
  approved?: { items: number; total: number }
  /** 'exact' (default when a product photo exists): real product pixels on a generated plate. 'generated': model-drawn product. */
  productFidelity?: ProductFidelityMode
  /**
   * Exact mode relight, included and free: 'auto' (default) = deterministic harmonization (shading,
   * white balance + grade, light wrap, shadows, reflection, grain); 'ai' = + an image-edit pass kept
   * only when fidelity still passes. Booleans accepted (true → 'ai').
   */
  relight?: RelightMode | boolean
  /** Kit objects allowed in scenes besides the product (ambient props are always allowed). */
  allowedProps?: string[]
  /** Appearance facts that must never change, e.g. "hélices blancas". */
  immutableAttributes?: string[]
}

export interface AdPackResizeRequest {
  packId: string
  itemId: string
  /**
   * Ratios to add (1:1, 4:5, 9:16, 16:9). Free: no model calls. Exact-mode ads re-composite the
   * stored plate + real-product cut-outs (fidelity re-scored, text kept off the product); ads
   * without stored cut-outs re-render the stored final scene (fidelity.method says which).
   */
  ratios: AspectRatio[]
}

export interface AdPackResizeResponse {
  item: AdPackItemView
  /** Ratios rendered by this call (already present ones are skipped). */
  added: AspectRatio[]
  chargedCredits: 0
  /** 'composite' = stored plate + real-product cut-outs (fidelity re-scored); 'scene' = stored final scene. */
  method?: 'composite' | 'scene'
  /** New ratios not delivered because the product fidelity check failed. */
  rejected?: Array<{ ratio: AspectRatio; fidelity: AdPackFidelityView }>
}

/** Angle object accepted by start (shape returned by guide_bulk_angles as `adpackAngle`). */
export interface AdPackAngleInput {
  id: string
  category?: AngleCategory
  hookType?: HookType
  format?: AdAngle['format']
  message?: string
  target?: string
  hook?: string
  rationale?: string
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
  | 'resize'
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

/** #15: what one ad of the pack will be — computed deterministically BEFORE approval (quote / approval). */
export interface AdPackPlannedAd {
  /** 1-based ad number (as in adpack_status). */
  index: number
  angleId: string
  category?: AngleCategory
  hookType: HookType
  format: AdAngle['format']
  layoutFamily?: LayoutFamily
  variation?: number
  /** Short "why this angle". */
  rationale?: string
  /** Planned product photo (exact mode: the real photo composited; a blurry one is swapped at run time). */
  photo?: { productImageId?: string; role?: string; label?: string; url: string; source: 'per_ad' | 'pool' }
  ratios: AspectRatio[]
}

export interface AdPackQuote {
  /** Ads in the pack (angles × variations). */
  size: number
  /** Total credits for the pack. */
  credits: number
  /** Credits per ad (one `image_standard`, copy included; relighting included). */
  perAd: number
  /** Angle ids the quote covers (exactly `size` of them). */
  angleIds?: string[]
  /** Present when variations > 1. */
  variations?: number
  /** Distinct angles (size / variations), when variations > 1. */
  angles?: number
  /** #15: the per-ad plan (with brand/offer or dna + offer and `withPlan`). */
  plan?: AdPackPlannedAd[]
}

export interface AdPackStartResponse {
  packId: string
  status: PackStatus
  quote: AdPackQuote
  /** True when this call returned an already-created pack (idempotent retry). */
  existing: boolean
  creativeFreedom?: CreativeFreedom
  variations?: number
  /** What the planner decided per ad (angle, hook, format, layout family, why, planned photo, ratios). */
  angles?: AdPackPlannedAd[]
  styleProfile?: StyleRenderProfile
  notes?: string[]
  /** Estimated seconds until the pack finishes (default step timings × pending steps ÷ workers). */
  etaSeconds?: number
}

export interface AdPackItemView {
  id: string
  index: number
  status: PackItemStatus
  format: AdAngle['format']
  archetype: AdAngle['archetype']
  hookType: AdAngle['hookType']
  message: string
  /** Shared catalog id `<category>-<hookType>-<format>`. */
  angleId?: string
  category?: AngleCategory
  /** Short "why this angle" (ES/EN). */
  rationale?: string
  layoutFamily?: LayoutFamily
  /** 0-based variation of the same angle (variations > 1). */
  variation?: number
  headline?: string
  copy?: AdCopy
  sceneUrl?: string
  renders: RenderedAd[]
  attempts: number
  /** #9: fonts actually drawn (first render; every ratio uses the same faces). */
  fontsUsed?: FontsUsed
  /** #16: automatic retries used inside the approval (0–2) and why each earlier attempt failed. */
  autoRetries?: number
  attemptLog?: Array<{ attempt: number; mode: 'copy' | 'scene'; error: string }>
  charged: boolean
  /** product_images ids of renders saved to the offer library (kind 'generated'). */
  libraryImageIds?: string[]
  /** Brand forbidden phrases/claims found in this ad's copy (empty when verified clean). */
  forbiddenHits?: Array<{ phrase: string; field: string }>
  /** Product fidelity (A4): exact = detail SSIM + silhouette IoU + hue shift vs the real cut-out (light may change, the product may not); generated = vision verdict. */
  fidelity?: AdPackFidelityView
  error?: string
}

export interface AdPackFidelityView {
  score: number
  passed: boolean
  method: FidelityMethod
  /** Detail SSIM (alias of ssimDetail). */
  ssim?: number
  /** ΔE after removing the relight luminance gradient. */
  deltaE?: number
  ssimDetail?: number
  silhouetteIoU?: number
  /** Degrees. */
  hueShift?: number
  chromaRatio?: number
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
  /** Exact mode relight ('auto' deterministic, or 'ai' + guarded model pass). Included, free. */
  relight?: RelightMode
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
  /** Suggested wait before the next status read (only while moreWork); work continues in the background meanwhile. */
  retryAfterSeconds?: number
  /** True when this read started a background advance (nobody held a lease). */
  backgroundKicked?: boolean
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
