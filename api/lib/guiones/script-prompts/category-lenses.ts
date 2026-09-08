import type { Language, ProductType } from '../types.js'

export function getCategoryLens(productType: ProductType, language: Language): string {
  const isEs = language === 'es'
  const lenses: Record<ProductType, string> = {
    product: isEs
      ? `LENTE PRODUCTO: el producto debe quedar claro desde la primera frase. Priorizá uso real, variaciones, specs, garantía, precio/logística y diferenciadores comprobables. Si faltan datos, omití ese hecho — no inventes ni uses corchetes.`
      : `PRODUCT LENS: the product must be clear in the first line. Prioritize real use, variations, specs, guarantee, price/logistics, and provable differentiators. If facts are missing, omit them — do not invent or use bracket placeholders.`,
    service: isEs
      ? `LENTE SERVICIO: volvé tangible lo intangible. Usá proceso, pasos, tiempos, entregables, método, garantía, casos y criterio profesional. No prometás resultados sin prueba.`
      : `SERVICE LENS: make the intangible tangible. Use process, steps, timing, deliverables, method, guarantee, cases, and professional criteria. Do not promise outcomes without proof.`,
    restaurant: isEs
      ? `LENTE RESTAURANTE: vendé platos reales del menú. Usá antojo, textura, porción, salsa, acompañamientos, horario y ubicación. No inventes platos; si falta un dato, omitilo.`
      : `RESTAURANT LENS: sell real menu items. Use craving, texture, portion, sauce, sides, schedule, and location. Do not invent dishes; omit missing quantities.`,
    real_estate: isEs
      ? `LENTE INMOBILIARIO: filtrá por precio, ubicación, tamaño, habitaciones, baños, parqueos, amenidades y referencia. Si falta precio, no lo inventes — omitilo.`
      : `REAL ESTATE LENS: filter by price, location, size, bedrooms, bathrooms, parking, amenities, and reference points. If price is missing, omit it — do not invent.`,
    indumentaria: isEs
      ? `LENTE INDUMENTARIA: vendé identidad y certeza. Usá material, tallas, modelos, uso real, cambios, personalización y calidad comprobable. No digas "premium" sin prueba.`
      : `APPAREL LENS: sell identity and certainty. Use material, sizes, models, real use, exchanges, customization, and provable quality. Do not say "premium" without proof.`,
  }
  return lenses[productType]
}
