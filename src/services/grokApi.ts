import type { Message, ScriptGenerationSettings, ProductType, ContextDocument, Business, Product } from '../types'
import { supabase } from '../lib/supabase'

const CHAT_API_URL = import.meta.env.PROD ? '/api/chat' : 'http://localhost:3000/api/chat'
const EDIT_SCRIPT_API_URL = import.meta.env.PROD ? '/api/edit-script' : 'http://localhost:3000/api/edit-script'

type Language = 'en' | 'es'

interface ProductContext {
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

interface ApiBusinessContext {
  name?: string
  sales_channels?: string[]
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

export function buildApiBusinessContext(business: Business | undefined): ApiBusinessContext | undefined {
  if (!business) return undefined
  return {
    name: business.name,
    sales_channels: business.sales_channels,
    location: business.location || undefined,
    does_shipping: business.does_shipping,
    shipping_method: business.shipping_method || undefined,
    target_audiences: business.target_audiences?.map(a => ({
      sex: a.sex,
      age_min: a.age_min,
      age_max: a.age_max,
      geographic_scope: a.geographic_scope,
      geographic_scope_custom: a.geographic_scope_custom || undefined,
      has_specific_profession: a.has_specific_profession,
      profession_description: a.profession_description || undefined,
    })),
    icp_description: business.icp_description || undefined,
  }
}

export function buildApiProductContext(product: Product): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    name: product.name,
    type: product.type,
  }
  const fields = [
    'product_description', 'product_category', 'current_alternatives', 'alternatives_disadvantages',
    'product_variations', 'technical_specs', 'utility', 'result', 'has_guarantee', 'guarantee_details',
    'price_range', 'stock_limited', 'main_problem', 'differentiation',
    'svc_service_type', 'svc_problem', 'svc_current_pain', 'svc_alternatives_tried',
    'svc_alternatives_failures', 'svc_concrete_result', 'svc_result_timeline', 'svc_life_change',
    'svc_process_steps', 'svc_service_format', 'svc_service_duration', 'svc_differentiation',
    'svc_has_own_method', 'svc_method_name', 'svc_main_objection', 'svc_has_guarantee', 'svc_guarantee_details',
    'svc_has_success_cases',
    'ind_article_type', 'ind_model_count', 'ind_variations_description', 'ind_sizes',
    'ind_main_material', 'ind_quality_description', 'ind_accepts_changes', 'ind_change_policy',
    'ind_customizable', 'ind_customization_description',
    'menu_text', 'location', 'schedule', 'is_new_restaurant',
    're_business_type', 're_price', 're_location', 're_construction_size', 're_bedrooms',
    're_capacity', 're_bathrooms', 're_parking', 're_highlights', 're_location_reference', 're_cta',
  ] as const
  for (const f of fields) {
    const val = product[f as keyof Product]
    if (val !== null && val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0)) {
      ctx[f] = val
    }
  }
  return ctx
}

export const DEFAULT_SCRIPT_SETTINGS: ScriptGenerationSettings = {
  framework: 'venta_directa',
  variations: 3,
  model: 'grok',
  generationMode: 'mixed',
  scriptTypeConfig: {
    venta_directa: 1,
    desvalidar_alternativas: 1,
    mostrar_servicio: 1,
    variedad_productos: 0,
    paso_a_paso: 0,
    reconocimiento: 0,
    educativo: 0,
    storytelling: 0,
    tendencia: 0,
    engagement: 0
  },
  ctaStrength: 'sales',
  useStructuredPipeline: false,
  forceFreshAngles: false
}

