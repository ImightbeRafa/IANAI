import type { Message } from '../types'

type Language = 'en' | 'es'

export interface ProductContext {
  product_name?: string
  product_description?: string
  offer?: string
  awareness_level?: string
  market_alternatives?: string
  customer_values?: string
  purchase_reason?: string
  target_audience?: string
  call_to_action?: string
  additional_context?: string
}

export async function sendMessageToGrok(
  messages: Message[],
  productContext: ProductContext,
  language: Language = 'es'
): Promise<string> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      businessDetails: productContext,
      language
    })
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`)
  }

  return data.content || 'No response generated'
}

export function getInitialPrompt(language: Language = 'es'): string {
  if (language === 'en') {
    return `Let's create high-converting ad scripts for your business. I'll ask you a few quick questions to understand your product.

What product or service do you sell and what's your irresistible offer?`
  }
  return `Vamos a crear guiones de venta de alta conversión para tu negocio. Te haré algunas preguntas rápidas para entender tu producto.

¿Qué producto o servicio vendes y cuál es tu oferta irresistible?`
}
