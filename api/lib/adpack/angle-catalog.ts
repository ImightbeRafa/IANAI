/**
 * ONE angle catalog shared by the Ad Pack planner (`adpack_angles`, `adpack_start {angleIds}`)
 * and the bulk angle board (`guide_bulk_angles`).
 *
 * Angle id = `<category>-<hookType>-<format>` (e.g. `regalo-desire-handheld_overlay`). Ids are
 * stable: the same id always means the same category × hook × format, whatever the pack size,
 * so ids from guide_bulk_angles, adpack_angles or an agent can be passed to adpack_start.
 * Legacy planner ids (`a01-venta_directa-pain-offer_graphic`) are still understood.
 */
import type { AdFormat, AdLanguage, AngleCategory, BusinessCategory, FactKey, HookType, IanArchetype } from './types.js'

export type { AngleCategory }

export const ALL_ANGLE_CATEGORIES: AngleCategory[] = [
  'problema_solucion',
  'uso_real',
  'regalo',
  'como_funciona',
  'valor_precio',
  'unboxing',
  'detalle_tecnico',
  'comparacion',
  'temporada',
  'prueba_social',
]

export function isAngleCategory(v: unknown): v is AngleCategory {
  return typeof v === 'string' && (ALL_ANGLE_CATEGORIES as string[]).includes(v)
}

/** Facts/context the planner can see when deciding whether a category is honest for this offer. */
export interface CategoryContext {
  keys: Set<FactKey>
  category: BusinessCategory
  pains: number
  desires: number
  objections: number
  /** Owner campaign brief present (season / date context). */
  hasBrief: boolean
}

type Frame = (target: string) => string

export interface AngleCategorySpec {
  id: AngleCategory
  label: Record<AdLanguage, string>
  /** Hook types that express this category (first = primary). */
  hooks: HookType[]
  archetypes: IanArchetype[]
  /** Formats that show this category best (first = preferred). */
  formats: AdFormat[]
  /** Honest for this offer? (prueba_social only with verified proof, valor_precio only with a price…) */
  available(ctx: CategoryContext, relaxed: boolean): boolean
  /** Which DNA lists to pick the target from, in order. */
  targetPools: Array<'pains' | 'desires' | 'objections' | 'phrases' | 'audience'>
  /** Message opener (internal direction for the copy model, never on-image). */
  frame: Record<AdLanguage, Frame>
  /** Short "why this angle" (status / deliverable). */
  why: Record<AdLanguage, string>
  /** Scene direction for the image model (visual only, English, no text). */
  scene: string
}

const has = (ctx: CategoryContext, ...k: FactKey[]) => k.some((x) => ctx.keys.has(x))
const NON_PRODUCT: BusinessCategory[] = ['services_local', 'finance', 'education']
const isProduct = (ctx: CategoryContext) => !NON_PRODUCT.includes(ctx.category)

