/**
 * Ad Pack engine — shared contract.
 *
 * One engine behind the web app (`api/ad-pack.ts`) and the MCP tools (`adpack_*`).
 * Pure types only: no runtime imports, safe for Vercel functions, the Cloudflare
 * container (server.mjs) and the SPA.
 *
 * See docs/operations/ad-pack-engine-plan.md.
 */

export type AdLanguage = 'es' | 'en'

/** Broad business category; drives angle spread, examples and compliance rules. */
export type BusinessCategory =
  | 'beauty'
  | 'health_wellness'
  | 'food_beverage'
  | 'fashion_apparel'
  | 'home_garden'
  | 'tech_electronics'
  | 'fitness_sports'
  | 'pets'
  | 'kids_baby'
  | 'services_local'
  | 'education'
  | 'finance'
  | 'other'

// ---------------------------------------------------------------------------
// Brand DNA
// ---------------------------------------------------------------------------

export type FactSource = 'website' | 'instagram' | 'upload' | 'user' | 'offer_form' | 'inferred'

/** Well-known fact keys. Free-form keys are allowed (`custom:<slug>`). */
export type FactKey =
  | 'brand_name'
  | 'offer_name'
  | 'price'
  | 'compare_at_price'
  | 'bundle'
  | 'shipping'
  | 'delivery_time'
  | 'payment_methods'
  | 'guarantee'
  | 'returns'
  | 'ingredients_materials'
  | 'how_it_works'
  | 'usage_steps'
  | 'variants'
  | 'quantity_per_pack'
  | 'proof_review'
  | 'proof_number'
  | 'certification'
  | 'location'
  | 'contact_channel'
  | 'differentiator'
  | 'result_claim'
  | `custom:${string}`

export interface DnaFact {
  key: FactKey
  /** Exact human-readable value, e.g. "₡9.900", "2–4 días hábiles", "SINPE Móvil o tarjeta". */
  value: string
  source: FactSource
  /** Only confirmed facts may appear as claims in generated copy. */
  confirmed: boolean
  /** Optional evidence snippet or URL. */
  evidence?: string
}

export interface DnaVisual {
  primaryColor?: string
  secondaryColor?: string
  accentColor?: string
  /** Font family names (the kit's). The renderer loads them (bundled → cache → Google Fonts) or maps to the closest bundled family. */
  headingFont?: string
  bodyFont?: string
  /** Uploaded custom font files (kit assets, TTF/OTF over https). Used before the Google lookup. */
  headingFontUrl?: string
  bodyFontUrl?: string
  logoUrl?: string
  /** e.g. "clean white studio, bright fruit splashes, bold sans headlines". */
  styleNotes?: string
  /** Formats the brand already uses (from Instagram analysis). */
  formatsSeen?: AdFormat[]
}

export interface BrandDna {
  version: 1
  brandName: string
  category: BusinessCategory
  language: AdLanguage
  /** Spanish register for copy: voseo (CR/AR), tuteo, usted. */
  register: 'voseo' | 'tuteo' | 'usted'
  oneLiner?: string
  voice?: string
  audience?: string[]
  pains?: string[]
  desires?: string[]
  objections?: string[]
  /** Customer phrases (reviews, comments, captions) — best hook material. */
  customerPhrases?: string[]
  forbiddenPhrases?: string[]
  /** Brand phrases the owner wants used when they fit (brand kit). Wording, never facts. */
  mustUsePhrases?: string[]
  facts: DnaFact[]
  visual: DnaVisual
  /** Missing facts that would materially improve ads, e.g. ["price", "delivery_time"]. */
  gaps: FactKey[]
  sources: Array<{ kind: FactSource; url?: string; fetchedAt: string; ok: boolean; note?: string }>
  /** Real product photos from uploads / offer form (first = hero). Added by DNA ingest. */
  productImageUrls?: string[]
  /** Style references (website hero images, Instagram posts, reference ads). Not product locks. */
  referenceImageUrls?: string[]
  /** Ingest notes for the UI, e.g. `conflict:price: "₡9.900" (website) vs "₡8.900" (instagram)`. */
  notes?: string[]
}

