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
  hookStyle: string
  frameworkHint: string
}

export type AngleBoard = {
  angles: AngleBoardItem[]
  count: number
  source: 'model' | 'fallback'
  avoidedNearDuplicates: boolean
}

export type StyleDna = {
  id: string
  name: string
  kind: StyleDnaKind
  referenceUrls: string[]
  notes: string
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
