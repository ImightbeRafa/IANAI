export const BULK_COUNT_DEFAULT = 10
export const BULK_COUNT_MIN = 1
export const BULK_COUNT_MAX = 25

export type BulkLanguage = 'es' | 'en'
export type StyleDnaKind = 'organic' | 'ads'

export type AngleBoardItem = {
  id: string
  title: string
  niche: string
  whyItBuys: string
  /** Short hook label (e.g. "night_reveal"). */
  hookStyle: string
  frameworkHint: string
  /** Full hook line, never truncated (E4). */
  hook?: string
  /** Shared angle-catalog category (api/lib/adpack/angle-catalog.ts) when the model gave one. */
  category?: string
}

export type AngleBoard = {
  angles: AngleBoardItem[]
  count: number
  /** model = LLM board; fallback = no key / unparseable; planner = deterministic catalog board (model over budget). */
  source: 'model' | 'fallback' | 'planner'
  avoidedNearDuplicates: boolean
  /** True when the model was over budget: a refined board lands in the cache for the next call (≤ 1 h). */
  refining?: boolean
  /** Served from the angle-board cache. */
  cached?: boolean
}

/**
 * Visual system extracted from a Style DNA's winner / reference ads (vision step, see
 * api/lib/adpack/style-profile.ts). Stored inside the brand kit's `style_dnas` jsonb entry.
 */
export type StyleDnaAnalysis = {
  layoutPattern: 'pill_overlay' | 'editorial' | 'split_panel' | 'type_led' | 'badge' | 'card' | 'native_ugc'
  hierarchy: 'headline_first' | 'product_first' | 'price_first'
  hookType: 'pain' | 'desire' | 'objection' | 'social_proof' | 'comparison' | 'price_value' | 'urgency_scarcity' | 'curiosity' | 'routine' | 'identity'
  density: 'minimal' | 'standard' | 'rich'
  colorUsage: 'brand_blocks' | 'accent_pops' | 'neutral_photo'
  typeWeight: 'heavy' | 'regular'
  ctaStyle: 'button' | 'text' | 'sticker'
  notes?: string
  analyzedAt: string
  model: string
  referenceCount: number
  /** Hash of the reference URLs analyzed (re-analyze when they change). */
  referenceHash: string
}

export type StyleDna = {
  id: string
  name: string
  kind: StyleDnaKind
  referenceUrls: string[]
  notes: string
  /** Extracted visual system (optional; added by the Ad Pack style step). */
  analysis?: StyleDnaAnalysis
}

export type BulkQuoteLine = {
  action: 'script' | 'image' | 'expand_ref'
  units: number
  creditsEach: number
  credits: number
}

export type BulkQuote = {
  creditUnit: 'credits'
  lines: BulkQuoteLine[]
  totalCredits: number
  note: string
}

export type RecentScriptSummary = {
  id: string
  title: string
  summary: string
}

export type BulkOrchestratorInput = {
  brandName: string
  brandIcp?: string | null
  brandVoice?: string | null
  audience?: string | null
  offerName: string
  offerType?: string | null
  offerDescription?: string | null
  count?: number | null
  language?: BulkLanguage
  recentSummaries?: string[]
}

export type BulkScriptItem = {
  angleId: string
  title: string
  content: string
  scriptId?: string
  messageId?: string
  charged: number
  generationId: string
  error?: string
}

export type BulkPostItem = {
  angleId: string
  scriptTitle?: string
  imageUrl?: string
  productImageId?: string
  messageId?: string
  charged: number
  generationId: string
  approach: string
  error?: string
}

export type ExpandedProductRef = {
  imageUrl: string
  productImageId: string
  charged: number
  generationId: string
}