// ---------------------------------------------------------------------------
// Offer + assets
// ---------------------------------------------------------------------------

export interface OfferInput {
  /** products.id when it exists. */
  productId?: string
  name: string
  /** Fact keys/values specific to this offer (price, bundle…); merged over DNA facts. */
  facts: DnaFact[]
  /** Public URLs (Supabase storage) of real product photos. First = hero. */
  productImageUrls: string[]
  /** Optional transparent cut-out of the hero product (PNG URL), created once and reused. */
  productCutoutUrl?: string
}

// ---------------------------------------------------------------------------
// Angles + formats
// ---------------------------------------------------------------------------

/** IAN method archetypes (api/chat.ts master prompt). */
export type IanArchetype =
  | 'venta_directa'
  | 'desvalidar_alternativas'
  | 'mostrar_servicio'
  | 'variedad_productos'
  | 'paso_a_paso'

/** The 7 standard static ad formats. */
export type AdFormat =
  | 'offer_graphic' // product hero + big headline + 3 benefit chips + price/offer
  | 'before_after' // split comparison (only when category rules allow)
  | 'how_to_steps' // 3–4 numbered steps
  | 'variant_card' // one variant/flavor/formula highlighted
  | 'ugc_person' // person holding/using product, minimal caption
  | 'handheld_overlay' // product in hand, lifestyle, one bold line
  | 'explainer' // "what is it / how it works" infographic

export type AspectRatio = '1:1' | '4:5' | '9:16'

export type HookType =
  | 'pain'
  | 'desire'
  | 'objection'
  | 'social_proof'
  | 'comparison'
  | 'price_value'
  | 'urgency_scarcity'
  | 'curiosity'
  | 'routine'
  | 'identity'

