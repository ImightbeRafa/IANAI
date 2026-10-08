/**
 * Category, Spanish register and language detection for Brand DNA.
 * Heuristics first (free, deterministic); the LLM fallback is only used when
 * keywords are inconclusive.
 */

import type { AdLanguage, BrandDna, BusinessCategory, ModelGateway } from '../types.js'

const CATEGORIES: BusinessCategory[] = [
  'beauty', 'health_wellness', 'food_beverage', 'fashion_apparel', 'home_garden', 'tech_electronics',
  'fitness_sports', 'pets', 'kids_baby', 'services_local', 'education', 'finance', 'other',
]

/** Keyword stems per category (accent-free, lowercase). */
const CATEGORY_KEYWORDS: Record<Exclude<BusinessCategory, 'other'>, string[]> = {
  beauty: ['skincare', 'serum', 'crema facial', 'maquillaje', 'makeup', 'cosmetic', 'cosmetica', 'pestan', 'unas', 'nail', 'cabello', 'hair', 'shampoo', 'perfume', 'fragrance', 'labial', 'lipstick', 'piel', 'skin', 'belleza', 'beauty', 'spa', 'barberia', 'barber'],
  health_wellness: ['suplemento', 'supplement', 'vitamina', 'vitamin', 'colageno', 'collagen', 'probiotic', 'bienestar', 'wellness', 'salud', 'health', 'natural remedy', 'parche', 'patch', 'magnesio', 'ashwagandha', 'farmacia', 'pharmacy', 'clinica', 'clinic', 'dental', 'nutricion'],
  food_beverage: ['restaurante', 'restaurant', 'cafe', 'coffee', 'comida', 'food', 'menu', 'pizza', 'hamburguesa', 'burger', 'reposteria', 'bakery', 'panaderia', 'pasteles', 'cake', 'bebida', 'drink', 'cerveza', 'beer', 'vino', 'wine', 'salsa', 'snack', 'chocolate', 'jugo', 'juice', 'receta', 'recipe', 'gourmet'],
  fashion_apparel: ['ropa', 'clothing', 'apparel', 'camisa', 'shirt', 'vestido', 'dress', 'zapato', 'shoe', 'sneaker', 'tenis', 'jeans', 'moda', 'fashion', 'bolso', 'bag', 'joyeria', 'jewelry', 'accesorio', 'tallas', 'sizes', 'boutique', 'outfit'],
  home_garden: ['hogar', 'home decor', 'decoracion', 'mueble', 'furniture', 'cocina', 'kitchen', 'jardin', 'garden', 'plantas', 'plants', 'colchon', 'mattress', 'limpieza', 'cleaning', 'velas', 'candle', 'textil', 'sabanas'],
  tech_electronics: ['tecnologia', 'technology', 'electronic', 'electronica', 'celular', 'smartphone', 'laptop', 'computadora', 'audifonos', 'headphones', 'cargador', 'charger', 'gadget', 'software', 'app', 'saas', 'smartwatch', 'bluetooth'],
  fitness_sports: ['gimnasio', 'gym', 'fitness', 'entrenamiento', 'workout', 'crossfit', 'yoga', 'pilates', 'deporte', 'sport', 'running', 'proteina', 'protein', 'pesas', 'weights', 'ciclismo', 'cycling', 'futbol', 'soccer'],
  pets: ['mascota', 'pet', 'perro', 'dog', 'gato', 'cat', 'veterinari', 'vet', 'croquetas', 'alimento para perro', 'pet food', 'grooming'],
  kids_baby: ['bebe', 'baby', 'ninos', 'kids', 'infantil', 'juguete', 'toy', 'panal', 'diaper', 'maternidad', 'maternity', 'lactancia', 'nursery'],
  services_local: ['servicio', 'service', 'reparacion', 'repair', 'plomeria', 'plumbing', 'mecanico', 'taller', 'limpieza de casas', 'abogado', 'lawyer', 'contador', 'accountant', 'fotografia', 'photography', 'eventos', 'events', 'agencia', 'agency', 'citas', 'appointment', 'inmobiliaria', 'real estate', 'bienes raices'],
  education: ['curso', 'course', 'clases', 'classes', 'academia', 'academy', 'escuela', 'school', 'tutor', 'mentoria', 'mentorship', 'taller online', 'workshop', 'certificacion', 'idiomas', 'ingles', 'bootcamp', 'ebook'],
  finance: ['credito', 'credit', 'prestamo', 'loan', 'seguro', 'insurance', 'inversion', 'investment', 'banco', 'bank', 'finanzas', 'finance', 'hipoteca', 'mortgage', 'cripto', 'crypto', 'tarjeta de credito'],
}

function normalize(text: string): string {
  return ` ${text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ')} `
}

function countOccurrences(haystack: string, needle: string): number {
  const n = ` ${needle}`
  let count = 0
  let index = haystack.indexOf(n)
  while (index !== -1 && count < 20) {
    count += 1
    index = haystack.indexOf(n, index + n.length)
  }
  return count
}

export interface CategoryScore { category: BusinessCategory; score: number }

/** Keyword scores, best first. Each keyword counts at most 3 times. */
export function scoreCategories(text: string): CategoryScore[] {
  const hay = normalize(text)
  const scores: CategoryScore[] = []
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS) as Array<[BusinessCategory, string[]]>) {
    let score = 0
    for (const word of words) score += Math.min(3, countOccurrences(hay, word))
    if (score > 0) scores.push({ category, score })
  }
  return scores.sort((a, b) => b.score - a.score || CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category))
}

