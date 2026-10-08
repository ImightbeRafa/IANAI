/**
 * Ad Pack engine — generic best-practice pattern library for static paid-social ads.
 *
 * Distilled from widely documented public guidance (Meta / TikTok creative best
 * practices, classic direct-response conventions): mobile-first legibility, one
 * message per ad, product visible in the first glance, short headline, clear
 * offer, single direct CTA. Plain data + small helpers; nothing brand-specific.
 */
import type { AdFormat, AdLanguage, BusinessCategory, HookType, IanArchetype } from './types.js'

// ---------------------------------------------------------------------------
// Hard limits (shared by prompt, post-processing and checker)
// ---------------------------------------------------------------------------

export const COPY_LIMITS = {
  headlineWords: 6,
  headlineWordsExplainer: 8,
  headlineChars: 48,
  sublineWords: 12,
  maxBullets: 4,
  bulletWords: 4,
  ctaWords: 4,
  captionMinChars: 40,
  captionMaxChars: 600,
  offerLineChars: 70,
  sceneBriefMaxChars: 700,
  scriptHookWords: 20,
  scriptDevelopmentWords: 90,
  scriptCtaWords: 15,
} as const

export function headlineMaxWords(format: AdFormat): number {
  return format === 'explainer' ? COPY_LIMITS.headlineWordsExplainer : COPY_LIMITS.headlineWords
}

// ---------------------------------------------------------------------------
// Universal rules
// ---------------------------------------------------------------------------

