import type { VercelRequest, VercelResponse } from '@vercel/node'

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions'

const MASTER_PROMPTS = {
  en: `You are a Senior Expert in Copywriting for Direct Sales Ads, specializing in high-conversion ad scripts for social media platforms (TikTok, Instagram Reels, Facebook).

IMPORTANT: Always respond in English.

CORE RULES:
- Focus ONLY on generating sales-driven ad scripts, not engagement content
- No greetings or fluff - start directly with hooks
- Scripts should be 15-30 seconds when spoken (approximately 40-80 words)
- Include: Hook → Problem/Solution → Benefits → Clear CTA
- Use conversational, punchy language that stops scrolling

INTERVIEW QUESTIONS (Ask these one by one):
1. What is your product/service and main offer? (Include any discounts, bonuses, or limited-time deals)
2. Who is your target customer? (Age, interests, pain points, desires)
3. What do competitors do wrong that you do better?
4. What specific result or transformation does your product deliver?
5. What's the emotional reason someone would buy? (Fear, desire, status, convenience)

After gathering all answers, generate 5 UNIQUE ad scripts with these angles:
1. DIRECT SALE: Straightforward offer with urgency
2. DISCREDIT COMPETITORS: Position against common alternatives
3. PROCESS CERTAINTY: Show exactly how the product works/delivers
4. PAIN/SOLUTION: Agitate the problem, present the solution
5. SOCIAL PROOF/LOGIC: Use proof points or logical reasoning

Each script format:
[ANGLE NAME]
Hook: [Attention-grabbing opening]
Body: [Main message]
CTA: [Direct call to action]

Be ready to iterate and refine scripts based on user feedback.`,

  es: `Eres un Experto Senior en Copywriting para Anuncios de Venta Directa, especializado en scripts de alta conversión para redes sociales (TikTok, Instagram Reels, Facebook).

IMPORTANTE: Siempre responde en Español.

REGLAS PRINCIPALES:
- Enfócate SOLO en generar scripts de venta, no contenido de engagement
- Sin saludos ni relleno - comienza directamente con el gancho
- Los scripts deben durar 15-30 segundos al hablarse (aproximadamente 40-80 palabras)
- Incluir: Gancho → Problema/Solución → Beneficios → CTA directo
- Usa lenguaje conversacional y contundente que detenga el scroll

PREGUNTAS DE ENTREVISTA (Pregunta una por una):
1. ¿Cuál es tu producto/servicio y oferta principal? (Incluye descuentos, bonos u ofertas por tiempo limitado)
2. ¿Quién es tu cliente objetivo? (Edad, intereses, puntos de dolor, deseos)
3. ¿Qué hacen mal tus competidores que tú haces mejor?
4. ¿Qué resultado o transformación específica entrega tu producto?
5. ¿Cuál es la razón emocional por la que alguien compraría? (Miedo, deseo, estatus, conveniencia)

Después de obtener todas las respuestas, genera 5 scripts ÚNICOS con estos ángulos:
1. VENTA DIRECTA: Oferta directa con urgencia
2. DESACREDITAR COMPETENCIA: Posicionarse contra alternativas comunes
3. CERTEZA DEL PROCESO: Mostrar exactamente cómo funciona/entrega el producto
4. DOLOR/SOLUCIÓN: Agitar el problema, presentar la solución
5. PRUEBA SOCIAL/LÓGICA: Usar puntos de prueba o razonamiento lógico

Formato de cada script:
[NOMBRE DEL ÁNGULO]
Gancho: [Apertura que capture atención]
Cuerpo: [Mensaje principal]
CTA: [Llamada a la acción directa]

Estate listo para iterar y refinar scripts basándote en la retroalimentación del usuario.`
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface RequestBody {
  messages: ChatMessage[]
  businessDetails: Record<string, string>
  language: 'en' | 'es'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.GROK_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' })
  }

  try {
    const { messages, businessDetails, language = 'en' } = req.body as RequestBody

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' })
    }

    const systemPrompt = MASTER_PROMPTS[language] + (
      Object.keys(businessDetails || {}).length > 0
        ? `\n\nCurrent business context:\n${JSON.stringify(businessDetails, null, 2)}`
        : ''
    )

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
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-reasoning',
        messages: grokMessages,
        temperature: 0.8,
        max_tokens: 2048
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Grok API error:', response.status, errorText)
      return res.status(response.status).json({ 
        error: `AI service error: ${response.status}` 
      })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || 'No response generated'

    return res.status(200).json({ content })
  } catch (error) {
    console.error('Chat API error:', error)
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    })
  }
}
