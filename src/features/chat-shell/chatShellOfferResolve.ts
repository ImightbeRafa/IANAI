const QUICK_POST_PRODUCT_NAME = 'Quick Use Image Studio'

export const OFFER_PICK_PREFIX = 'advance:offer-pick:'

export interface OfferPickPayload {
  originalText: string
  productIds: string[]
}

export interface NamedOffer {
  id: string
  name: string
}

export type ResolveSendOfferResult =
  | { action: 'use-attached' }
  | { action: 'attach'; productId: string }
  | { action: 'ask'; products: NamedOffer[] }
  | { action: 'none' }

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function realBrandOffers<T extends { id: string; name: string }>(products: T[]): T[] {
  return products.filter((product) => product.name !== QUICK_POST_PRODUCT_NAME)
}

export function matchOfferFromText<T extends NamedOffer>(text: string, products: T[]): T | null {
  const needle = normalizeName(text)
  if (!needle) return null
  const numbered = needle.match(/^(\d{1,2})\b/)
  if (numbered) {
    const index = Number(numbered[1]) - 1
    if (index >= 0 && index < products.length) return products[index]
  }
  const hits = products.filter((product) => {
    const name = normalizeName(product.name)
    return name.length >= 2 && (needle.includes(name) || name.includes(needle))
  })
  return hits.length === 1 ? hits[0] : null
}

export function encodeOfferPick(payload: OfferPickPayload): string {
  return OFFER_PICK_PREFIX + JSON.stringify(payload)
}

export function decodeOfferPick(systemPrompt: string | null | undefined): OfferPickPayload | null {
  if (!systemPrompt || !systemPrompt.startsWith(OFFER_PICK_PREFIX)) return null
  try {
    const parsed = JSON.parse(systemPrompt.slice(OFFER_PICK_PREFIX.length)) as OfferPickPayload
    if (!parsed || typeof parsed.originalText !== 'string' || !Array.isArray(parsed.productIds)) return null
    return parsed
  } catch {
    return null
  }
}

export function resolveSendOffer(options: {
  attachedCount: number
  products: NamedOffer[]
  text: string
}): ResolveSendOfferResult {
  if (options.attachedCount > 0) return { action: 'use-attached' }
  const products = realBrandOffers(options.products)
  if (products.length === 0) return { action: 'none' }
  if (products.length === 1) return { action: 'attach', productId: products[0].id }
  const matched = matchOfferFromText(options.text, products)
  if (matched) return { action: 'attach', productId: matched.id }
  return { action: 'ask', products }
}

export function offerPickQuestion(products: NamedOffer[], language: 'en' | 'es'): string {
  const list = products.map((product, index) => `${index + 1}. ${product.name}`).join('\n')
  if (language === 'es') {
    return `Hay varias ofertas. ¿Cuál uso para este pedido?\n${list}\nEscribí el número o el nombre.`
  }
  return `There are several offers. Which one should I use for this request?\n${list}\nType the number or the name.`
}
