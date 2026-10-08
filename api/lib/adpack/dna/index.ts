/** Brand DNA ingest — public surface. See docs/operations/ad-pack-engine-plan.md (step 1). */

export { ingestBrandDna, DNA_SOURCE_TIMEOUTS_MS, DNA_TOTAL_BUDGET_MS, type IngestBrandDnaInput, type IngestBrandDnaResult } from './ingest.js'
export { buildBrandDna, computeGaps, mergeFacts, SOURCE_PRECEDENCE, type BuildBrandDnaInput, type OfferFormInput, type UserFactInput } from './merge.js'
export { confirmFacts, type FactEdit } from './confirm.js'
export { classifyCategory, detectLanguage, detectRegister, heuristicCategory } from './classify.js'
export { ingestWebsite, mapSiteAnalysis, scanCommerceFacts } from './website.js'
export {
  analyzeInstagramPosts,
  fetchInstagramProfile,
  ingestInstagram,
  normalizeInstagramHandle,
  parseBioFacts,
  type InstagramProfile,
} from './instagram.js'
export { ingestUploads, type UploadItem, type UploadKind } from './uploads.js'
export type { DnaPart } from './part.js'
