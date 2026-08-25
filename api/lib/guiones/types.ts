export type ProductType = 'product' | 'service' | 'restaurant' | 'real_estate' | 'indumentaria'
export type ScriptFramework =
  | 'venta_directa'
  | 'desvalidar_alternativas'
  | 'mostrar_servicio'
  | 'variedad_productos'
  | 'paso_a_paso'
  | 'reconocimiento'
  | 'educativo'
  | 'storytelling'
  | 'tendencia'
  | 'engagement'
export type GenerationMode = 'mixed' | 'by_type'
export type CTAStrength = 'none' | 'soft' | 'brand_mention' | 'sales'
export type SalesChannel = 'physical' | 'messages' | 'website'
export type BuyerStage = 'cold' | 'warm' | 'hot'
export type Language = 'en' | 'es'

export interface ScriptTypeConfig {
  venta_directa: number
  desvalidar_alternativas: number
  mostrar_servicio: number
  variedad_productos: number
  paso_a_paso: number
  reconocimiento: number
  educativo: number
  storytelling: number
  tendencia: number
  engagement: number
}

export interface ScriptSettings {
  framework: ScriptFramework
  variations: number
  model?: 'grok'
  generationMode?: GenerationMode
  scriptTypeConfig?: ScriptTypeConfig
  ctaStrength?: CTAStrength
  useStructuredPipeline?: boolean
  forceFreshAngles?: boolean
}

export interface ContextDocumentData {
  type: 'pdf' | 'image' | 'link' | 'text'
  name: string
  content?: string
  url?: string
}

export interface BusinessContextLike {
  name?: string
  sales_channels?: SalesChannel[]
  location?: string
  does_shipping?: boolean
  shipping_method?: string
  target_audiences?: Array<{
    sex?: string
    age_min?: number
    age_max?: number
    geographic_scope?: string
    geographic_scope_custom?: string
    has_specific_profession?: boolean
    profession_description?: string
  }>
  icp_description?: string
}

export interface ProductContextLike {
  name?: string
  type?: ProductType
  product_description?: string
  product_category?: string
  current_alternatives?: string
  alternatives_disadvantages?: string
  product_variations?: string[]
  technical_specs?: string
  utility?: string
  result?: string
  has_guarantee?: boolean
  guarantee_details?: string
  price_range?: string
  /** Exact sticker price when known (e.g. ₡9.900). Never an enum bucket. */
  exact_price?: string
  stock_limited?: boolean
  main_problem?: string
  differentiation?: string
  svc_service_type?: string
  svc_problem?: string
  svc_current_pain?: string
  svc_alternatives_tried?: string
  svc_alternatives_failures?: string
  svc_concrete_result?: string
  svc_result_timeline?: string
  svc_life_change?: string
  svc_process_steps?: string
  svc_service_format?: string
  svc_service_duration?: string
  svc_differentiation?: string
  svc_has_own_method?: boolean
  svc_method_name?: string
  svc_main_objection?: string
  svc_has_guarantee?: boolean
  svc_guarantee_details?: string
  svc_has_success_cases?: boolean
  success_cases?: Array<{
    client_name?: string
    before_state?: string
    what_they_did?: string
    result?: string
    timeline?: string
    life_change?: string
  }>
  ind_article_type?: string
  ind_model_count?: number
  ind_variations_description?: string
  ind_sizes?: string
  ind_main_material?: string
  ind_quality_description?: string
  ind_accepts_changes?: boolean
  ind_change_policy?: string
  ind_customizable?: boolean
  ind_customization_description?: string
  menu_text?: string
  location?: string
  schedule?: string
  is_new_restaurant?: boolean
  re_business_type?: 'sale' | 'rent' | 'airbnb' | string
  re_price?: string
  re_location?: string
  re_construction_size?: string
  re_bedrooms?: string
  re_capacity?: string
  re_bathrooms?: string
  re_parking?: string
  re_highlights?: string
  re_location_reference?: string
  re_cta?: string
  context_links_content?: string
  [key: string]: unknown
}

export interface ScriptContextProfile {
  productType: ProductType
  productName: string
  businessName?: string
  category?: string
  audienceSegments: string[]
  buyerReadinessSignals: string[]
  pains: string[]
  desires: string[]
  objections: string[]
  alternatives: Array<{ name: string; weakness?: string; ethicalContrast?: string }>
  proof: string[]
  logistics: string[]
  offerFacts: string[]
  sensoryFacts: string[]
  missingFacts: string[]
  bannedClaims: string[]
  activeSalesChannel?: SalesChannel
  ctaStrength?: CTAStrength
  contextDocumentsSummary: string[]
}

export interface AngleCandidate {
  id: string
  scriptType: ScriptFramework
  hookMechanism: string
  buyerStage: BuyerStage
  audienceSegment: string
  coreDoubt: string
  proofToUse: string[]
  logisticsToUse: string[]
  hookDraft: string
  whyItCouldWin: string
  score: number
}

export interface ScriptBrief {
  index: number
  scriptType: ScriptFramework
  productType: ProductType
  angleId: string
  hookMechanism: string
  buyerStage: BuyerStage
  openingPromise: string
  developmentBeats: string[]
  mustIncludeFacts: string[]
  mustAvoid: string[]
  cta: {
    strength: CTAStrength
    channel?: SalesChannel
    textDirection: string
  }
  coreDoubt: string
  proofToUse: string[]
}

export interface GeneratedScript {
  index: number
  title: string
  scriptType: ScriptFramework
  hookMechanism: string
  buyerStage: BuyerStage
  spokenScript: {
    hook: string
    development: string
    ctaOrClose: string
  }
  qualityScore: number
}

export interface ScriptQualityReport {
  index: number
  passed: boolean
  specificity: number
  hookStrength: number
  detailDensity: number
  categoryFit: number
  ctaFit: number
  repetitionRisk: number
  inventedClaimRisk: number
  genericPhrases: string[]
  unresolvedPlaceholders?: string[]
  forbiddenPhrases?: string[]
  repairInstruction?: string
}

export interface GuionesPipelineResult {
  content: string
  contextProfile: ScriptContextProfile
  angleCandidates: AngleCandidate[]
  briefs: ScriptBrief[]
  qualityReports: ScriptQualityReport[]
  scripts: GeneratedScript[]
  promptPreview: string
}