export const ANGLE_CATEGORIES: Record<AngleCategory, AngleCategorySpec> = {
  problema_solucion: {
    id: 'problema_solucion',
    label: { es: 'Problema → solución', en: 'Problem → solution' },
    hooks: ['pain', 'objection'],
    archetypes: ['venta_directa', 'desvalidar_alternativas'],
    formats: ['before_after', 'offer_graphic', 'handheld_overlay', 'how_to_steps'],
    available: (ctx, relaxed) => relaxed || ctx.pains > 0,
    targetPools: ['pains', 'phrases', 'objections'],
    frame: {
      es: (t) => `Del problema concreto ("${t}") a la solución que se ve en la imagen:`,
      en: (t) => `From the concrete problem ("${t}") to the solution shown in the image:`,
    },
    why: { es: 'nombra un dolor real del comprador y muestra la salida', en: "names a real buyer pain and shows the way out" },
    scene: 'the product solving the everyday situation, shown in the real place where the problem happens',
  },
  uso_real: {
    id: 'uso_real',
    label: { es: 'Uso real', en: 'Real use' },
    hooks: ['routine', 'identity', 'desire'],
    archetypes: ['venta_directa', 'mostrar_servicio', 'paso_a_paso'],
    formats: ['ugc_person', 'handheld_overlay', 'how_to_steps'],
    available: () => true,
    targetPools: ['audience', 'desires', 'pains'],
    frame: {
      es: (t) => `El producto en un momento real y reconocible de quien busca "${t}":`,
      en: (t) => `The product in a real, recognizable moment for people after "${t}":`,
    },
    why: { es: 'el comprador se ve usándolo en su día a día', en: 'the buyer pictures using it in their day' },
    scene: 'candid, real-life moment of the product in use by a person, natural light, lived-in setting',
  },
  regalo: {
    id: 'regalo',
    label: { es: 'Regalo', en: 'Gift' },
    hooks: ['desire', 'identity', 'urgency_scarcity'],
    archetypes: ['venta_directa', 'variedad_productos'],
    formats: ['handheld_overlay', 'offer_graphic', 'variant_card', 'ugc_person'],
    available: (ctx) => isProduct(ctx),
    targetPools: ['audience', 'desires'],
    frame: {
      es: (t) => `Para regalar: un obsequio que acierta con quien busca "${t}":`,
      en: (t) => `To give as a gift: a present that lands with people after "${t}":`,
    },
    why: { es: 'abre la compra a quien regala, no solo a quien lo usa', en: 'opens the sale to gift buyers, not only users' },
    scene: 'gift moment: the product being handed over or next to simple wrapping paper and a ribbon, warm light; the product itself unchanged and fully visible',
  },
  como_funciona: {
    id: 'como_funciona',
    label: { es: 'Cómo funciona', en: 'How it works' },
    hooks: ['curiosity', 'routine', 'objection'],
    archetypes: ['mostrar_servicio', 'paso_a_paso'],
    formats: ['how_to_steps', 'explainer'],
    available: (ctx, relaxed) => relaxed || has(ctx, 'how_it_works', 'usage_steps', 'ingredients_materials'),
    targetPools: ['objections', 'desires'],
    frame: {
      es: (t) => `Cómo funciona, en pasos simples, para quien duda "${t}":`,
      en: (t) => `How it works, in simple steps, for people who doubt "${t}":`,
    },
    why: { es: 'quita la duda de uso mostrando el mecanismo o los pasos', en: 'removes the how-do-I-use-it doubt by showing the steps' },
    scene: 'clear demonstration of the product in use, hands showing the key step, clean surface',
  },
  valor_precio: {
    id: 'valor_precio',
    label: { es: 'Valor / precio', en: 'Value / price' },
    hooks: ['price_value', 'urgency_scarcity', 'objection'],
    archetypes: ['venta_directa'],
    formats: ['offer_graphic', 'variant_card'],
    available: (ctx) => has(ctx, 'price', 'bundle'),
    targetPools: ['objections', 'desires'],
    frame: {
      es: (t) => `Lo que recibís por tu plata, para quien piensa "${t}":`,
      en: (t) => `What you get for the money, for people thinking "${t}":`,
    },
    why: { es: 'el precio confirmado es el argumento: valor claro y concreto', en: 'the confirmed price is the argument: clear, concrete value' },
    scene: 'hero product shot, crisp studio-quality light, the product and what comes with it clearly visible',
  },
  unboxing: {
    id: 'unboxing',
    label: { es: 'Qué incluye', en: "What's inside" },
    hooks: ['curiosity', 'desire'],
    archetypes: ['venta_directa', 'variedad_productos', 'mostrar_servicio'],
    formats: ['explainer', 'handheld_overlay', 'ugc_person', 'offer_graphic'],
    available: (ctx, relaxed) => isProduct(ctx) && (relaxed || has(ctx, 'quantity_per_pack', 'variants', 'ingredients_materials', 'differentiator')),
    targetPools: ['desires', 'phrases'],
    frame: {
      es: (t) => `Qué trae, pieza por pieza, para quien quiere "${t}":`,
      en: (t) => `What comes in it, piece by piece, for people who want "${t}":`,
    },
    why: { es: 'mostrar exactamente qué llega reduce la incertidumbre de compra', en: 'showing exactly what arrives reduces purchase uncertainty' },
    scene: 'unboxing flat lay: the real product and only its real included parts neatly arranged on a table, top-down, soft light',
  },
  detalle_tecnico: {
    id: 'detalle_tecnico',
    label: { es: 'Detalle técnico', en: 'Technical detail' },
    hooks: ['curiosity', 'comparison', 'objection'],
    archetypes: ['desvalidar_alternativas', 'mostrar_servicio'],
    formats: ['explainer', 'offer_graphic', 'variant_card'],
    available: (ctx) => has(ctx, 'ingredients_materials', 'differentiator', 'how_it_works', 'certification'),
    targetPools: ['objections', 'desires'],
    frame: {
      es: (t) => `El dato técnico confirmado que responde "${t}":`,
      en: (t) => `The confirmed technical fact that answers "${t}":`,
    },
    why: { es: 'un dato concreto convence a quien compara especificaciones', en: 'one concrete spec convinces people who compare' },
    scene: 'macro close-up of the product detail that matters (material, texture, mechanism), dramatic side light',
  },
  comparacion: {
    id: 'comparacion',
    label: { es: 'Comparación', en: 'Comparison' },
    hooks: ['comparison', 'objection', 'pain'],
    archetypes: ['desvalidar_alternativas'],
    formats: ['before_after', 'explainer', 'offer_graphic'],
    available: (ctx, relaxed) => relaxed || has(ctx, 'differentiator', 'ingredients_materials', 'how_it_works'),
    targetPools: ['objections', 'pains'],
    frame: {
      es: (t) => `Frente a la alternativa de siempre ("${t}"):`,
      en: (t) => `Versus the usual alternative ("${t}"):`,
    },
    why: { es: 'contrasta con lo que el comprador usa hoy', en: 'contrasts with what the buyer uses today' },
    scene: 'side-by-side: the ordinary alternative on one side, this product on the other, same framing',
  },
  temporada: {
    id: 'temporada',
    label: { es: 'Temporada / fecha', en: 'Season / date' },
    hooks: ['urgency_scarcity', 'desire', 'identity'],
    archetypes: ['venta_directa', 'variedad_productos'],
    formats: ['offer_graphic', 'handheld_overlay', 'variant_card'],
    available: (ctx) => ctx.hasBrief || has(ctx, 'custom:season' as FactKey),
    targetPools: ['desires', 'audience'],
    frame: {
      es: (t) => `Para la fecha de la campaña, pensado para quien busca "${t}":`,
      en: (t) => `For the campaign date, made for people after "${t}":`,
    },
    why: { es: 'ata la compra a la fecha o temporada de la campaña', en: "ties the purchase to the campaign's date or season" },
    scene: 'seasonal setting matching the campaign context, subtle seasonal props, the product as the hero',
  },
  prueba_social: {
    id: 'prueba_social',
    label: { es: 'Prueba social', en: 'Social proof' },
    hooks: ['social_proof'],
    archetypes: ['venta_directa'],
    formats: ['ugc_person', 'offer_graphic'],
    // Only with verified proof (review / number / certification). Never relaxed.
    available: (ctx) => has(ctx, 'proof_review', 'proof_number', 'certification'),
    targetPools: ['phrases', 'desires'],
    frame: {
      es: (t) => `Prueba verificada de clientes reales ("${t}"):`,
      en: (t) => `Verified proof from real customers ("${t}"):`,
    },
    why: { es: 'la prueba verificada baja el riesgo percibido', en: 'verified proof lowers perceived risk' },
    scene: 'authentic customer-style photo of the product in a real home, natural light',
  },
}

