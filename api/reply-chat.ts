import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, checkUsageLimit, incrementUsage } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { getMemoryInjection } from './lib/memory-helpers.js'
import { resolveBrandKit, buildBrandVoicePrompt } from './lib/brand-kit.js'

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const REPLY_SYSTEM_PROMPTS: Record<string, string> = {
  es: `ACTÚA COMO: Experto Senior en Comunicación Comercial y Atención al Cliente, especializado en ventas por mensajes (WhatsApp, Instagram DM, Facebook Messenger, email).

OBJETIVO: Generar la respuesta ÓPTIMA para que el usuario envíe a su cliente potencial. Tu meta es avanzar la conversación hacia el cierre de venta o la acción deseada.

===================================================================
FILOSOFÍA: RESPUESTAS QUE VENDEN
===================================================================
1. ANALIZA LA CONVERSACIÓN: Identifica en qué etapa está el cliente (curiosidad inicial, comparando opciones, objeción específica, listo para comprar, post-venta).
2. DETECTA EL TONO: Adapta la respuesta al nivel de formalidad y energía del cliente.
3. RESPONDE LA PREGUNTA DIRECTAMENTE: Nunca evadas. Si preguntan precio, da el precio. Si preguntan disponibilidad, confirma.
4. AGREGA VALOR: Después de responder, añade un dato que acerque al cierre (beneficio, prueba social, urgencia real).
5. CIERRA CON ACCIÓN: Termina con una pregunta o instrucción que mueva al siguiente paso.

===================================================================
REGLAS ESTRICTAS
===================================================================
- NUNCA generes saludos genéricos ("Hola, ¿cómo estás?") a menos que sea el primer contacto.
- NUNCA uses lenguaje robótico o corporativo. Escribe como persona real.
- SÉ CONCISO: Mensajes de WhatsApp/DM deben ser cortos y puntuales. Máximo 2-3 párrafos cortos.
- USA la información del negocio/producto para dar respuestas precisas y fundamentadas.
- Si el cliente tiene una objeción, abórdala directamente con datos concretos.
- Si el cliente está listo para comprar, facilita el proceso inmediatamente.
- RESPONDE SIEMPRE EN ESPAÑOL a menos que el cliente escriba en otro idioma.

===================================================================
FORMATO DE RESPUESTA
===================================================================
Genera SOLO el texto del mensaje que el usuario debe enviar. Sin explicaciones, sin títulos, sin formato especial. Solo el mensaje listo para copiar y pegar.

Si necesitas dar contexto adicional o sugerencias, ponlas DESPUÉS del mensaje principal, separadas por "---" y en cursiva.`,

  en: `ACT AS: Senior Expert in Commercial Communication and Customer Service, specialized in message-based sales (WhatsApp, Instagram DM, Facebook Messenger, email).

OBJECTIVE: Generate the OPTIMAL response for the user to send to their potential client. Your goal is to advance the conversation toward closing the sale or desired action.

===================================================================
PHILOSOPHY: RESPONSES THAT SELL
===================================================================
1. ANALYZE THE CONVERSATION: Identify the client's stage (initial curiosity, comparing options, specific objection, ready to buy, post-sale).
2. DETECT THE TONE: Match the response to the client's formality and energy level.
3. ANSWER THE QUESTION DIRECTLY: Never dodge. If they ask price, give the price. If they ask availability, confirm.
4. ADD VALUE: After answering, add a fact that moves toward closing (benefit, social proof, real urgency).
5. CLOSE WITH ACTION: End with a question or instruction that moves to the next step.

===================================================================
STRICT RULES
===================================================================
- NEVER generate generic greetings ("Hi, how are you?") unless it's first contact.
- NEVER use robotic or corporate language. Write like a real person.
- BE CONCISE: WhatsApp/DM messages should be short and to the point. Maximum 2-3 short paragraphs.
- USE the business/product information to give precise, well-founded responses.
- If the client has an objection, address it directly with concrete data.
- If the client is ready to buy, facilitate the process immediately.
- ALWAYS RESPOND IN ENGLISH unless the client writes in another language.

===================================================================
RESPONSE FORMAT
===================================================================
Generate ONLY the message text that the user should send. No explanations, no titles, no special formatting. Just the message ready to copy and paste.

If you need to provide additional context or suggestions, put them AFTER the main message, separated by "---" and in italics.`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  // Rate limit: 30 replies per 60 seconds
  const rateCheck = checkRateLimit(user.id, { maxRequests: 30, windowSeconds: 60 })
  if (!rateCheck.allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded', resetInSeconds: rateCheck.resetInSeconds })
  }

  // Usage limit check
  const { allowed, remaining, limit } = await checkUsageLimit(user.id, 'reply')
  if (!allowed) {
    return res.status(403).json({
      error: 'Reply limit reached for your plan',
      limit,
      remaining: 0
    })
  }

  const grokApiKey = process.env.GROK_API_KEY
  if (!grokApiKey) {
    return res.status(500).json({ error: 'Grok API key not configured' })
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Server not configured' })
  }

  try {
    const {
      messages,
      productId,
      language = 'es',
      sessionId
    } = req.body as {
      messages: Array<{ role: string; content: string }>
      productId: string
      language?: string
      sessionId?: string
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' })
    }

    if (!productId || typeof productId !== 'string') {
      return res.status(400).json({ error: 'productId is required' })
    }

    // Validate productId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(productId)) {
      return res.status(400).json({ error: 'Invalid productId format' })
    }

    // Limit message count to prevent prompt abuse
    if (messages.length > 100) {
      return res.status(400).json({ error: 'Too many messages. Maximum 100 per request.' })
    }

    // Validate messages
    for (const msg of messages) {
      if (!msg.content || typeof msg.content !== 'string') {
        return res.status(400).json({ error: 'Each message must have string content' })
      }
      if (msg.content.length > 50_000) {
        return res.status(400).json({ error: 'Message content too long' })
      }
      // Prevent role injection — only allow user and assistant roles
      if (!['user', 'assistant'].includes(msg.role)) {
        return res.status(400).json({ error: 'Invalid message role. Allowed: user, assistant' })
      }
    }

    // =============================================
    // 1. VERIFY PRODUCT OWNERSHIP + LOAD CONTEXT
    // =============================================
    // First verify the user owns this product (or is a collaborator)
    const { data: ownershipCheck } = await supabase
      .from('products')
      .select('id, owner_id')
      .eq('id', productId)
      .single()

    if (!ownershipCheck) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // Check direct ownership or collaborator access
    let hasAccess = ownershipCheck.owner_id === user.id
    if (!hasAccess) {
      const { data: collab } = await supabase
        .from('product_collaborators')
        .select('id')
        .eq('product_id', productId)
        .eq('user_id', user.id)
        .eq('status', 'accepted')
        .maybeSingle()
      hasAccess = !!collab
    }

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied to this product' })
    }

    // Now load full product context
    const { data: product } = await supabase
      .from('products')
      .select('*, business:businesses(*)')
      .eq('id', productId)
      .single()

    let businessContextPrompt = ''
    let productContextPrompt = ''

    if (product) {
      const isEs = language === 'es'

      // Build product context
      const productFields: string[] = []
      if (product.name) productFields.push(`${isEs ? 'Producto/Servicio' : 'Product/Service'}: ${product.name}`)
      if (product.product_description) productFields.push(`${isEs ? 'Descripción' : 'Description'}: ${product.product_description}`)
      if (product.price_range) productFields.push(`${isEs ? 'Rango de precios' : 'Price range'}: ${product.price_range}`)
      if (product.differentiation) productFields.push(`${isEs ? 'Diferenciación' : 'Differentiation'}: ${product.differentiation}`)
      if (product.key_objection) productFields.push(`${isEs ? 'Objeción principal' : 'Key objection'}: ${product.key_objection}`)
      if (product.expected_result) productFields.push(`${isEs ? 'Resultado esperado' : 'Expected result'}: ${product.expected_result}`)
      if (product.shipping_info) productFields.push(`${isEs ? 'Envío' : 'Shipping'}: ${product.shipping_info}`)
      if (product.has_guarantee && product.guarantee_details) productFields.push(`${isEs ? 'Garantía' : 'Guarantee'}: ${product.guarantee_details}`)
      // Service fields
      if (product.svc_concrete_result) productFields.push(`${isEs ? 'Resultado concreto' : 'Concrete result'}: ${product.svc_concrete_result}`)
      if (product.svc_result_timeline) productFields.push(`${isEs ? 'Tiempo de resultado' : 'Result timeline'}: ${product.svc_result_timeline}`)
      if (product.svc_process_steps) productFields.push(`${isEs ? 'Proceso' : 'Process'}: ${product.svc_process_steps}`)
      if (product.svc_main_objection) productFields.push(`${isEs ? 'Objeción principal' : 'Main objection'}: ${product.svc_main_objection}`)
      // Restaurant fields
      if (product.menu_text) productFields.push(`${isEs ? 'Menú' : 'Menu'}: ${product.menu_text}`)
      if (product.location) productFields.push(`${isEs ? 'Ubicación' : 'Location'}: ${product.location}`)
      if (product.schedule) productFields.push(`${isEs ? 'Horario' : 'Schedule'}: ${product.schedule}`)

      if (productFields.length > 0) {
        productContextPrompt = `\n\n${isEs ? '=== INFORMACIÓN DEL PRODUCTO/SERVICIO ===' : '=== PRODUCT/SERVICE INFORMATION ==='}\n${productFields.join('\n')}`
      }

      // Build business context
      const biz = product.business
      if (biz) {
        const bizFields: string[] = []
        if (biz.name) bizFields.push(`${isEs ? 'Negocio' : 'Business'}: ${biz.name}`)
        if (biz.location) bizFields.push(`${isEs ? 'Ubicación' : 'Location'}: ${biz.location}`)
        if (biz.sales_channels?.length) bizFields.push(`${isEs ? 'Canales de venta' : 'Sales channels'}: ${biz.sales_channels.join(', ')}`)
        if (biz.does_shipping) bizFields.push(`${isEs ? 'Hace envíos' : 'Does shipping'}: ${isEs ? 'Sí' : 'Yes'}${biz.shipping_method ? ` (${biz.shipping_method})` : ''}`)

        if (bizFields.length > 0) {
          businessContextPrompt = `\n\n${isEs ? '=== INFORMACIÓN DEL NEGOCIO ===' : '=== BUSINESS INFORMATION ==='}\n${bizFields.join('\n')}`
        }
      }
    }

    // =============================================
    // 2. LOAD REPLY CONTEXT SOURCES (knowledge base)
    // =============================================
    const { data: contextSources } = await supabase
      .from('reply_context_sources')
      .select('source_type, title, content')
      .eq('product_id', productId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    let contextSourcesPrompt = ''
    if (contextSources && contextSources.length > 0) {
      const isEs = language === 'es'
      const items = contextSources
        .filter(s => s.content)
        .map(s => `[${s.source_type.toUpperCase()}] ${s.title}:\n${s.content!.substring(0, 2000)}`)
        .join('\n\n')

      if (items) {
        contextSourcesPrompt = `\n\n${isEs ? '=== BASE DE CONOCIMIENTO ADICIONAL ===' : '=== ADDITIONAL KNOWLEDGE BASE ==='}\n${isEs ? 'Usa esta información para dar respuestas más precisas:' : 'Use this information to give more precise responses:'}\n${items}`
      }
    }

    // =============================================
    // 3. AI MEMORY INJECTION
    // =============================================
    let memoryPrompt = ''
    try {
      memoryPrompt = await getMemoryInjection(
        user.id,
        productId,
        language as 'es' | 'en'
      )
      if (memoryPrompt) {
        memoryPrompt = '\n\n' + memoryPrompt
      }
    } catch (e) {
      console.warn('Failed to load memory for reply:', e)
    }

    // =============================================
    // 3b. BRAND KIT INJECTION
    // =============================================
    const brandKitId = req.body.brandKitId as string | undefined
    let brandVoicePrompt = ''
    let resolvedBrandKit: Awaited<ReturnType<typeof resolveBrandKit>> = null
    try {
      resolvedBrandKit = await resolveBrandKit(user.id, brandKitId)
      if (resolvedBrandKit) {
        const bv = buildBrandVoicePrompt(resolvedBrandKit, language as 'es' | 'en')
        if (bv) brandVoicePrompt = '\n\n' + bv
      }
    } catch { /* ignore */ }

    // =============================================
    // 4. BUILD SYSTEM PROMPT
    // =============================================
    const lang = ['en', 'es'].includes(language) ? language : 'es'
    const systemPrompt = REPLY_SYSTEM_PROMPTS[lang] + businessContextPrompt + productContextPrompt + contextSourcesPrompt + memoryPrompt + brandVoicePrompt

    // =============================================
    // 5. GROK API CALL (with search_mode: "auto")
    // =============================================
    const grokMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))
    ]

    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${grokApiKey}`
      },
      body: JSON.stringify({
        model: 'grok-3-fast',
        messages: grokMessages,
        temperature: 0.7,
        max_tokens: 2048,
        search_mode: 'auto'
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Grok API error:', response.status, errorText)
      return res.status(response.status).json({ error: `Grok API error: ${response.status}` })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || 'No response generated'

    // =============================================
    // 6. LOG USAGE + INCREMENT COUNTER
    // =============================================
    const usage = data.usage || {}
    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'reply',
      model: 'grok-3-fast',
      inputTokens: usage.prompt_tokens || estimateTokens(systemPrompt + messages.map(m => m.content).join('')),
      outputTokens: usage.completion_tokens || estimateTokens(content),
      success: true,
      metadata: { productId, sessionId, hasWebSearch: !!data.search_results, brandKitId: resolvedBrandKit?.id, brandKitName: resolvedBrandKit?.name }
    })

    await incrementUsage(user.id, 'reply')

    return res.status(200).json({
      content,
      remaining: remaining - 1,
      searchResults: data.search_results || null
    })

  } catch (error) {
    console.error('Reply chat API error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'reply',
      model: 'grok-3-fast',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })

    return res.status(500).json({
      error: 'Failed to generate reply. Please try again.'
    })
  }
}
