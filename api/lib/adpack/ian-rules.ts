/**
 * Ad Pack engine — IAN method, condensed for static paid-social ads.
 *
 * Faithful summary of the IAN master prompt in api/chat.ts (certeza total, tríada
 * gancho/desarrollo/CTA, 5 estructuras maestras, reglas inquebrantables), adapted
 * from video scripts to on-image copy. Examples are generic and fictional.
 */
import type { AdLanguage, BrandDna, IanArchetype } from './types.js'

export type SpanishRegister = BrandDna['register']

export const IAN_CORE_RULES: Record<AdLanguage, string> = {
  es: `MÉTODO IAN — COPY DE VENTA DIRECTA PARA ANUNCIOS ESTÁTICOS
Objetivo único: vender (mensajes al DM, pedidos). No likes, no entretener, no cortesía.

1. CERTEZA TOTAL: el freno de compra no es el precio, es la desconfianza. No intentés "convencer": eliminá la duda describiendo la realidad con precisión.
2. PRODUCTO > MARKETING: describí el producto tal cual es; nada de historias inventadas ni slogans vacíos.
3. VALOR TANGIBLE: concreto gana a abstracto. MALO: "envíos rápidos". BUENO: "te llega en 2 a 4 días" (solo si ese dato está confirmado).
4. CERO SALUDOS: prohibido "Hola", "¿Cómo están?", "Bienvenidos". El anuncio empieza en el gancho.
5. TRÍADA:
   - GANCHO (titular, se lee en ≤3 s): FILTRA y SEGMENTA al que tiene la billetera lista (contexto inmediato, precio, situación o prueba social real).
   - DESARROLLO (subtítulo, chips, caption): certeza y claridad; justificá la promesa, tangibilizá (proceso, datos, pasos), respondé objeciones antes de que aparezcan; la logística (envío, tiempos, garantía) es parte del valor.
   - CTA: instrucción de navegación FRÍA, SECA y DIRECTA ("Escribinos para pedir el tuyo"). Sin "por favor", sin "si gustás", sin despedidas.
6. NO REITERACIÓN: nunca digas lo mismo dos veces (ni entre titular, subtítulo y chips).
7. UN SOLO MENSAJE por anuncio. Si una frase no filtra, no da certeza o no ordena la acción, se borra.
8. CERO INVENTOS: precios, tiempos, garantías, cifras y resultados solo si están en la lista de hechos confirmados. Sin placeholders ([TALLA], ___, XXX): si falta el dato, omitilo.
9. ÉTICA AL DESVALIDAR: atacá "las opciones tradicionales" o "lo del súper", nunca a un negocio específico.`,
  en: `IAN METHOD — DIRECT-RESPONSE COPY FOR STATIC ADS
Single goal: sell (DMs, orders). No likes, no entertainment, no pleasantries.

1. TOTAL CERTAINTY: the purchase blocker is not price, it is distrust. Don't "try to convince": remove doubt by describing reality precisely.
2. PRODUCT > MARKETING: describe the product as it is; no invented stories or empty slogans.
3. TANGIBLE VALUE: concrete beats abstract. BAD: "fast shipping". GOOD: "arrives in 2–4 days" (only if that fact is confirmed).
4. ZERO GREETINGS: no "Hi", "How are you?", "Welcome". The ad starts at the hook.
5. TRIAD:
   - HOOK (headline, read in ≤3 s): FILTERS and SEGMENTS the buyer with the wallet ready (immediate context, price, situation or real social proof).
   - DEVELOPMENT (subline, chips, caption): certainty and clarity; justify the promise, make it tangible (process, data, steps), answer objections before they come up; logistics (shipping, timing, guarantee) are part of the value.
   - CTA: a COLD, DRY, DIRECT navigation instruction ("Message us to order yours"). No "please", no "if you like", no sign-offs.
6. NO REPETITION: never say the same thing twice (not across headline, subline and chips).
7. ONE MESSAGE per ad. If a phrase doesn't filter, build certainty or drive the action, delete it.
8. ZERO INVENTION: prices, timings, guarantees, figures and results only if they are in the confirmed facts list. No placeholders ([SIZE], ___, XXX): if the fact is missing, leave it out.
9. ETHICAL COMPARISON: attack "traditional options" or "store-bought", never a specific business.`,
}

export interface ArchetypeSpec {
  label: Record<AdLanguage, string>
  idealFor: Record<AdLanguage, string>
  formula: Record<AdLanguage, string>
  /** 1–2 short, generic, fictional examples (headline → development → CTA). */
  examples: Record<AdLanguage, string[]>
}

