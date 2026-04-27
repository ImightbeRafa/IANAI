import type { Language, ProductType } from '../types.js'

export function getCategoryLens(productType: ProductType, language: Language): string {
  const isEs = language === 'es'
  const lenses: Record<ProductType, string> = {
    product: isEs
      ? `LENTE PRODUCTO: el producto debe quedar claro desde la primera frase. Prioriza uso real, variaciones, specs, garantia, precio/logistica y diferenciadores comprobables. Si faltan datos, usa placeholders especificos.`
      : `PRODUCT LENS: the product must be clear in the first line. Prioritize real use, variations, specs, guarantee, price/logistics, and provable differentiators. Use specific placeholders when facts are missing.`,
    service: isEs
      ? `LENTE SERVICIO: vuelve tangible lo intangible. Usa proceso, pasos, tiempos, entregables, metodo, garantia, casos y criterio profesional. No prometas resultados sin prueba o placeholder.`
      : `SERVICE LENS: make the intangible tangible. Use process, steps, timing, deliverables, method, guarantee, cases, and professional criteria. Do not promise outcomes without proof or placeholders.`,
    restaurant: isEs
      ? `LENTE RESTAURANTE: vende platos reales del menu. Usa antojo, textura, porcion, salsa, acompanamientos, horario y ubicacion. No inventes platos; si falta cantidad usa placeholders.`
      : `RESTAURANT LENS: sell real menu items. Use craving, texture, portion, sauce, sides, schedule, and location. Do not invent dishes; use placeholders when quantities are missing.`,
    real_estate: isEs
      ? `LENTE INMOBILIARIO: filtra por precio, ubicacion, tamano, habitaciones, banos, parqueos, amenidades y referencia. Si falta precio, usa [PRECIO] y no inventes.`
      : `REAL ESTATE LENS: filter by price, location, size, bedrooms, bathrooms, parking, amenities, and reference points. If price is missing, use [PRICE] and do not invent.`,
    indumentaria: isEs
      ? `LENTE INDUMENTARIA: vende identidad y certeza. Usa material, tallas, modelos, uso real, cambios, personalizacion y calidad comprobable. No digas "premium" sin prueba.`
      : `APPAREL LENS: sell identity and certainty. Use material, sizes, models, real use, exchanges, customization, and provable quality. Do not say "premium" without proof.`,
  }
  return lenses[productType]
}

