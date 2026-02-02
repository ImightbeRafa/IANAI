export interface User {
  id: string
  email: string
  full_name?: string
  avatar_url?: string
  created_at: string
  updated_at?: string
}

export interface Conversation {
  id: string
  user_id: string
  title: string
  status: 'active' | 'completed' | 'archived'
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
}

export interface Script {
  id: string
  conversation_id: string
  user_id: string
  title: string
  content: string
  angle: ScriptAngle
  created_at: string
  updated_at: string
}

export type ScriptAngle = 
  | 'direct_sale'
  | 'discredit_competitors'
  | 'process_certainty'
  | 'pain_solution'
  | 'social_proof'

export interface BusinessDetails {
  product_name?: string
  product_description?: string
  target_audience?: string
  unique_value?: string
  competitors?: string
  customer_pain_points?: string
  emotional_trigger?: string
  call_to_action?: string
}

export interface ChatState {
  currentConversation: Conversation | null
  messages: Message[]
  isLoading: boolean
  error: string | null
  businessDetails: BusinessDetails
  interviewStep: number
  interviewComplete: boolean
}

export interface DashboardStats {
  totalConversations: number
  totalScripts: number
  activeConversations: number
  scriptsThisMonth: number
}