/** Default category for a hook type (legacy ids / guide items without a category). */
export const HOOK_DEFAULT_CATEGORY: Record<HookType, AngleCategory> = {
  pain: 'problema_solucion',
  desire: 'uso_real',
  objection: 'comparacion',
  social_proof: 'prueba_social',
  comparison: 'comparacion',
  price_value: 'valor_precio',
  urgency_scarcity: 'valor_precio',
  curiosity: 'detalle_tecnico',
  routine: 'uso_real',
  identity: 'uso_real',
}

const HOOKS: HookType[] = ['pain', 'desire', 'objection', 'social_proof', 'comparison', 'price_value', 'urgency_scarcity', 'curiosity', 'routine', 'identity']
const FORMATS: AdFormat[] = ['offer_graphic', 'before_after', 'how_to_steps', 'variant_card', 'ugc_person', 'handheld_overlay', 'explainer']
const ARCHETYPES: IanArchetype[] = ['venta_directa', 'desvalidar_alternativas', 'mostrar_servicio', 'variedad_productos', 'paso_a_paso']

export function angleId(category: AngleCategory, hookType: HookType, format: AdFormat): string {
  return `${category}-${hookType}-${format}`
}

export interface ParsedAngleId {
  category: AngleCategory
  hookType: HookType
  format: AdFormat
  /** Only for legacy `aNN-archetype-hook-format` ids. */
  archetype?: IanArchetype
  legacy: boolean
}

