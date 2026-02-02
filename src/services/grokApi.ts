import type { BusinessDetails, Message } from '../types'
import type { Language } from '../contexts/LanguageContext'

interface ApiResponse {
  content?: string
  error?: string
}

export async function sendMessageToGrok(
  messages: Message[],
  businessDetails: BusinessDetails,
  language: Language = 'en'
): Promise<string> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      businessDetails,
      language
    })
  })

  const data: ApiResponse = await response.json()

  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`)
  }

  return data.content || 'No response generated'
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
