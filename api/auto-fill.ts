import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'
import { GROK_API_URL, GROK_TEXT_MODEL_EFFICIENT } from './lib/grok-models.js'

const MAX_CONTENT_LENGTH = 15_000

type FormType =
  | 'business'
  | 'service'
  | 'indumentaria'
  | 'restaurant'
  | 'product'
  | 'real_estate'
  | 'session_context'
  | 'brand_context'

const FORM_PROMPTS: Record<FormType, string> = {
  business: `Eres un asistente experto en negocios y marketing. Tu tarea es analizar la información proporcionada sobre un negocio y extraer TODOS los datos posibles para completar un formulario.

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
REGLAS para audiencia: deduce el rango de edad, sexo y alcance geográfico basándote en el tipo de negocio y productos/servicios que ofrece.`,

  service: `Eres un asistente experto en marketing de servicios. Tu tarea es analizar la información y completar TODOS los campos del formulario de servicio.

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

Para cada campo, piensa: ¿qué respondería el dueño del negocio basándose en la información disponible?`,

  indumentaria: `Eres un asistente experto en moda, textiles y retail. Tu tarea es analizar la información y completar TODOS los campos del formulario de indumentaria/moda.

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

Deduce materiales, calidad, tallas basándote en el tipo de artículo si no se mencionan explícitamente.`,

  restaurant: `Eres un asistente experto en gastronomía y restaurantes. Tu tarea es analizar la información y completar TODOS los campos del formulario de restaurante.

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

Para menu_text: organiza por categorías (Entradas, Platos Fuertes, Bebidas, Postres, etc.) con precios.`,

  product: `Eres un asistente experto en marketing de productos. Tu tarea es analizar la información y completar TODOS los campos del formulario de producto.

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
Para price_range: deduce según el tipo de producto y cualquier precio mencionado.`,

  real_estate: `Eres un asistente experto en bienes raíces. Tu tarea es analizar la información y completar TODOS los campos del formulario de propiedad inmobiliaria.

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
}`,

  session_context: `Eres un asistente de briefing para generación de guiones publicitarios.
Analiza la información del negocio/marca y produce un resumen de sesión listo para guardar.

INSTRUCCIONES:
- Responde ÚNICAMENTE con JSON válido, sin markdown ni texto extra.
- context debe ser un brief útil (2–6 párrafos cortos): qué vende, a quién, dolor, diferencial, oferta/CTA si aparecen.
- primary_channel: el canal principal más probable entre messages | website | physical.
- awareness_level: cold | warm | hot según qué tan listo parece el público.
- title: título corto de sesión (máx ~60 caracteres).
- NO inventes productos nuevos ni IDs. Solo briefing de sesión.

CAMPOS:
{
  "title": "título corto de la sesión",
  "context": "brief de sesión para guiones",
  "primary_channel": "messages" | "website" | "physical",
  "awareness_level": "cold" | "warm" | "hot"
}`,

  brand_context: `Eres un editor preciso de contexto de marca. Recibirás el contexto actual y una corrección del usuario.

INSTRUCCIONES:
- Devuelve ÚNICAMENTE JSON válido.
- Incluye solamente campos que el usuario pidió cambiar o que están explícitos en su corrección.
- No reemplaces datos existentes que el usuario no mencionó.
- Para colores usa hexadecimal #RRGGBB cuando sea posible.
- salesChannels solo puede contener website, messages o physical.

CAMPOS DISPONIBLES:
{
  "businessName": "nombre del negocio",
  "salesChannels": ["website", "messages", "physical"],
  "location": "ubicación",
  "doesShipping": true,
  "shippingMethod": "método de envío",
  "icp": "cliente ideal o audiencia",
  "offerName": "nombre de la oferta",
  "product_description": "qué es o qué vende",
  "utility": "para qué sirve",
  "result": "resultado prometido",
  "main_problem": "problema que resuelve",
  "expected_result": "resultado concreto",
  "differentiation": "diferenciador",
  "key_objection": "objeción principal",
  "current_alternatives": "alternativas actuales",
  "brand_voice": "descripción de la voz",
  "tone_keywords": ["palabras de tono"],
  "must_use_phrases": ["frases que sí usa"],
  "forbidden_phrases": ["frases que evita"],
  "brand_visual": "dirección visual y fotografía",
  "primary_color": "#RRGGBB",
  "secondary_color": "#RRGGBB",
  "accent_color": "#RRGGBB",
  "tagline": "tagline",
  "font_primary": "tipografía principal"
}`,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await requireAuth(req, res)
  if (!user) return

  // Rate limit: 10 requests per 60 seconds per user
  const rateCheck = checkRateLimit(user.id, { maxRequests: 10, windowSeconds: 60 })
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'rate_limit',
      message: `Por favor espera ${rateCheck.resetInSeconds} segundos antes de intentar de nuevo.`,
      messageEn: `Please wait ${rateCheck.resetInSeconds} seconds before trying again.`,
    })
  }

  try {
    const { formType, content, language = 'es', strictUnknowns = false } = req.body || {}

    if (!formType || !FORM_PROMPTS[formType as FormType]) {
      return res.status(400).json({
        error: 'invalid_form_type',
        message: 'Tipo de formulario inválido.',
        messageEn: 'Invalid form type.',
      })
    }

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({
        error: 'empty_content',
        message: 'No se proporcionó información para analizar.',
        messageEn: 'No information provided to analyze.',
      })
    }

    const grokApiKey = process.env.GROK_API_KEY
    if (!grokApiKey) {
      return res.status(500).json({
        error: 'config_error',
        message: 'Error de configuración del servidor.',
        messageEn: 'Server configuration error.',
      })
    }

    // Truncate content server-side to prevent token overflow
    let truncated = false
    let processedContent = content.trim()
    if (processedContent.length > MAX_CONTENT_LENGTH) {
      processedContent = processedContent.slice(0, MAX_CONTENT_LENGTH)
      truncated = true
    }

    const basePrompt = FORM_PROMPTS[formType as FormType]
    const systemPrompt = strictUnknowns
      ? `${basePrompt}

MODO ESTRICTO (obligatorio):
- NO inventes ni infieras hechos que no estén explícitos en la información.
- Si un campo no está respaldado por el texto, usa null, "" o [].
- Booleanos desconocidos: null.
- Nunca adivines ubicación, precios, horarios, demografía o garantías.`
      : basePrompt
    const userMessage = `INFORMACIÓN A ANALIZAR:\n${processedContent}`

    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${grokApiKey}`,
      },
      body: JSON.stringify({
        model: GROK_TEXT_MODEL_EFFICIENT,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Auto-fill Grok API error:', response.status, errorText)

      await logApiUsage({
        userId: user.id,
        userEmail: user.email,
        feature: 'paste_organize',
        model: GROK_TEXT_MODEL_EFFICIENT,
        success: false,
        errorMessage: `Grok ${response.status}: ${errorText.slice(0, 200)}`,
        metadata: { formType },
      })

      if (response.status === 429) {
        return res.status(429).json({
          error: 'ai_rate_limit',
          message: 'El servicio de IA está ocupado. Intenta de nuevo en unos segundos.',
          messageEn: 'AI service is busy. Try again in a few seconds.',
        })
      }

      return res.status(502).json({
        error: 'ai_error',
        message: 'Error al procesar con IA. Intenta de nuevo.',
        messageEn: 'AI processing error. Please try again.',
      })
    }

    const data = await response.json()
    const aiContent = data.choices?.[0]?.message?.content

    if (!aiContent) {
      await logApiUsage({
        userId: user.id,
        userEmail: user.email,
        feature: 'paste_organize',
        model: GROK_TEXT_MODEL_EFFICIENT,
        success: false,
        errorMessage: 'Empty AI response',
        metadata: { formType },
      })

      return res.status(502).json({
        error: 'empty_response',
        message: 'La IA no generó una respuesta. Intenta con información más clara.',
        messageEn: 'AI did not generate a response. Try with clearer information.',
      })
    }

    // Extract JSON from AI response
    const jsonMatch = aiContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('Auto-fill: No JSON found in AI response:', aiContent.slice(0, 500))

      await logApiUsage({
        userId: user.id,
        userEmail: user.email,
        feature: 'paste_organize',
        model: GROK_TEXT_MODEL_EFFICIENT,
        success: false,
        errorMessage: 'No JSON in response',
        metadata: { formType, responsePreview: aiContent.slice(0, 200) },
      })

      return res.status(422).json({
        error: 'parse_error',
        message: 'No se pudo extraer información estructurada. Intenta con un texto más claro.',
        messageEn: 'Could not extract structured information. Try with clearer text.',
      })
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      console.error('Auto-fill: JSON parse failed:', jsonMatch[0].slice(0, 500))

      await logApiUsage({
        userId: user.id,
        userEmail: user.email,
        feature: 'paste_organize',
        model: GROK_TEXT_MODEL_EFFICIENT,
        success: false,
        errorMessage: 'JSON parse failed',
        metadata: { formType },
      })

      return res.status(422).json({
        error: 'parse_error',
        message: 'No se pudo interpretar la respuesta de la IA. Intenta de nuevo.',
        messageEn: 'Could not interpret AI response. Please try again.',
      })
    }

    // Log successful usage
    const usage = data.usage || {}
    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'paste_organize',
      model: GROK_TEXT_MODEL_EFFICIENT,
      inputTokens: usage.prompt_tokens || estimateTokens(systemPrompt + userMessage),
      outputTokens: usage.completion_tokens || estimateTokens(aiContent),
      success: true,
      metadata: { formType, truncated, originalLength: content.length },
    })

    return res.status(200).json({
      data: parsed,
      truncated,
    })
  } catch (error) {
    console.error('Auto-fill API error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'paste_organize',
      model: GROK_TEXT_MODEL_EFFICIENT,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    })

    return res.status(500).json({
      error: 'server_error',
      message: 'Error interno del servidor. Intenta de nuevo.',
      messageEn: 'Internal server error. Please try again.',
    })
  }
}
