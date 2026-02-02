import type { BusinessDetails, Message } from '../types'
import type { Language } from '../contexts/LanguageContext'

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions'
const GROK_API_KEY = import.meta.env.VITE_GROK_API_KEY

const MASTER_PROMPTS: Record<Language, string> = {
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

interface GrokMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface GrokResponse {
  choices: {
    message: {
      content: string
    }
  }[]
}

export async function sendMessageToGrok(
  messages: Message[],
  businessDetails: BusinessDetails,
  language: Language = 'en'
): Promise<string> {
  if (!GROK_API_KEY) {
    throw new Error('Grok API key not configured. Please set VITE_GROK_API_KEY in your .env file.')
  }

  const systemMessage: GrokMessage = {
    role: 'system',
    content: MASTER_PROMPTS[language] + (Object.keys(businessDetails).length > 0 
      ? `\n\nCurrent business context:\n${JSON.stringify(businessDetails, null, 2)}`
      : '')
  }

  const grokMessages: GrokMessage[] = [
    systemMessage,
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))
  ]

  const response = await fetch(GROK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'grok-4-1-fast-reasoning',
      messages: grokMessages,
      temperature: 0.8,
      max_tokens: 2048
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Grok API error: ${response.status} - ${error}`)
  }

  const data: GrokResponse = await response.json()
  return data.choices[0]?.message?.content || 'No response generated'
}

export function getInitialPrompt(language: Language = 'en'): string {
  if (language === 'es') {
    return `¡Vamos a crear scripts de anuncios de alta conversión para tu negocio! Te haré 5 preguntas rápidas para entender tu producto y audiencia, luego generaré 5 scripts únicos con diferentes ángulos.

**Pregunta 1 de 5:**
¿Cuál es tu producto o servicio y cuál es tu oferta principal? (Incluye descuentos, bonos u ofertas por tiempo limitado si aplica)`
  }
  return `Let's create some high-converting ad scripts for your business! I'll ask you 5 quick questions to understand your product and audience, then generate 5 unique ad scripts with different angles.

**Question 1 of 5:**
What is your product or service, and what's your main offer? (Include any discounts, bonuses, or limited-time deals if applicable)`
}

export const INTERVIEW_QUESTIONS: Record<Language, string[]> = {
  en: [
    "What is your product or service, and what's your main offer? (Include any discounts, bonuses, or limited-time deals if applicable)",
    "Who is your target customer? Tell me about their age range, interests, main pain points, and desires.",
    "What do your competitors do wrong that you do better? What makes your solution unique?",
    "What specific result or transformation does your product deliver? What can customers expect?",
    "What's the emotional reason someone would buy from you? (Think: fear of missing out, desire for status, need for convenience, etc.)"
  ],
  es: [
    "¿Cuál es tu producto o servicio y cuál es tu oferta principal? (Incluye descuentos, bonos u ofertas por tiempo limitado si aplica)",
    "¿Quién es tu cliente objetivo? Cuéntame sobre su rango de edad, intereses, principales puntos de dolor y deseos.",
    "¿Qué hacen mal tus competidores que tú haces mejor? ¿Qué hace única tu solución?",
    "¿Qué resultado o transformación específica entrega tu producto? ¿Qué pueden esperar los clientes?",
    "¿Cuál es la razón emocional por la que alguien compraría de ti? (Piensa: miedo a perderse algo, deseo de estatus, necesidad de conveniencia, etc.)"
  ]
}