export interface AdAngle {
  id: string
  archetype: IanArchetype
  hookType: HookType
  format: AdFormat
  /** The single message this ad sells. */
  message: string
  /** Pain/desire/objection or customer phrase it targets. */
  target: string
  /** Fact keys the copy is allowed/expected to use. */
  factKeys: FactKey[]
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export interface AdCopy {
  /** On-image headline, ≤ 6 words (≤ 8 for explainer). */
  headline: string
  /** Optional on-image subline, ≤ 12 words. */
  subline?: string
  /** 0–4 short chips (≤ 4 words each), e.g. benefits or steps. */
  bullets: string[]
  /** Exact offer/price line from facts, e.g. "₡9.900 · Envío gratis desde 2". Empty when no confirmed price. */
  offerLine?: string
  /** On-image CTA, ≤ 4 words. */
  cta: string
  /** Feed caption (primary text), 40–600 chars. */
  caption: string
  /** Optional spoken script (IAN triad) for a UGC/video version. */
  script?: { hook: string; development: string; cta: string }
  /** Visual direction for the scene model; must not ask for any text. */
  sceneBrief: string
  /** Fact keys actually used, for verification. */
  usedFactKeys: FactKey[]
}

export interface CopyCheckIssue {
  code:
    | 'unconfirmed_fact'
    | 'number_mismatch'
    | 'too_long'
    | 'empty_field'
    | 'forbidden_phrase'
    | 'compliance'
    | 'greeting'
    | 'duplicate_message'
    | 'placeholder'
    | 'register'
  field: keyof AdCopy | 'script'
  detail: string
}

export interface CopyCheckResult {
  ok: boolean
  issues: CopyCheckIssue[]
}

// ---------------------------------------------------------------------------
// Scene + render
// ---------------------------------------------------------------------------

export interface SceneResult {
  /** Storage URL of the text-free scene image. */
  imageUrl: string
  width: number
  height: number
  model: string
  costUsd: number
  /** True when the product reference was applied (product lock). */
  productLocked: boolean
}

export interface SceneCheckResult {
  ok: boolean
  productMatches: boolean | null
  strayText: boolean | null
  /** Blank bars / borders / letterboxing / collage panels (the scene must be full-bleed). */
  borders?: boolean | null
  /** 0–1 */
  score: number
  notes?: string
}

export interface RenderedAd {
  ratio: AspectRatio
  imageUrl: string
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

export type PackStatus = 'planned' | 'running' | 'done' | 'partial' | 'failed' | 'cancelled'

export type PackItemStatus =
  | 'planned'
  | 'copy_ready'
  | 'scene_ready'
  | 'rendered'
  | 'done'
  | 'failed'

export interface PackItem {
  id: string
  packId: string
  index: number
  status: PackItemStatus
  angle: AdAngle
  copy?: AdCopy
  copyCheck?: CopyCheckResult
  scene?: SceneResult
  sceneCheck?: SceneCheckResult
  renders: RenderedAd[]
  attempts: number
  error?: string
  /** Idempotency key for credit charge. */
  generationId: string
  leaseUntil?: string
  updatedAt: string
  /** Model cost spent on this item so far (all attempts), USD. */
  costUsd?: number
  /** Wall time per step of the latest run, ms. */
  timings?: PackItemTimings
  /** Scene generations spent in the latest scene step (1 + retries). */
  sceneAttempts?: number
  /** Set when credits were charged for `generationId`. */
  chargedAt?: string
  /** Renders saved to the offer library (`product_images`, kind 'generated'). One entry per saved render URL. */
  libraryImages?: LibraryImage[]
}

export interface LibraryImage {
  ratio: AspectRatio
  imageUrl: string
  productImageId: string
}

export interface PackItemTimings {
  copyMs?: number
  sceneMs?: number
  sceneCheckMs?: number
  renderMs?: number
  chargeMs?: number
}

export interface Pack {
  id: string
  userId: string
  businessId?: string
  brandKitId?: string
  offer: OfferInput
  dna: BrandDna
  status: PackStatus
  size: number
  ratios: AspectRatio[]
  /** Credits quoted at start. */
  quotedCredits: number
  /** Origin door, for parity analytics. */
  source: 'web' | 'mcp'
  /**
   * Owner's campaign brief ("Black Friday, focus on bundles"), sanitized, ≤ 500 chars.
   * Creative direction for angle/copy prompts only — never a fact or claim.
   */
  brief?: string
  createdAt: string
  updatedAt: string
}

/** Storage abstraction: Supabase in prod, in-memory in tests. */
export interface PackStore {
  createPack(pack: Pack, items: PackItem[]): Promise<void>
  getPack(packId: string, userId: string): Promise<{ pack: Pack; items: PackItem[] } | null>
  updatePack(packId: string, patch: Partial<Pack>): Promise<void>
  /**
   * Atomically lease up to `limit` items that need work (status not done/failed)
   * and are not leased (or whose lease expired), lowest `index` first.
   * `excludeIds` are skipped (items deferred by this caller).
   */
  leaseItems(packId: string, limit: number, leaseMs: number, opts?: { excludeIds?: string[] }): Promise<PackItem[]>
  /** Patch an item. A present-but-undefined `leaseUntil` clears the lease. */
  updateItem(itemId: string, patch: Partial<PackItem>): Promise<void>
}

/** Model-call abstraction so tests and the benchmark can inject fakes / record cost. */
export interface ModelGateway {
  /** JSON-only text completion. */
  json<T>(input: { system: string; user: string; model?: string; maxTokens?: number; temperature?: number }): Promise<{ data: T; costUsd: number; model: string }>
  /** Vision JSON (images as URLs or data URLs). */
  visionJson<T>(input: { system: string; user: string; images: string[]; model?: string }): Promise<{ data: T; costUsd: number; model: string }>
  /**
   * Text-free scene; `refs` are product references (refs[0] = hero, product lock).
   * `styleRefs` are optional style anchors (e.g. the pack's first scene), never a product lock.
   */
  scene(input: { prompt: string; refs: string[]; ratio: AspectRatio; draft: boolean; styleRefs?: string[]; language?: AdLanguage }): Promise<{ bytes: Uint8Array; mimeType: string; costUsd: number; model: string; productLocked: boolean }>
}
