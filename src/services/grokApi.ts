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

export function getInitialPrompt(language: Language = 'es'): string {
  if (language === 'en') {
    return `Let's create high-converting ad scripts for your business. I'll ask you 5 strategic questions to understand your product and audience, then generate 5 unique scripts with different angles.

**Question 1 of 5:**
What product or service do you sell and what's your irresistible offer?`
  }
  return `Vamos a crear guiones de venta de alta conversión para tu negocio. Te haré 5 preguntas estratégicas para entender tu producto y audiencia, luego generaré 5 guiones únicos con diferentes ángulos.

**Pregunta 1 de 5:**
¿Qué producto o servicio vendes y cuál es tu oferta irresistible?`
}

export const INTERVIEW_QUESTIONS: Record<Language, string[]> = {
  es: [
    "¿Qué producto o servicio vendes y cuál es tu oferta irresistible?",
    "¿Cuál es el nivel de conciencia de tu cliente ideal? (¿Sabe que tiene el problema? ¿Conoce tu solución?)",
    "¿Qué otras opciones existen en el mercado y qué desventajas tienen comparadas contigo? (Sé específico sobre por qué la competencia es peor)",
    "¿Qué es lo que MÁS valora tu cliente (Precio, rapidez, calidad, estatus)?",
    "¿Por qué el cliente compra tu producto/servicio realmente? (La razón emocional o profunda)"
  ],
  en: [
    "What product or service do you sell and what's your irresistible offer?",
    "What's the awareness level of your ideal customer? (Do they know they have the problem? Do they know your solution?)",
    "What other options exist in the market and what disadvantages do they have compared to you? (Be specific about why the competition is worse)",
    "What does your customer value MOST (Price, speed, quality, status)?",
    "Why does the customer really buy your product/service? (The emotional or deep reason)"
  ]
}