export const UNIVERSAL_AD_RULES: Record<AdLanguage, string[]> = {
  es: [
    'Un solo mensaje por anuncio: un problema o deseo, una promesa, una acción.',
    'El producto real se ve claro y grande en la escena (idealmente en el primer tercio de atención).',
    'Si hay precio/oferta confirmados, se muestran visibles; si no, no se inventan.',
    `Titular de máximo ${COPY_LIMITS.headlineWords} palabras, legible en un celular a un vistazo.`,
    'CTA único, frío y directo (verbo de acción + qué pasa), sin "por favor".',
    'Sin saludos ni presentaciones; el texto empieza en el gancho.',
    'Poco texto en imagen: titular + subtítulo corto + hasta 4 chips cortos + oferta + CTA.',
    'Contraste alto texto/fondo, tipografía gruesa, zona de texto despejada en la escena.',
    'Habla al comprador en segunda persona y con el lenguaje que usan los clientes reales.',
  ],
  en: [
    'One message per ad: one problem or desire, one promise, one action.',
    'The real product is clearly visible and large in the scene (ideally in the first glance).',
    'If a price/offer is confirmed, show it; if not, never invent one.',
    `Headline of at most ${COPY_LIMITS.headlineWords} words, readable on a phone at a glance.`,
    'A single cold, direct CTA (action verb + what happens), no "please".',
    'No greetings or intros; copy starts at the hook.',
    'Little on-image text: headline + short subline + up to 4 short chips + offer + CTA.',
    'High text/background contrast, bold type, a clean text zone in the scene.',
    'Talk to the buyer in second person, using real customers\' language.',
  ],
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

export interface FormatPattern {
  /** Layout intent for copy + scene. */
  layout: Record<AdLanguage, string>
  /** What the scene should show (visual only, never text). */
  sceneIntent: string
  archetypes: IanArchetype[]
  hooks: HookType[]
  /** Recommended number of chips. */
  bullets: [min: number, max: number]
  /** Whether bullets are ordered steps. */
  bulletsAreSteps?: boolean
  needsPerson?: boolean
}

export const FORMAT_PATTERNS: Record<AdFormat, FormatPattern> = {
  offer_graphic: {
    layout: {
      es: 'Producto héroe a la derecha + titular grande arriba + 3 chips de beneficios tangibles a la izquierda + línea de precio/oferta destacada + CTA en botón.',
      en: 'Hero product on the right + big headline on top + 3 tangible benefit chips on the left + highlighted price/offer line + CTA button.',
    },
    sceneIntent: 'Hero product shot, product standing in the right half of the frame, clean uncluttered background in brand colors, calm empty space on the left and at the top for the overlay.',
    archetypes: ['venta_directa', 'desvalidar_alternativas', 'variedad_productos'],
    hooks: ['price_value', 'desire', 'pain', 'urgency_scarcity', 'objection', 'social_proof'],
    bullets: [2, 3],
  },
  before_after: {
    layout: {
      es: 'Pantalla dividida: izquierda "antes"/opción tradicional, derecha "después"/con el producto; titular corto arriba; disclaimer pequeño si aplica.',
      en: 'Split screen: left "before"/traditional option, right "after"/with the product; short headline on top; small disclaimer when required.',
    },
    sceneIntent: 'Split composition: left half shows the problem or the ordinary alternative, right half shows the product in use with the improved situation; same framing on both halves.',
    archetypes: ['desvalidar_alternativas', 'venta_directa'],
    hooks: ['comparison', 'pain', 'objection'],
    bullets: [0, 2],
  },
  how_to_steps: {
    layout: {
      es: '3–4 pasos numerados en columna o fila, cada uno con micro-texto de ≤4 palabras; producto visible; titular "en 3 pasos".',
      en: '3–4 numbered steps in a column or row, each with ≤4-word micro text; product visible; "in 3 steps" headline.',
    },
    sceneIntent: 'Product in the right part of the frame with the elements of its use laid out next to it on a tabletop; the left two thirds stay calm and low-detail for numbered step cards.',
    archetypes: ['paso_a_paso', 'mostrar_servicio'],
    hooks: ['routine', 'objection', 'curiosity', 'desire'],
    bullets: [3, 4],
    bulletsAreSteps: true,
  },
  variant_card: {
    layout: {
      es: 'Una variante (sabor/color/fórmula) destacada con su perfil ideal; color de fondo de la variante; chips de para quién es.',
      en: 'One variant (flavor/color/formula) featured with its ideal profile; variant-colored background; chips for who it is for.',
    },
    sceneIntent: 'Single product variant hero shot with props that express its flavor/color/profile, solid or gradient background matching the variant.',
    archetypes: ['variedad_productos', 'venta_directa'],
    hooks: ['identity', 'desire', 'curiosity', 'routine'],
    bullets: [2, 3],
  },
  ugc_person: {
    layout: {
      es: 'Persona real sosteniendo/usando el producto, estética de celular; caption mínimo tipo comentario de cliente; CTA pequeño.',
      en: 'Real person holding/using the product, phone-shot aesthetic; minimal customer-comment style caption; small CTA.',
    },
    sceneIntent: 'Authentic phone-camera photo of a person in an everyday setting holding or using the product, natural light, product label facing camera.',
    archetypes: ['venta_directa', 'mostrar_servicio'],
    hooks: ['social_proof', 'pain', 'identity', 'desire', 'objection'],
    bullets: [0, 2],
    needsPerson: true,
  },
  handheld_overlay: {
    layout: {
      es: 'Producto en mano en contexto de uso (lifestyle), una sola línea grande y en negrita; CTA abajo.',
      en: 'Product in hand in a usage context (lifestyle), one big bold line; CTA at the bottom.',
    },
    sceneIntent: 'Close-up of a hand holding the product in a real-life context where it is used, shallow depth of field, clean area for one bold line.',
    archetypes: ['venta_directa', 'desvalidar_alternativas'],
    hooks: ['pain', 'desire', 'curiosity', 'identity', 'urgency_scarcity'],
    bullets: [0, 1],
  },
  explainer: {
    layout: {
      es: 'Infografía "qué es / cómo funciona": producto al centro con 3–4 llamadas a sus partes, ingredientes o mecanismo; titular de hasta 8 palabras.',
      en: '"What it is / how it works" infographic: product in the center with 3–4 callouts to its parts, ingredients or mechanism; headline up to 8 words.',
    },
    sceneIntent: 'Product centered on a clean background with its key ingredients/materials/parts arranged around it, room for callout lines.',
    archetypes: ['desvalidar_alternativas', 'mostrar_servicio', 'venta_directa'],
    hooks: ['curiosity', 'comparison', 'objection', 'routine'],
    bullets: [3, 4],
  },
}

export const ALL_FORMATS: AdFormat[] = Object.keys(FORMAT_PATTERNS) as AdFormat[]
export const ALL_ARCHETYPES: IanArchetype[] = [
  'venta_directa',
  'desvalidar_alternativas',
  'mostrar_servicio',
  'variedad_productos',
  'paso_a_paso',
]
export const ALL_HOOKS: HookType[] = [
  'pain',
  'desire',
  'objection',
  'social_proof',
  'comparison',
  'price_value',
  'urgency_scarcity',
  'curiosity',
  'routine',
  'identity',
]

export function getFormatPattern(format: AdFormat): FormatPattern {
  return FORMAT_PATTERNS[format]
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CategoryPattern {
  /** Formats in order of preference. */
  formats: AdFormat[]
  /** Hook types in order of preference. */
  hooks: HookType[]
  /** Archetypes in order of preference. */
  archetypes: IanArchetype[]
  notes: string
}

export const CATEGORY_PATTERNS: Record<BusinessCategory, CategoryPattern> = {
  beauty: {
    formats: ['offer_graphic', 'ugc_person', 'explainer', 'how_to_steps', 'before_after', 'variant_card', 'handheld_overlay'],
    hooks: ['pain', 'routine', 'social_proof', 'desire', 'objection', 'curiosity', 'price_value', 'identity'],
    archetypes: ['venta_directa', 'mostrar_servicio', 'desvalidar_alternativas', 'variedad_productos', 'paso_a_paso'],
    notes: 'Textures, routine steps and real-skin UGC outperform glossy claims; never guarantee results.',
  },
  health_wellness: {
    formats: ['explainer', 'offer_graphic', 'how_to_steps', 'handheld_overlay', 'ugc_person', 'variant_card'],
    hooks: ['routine', 'curiosity', 'desire', 'objection', 'comparison', 'identity', 'price_value'],
    archetypes: ['venta_directa', 'desvalidar_alternativas', 'paso_a_paso', 'variedad_productos', 'mostrar_servicio'],
    notes: 'Ingredient/process transparency and routines; no disease, weight-loss or body-image claims.',
  },
  food_beverage: {
    formats: ['offer_graphic', 'variant_card', 'handheld_overlay', 'ugc_person', 'explainer', 'how_to_steps'],
    hooks: ['desire', 'identity', 'price_value', 'curiosity', 'routine', 'social_proof', 'comparison'],
    archetypes: ['variedad_productos', 'venta_directa', 'desvalidar_alternativas', 'paso_a_paso', 'mostrar_servicio'],
    notes: 'Appetite appeal first: close-ups, texture, abundance; menus/flavors help self-selection.',
  },
  fashion_apparel: {
    formats: ['ugc_person', 'variant_card', 'offer_graphic', 'handheld_overlay', 'explainer', 'how_to_steps'],
    hooks: ['identity', 'desire', 'objection', 'price_value', 'social_proof', 'curiosity'],
    archetypes: ['variedad_productos', 'venta_directa', 'desvalidar_alternativas', 'paso_a_paso'],
    notes: 'Worn-on-body shots and fit/size certainty; sizing and returns kill the top objection.',
  },
  home_garden: {
    formats: ['before_after', 'how_to_steps', 'offer_graphic', 'explainer', 'handheld_overlay', 'ugc_person'],
    hooks: ['pain', 'comparison', 'routine', 'desire', 'price_value', 'objection'],
    archetypes: ['desvalidar_alternativas', 'venta_directa', 'paso_a_paso', 'mostrar_servicio', 'variedad_productos'],
    notes: 'Visible problem → solved state (cleaning, organizing) works; show scale and materials.',
  },
  tech_electronics: {
    formats: ['explainer', 'offer_graphic', 'handheld_overlay', 'ugc_person', 'variant_card', 'how_to_steps'],
    hooks: ['price_value', 'comparison', 'objection', 'curiosity', 'pain', 'desire'],
    archetypes: ['venta_directa', 'desvalidar_alternativas', 'variedad_productos', 'paso_a_paso'],
    notes: 'Specs as tangible outcomes, price vs store, warranty to remove risk.',
  },
  fitness_sports: {
    formats: ['ugc_person', 'how_to_steps', 'offer_graphic', 'handheld_overlay', 'explainer', 'variant_card'],
    hooks: ['identity', 'routine', 'pain', 'desire', 'objection', 'social_proof'],
    archetypes: ['venta_directa', 'paso_a_paso', 'desvalidar_alternativas', 'variedad_productos', 'mostrar_servicio'],
    notes: 'Performance and routine, real use in training; no body-transformation promises.',
  },
  pets: {
    formats: ['ugc_person', 'offer_graphic', 'handheld_overlay', 'explainer', 'variant_card', 'how_to_steps'],
    hooks: ['identity', 'pain', 'desire', 'routine', 'objection', 'social_proof'],
    archetypes: ['venta_directa', 'desvalidar_alternativas', 'variedad_productos', 'paso_a_paso'],
    notes: 'Pet in frame with the product; owner identity and pet comfort; no veterinary cure claims.',
  },
  kids_baby: {
    formats: ['offer_graphic', 'explainer', 'ugc_person', 'how_to_steps', 'handheld_overlay', 'variant_card'],
    hooks: ['objection', 'routine', 'pain', 'desire', 'identity', 'comparison'],
    archetypes: ['venta_directa', 'desvalidar_alternativas', 'paso_a_paso', 'variedad_productos'],
    notes: 'Safety/materials certainty for parents; calm, real routines; no medical claims.',
  },
  services_local: {
    formats: ['how_to_steps', 'ugc_person', 'offer_graphic', 'explainer', 'before_after', 'handheld_overlay'],
    hooks: ['pain', 'objection', 'price_value', 'curiosity', 'social_proof', 'identity'],
    archetypes: ['mostrar_servicio', 'venta_directa', 'paso_a_paso', 'desvalidar_alternativas'],
    notes: 'Show the process start to finish and the location/area; free valuation CTA if confirmed.',
  },
  education: {
    formats: ['explainer', 'offer_graphic', 'how_to_steps', 'ugc_person', 'handheld_overlay'],
    hooks: ['identity', 'pain', 'desire', 'objection', 'curiosity', 'price_value'],
    archetypes: ['venta_directa', 'paso_a_paso', 'mostrar_servicio', 'desvalidar_alternativas'],
    notes: 'Concrete outcome of the course (skill, schedule, format); no income/job guarantees.',
  },
  finance: {
    formats: ['explainer', 'how_to_steps', 'offer_graphic', 'ugc_person', 'handheld_overlay'],
    hooks: ['objection', 'pain', 'curiosity', 'routine', 'comparison', 'identity'],
    archetypes: ['paso_a_paso', 'venta_directa', 'desvalidar_alternativas', 'mostrar_servicio'],
    notes: 'Transparency (fees, steps, requirements); never guaranteed returns or risk-free claims.',
  },
  other: {
    formats: ['offer_graphic', 'handheld_overlay', 'explainer', 'ugc_person', 'how_to_steps', 'variant_card', 'before_after'],
    hooks: ['pain', 'desire', 'objection', 'curiosity', 'price_value', 'identity', 'routine', 'comparison'],
    archetypes: ['venta_directa', 'desvalidar_alternativas', 'paso_a_paso', 'variedad_productos', 'mostrar_servicio'],
    notes: 'Generic direct-response defaults.',
  },
}

export function getCategoryPattern(category: BusinessCategory): CategoryPattern {
  return CATEGORY_PATTERNS[category] ?? CATEGORY_PATTERNS.other
}

/** 0 = best. Items not listed get `list.length`. */
export function preferenceRank<T>(list: readonly T[], item: T): number {
  const i = list.indexOf(item)
  return i < 0 ? list.length : i
}

/** Prompt block: universal rules + format layout intent. */
export function formatGuidance(format: AdFormat, language: AdLanguage): string {
  const p = FORMAT_PATTERNS[format]
  const head = language === 'es' ? 'FORMATO' : 'FORMAT'
  const chips = language === 'es' ? 'Chips recomendados' : 'Recommended chips'
  return [
    `${head}: ${format} — ${p.layout[language]}`,
    `${chips}: ${p.bullets[0]}–${p.bullets[1]}${p.bulletsAreSteps ? (language === 'es' ? ' (pasos en orden)' : ' (ordered steps)') : ''}`,
  ].join('\n')
}
