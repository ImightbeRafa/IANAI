// =============================================
// Account Types
// =============================================
export type AccountType = 'single' | 'team'
export type TeamRole = 'owner' | 'admin' | 'member'
export type ProductType = 'product' | 'service' | 'restaurant' | 'real_estate'
export type SessionStatus = 'active' | 'completed' | 'archived'

// =============================================
// Script Enhancement Types
// =============================================
export type ScriptFramework = 'venta_directa' | 'desvalidar_alternativas' | 'mostrar_servicio' | 'variedad_productos' | 'paso_a_paso'
export type ScriptTone = 'professional' | 'casual' | 'urgent' | 'humorous' | 'inspirational' | 'controversial'
export type ScriptDuration = '15s' | '30s' | '60s' | '90s'
export type ScriptPlatform = 'general' | 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'linkedin' | 'tv' | 'radio'
export type AIModel = 'grok' | 'gemini'
export type ImageModel = 'flux' | 'nano-banana' | 'nano-banana-pro'

// =============================================
// Core Entities
// =============================================
export interface Profile {
  id: string
  email: string
  full_name?: string
  avatar_url?: string
  account_type: AccountType
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

export interface Product {
  id: string
  owner_id?: string
  client_id?: string
  name: string
  type: ProductType
  // New form fields
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
  created_at: string
  updated_at: string
  // Joined data
  client?: Client
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
  tone: ScriptTone
  duration: ScriptDuration
  platform: ScriptPlatform
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
  tone?: ScriptTone
  duration?: ScriptDuration
  platform?: ScriptPlatform
  variation_number: number
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
  tone?: ScriptTone
  duration?: ScriptDuration
  platform?: ScriptPlatform
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
  menu_text: string
  menu_pdf_url?: string
  location: string
  schedule: string
  is_new_restaurant: boolean
}

export interface RealEstateFormData {
  name: string
  type: 'real_estate'
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
}

export interface ScriptGenerationSettings {
  framework: ScriptFramework
  tone: ScriptTone
  duration: ScriptDuration
  platform: ScriptPlatform
  variations: number
  model: AIModel
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

