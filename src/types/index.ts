// =============================================
// Account Types
// =============================================
export type AccountType = 'single' | 'team'
export type TeamRole = 'owner' | 'admin' | 'member'
export type ProductType = 'product' | 'service'
export type SessionStatus = 'active' | 'completed' | 'archived'

// =============================================
// Script Enhancement Types
// =============================================
export type ScriptFramework = 'direct' | 'pas' | 'aida' | 'bab' | 'fourp'
export type ScriptTone = 'professional' | 'casual' | 'urgent' | 'humorous' | 'inspirational' | 'controversial'
export type ScriptDuration = '15s' | '30s' | '60s' | '90s'
export type ScriptPlatform = 'general' | 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'linkedin' | 'tv' | 'radio'

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
  // Core product info (from form)
  description?: string
  offer?: string
  awareness_level?: string
  market_alternatives?: string
  customer_values?: string
  purchase_reason?: string
  // Additional context
  target_audience?: string
  unique_value?: string
  call_to_action?: string
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
  description: string
  offer: string
  awareness_level: string
  market_alternatives: string
  customer_values: string
  purchase_reason: string
  target_audience?: string
  call_to_action?: string
}

export interface ScriptGenerationSettings {
  framework: ScriptFramework
  tone: ScriptTone
  duration: ScriptDuration
  platform: ScriptPlatform
  variations: number
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

