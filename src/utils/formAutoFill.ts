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
      messages: [{ role: 'user', content: `${prompt}\n\n---\nINFORMACIÓN A ANALIZAR:\n${content}` }],
      businessDetails: {},
      language,
    }),
  })
  const data = await res.json()
  if (!data.content) return null
  const jsonMatch = data.content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    return JSON.parse(jsonMatch[0])
  } catch {
    return null
  }
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

const BUSINESS_PROMPT = `Eres un asistente experto en negocios y marketing. Tu tarea es analizar la información proporcionada sobre un negocio y extraer TODOS los datos posibles para completar un formulario.

INSTRUCCIONES CRÍTICAS:
- Analiza toda la información disponible y deduce respuestas inteligentes.
- Si un dato no está explícito, INFIERE una respuesta razonable basándote en el contexto del negocio.
- NUNCA dejes un campo vacío. Si realmente no puedes inferir, usa tu mejor estimación basada en el tipo de negocio.
- Responde ÚNICAMENTE con un JSON válido, sin texto adicional.

CAMPOS REQUERIDOS:
{
  "name": "nombre del negocio",
  "sales_channels": ["physical", "messages", "website"],
  "location": "ubicación exacta del negocio (ciudad, país)",
  "does_shipping": true/false,
  "shipping_method": "método de envío (si aplica)",
  "audience_sex": "male" | "female" | "both",
  "audience_age_min": número (ej: 18),
  "audience_age_max": número (ej: 55),
  "audience_geographic_scope": "local" | "country" | "world",
  "audience_profession": "profesión específica del público objetivo, o vacío si es general"
}

REGLAS para sales_channels: incluye "physical" si tiene tienda/local, "messages" si vende por WhatsApp/DM/mensajes, "website" si tiene tienda online.
REGLAS para audiencia: deduce el rango de edad, sexo y alcance geográfico basándote en el tipo de negocio y productos/servicios que ofrece.`

const SERVICE_PROMPT = `Eres un asistente experto en marketing de servicios. Tu tarea es analizar la información y completar TODOS los campos del formulario de servicio.

INSTRUCCIONES CRÍTICAS:
- Analiza toda la información y deduce respuestas inteligentes para CADA campo.
- Si un dato no está explícito, INFIERE una respuesta razonable basándote en el tipo de servicio.
- NUNCA dejes un campo como cadena vacía. Deduce la mejor respuesta posible.
- Responde ÚNICAMENTE con un JSON válido, sin texto adicional.

CAMPOS REQUERIDOS:
{
  "name": "nombre del servicio",
  "svc_service_type": "consultoria" | "mentoria" | "profesional" | "agencia" | "salud_estetica" | "educacion" | "tecnico" | "otro",
  "svc_problem": "problema específico que resuelve el servicio (describe con detalle)",
  "svc_current_pain": "dolor actual del cliente: qué está pasando hoy por culpa de ese problema",
  "svc_alternatives_tried": "qué intenta hacer la gente hoy para resolver el problema",
  "svc_alternatives_failures": "por qué esas alternativas no funcionan o no son suficientes",
  "svc_concrete_result": "resultado concreto y medible que obtiene el cliente",
  "svc_result_timeline": "tiempo para ver resultados (ej: 30 días, 3 meses)",
  "svc_life_change": "cómo cambia la vida/negocio del cliente después del resultado",
  "svc_process_steps": "pasos del proceso resumido (ej: Diagnóstico → Estrategia → Implementación)",
  "svc_service_format": "one_on_one" | "group" | "automated" | "mixed",
  "svc_service_duration": "duración del servicio (ej: 3 meses, sesión única)",
  "svc_differentiation": "qué hace este servicio diferente al resto",
  "svc_has_own_method": true/false (si tiene un método o sistema propio),
  "svc_method_name": "nombre del método propio (si aplica)",
  "svc_main_objection": "principal objeción que tienen los clientes antes de contratar",
  "svc_has_guarantee": true/false,
  "svc_guarantee_details": "detalles de la garantía (si aplica)"
}

Para cada campo, piensa: ¿qué respondería el dueño del negocio basándose en la información disponible?`

const INDUMENTARIA_PROMPT = `Eres un asistente experto en moda, textiles y retail. Tu tarea es analizar la información y completar TODOS los campos del formulario de indumentaria/moda.

INSTRUCCIONES CRÍTICAS:
- Analiza toda la información y deduce respuestas inteligentes para CADA campo.
- Si un dato no está explícito, INFIERE una respuesta razonable basándote en el tipo de producto.
- NUNCA dejes un campo vacío. Usa tu conocimiento de la industria para deducir.
- Responde ÚNICAMENTE con un JSON válido, sin texto adicional.

CAMPOS REQUERIDOS:
{
  "name": "nombre del producto o colección",
  "ind_article_type": "ropa" | "zapatos" | "joyeria" | "relojes" | "accesorios" | "otro",
  "ind_model_count": número de modelos o diseños diferentes,
  "ind_variations_description": "descripción de todas las variaciones (colores, estilos, diseños disponibles)",
  "ind_sizes": "tallas disponibles (ej: S a XL, 36 al 42)",
  "ind_main_material": "material principal del producto",
  "ind_quality_description": "qué hace que la calidad sea buena (detalles tangibles)",
  "ind_accepts_changes": true/false (acepta cambios o devoluciones),
  "ind_change_policy": "política de cambios (ej: 7 días para cambios)",
  "has_guarantee": true/false,
  "guarantee_details": "detalles de la garantía",
  "ind_customizable": true/false (se puede personalizar),
  "ind_customization_description": "qué se puede personalizar (ej: bordado con nombre)"
}

Deduce materiales, calidad, tallas basándote en el tipo de artículo si no se mencionan explícitamente.`

