import { supabase } from '../lib/supabase'

const getChatUrl = () => import.meta.env.PROD ? '/api/chat' : 'http://localhost:3000/api/chat'
const getFetchUrl = () => import.meta.env.PROD ? '/api/fetch-url' : 'http://localhost:3000/api/fetch-url'

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

async function callAI(token: string, prompt: string, content: string, language: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(getChatUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      messages: [{ role: 'user', content: `${prompt}\n\nInformación:\n${content}` }],
      businessDetails: {},
      language,
    }),
  })
  const data = await res.json()
  if (!data.content) return null
  const jsonMatch = data.content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  return JSON.parse(jsonMatch[0])
}

async function scrapeUrl(token: string, url: string): Promise<{ content: string; title: string } | null> {
  const res = await fetch(getFetchUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ url }),
  })
  const data = await res.json()
  if (!res.ok || !data.content) return null
  return { content: data.content.slice(0, 12000), title: data.title || url }
}

// ---- Form-specific AI prompts ----

const BUSINESS_PROMPT = `Eres un asistente experto en negocios. Analiza la siguiente información y extrae datos del negocio. Responde SOLO con JSON válido con estos campos:
- name (nombre del negocio)
- sales_channels (array de strings, opciones: "physical", "messages", "website")
- location (ubicación del negocio, si se menciona)
- does_shipping (boolean)
- shipping_method (método de envío si aplica)
- audience_sex ("male", "female", o "both")
- audience_age_min (número)
- audience_age_max (número)
- audience_geographic_scope ("local", "country", "world")
- audience_profession (descripción de profesión si se menciona, o "")
Si no encuentras info para un campo, usa valores por defecto razonables.`

const SERVICE_PROMPT = `Eres un asistente experto en marketing de servicios. Analiza la siguiente información y extrae datos del servicio. Responde SOLO con JSON válido con estos campos:
- name (nombre del servicio)
- svc_service_type (uno de: consultoria, mentoria, profesional, agencia, salud_estetica, educacion, tecnico, otro)
- svc_problem (problema que resuelve)
- svc_current_pain (dolor actual del cliente)
- svc_alternatives_tried (alternativas que intentan los clientes)
- svc_alternatives_failures (por qué fallan esas alternativas)
- svc_concrete_result (resultado concreto)
- svc_result_timeline (tiempo para ver resultados)
- svc_life_change (cambio de vida después del resultado)
- svc_process_steps (pasos del proceso)
- svc_service_format (uno de: one_on_one, group, automated, mixed)
- svc_service_duration (duración del servicio)
- svc_differentiation (diferenciación)
- svc_main_objection (objeción principal)
Si no encuentras info para un campo, déjalo como "".`

const INDUMENTARIA_PROMPT = `Eres un asistente experto en moda y retail. Analiza la siguiente información y extrae datos del producto de indumentaria. Responde SOLO con JSON válido con estos campos:
- name (nombre del producto o colección)
- ind_article_type (uno de: ropa, zapatos, joyeria, relojes, accesorios, otro)
- ind_model_count (número de modelos/diseños diferentes)
- ind_variations_description (descripción de variaciones: colores, estilos, etc.)
- ind_sizes (tallas disponibles)
- ind_main_material (material principal)
- ind_quality_description (qué hace la calidad buena)
Si no encuentras info para un campo, déjalo como "".`

const RESTAURANT_PROMPT = `Eres un asistente experto en gastronomía. Analiza la siguiente información y extrae datos del restaurante. Responde SOLO con JSON válido con estos campos:
- name (nombre del restaurante)
- menu_text (lista de platillos y precios encontrados, formateado como texto)
- location (ubicación del restaurante)
- schedule (horario de atención)
Si no encuentras info para un campo, déjalo como "".`

export type FormType = 'business' | 'service' | 'indumentaria' | 'restaurant'

const PROMPTS: Record<FormType, string> = {
  business: BUSINESS_PROMPT,
  service: SERVICE_PROMPT,
  indumentaria: INDUMENTARIA_PROMPT,
  restaurant: RESTAURANT_PROMPT,
}

export async function autoFillFromUrl(
  url: string,
  formType: FormType,
  language: string
): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  const token = await getToken()
  if (!token) return { data: null, error: 'Not authenticated' }

  const scraped = await scrapeUrl(token, url)
  if (!scraped) return { data: null, error: 'Could not scrape URL' }

  const parsed = await callAI(token, PROMPTS[formType], scraped.content, language)
  return { data: parsed }
}

export async function autoFillFromText(
  text: string,
  formType: FormType,
  language: string
): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  const token = await getToken()
  if (!token) return { data: null, error: 'Not authenticated' }

  const parsed = await callAI(token, PROMPTS[formType], text, language)
  return { data: parsed }
}
