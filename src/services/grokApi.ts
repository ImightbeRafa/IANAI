import type { Message, ScriptGenerationSettings, ProductType, ICP, ContextDocument } from '../types'
import { supabase } from '../lib/supabase'

const CHAT_API_URL = import.meta.env.PROD ? '/api/chat' : 'http://localhost:3000/api/chat'

type Language = 'en' | 'es'

export interface ProductContext {
  product_name?: string
  product_type?: ProductType
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
  offer?: string
  market_alternatives?: string
  customer_values?: string
  purchase_reason?: string
  target_audience?: string
  call_to_action?: string
  additional_context?: string
  // Restaurant-specific fields
  menu_text?: string
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
}

export const DEFAULT_SCRIPT_SETTINGS: ScriptGenerationSettings = {
  framework: 'venta_directa',
  tone: 'professional',
  duration: '30s',
  platform: 'general',
  variations: 3,
  model: 'grok'
}

export async function sendMessageToGrok(
  messages: Message[],
  productContext: ProductContext,
  language: Language = 'es',
  scriptSettings?: ScriptGenerationSettings,
  productType?: ProductType,
  icp?: ICP | null,
  contextDocs?: ContextDocument[]
): Promise<{ content: string; _debug?: { systemPrompt: string } }> {
  // Get the current session token for authentication
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  if (!token) {
    throw new Error('No estás autenticado. Por favor inicia sesión.')
  }

  // Prepare context documents for API
  const contextDocuments = contextDocs?.map(doc => ({
    type: doc.type,
    name: doc.name,
    content: doc.content,
    url: doc.url
  })) || []

  const response = await fetch(CHAT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      businessDetails: productContext,
      language,
      scriptSettings,
      productType: productType || productContext.product_type,
      icp: icp ? {
        name: icp.name,
        description: icp.description,
        awareness_level: icp.awareness_level,
        sophistication_level: icp.sophistication_level,
        urgency_type: icp.urgency_type,
        gender: icp.gender,
        age_range: icp.age_range
      } : null,
      contextDocuments
    })
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`)
  }

  return {
    content: data.content || 'No response generated',
    _debug: data._debug
  }
}

export async function previewPrompt(
  messages: Message[],
  productContext: ProductContext,
  language: Language = 'es',
  scriptSettings?: ScriptGenerationSettings,
  productType?: ProductType,
  icp?: ICP | null,
  contextDocs?: ContextDocument[]
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Not authenticated')

  const contextDocuments = contextDocs?.map(doc => ({
    type: doc.type,
    name: doc.name,
    content: doc.content,
    url: doc.url
  })) || []

  const response = await fetch(CHAT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      businessDetails: productContext,
      language,
      scriptSettings,
      productType: productType || productContext.product_type,
      icp: icp ? {
        name: icp.name,
        description: icp.description,
        awareness_level: icp.awareness_level,
        sophistication_level: icp.sophistication_level,
        urgency_type: icp.urgency_type,
        gender: icp.gender,
        age_range: icp.age_range
      } : null,
      contextDocuments,
      previewOnly: true
    })
  })

  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Preview failed')
  return data.systemPrompt || ''
}

export function getInitialPrompt(language: Language = 'es'): string {
  if (language === 'en') {
    return `Let's create high-converting ad scripts for your business. I'll ask you a few quick questions to understand your product.

What product or service do you sell and what's your irresistible offer?`
  }
  return `Vamos a crear guiones de venta de alta conversión para tu negocio. Te haré algunas preguntas rápidas para entender tu producto.

¿Qué producto o servicio vendes y cuál es tu oferta irresistible?`
}