export const IAN_ARCHETYPES: Record<IanArchetype, ArchetypeSpec> = {
  venta_directa: {
    label: { es: 'Venta directa (la madre)', en: 'Direct sale (the mother)' },
    idealFor: { es: 'Demanda clara o producto que ya se entiende.', en: 'Clear demand or a product people already understand.' },
    formula: {
      es: '[Gancho con tensión o deseo concreto] + [Por qué este: diferenciador real, no slogan] + [Prueba/certeza si hay datos] + [Logística solo si aporta] + [CTA frío]. Anti-robot: no empieces con "Comprá tu X de Marca", no listes logística de relleno.',
      en: '[Hook with tension or a concrete desire] + [Why this one: real differentiator, not a slogan] + [Proof/certainty if data exists] + [Logistics only if it adds value] + [Cold CTA]. Anti-robot: don\'t open with "Buy your X from Brand", don\'t pad with logistics.',
    },
    examples: {
      es: [
        'Titular: "¿Pagando de más por audífonos?" → Desarrollo: importamos directo y armamos el combo con estuche; garantía de un año. → CTA: "Escribinos y armamos tu pedido."',
        'Titular: "La espalda te cobra 8 horas sentado" → Desarrollo: soporte firme que se ajusta bajo la ropa, no el corrector flojo del súper. → CTA: "Pedí el tuyo por DM."',
      ],
      en: [
        'Headline: "Overpaying for earbuds?" → Development: we import direct and bundle the case; one-year warranty. → CTA: "Message us to order."',
        'Headline: "8 hours sitting? Your back pays" → Development: firm support that adjusts under clothing, not the flimsy store brace. → CTA: "DM us to get yours."',
      ],
    },
  },
  desvalidar_alternativas: {
    label: { es: 'Desvalidar alternativas (el posicionador)', en: 'Invalidate alternatives (the positioner)' },
    idealFor: { es: 'Productos superiores a la opción común.', en: 'Products that beat the common option.' },
    formula: {
      es: '[Gancho: "No compres X sin saber esto"] + [Defectos de la opción tradicional] + ["En cambio…" + beneficios opuestos] + [CTA]. Nunca ataques a un negocio específico.',
      en: '[Hook: "Don\'t buy X before you know this"] + [Flaws of the traditional option] + ["Instead…" + opposite benefits] + [CTA]. Never attack a specific business.',
    },
    examples: {
      es: [
        'Titular: "No compres más plástico para envolver" → Desarrollo: el plástico no se reutiliza y no conserva; las envolturas de tela con cera de abeja se lavan y se reúsan. → CTA: "Envianos un mensaje."',
      ],
      en: [
        'Headline: "Stop buying plastic wrap" → Development: plastic can\'t be reused and doesn\'t keep food fresh; beeswax cotton wraps wash and reuse. → CTA: "Send us a message."',
      ],
    },
  },
  mostrar_servicio: {
    label: { es: 'Mostrar el servicio (principio a fin)', en: 'Show the service (start to finish)' },
    idealFor: { es: 'Estética, salud, procesos artesanales, servicios.', en: 'Aesthetics, wellness, craft processes, services.' },
    formula: {
      es: '[Nombre del servicio/proceso] + [Paso 1, 2, 3 visuales] + [Sensación/resultado final, sin prometer resultados garantizados] + [CTA de valoración o pedido].',
      en: '[Service/process name] + [Visual steps 1, 2, 3] + [Final feeling/outcome, no guaranteed results] + [Consultation or order CTA].',
    },
    examples: {
      es: [
        'Titular: "Limpieza facial profunda, paso a paso" → Chips: "Exfoliación" · "Extracción" · "Mascarilla hidratante" → CTA: "Escribinos para tu valoración."',
      ],
      en: [
        'Headline: "Deep facial, step by step" → Chips: "Exfoliation" · "Extraction" · "Hydrating mask" → CTA: "Message us to book."',
      ],
    },
  },
  variedad_productos: {
    label: { es: 'Variedad de productos (el menú)', en: 'Product variety (the menu)' },
    idealFor: { es: 'Tiendas con variantes (sabores, tallas, colores, fórmulas).', en: 'Stores with variants (flavors, sizes, colors, formulas).' },
    formula: {
      es: '[Gancho: "3 tipos de X que tenés que conocer"] + [Opción A → perfil 1] + [Opción B → perfil 2] + [Opción C → perfil 3] + [Logística] + [CTA]. Ayuda al indeciso a autoseleccionarse.',
      en: '[Hook: "3 kinds of X you should know"] + [Option A → profile 1] + [Option B → profile 2] + [Option C → profile 3] + [Logistics] + [CTA]. Helps the undecided self-select.',
    },
    examples: {
      es: [
        'Titular: "¿Cuál café va con vos?" → Chips: "Frutal · tarde" · "Cacao · mañana" · "Dulce · postres" → CTA: "Pedí el tuyo por DM."',
      ],
      en: [
        'Headline: "Which coffee fits you?" → Chips: "Fruity · afternoon" · "Cocoa · morning" · "Sweet · dessert" → CTA: "DM us to order."',
      ],
    },
  },
  paso_a_paso: {
    label: { es: 'Paso a paso (retargeting)', en: 'Step by step (retargeting)' },
    idealFor: { es: 'Explicar cómo se pide/usa; no suele ser el primer impacto.', en: 'Explaining how to order/use; rarely the first touch.' },
    formula: {
      es: '[Gancho: "Pedí tu X en 3 pasos"] + [Paso 1] + [Paso 2] + [Paso 3] + [CTA]. Pasos reales (catálogo, asesoría, pago, envío o uso), sin inventar tiempos.',
      en: '[Hook: "Get your X in 3 steps"] + [Step 1] + [Step 2] + [Step 3] + [CTA]. Real steps (catalog, advice, payment, delivery or use), never invented timings.',
    },
    examples: {
      es: [
        'Titular: "Tu pedido en 3 pasos" → Chips: "1. Elegí tu sabor" · "2. Escribinos" · "3. Te lo enviamos" → CTA: "Escribinos para pedir."',
      ],
      en: [
        'Headline: "Your order in 3 steps" → Chips: "1. Pick a flavor" · "2. Message us" · "3. We ship it" → CTA: "Message us to order."',
      ],
    },
  },
}