export async function sendMessageToGrok(
  messages: Message[],
  productContext: ProductContext,
  language: Language = 'es',
  scriptSettings?: ScriptGenerationSettings,
  productType?: ProductType,
  contextDocs?: ContextDocument[],
  feature?: 'script' | 'description',
  businessCtx?: ApiBusinessContext,
  productCtx?: Record<string, unknown>,
  _consciousnessLevel?: 'cold' | 'warm' | 'hot',
  activeSalesChannel?: 'physical' | 'messages' | 'website',
  productId?: string,
  aiMemoryEnabled?: boolean,
  brandKitId?: string,
  scriptTemplateIds?: string[]
): Promise<{ content: string; _debug?: { systemPrompt: string; contextProfile?: unknown; angleCandidates?: unknown[]; briefs?: unknown[]; qualityReports?: unknown[] } }> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  if (!token) {
    throw new Error('No estás autenticado. Por favor inicia sesión.')
  }

  const contextDocuments = contextDocs?.map(doc => ({
    type: doc.type,
    name: doc.name,
    content: doc.content,
    url: doc.url
  })) || []

  const response = await fetch(EDIT_SCRIPT_API_URL, {
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
      businessContext: businessCtx,
      productContext: productCtx,
      language,
      scriptSettings,
      productType: productType || productContext.product_type,
      contextDocuments,
      ...(feature ? { feature } : {}),
      ...(activeSalesChannel ? { activeSalesChannel } : {}),
      ...(productId ? { productId } : {}),
      ...(aiMemoryEnabled !== undefined ? { aiMemoryEnabled } : {}),
      ...(brandKitId ? { brandKitId } : {}),
      ...(scriptTemplateIds && scriptTemplateIds.length > 0 ? { scriptTemplateIds } : {})
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
  contextDocs?: ContextDocument[],
  businessCtx?: ApiBusinessContext,
  productCtx?: Record<string, unknown>
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
      businessContext: businessCtx,
      productContext: productCtx,
      language,
      scriptSettings,
      productType: productType || productContext.product_type,
      contextDocuments,
      previewOnly: true
    })
  })

  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Preview failed')
  return data.systemPrompt || ''
}

export async function editScript(
  originalScript: string,
  editInstruction: string,
  language: Language = 'es',
  businessCtx?: Record<string, unknown>,
  productCtx?: Record<string, unknown>,
  editType?: 'script_edit' | 'script_enhance' | 'script_hook' | 'script_consciousness'
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error(language === 'es' ? 'No estás autenticado.' : 'Not authenticated.')

  let contextBlock = ''
  if (businessCtx && Object.keys(businessCtx).length > 0) {
    contextBlock += `\n\nCONTEXTO DEL NEGOCIO:\n${JSON.stringify(businessCtx, null, 2)}`
  }
  if (productCtx && Object.keys(productCtx).length > 0) {
    contextBlock += `\n\nCONTEXTO DEL PRODUCTO/SERVICIO:\n${JSON.stringify(productCtx, null, 2)}`
  }

  const systemPrompt = language === 'es'
    ? `Eres un editor de guiones de venta. Tu ÚNICA tarea es aplicar la edición solicitada al guión original y devolver el guión editado completo.

REGLAS ESTRICTAS:
- Devuelve SOLO el guión editado, nada más.
- Devuelve exactamente UN (1) solo guión. NUNCA generes múltiples opciones, versiones o alternativas.
- NO incluyas "OPCIÓN #1", "OPCIÓN #2", "Versión A", etc. Solo UN guión.
- NO incluyas explicaciones, comentarios, notas ni introducciones.
- NO digas "Aquí está el guión editado" ni nada similar.
- Mantén exactamente el mismo formato, estructura y estilo del guión original.
- Solo modifica lo que el usuario pide. Todo lo demás debe permanecer idéntico.
- Si la instrucción no es clara, haz tu mejor interpretación y aplica el cambio mínimo necesario.
- Usa la información del negocio y producto/servicio proporcionada para adaptar el contenido correctamente.${contextBlock}`
    : `You are a sales script editor. Your ONLY task is to apply the requested edit to the original script and return the complete edited script.

STRICT RULES:
- Return ONLY the edited script, nothing else.
- Return exactly ONE (1) single script. NEVER generate multiple options, versions or alternatives.
- Do NOT include "OPTION #1", "OPTION #2", "Version A", etc. Just ONE script.
- Do NOT include explanations, comments, notes or introductions.
- Do NOT say "Here is the edited script" or anything similar.
- Keep exactly the same format, structure and style as the original script.
- Only modify what the user asks. Everything else must remain identical.
- If the instruction is unclear, make your best interpretation and apply the minimum change needed.
- Use the provided business and product/service context to adapt content correctly.${contextBlock}`

  const userMessage = language === 'es'
    ? `GUIÓN ORIGINAL:\n${originalScript}\n\nEDICIÓN SOLICITADA: ${editInstruction}`
    : `ORIGINAL SCRIPT:\n${originalScript}\n\nREQUESTED EDIT: ${editInstruction}`

  const response = await fetch(CHAT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      originalScript,
      editInstruction,
      businessContext: businessCtx,
      productContext: productCtx,
      editType: editType || 'script_edit',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      businessDetails: {},
      language,
      feature: editType || 'script'
    })
  })

  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Edit failed')
  return data.content || ''
}
