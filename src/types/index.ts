// =============================================
// Account Types
// =============================================
export type AccountType = 'single' | 'team'
export type TeamRole = 'owner' | 'admin' | 'member'
export type ProductType = 'product' | 'service' | 'restaurant' | 'real_estate' | 'indumentaria'
export type SessionStatus = 'active' | 'completed' | 'archived'

// =============================================
// Script Enhancement Types
// =============================================
export type ScriptFramework = 'venta_directa' | 'desvalidar_alternativas' | 'mostrar_servicio' | 'variedad_productos' | 'paso_a_paso' | 'reconocimiento'
export type GenerationMode = 'mixed' | 'by_type'

export interface ScriptTypeConfig {
  venta_directa: number
  desvalidar_alternativas: number
  mostrar_servicio: number
  variedad_productos: number
  paso_a_paso: number
  reconocimiento: number
}
export type AIModel = 'grok' | 'gemini'
export type ImageModel = 'nano-banana' | 'nano-banana-pro' | 'grok-imagine'
export type VideoModel = 'grok-imagine-video'
export type AspectRatio = '16:9' | '4:3' | '1:1' | '9:16' | '3:4' | '3:2' | '2:3'
export type VideoResolution = '720p' | '480p'

// =============================================
// Core Entities
// =============================================
export interface Profile {
  id: string
  email: string
  full_name?: string
  avatar_url?: string
  account_type: AccountType
  is_admin: boolean
  created_at: string
  updated_at: string
}

export interface Team {
  id: string
  name: string
  owner_id: string
  max_members: number
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  role: TeamRole
  invited_at: string
  joined_at?: string
  // Joined data
  profile?: Profile
}

export interface Client {
  id: string
  team_id: string
  name: string
  created_by: string
  created_at: string
  updated_at: string
  // Computed
  products_count?: number
}

// =============================================
// Business & Target Audience Types
// =============================================
export type SalesChannel = 'physical' | 'messages' | 'website'
export type GeographicScope = 'local' | 'country' | 'world' | 'custom'
export type ServiceFormat = 'one_on_one' | 'group' | 'automated' | 'mixed'

export interface Business {
  id: string
  owner_id: string
  client_id?: string
  name: string
  sales_channels: SalesChannel[]
  location?: string
  does_shipping: boolean
  shipping_method?: string
  created_at: string
  updated_at: string
  target_audiences?: TargetAudience[]
}

export interface BusinessFormData {
  name: string
  sales_channels: SalesChannel[]
  location?: string
  does_shipping: boolean
  shipping_method?: string
  target_audiences: TargetAudienceFormData[]
}

export interface TargetAudience {
  id: string
  business_id: string
  sex: 'male' | 'female' | 'both'
  age_min: number
  age_max: number
  geographic_scope: GeographicScope
  geographic_scope_custom?: string
  has_specific_profession: boolean
  profession_description?: string
  created_at: string
}

export interface TargetAudienceFormData {
  sex: 'male' | 'female' | 'both'
  age_min: number
  age_max: number
  geographic_scope: GeographicScope
  geographic_scope_custom?: string
  has_specific_profession: boolean
  profession_description?: string
}

export interface SuccessCase {
  id: string
  product_id: string
  client_name?: string
  before_state: string
  what_they_did: string
  result: string
  timeline: string
  life_change: string
  created_at: string
}

export interface SuccessCaseFormData {
  client_name?: string
  before_state: string
  what_they_did: string
  result: string
  timeline: string
  life_change: string
}