export const REGISTER_RULES: Record<SpanishRegister, string> = {
  voseo:
    'REGISTRO: voseo centroamericano/rioplatense. Usá "vos" y sus formas: tenés, querés, pedí, escribinos, mirá, elegí. Nunca "tú", "tienes", "pide", "escríbenos", ni "usted".',
  tuteo:
    'REGISTRO: tuteo neutro. Usa "tú" y sus formas: tienes, quieres, pide, escríbenos, mira, elige. Nunca voseo ("tenés", "pedí") ni "usted".',
  usted:
    'REGISTRO: usted. Usa "usted" y sus formas: tiene, quiere, pida, escríbanos, mire, elija. Nunca "tú" ni voseo ("tenés", "pedí").',
}

/** Register instruction for the copy prompt. English has no register switch. */
export function registerInstruction(register: SpanishRegister | undefined, language: AdLanguage): string {
  if (language === 'en') return 'REGISTER: direct second person ("you"), plain conversational English, no slang that the brand voice does not use.'
  return REGISTER_RULES[register ?? 'tuteo']
}

/** Short register-correct CTA verbs, handy for fallbacks and tests. */
export const REGISTER_CTA_VERBS: Record<SpanishRegister, string[]> = {
  voseo: ['Escribinos', 'Pedí', 'Mandanos', 'Reservá', 'Comprá'],
  tuteo: ['Escríbenos', 'Pide', 'Envíanos', 'Reserva', 'Compra'],
  usted: ['Escríbanos', 'Pida', 'Envíenos', 'Reserve', 'Compre'],
}

/** Markers of the wrong register, used by checks to flag drift. */
export const REGISTER_MARKERS: Record<SpanishRegister, RegExp> = {
  voseo: /(?<!\p{L})(tenés|querés|pedí|escribinos|mandanos|mirá|elegí|sabés|podés|vos)(?!\p{L})/iu,
  tuteo: /(?<!\p{L})(tienes|quieres|pide|escríbenos|escribenos|envíanos|tú|puedes|sabes)(?!\p{L})/iu,
  usted: /(?<!\p{L})(usted|escríbanos|escribanos|envíenos|pida)(?!\p{L})/iu,
}

/**
 * Unambiguous wrong-register markers for the deterministic copy check (REGISTER_MARKERS
 * minus forms that are also valid 1st/3rd person: "pedí" = I ordered, "pide"/"pida" = he/she asks).
 */
export const REGISTER_DRIFT_MARKERS: Record<SpanishRegister, RegExp> = {
  voseo: /(?<!\p{L})(tenés|querés|escribinos|mandanos|mirá|elegí|sabés|podés|vos)(?!\p{L})/iu,
  tuteo: /(?<!\p{L})(tienes|quieres|escríbenos|envíanos|tú|puedes|sabes)(?!\p{L})/iu,
  usted: /(?<!\p{L})(usted|escríbanos|envíenos)(?!\p{L})/iu,
}

export function archetypeBlock(archetype: IanArchetype, language: AdLanguage): string {
  const spec = IAN_ARCHETYPES[archetype]
  const head = language === 'es' ? 'ESTRUCTURA' : 'STRUCTURE'
  const ideal = language === 'es' ? 'Ideal para' : 'Ideal for'
  const formula = language === 'es' ? 'Fórmula' : 'Formula'
  const ex = language === 'es' ? 'Ejemplo (copiá el estilo, no el contenido)' : 'Example (copy the style, not the content)'
  return [
    `${head}: ${spec.label[language]}`,
    `${ideal}: ${spec.idealFor[language]}`,
    `${formula}: ${spec.formula[language]}`,
    ...spec.examples[language].map((e) => `${ex}: ${e}`),
  ].join('\n')
}