const RESTAURANT_PROMPT = `Eres un asistente experto en gastronomía y restaurantes. Tu tarea es analizar la información y completar TODOS los campos del formulario de restaurante.

INSTRUCCIONES CRÍTICAS:
- Analiza toda la información y extrae TODOS los datos posibles.
- Para el menú, lista TODOS los platillos, categorías y precios que encuentres, formateado legiblemente.
- Si un dato no está explícito, INFIERE una respuesta razonable.
- NUNCA dejes un campo vacío.
- Responde ÚNICAMENTE con un JSON válido, sin texto adicional.

CAMPOS REQUERIDOS:
{
  "name": "nombre del restaurante",
  "menu_text": "menú completo con platillos, descripciones y precios organizados por categoría",
  "location": "ubicación exacta del restaurante (dirección, ciudad, país)",
  "schedule": "horario de atención completo (días y horas)",
  "is_new_restaurant": true/false (true si parece nuevo o poco conocido, false si ya es establecido)
}

Para menu_text: organiza por categorías (Entradas, Platos Fuertes, Bebidas, Postres, etc.) con precios.`

const PRODUCT_PROMPT = `Eres un asistente experto en marketing de productos. Tu tarea es analizar la información y completar TODOS los campos del formulario de producto.

INSTRUCCIONES CRÍTICAS:
- Analiza toda la información y deduce respuestas inteligentes para CADA campo.
- Si un dato no está explícito, INFIERE una respuesta razonable basándote en el tipo de producto.
- NUNCA dejes un campo vacío. Deduce la mejor respuesta posible.
- Responde ÚNICAMENTE con un JSON válido, sin texto adicional.

CAMPOS REQUERIDOS:
{
  "name": "nombre del producto",
  "product_category": "tecnologia" | "hogar" | "salud" | "belleza" | "accesorio" | "otro",
  "product_description": "beneficios principales del producto (qué hace, para qué sirve)",
  "current_alternatives": "qué alternativas usan los clientes actualmente",
  "alternatives_disadvantages": "desventajas o problemas de esas alternativas",
  "technical_specs": "especificaciones técnicas del producto",
  "utility": "para qué se usa exactamente, utilidad práctica",
  "result": "resultado concreto que obtiene el comprador",
  "product_variations": ["color", "tamaño", "modelo", "sabor", "otro"],
  "has_guarantee": true/false,
  "guarantee_details": "detalles de la garantía (si aplica)",
  "price_range": "bajo" | "medio" | "premium" | "lujo",
  "stock_limited": true/false (si tiene stock limitado o edición limitada)
}

Para product_variations: incluye las variaciones que apliquen de la lista: "color", "tamaño", "modelo", "sabor", "otro".
Para price_range: deduce según el tipo de producto y cualquier precio mencionado.`

const RE_PROMPT = `Eres un asistente experto en bienes raíces. Tu tarea es analizar la información y completar TODOS los campos del formulario de propiedad inmobiliaria.

INSTRUCCIONES CRÍTICAS:
- Analiza toda la información y extrae TODOS los datos posibles.
- Si un dato no está explícito, INFIERE una respuesta razonable.
- NUNCA dejes un campo vacío.
- Responde ÚNICAMENTE con un JSON válido, sin texto adicional.

CAMPOS REQUERIDOS:
{
  "name": "nombre o título de la propiedad",
  "re_business_type": "sale" | "rent" | "airbnb",
  "re_price": "precio de la propiedad",
  "re_location": "ubicación de la propiedad (dirección, zona, ciudad)",
  "re_construction_size": "tamaño de construcción (m²)",
  "re_bedrooms": "número de habitaciones",
  "re_capacity": "capacidad de personas (para Airbnb)",
  "re_bathrooms": "número de baños",
  "re_parking": "espacios de estacionamiento",
  "re_highlights": "características destacadas (piscina, jardín, vista, etc.)",
  "re_location_reference": "punto de referencia de la ubicación",
  "re_cta": "llamado a acción (ej: Agenda tu visita, Escríbenos)"
}`

export type FormType = 'business' | 'service' | 'indumentaria' | 'restaurant' | 'product' | 'real_estate'

const PROMPTS: Record<FormType, string> = {
  business: BUSINESS_PROMPT,
  service: SERVICE_PROMPT,
  indumentaria: INDUMENTARIA_PROMPT,
  restaurant: RESTAURANT_PROMPT,
  product: PRODUCT_PROMPT,
  real_estate: RE_PROMPT,
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