export interface Product {
  id: string
  owner_id?: string
  client_id?: string
  business_id?: string
  name: string
  type: ProductType
  // Legacy/shared form fields
  product_description?: string
  main_problem?: string
  best_customers?: string
  failed_attempts?: string
  attention_grabber?: string
  real_pain?: string
  pain_consequences?: string
  expected_result?: string
  differentiation?: string
  key_objection?: string
  shipping_info?: string
  awareness_level?: string
  // Legacy fields for backward compatibility
  description?: string
  offer?: string
  market_alternatives?: string
  customer_values?: string
  purchase_reason?: string
  target_audience?: string
  unique_value?: string
  call_to_action?: string
  // New product-type fields
  product_category?: string
  product_category_custom?: string
  current_alternatives?: string
  alternatives_disadvantages?: string
  product_variations?: string[]
  technical_specs?: string
  utility?: string
  result?: string
  has_guarantee?: boolean
  guarantee_details?: string
  price_range?: string
  stock_limited?: boolean
  // Indumentaria fields
  ind_article_type?: string
  ind_article_type_custom?: string
  ind_model_count?: number
  ind_variations_description?: string
  ind_sizes?: string
  ind_main_material?: string
  ind_quality_description?: string
  ind_accepts_changes?: boolean
  ind_change_policy?: string
  ind_customizable?: boolean
  ind_customization_description?: string
  ind_product_images?: string[]
  // Service fields
  svc_service_type?: string
  svc_service_type_custom?: string
  svc_problem?: string
  svc_current_pain?: string
  svc_alternatives_tried?: string
  svc_alternatives_failures?: string
  svc_concrete_result?: string
  svc_result_timeline?: string
  svc_life_change?: string
  svc_process_steps?: string
  svc_service_format?: ServiceFormat
  svc_service_duration?: string
  svc_differentiation?: string
  svc_has_own_method?: boolean
  svc_method_name?: string
  svc_main_objection?: string
  svc_has_guarantee?: boolean
  svc_guarantee_details?: string
  svc_has_success_cases?: boolean
  // Restaurant-specific fields
  menu_text?: string
  menu_pdf_url?: string
  location?: string
  schedule?: string
  is_new_restaurant?: boolean
  // Real estate-specific fields
  re_business_type?: 'sale' | 'rent' | 'airbnb'
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
  context_links?: string[]
  context_links_content?: string
  created_at: string
  updated_at: string
  // Joined data
  client?: Client
  business?: Business
  sessions_count?: number
  scripts_count?: number
}

export interface ChatSession {
  id: string
  product_id: string
  user_id: string
  title: string
  status: SessionStatus
  context?: string
  // Script generation settings
  framework: ScriptFramework
  tone?: string
  duration?: string
  platform?: string
  created_at: string
  updated_at: string
  // Joined data
  product?: Product
  messages_count?: number
}

export interface Message {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  system_prompt?: string
  created_at: string
}

export interface Script {
  id: string
  session_id: string
  product_id: string
  title: string
  content: string
  angle?: string
  is_favorite: boolean
  // Enhancement fields
  rating?: number
  version: number
  parent_script_id?: string
  framework?: ScriptFramework
  tone?: string
  duration?: string
  platform?: string
  variation_number: number
  // Edit tracking
  edit_source?: string
  edit_label?: string
  message_id?: string
  script_index?: number
  created_at: string
  updated_at: string
  // Joined data
  product?: Product
  versions?: Script[]
}

export interface ScriptTemplate {
  id: string
  owner_id?: string
  team_id?: string
  name: string
  description?: string
  content: string
  framework?: ScriptFramework
  tone?: string
  duration?: string
  platform?: string
  usage_count: number
  created_at: string
  updated_at: string
}

// =============================================
// Form Types
// =============================================
export interface ProductFormData {
  name: string
  type: ProductType
  // Section 1: The Product/Service
  product_description?: string      // What are you selling / What service do you offer
  main_problem?: string             // What main problem does it solve
  // Section 2: Client & Context
  best_customers?: string           // Describe your best current customers/clients
  failed_attempts?: string          // What they tried before that didn't work
  attention_grabber?: string        // What catches their attention about your product/service
  // Section 3: Real Pain (Service only, but stored for both)
  real_pain?: string               // What bothers potential clients most (service)
  pain_consequences?: string       // What happens if they don't solve it (service)
  // Section 4: Desire/Result
  expected_result?: string          // What result do they expect
  // Section 5: Differentiation
  differentiation?: string          // What makes this different/better
  // Section 6: Key Objection (Product only)
  key_objection?: string           // What do people doubt or ask before buying
  // Section 7: Logistics (Product only)
  shipping_info?: string           // How does shipping work
  // Section 8: Awareness Level
  awareness_level?: string          // How do they find this product/service
  // Restaurant fields
  menu_text?: string
  menu_pdf_url?: string
  location?: string
  schedule?: string
  is_new_restaurant?: boolean
  // Real estate fields
  re_business_type?: 'sale' | 'rent' | 'airbnb'
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
  // Context links added during product creation
  context_links?: string[]
  context_links_content?: string
  // Legacy fields for backward compatibility
  description?: string
  offer?: string
  market_alternatives?: string
  customer_values?: string
  purchase_reason?: string
  target_audience?: string
  call_to_action?: string
}