/** Parse a catalog id (or a legacy planner id). Null when it is neither. */
export function parseAngleId(id: string): ParsedAngleId | null {
  if (typeof id !== 'string') return null
  const parts = id.trim().split('-')
  if (parts.length === 3 && isAngleCategory(parts[0]) && HOOKS.includes(parts[1] as HookType) && FORMATS.includes(parts[2] as AdFormat)) {
    return { category: parts[0], hookType: parts[1] as HookType, format: parts[2] as AdFormat, legacy: false }
  }
  if (parts.length === 4 && /^a\d{2}$/.test(parts[0]) && ARCHETYPES.includes(parts[1] as IanArchetype) && HOOKS.includes(parts[2] as HookType) && FORMATS.includes(parts[3] as AdFormat)) {
    const hookType = parts[2] as HookType
    return { category: HOOK_DEFAULT_CATEGORY[hookType], hookType, format: parts[3] as AdFormat, archetype: parts[1] as IanArchetype, legacy: true }
  }
  return null
}

/** Best archetype for a category × format (planner fallback when an id carries none). */
export function archetypeFor(category: AngleCategory, format: AdFormat): IanArchetype {
  const spec = ANGLE_CATEGORIES[category]
  if (format === 'how_to_steps') return spec.archetypes.includes('paso_a_paso') ? 'paso_a_paso' : spec.archetypes[0]
  if (format === 'variant_card' && spec.archetypes.includes('variedad_productos')) return 'variedad_productos'
  if (format === 'before_after' && spec.archetypes.includes('desvalidar_alternativas')) return 'desvalidar_alternativas'
  return spec.archetypes[0]
}

const FORMAT_WHY: Record<AdLanguage, Record<AdFormat, string>> = {
  es: {
    offer_graphic: 'formato oferta: producto héroe + precio visible',
    before_after: 'formato comparación lado a lado',
    how_to_steps: 'formato pasos numerados',
    variant_card: 'formato variante destacada',
    ugc_person: 'formato persona real (nativo)',
    handheld_overlay: 'formato en mano, una sola frase',
    explainer: 'formato explicativo con puntos clave',
  },
  en: {
    offer_graphic: 'offer format: hero product + visible price',
    before_after: 'side-by-side comparison format',
    how_to_steps: 'numbered steps format',
    variant_card: 'featured variant format',
    ugc_person: 'real-person (native) format',
    handheld_overlay: 'in-hand format, one line',
    explainer: 'explainer format with key points',
  },
}

/** Short ES/EN "why this angle" (≤ ~200 chars). */
export function angleRationale(category: AngleCategory, format: AdFormat, language: AdLanguage, focus?: string): string {
  const spec = ANGLE_CATEGORIES[category]
  const base = `${spec.label[language]}: ${spec.why[language]}; ${FORMAT_WHY[language][format]}`
  const withFocus = focus ? `${base}${language === 'es' ? '; se apoya en' : '; built on'} "${focus.slice(0, 60)}"` : base
  return withFocus.slice(0, 220)
}

/** Map a free-form bulk angle (hook style / framework / title) to a catalog category + hook. */
export function categoryFromText(text: string): { category: AngleCategory; hookType: HookType } {
  const s = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const rules: Array<[RegExp, AngleCategory, HookType]> = [
    [/regal|gift|navidad|christmas|cumple|birthday|madre|padre|mother|father|san valentin|valentine/, 'regalo', 'desire'],
    [/unbox|que incluye|what'?s inside|kit|caja|box|contenido|includes/, 'unboxing', 'curiosity'],
    [/precio|price|valor|value|oferta|deal|ahorr|save|bundle|combo|descuento/, 'valor_precio', 'price_value'],
    [/como funciona|how it works|paso|step|tutorial|educativ|explica|demo/, 'como_funciona', 'curiosity'],
    [/tecnic|spec|material|ingredient|detalle|detail|calidad|quality|engineering/, 'detalle_tecnico', 'curiosity'],
    [/compar|versus|\bvs\b|alternativ|desvalidar|instead|en vez/, 'comparacion', 'comparison'],
    [/temporada|season|fecha|black friday|verano|summer|invierno|winter|vuelta a clases|back to school|tendencia|trend/, 'temporada', 'urgency_scarcity'],
    [/review|resena|testimon|prueba social|social proof|clientes|customers|reconocimiento|peer/, 'prueba_social', 'social_proof'],
    [/problem|dolor|pain|frustr|cansad|tired|harto|gap|survival|hidden/, 'problema_solucion', 'pain'],
    [/rutina|routine|dia a dia|daily|ritual|real life|storytelling|uso|shift|commute|identity|identidad/, 'uso_real', 'routine'],
  ]
  for (const [re, category, hookType] of rules) if (re.test(s)) return { category, hookType }
  return { category: 'uso_real', hookType: 'desire' }
}