/** Deterministic keyword verdict, or null when inconclusive. */
export function heuristicCategory(text: string): BusinessCategory | null {
  const [top, second] = scoreCategories(text)
  if (!top || top.score < 2) return null
  if (second && top.score < second.score * 1.5) return null
  return top.category
}

export async function classifyCategory(input: {
  text: string
  gateway?: ModelGateway
  language?: AdLanguage
}): Promise<{ category: BusinessCategory; method: 'heuristic' | 'llm' | 'default'; costUsd: number }> {
  const heuristic = heuristicCategory(input.text)
  if (heuristic) return { category: heuristic, method: 'heuristic', costUsd: 0 }
  const top = scoreCategories(input.text)[0]
  if (!input.gateway || input.text.trim().length < 20) {
    return { category: top?.category || 'other', method: 'default', costUsd: 0 }
  }
  try {
    const result = await input.gateway.json<{ category?: string }>({
      system: `Classify the business into exactly one category. Reply JSON {"category": one of ${CATEGORIES.map((c) => `"${c}"`).join(', ')}}.`,
      user: input.text.slice(0, 4_000),
      maxTokens: 60,
      temperature: 0,
    })
    const raw = String(result.data?.category || '').trim() as BusinessCategory
    const category = CATEGORIES.includes(raw) ? raw : (top?.category || 'other')
    return { category, method: 'llm', costUsd: result.costUsd || 0 }
  } catch {
    return { category: top?.category || 'other', method: 'default', costUsd: 0 }
  }
}

// ---------------------------------------------------------------------------
// Language + register
// ---------------------------------------------------------------------------

const ES_WORDS = ['el', 'la', 'los', 'las', 'de', 'del', 'que', 'y', 'para', 'con', 'por', 'una', 'envio', 'envios', 'pedido', 'nuestro', 'nuestra', 'tu', 'tus', 'su', 'es', 'en', 'mas', 'aqui']
const EN_WORDS = ['the', 'and', 'for', 'with', 'your', 'our', 'you', 'shop', 'free', 'shipping', 'order', 'is', 'of', 'to', 'in', 'this', 'that', 'new', 'now', 'get']

export function detectLanguage(text: string): AdLanguage {
  const hay = normalize(text)
  let es = /[ñ¿¡áéíóú]/i.test(text) ? 3 : 0
  let en = 0
  for (const w of ES_WORDS) es += Math.min(5, countOccurrences(hay, `${w} `))
  for (const w of EN_WORDS) en += Math.min(5, countOccurrences(hay, `${w} `))
  return en > es * 1.2 ? 'en' : 'es'
}

/** Voseo verb forms (stressed final syllable) and pronoun. Accents required: they disambiguate. */
const VOSEO_RE = /(?:^|[^\p{L}])(vos|querés|tenés|podés|sabés|sos|pedí|pedilo|pedila|pedís|comprá|compralo|comprala|escribinos|escribí|aprovechá|hacé|vení|mirá|probá|probalo|elegí|conocé|descubrí|llevá|llevate|reservá|agendá|contanos|seguinos|consultá|encontrá|disfrutá|cuidá)(?=$|[^\p{L}])/giu
const TUTEO_RE = /(?:^|[^\p{L}])(tú|quieres|tienes|puedes|sabes|eres|pídelo|pídela|pide\s+(?:ya|ahora|el\s+tuyo|la\s+tuya)|cómpralo|cómprala|escríbenos|pruébalo|llévate|cuéntanos|síguenos|aprovecha|descubre|elige|disfruta|encuentra|te\s+(?:llega|ayuda|encantará|va|enviamos))(?=$|[^\p{L}])/giu
const USTED_RE = /(?:^|[^\p{L}])(usted|ustedes|contáctenos|escríbanos|llámenos|visítenos|consúltenos|adquiera|solicite|reserve|agende|le\s+ofrecemos|le\s+invitamos|le\s+atendemos|su\s+pedido|su\s+compra|su\s+hogar|su\s+empresa)(?=$|[^\p{L}])/giu

export type SpanishRegister = BrandDna['register']

export function detectCountryHint(text: string): 'CR' | 'AR' | 'UY' | null {
  if (/costa\s*rica|₡|\bsinpe\b|\bcolones\b|san\s+jos[eé]\b|heredia|alajuela|cartago|\+506/i.test(text)) return 'CR'
  if (/argentina|buenos\s+aires|\bcaba\b|mercado\s*pago|c[oó]rdoba|rosario|\+54\b/i.test(text)) return 'AR'
  if (/uruguay|montevideo|\+598/i.test(text)) return 'UY'
  return null
}

export function registerScores(text: string): { voseo: number; tuteo: number; usted: number } {
  return {
    voseo: [...text.matchAll(VOSEO_RE)].length,
    tuteo: [...text.matchAll(TUTEO_RE)].length,
    usted: [...text.matchAll(USTED_RE)].length,
  }
}

/**
 * voseo when voseo markers appear (or a CR/AR/UY hint with no other markers),
 * usted when formal markers dominate, else tuteo.
 */
export function detectRegister(text: string, countryHint?: string | null): SpanishRegister {
  const s = registerScores(text)
  if (s.voseo > 0 && s.voseo >= s.tuteo && s.voseo >= s.usted) return 'voseo'
  if (s.usted > 0 && s.usted > s.tuteo && s.usted > s.voseo) return 'usted'
  if (s.tuteo > 0) return 'tuteo'
  const hint = countryHint === undefined ? detectCountryHint(text) : countryHint
  if (hint && ['CR', 'AR', 'UY'].includes(hint.toUpperCase())) return 'voseo'
  return 'tuteo'
}
