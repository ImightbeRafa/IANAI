import type { Product } from '../../types'
import type { ChatShellLanguage } from './chatShellScriptIntent'

/** Short assistant replies when the user chats without asking to generate. */
export function isCasualChatMessage(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/^(hey|hi|hello|hola|buenas|buen[oa]s|qué tal|que tal|sup|gracias|thanks|ok|dale|listo)\b/i.test(trimmed)) {
    return true
  }
  return trimmed.length <= 12 && !/\b(genera|guion|script|post|foto|logo|http|www\.)\b/i.test(trimmed)
}

export function buildChatShellConversationalReply(options: {
  text: string
  language: ChatShellLanguage
  hasOffer: boolean
  hasChannels?: boolean
  hasSources?: boolean
}): string {
  const es = options.language !== 'en'
  const trimmed = options.text.trim()
  const greeting = isCasualChatMessage(trimmed)

  const missing: string[] = []
  if (!options.hasOffer) missing.push(es ? 'la oferta' : 'an offer')
  if (options.hasChannels === false) missing.push(es ? 'los canales' : 'channels')
  if (options.hasSources === false) missing.push(es ? 'fuentes' : 'sources')

  if (!options.hasOffer) {
    if (greeting) {
      return es
        ? '¡Hey! Estoy listo — falta crear o confirmar una oferta para esta marca. Abrí Ofertas o contame qué vendés y la armamos.'
        : 'Hey! I’m ready — we still need an offer for this brand. Open Offers or tell me what you sell and we’ll set it up.'
    }
    return es
      ? 'Para generar guiones necesito una oferta en esta marca. Creala en el panel Ofertas o contame el producto/servicio.'
      : 'To generate scripts I need an offer on this brand. Create one in Offers or tell me the product/service.'
  }

  if (missing.length > 0 && missing[0] !== (es ? 'la oferta' : 'an offer')) {
    const list = missing.join(es ? ' y ' : ' and ')
    return es
      ? `¡Hey! Listo para un nuevo guion. Todavía falta configurar ${list} — tocá el setup o pedime guiones cuando quieras.`
      : `Hey! Ready for a new script. Still need to configure ${list} — tap setup or ask for scripts anytime.`
  }

  if (greeting) {
    return es
      ? '¡Hey! Listo para un nuevo guion. Pedime algo como “generame 2 de venta” o usá Guiones en el Brand Kit.'
      : 'Hey! Ready for a new script. Ask for something like “generate 2 direct sale” or use Scripts in the Brand Kit.'
  }

  return es
    ? 'Puedo ayudarte con guiones, posts o fotos. Decime qué querés crear, o pedí “generame un guion”.'
    : 'I can help with scripts, posts, or photos. Tell me what you want to create, or ask to “generate a script”.'
}

export function brandHasRealOffer(products: Product[]): boolean {
  return products.some((product) => product.name && product.name !== 'Quick Use Image Studio')
}
