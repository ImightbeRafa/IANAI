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

/** Shared angle-catalog categories (see angle-catalog.ts). */
export type AngleCategory =
  | 'regalo'
  | 'como_funciona'
  | 'valor_precio'
  | 'unboxing'
  | 'uso_real'
  | 'detalle_tecnico'
  | 'comparacion'
  | 'temporada'
  | 'problema_solucion'
  | 'prueba_social'

/** Visual layout families (see render/families.ts). */
export type LayoutFamily = 'bold_pill' | 'editorial_minimal' | 'split_panel' | 'full_bleed_type' | 'badge_corner' | 'framed_card' | 'ugc_native'

/** How much the planner decides on its own: high = angle, hook, format, layout and scene; guided = the agent's picks are kept. */
export type CreativeFreedom = 'high' | 'guided'

/**
 * Render choices derived from a brand's Style DNA (winner / reference ads), see style-profile.ts.
 * A quality floor: matching layout family + copy density; references are never copied.
 */
export interface StyleRenderProfile {
  styleDnaId?: string
  /** Families to use, in preference order (the pack alternates between them). */
  families: LayoutFamily[]
  paletteEmphasis: 'primary' | 'accent' | 'neutral'
  typeWeight: 'heavy' | 'regular'
  ctaStyle: 'button' | 'text' | 'sticker'
  copyDensity: 'minimal' | 'standard' | 'rich'
  /** Hook type the winners lean on (planner preference, not a constraint). */
  hookType?: HookType
  /** Where the profile came from. */
  source: 'analysis' | 'notes' | 'default'
}

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
  /** Render profile from the brand's Style DNA (set by adpack_start {styleDnaId}). */
  styleProfile?: StyleRenderProfile
}

export interface BrandDna {
  version: 1
  brandName: string
  category: BusinessCategory
  language: AdLanguage
  /** Spanish register for copy: voseo (CR/AR), tuteo, usted. */
  register: 'voseo' | 'tuteo' | 'usted'
  /**
   * BCP-47 locale, e.g. "es-CR". When set, `register` is a HARD rule (E3): copy in another
   * register is blocking (repaired once, else the ad fails) — not just a tone note.
   */
  locale?: string
  oneLiner?: string
  voice?: string
  audience?: string[]
  pains?: string[]
  desires?: string[]
  objections?: string[]
  /** Customer phrases (reviews, comments, captions) — best hook material. */
  customerPhrases?: string[]
  forbiddenPhrases?: string[]
  /** Claims the brand must never make (e.g. "armado en minutos"); checked like forbiddenPhrases. */
  forbiddenClaims?: string[]
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
  /** Items the offer does NOT include (e.g. "Papel"); copy may never say they are included. */
  notIncluded?: string[]
  /** Owner keeps a verified-claims bank: claim-like sentences must trace to a confirmed fact. */
  strictClaims?: boolean
  /** A2 product lock (data model; image tools respect it). */
  productLock?: { lockProductAppearance: boolean; immutableAttributes: string[]; allowedProps: string[] }
  /** C3: per-ad product photos (ad index as string → https URLs, first = hero). Falls back to productImageUrls. */
  productImageUrlsByAd?: Record<string, string[]>
  /**
   * Real product photos with their role (multi-part products: hero, the controller, the box,
   * kit contents…). One cut-out per photo in exact mode; parts are never synthesized.
   * Absent → `productImageUrls` (first = hero, the rest = alternate shots).
   */
  productPhotos?: ProductPhoto[]
  /** Kit objects that MAY appear in a scene besides the product (e.g. "caja", "manual"). Ambient props are always allowed. */
  allowedProps?: string[]
  /** Appearance facts that must never change, e.g. "ala de papel blanca", "hélices blancas". Prompts + vision checks. */
  immutableAttributes?: string[]
  /** Brand/offer-level product lock: image tools must keep the real product pixels (exact mode). */
  lockProductAppearance?: boolean
}

/** What a real product photo shows. */
export type ProductPhotoRole = 'hero' | 'part' | 'contents' | 'box' | 'in_use' | 'detail'

export interface ProductPhoto {
  url: string
  role: ProductPhotoRole
  /** Owner label, e.g. "control tipo gamepad". */
  label?: string
  /** product_images.id when known. */
  id?: string
}

/**
 * How the product reaches the ad image:
 * - exact: real product pixels (segmented cut-out) composited into a generated background plate;
 * - generated: the image model draws the product from the reference photo (legacy).
 */
export type ProductFidelityMode = 'exact' | 'generated'

/**
 * Exact-mode relighting. Always included and free:
 * - 'auto' (default): deterministic photographic harmonization (light model of the plate,
 *   directional shading, white balance + shared grade, light wrap, contact/cast shadows,
 *   reflection on glossy surfaces, grain/defocus match) — no model call, product pixels kept.
 * - 'ai': the same, then an image-edit relight pass kept only when fidelity still passes.
 */
export type RelightMode = 'auto' | 'ai'

/** Surface the plate was prompted with (glossy → reflection under the product). */
export type PlateSurface = 'matte' | 'glossy'

/** Pack-level render options (persisted with the pack). */
export interface PackRenderOptions {
  productFidelity: ProductFidelityMode
  /** 'ai' adds the optional model relight pass (free, fidelity-guarded); absent = 'auto'. Legacy `true` = 'ai'. */
  relight?: RelightMode
  allowedProps?: string[]
  immutableAttributes?: string[]
}

/** composite = plain cut-out (no harmonization); harmonized = deterministic relight stage; relit = + AI pass; generated = model-drawn. */
export type FidelityMethod = 'composite' | 'harmonized' | 'relit' | 'generated'