export interface RestaurantFormData {
  name: string
  type: 'restaurant'
  business_id?: string
  menu_text: string
  menu_pdf_url?: string
  location: string
  schedule: string
  is_new_restaurant: boolean
}

export interface RealEstateFormData {
  name: string
  type: 'real_estate'
  business_id?: string
  re_business_type: 'sale' | 'rent' | 'airbnb'
  re_price: string
  re_location: string
  re_construction_size: string
  re_bedrooms: string
  re_capacity: string
  re_bathrooms: string
  re_parking: string
  re_highlights: string
  re_location_reference: string
  re_cta: string
  context_links?: string[]
  context_links_content?: string
}

export interface NewProductFormData {
  name: string
  type: 'product'
  business_id: string
  product_category: string
  product_category_custom?: string
  product_description?: string
  current_alternatives?: string
  alternatives_disadvantages?: string
  product_variations?: string[]
  technical_specs?: string
  utility?: string
  result?: string
  has_guarantee?: boolean
  guarantee_details?: string
  price_range?: string
  stock_limited?: boolean
  context_links?: string[]
  context_links_content?: string
}

export interface NewServiceFormData {
  name: string
  type: 'service'
  business_id: string
  svc_service_type: string
  svc_service_type_custom?: string
  svc_problem: string
  svc_current_pain: string
  svc_alternatives_tried: string
  svc_alternatives_failures: string
  svc_concrete_result: string
  svc_result_timeline: string
  svc_life_change: string
  svc_process_steps: string
  svc_service_format: ServiceFormat
  svc_service_duration: string
  svc_differentiation: string
  svc_has_own_method: boolean
  svc_method_name?: string
  svc_main_objection: string
  svc_has_guarantee: boolean
  svc_guarantee_details?: string
  svc_has_success_cases: boolean
  success_cases?: SuccessCaseFormData[]
  context_links?: string[]
  context_links_content?: string
}

export interface IndumentariaFormData {
  name: string
  type: 'indumentaria'
  business_id: string
  ind_article_type: string
  ind_article_type_custom?: string
  ind_model_count: number
  ind_variations_description: string
  ind_sizes?: string
  ind_main_material: string
  ind_quality_description?: string
  ind_accepts_changes: boolean
  ind_change_policy?: string
  has_guarantee?: boolean
  guarantee_details?: string
  ind_customizable: boolean
  ind_customization_description?: string
  ind_product_images?: string[]
  context_links?: string[]
  context_links_content?: string
}

export interface ScriptGenerationSettings {
  framework: ScriptFramework
  variations: number
  model: AIModel
  generationMode: GenerationMode
  scriptTypeConfig: ScriptTypeConfig
}

// =============================================
// Context Documents Types
// =============================================
export type ContextDocumentType = 'pdf' | 'image' | 'link' | 'text'

export interface ContextDocument {
  id: string
  session_id: string
  owner_id: string
  type: ContextDocumentType
  name: string
  content?: string
  url?: string
  file_path?: string
  metadata?: Record<string, unknown>
  created_at: string
}

export interface ContextDocumentFormData {
  type: ContextDocumentType
  name: string
  content?: string
  url?: string
}

// =============================================
// Dashboard Stats
// =============================================
export interface DashboardStats {
  totalProducts: number
  totalScripts: number
  totalSessions: number
  scriptsThisMonth: number
}

export interface TeamDashboardStats extends DashboardStats {
  totalClients: number
  totalMembers: number
}