/**
 * Product fidelity of a finished image (inside the product mask vs the real cut-out).
 * Light may change, shape and identity color may not: passed = structural (detail SSIM on
 * high-pass log-luminance + silhouette IoU) AND identity color (hue shift, chroma ratio, ΔE —
 * measured after removing the low-frequency luminance gradient that relighting applies).
 */
export interface FidelityResult {
  /** 0–1 combined score (1 = identical). */
  score: number
  /** Detail SSIM (same value as ssimDetail; kept for older readers); null for generated mode. */
  ssim: number | null
  /** Mean ΔE (CIE76) after removing the relight luminance gradient; null for generated mode. */
  deltaE: number | null
  /** SSIM of the high-pass (detail) log-luminance inside the mask. */
  ssimDetail?: number | null
  /** IoU of the product silhouette found in the image vs the cut-out's. */
  silhouetteIoU?: number | null
  /** Chroma-weighted mean hue shift (degrees) after gradient removal. */
  hueShift?: number | null
  /** Mean chroma image / cut-out after gradient removal. */
  chromaRatio?: number | null
  passed: boolean
  method: FidelityMethod
  /** Heatmap PNG of the per-pixel difference (exact mode, worst ratio). */
  diffImageUrl?: string
  /** Ratio the item-level value was taken from (the worst one). */
  ratio?: AspectRatio
}

/** Light direction of a background plate (drives the composite's contact shadow). */
export type LightDirection = 'left' | 'right' | 'top'

export interface StoredCutout {
  url: string
  role: ProductPhotoRole
  label?: string
  /** How the cut-out was made ('cache' = reused from the content-addressed cache). */
  method: 'alpha' | 'flood' | 'model' | 'cache'
  /** sha256 of the source photo bytes (cache key). */
  sourceHash: string
  sourceUrl: string
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

export type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9'

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
  /** Shared angle-catalog category (angle-catalog.ts). Id = `<category>-<hookType>-<format>`. */
  category?: AngleCategory
  /** Short ES/EN "why this angle" (shown in status / deliverable). */
  rationale?: string
  /** Full hook line suggested by the angle source (guide_bulk_angles / agent). Never truncated. */
  hook?: string
  /** Visual direction for the scene (English, visual only). */
  sceneDirection?: string
  /** Visual layout family for this ad (render/families.ts). */
  layoutFamily?: LayoutFamily
  /** 0-based variation of the same angle (variations: n): same copy, different scene/layout. */
  variation?: number
  /** Where the angle came from. */
  source?: 'planner' | 'guide' | 'agent'
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
    /** Wrong register while `dna.locale` makes the register a hard rule (blocking). */
    | 'locale_register'
    /** Generic hook/cliché from the deterministic blocklist (cliches.ts). Repairable, not blocking. */
    | 'cliche'
  field: keyof AdCopy | 'script'
  detail: string
  /** Exact location, e.g. "bullets[2]" or "script.hook" (defaults to `field`). */
  path?: string
  /** Length rules: the limit and the actual value (chars or words, see detail). */
  limit?: number
  actual?: number
  /** The offending token (number, phrase, verb form). */
  token?: string
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
  /** 'plate' = product-free background for exact mode (the product is composited at render). */
  kind?: 'scene' | 'plate'
  /** Plate light direction (exact mode). */
  light?: LightDirection
  /** Surface the plate was prompted with (glossy → reflection under the product). */
  surface?: PlateSurface
  /** Real-product cut-outs composited onto the plate (exact mode). First = hero. */
  cutouts?: StoredCutout[]
  /**
   * Where the product sits in this scene, fractions (0–1) of the scene's width/height. Filled by
   * product detection (another step); the renderer never places copy over it.
   */
  productBox?: { x: number; y: number; w: number; h: number }
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
  /** Product parts / accessories / devices in the scene that are not in the reference photos nor allowed props. */
  extraObjects?: string[]
  /** Product bounding box in the scene, [y0, x0, y1, x1] normalized 0–1000 (generated mode; text avoids it). */
  productBox?: [number, number, number, number]
  /** Persisted copy of PackItem.fidelity (stored in the scene_check jsonb; no extra column). */
  fidelity?: FidelityResult
}

export interface RenderedAd {
  ratio: AspectRatio
  imageUrl: string
  width: number
  height: number
  /** Product fidelity of this render (exact: detail SSIM, silhouette IoU, identity color vs the cut-out). */
  fidelity?: FidelityResult
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
  /** Item-level product fidelity (worst ratio). Persisted inside scene_check.fidelity. */
  fidelity?: FidelityResult
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
  /** Product fidelity / scene options. Absent (packs created before exact mode) → generated. */
  render?: PackRenderOptions
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
  /**
   * Optional: model segmentation (Gemini 2.5 Flash). Returns the documented format —
   * box_2d [y0, x0, y1, x1] normalized 0–1000 and a probability-mask PNG (base64) for that box.
   */
  segment?(input: { image: string; prompt?: string; model?: string }): Promise<{ items: SegmentationItem[]; costUsd: number; model: string }>
  /** Optional: image edit (relight pass). `image` is a data URL or https URL. */
  edit?(input: { image: string; prompt: string; ratio?: string }): Promise<{ bytes: Uint8Array; mimeType: string; costUsd: number; model: string }>
}

export interface SegmentationItem {
  /** [y0, x0, y1, x1], 0–1000. */
  box_2d: [number, number, number, number]
  /** Probability mask PNG (base64, with or without a data: prefix) covering box_2d. */
  mask: string
  label: string
}
