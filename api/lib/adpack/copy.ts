/**
 * Ad Pack engine — copy generation.
 *
 * generateAdCopy: ONE gateway.json call per ad with IAN rules, the archetype
 * example, format layout intent, brand voice/register, forbidden phrases and a
 * FACTS ALLOWLIST (confirmed facts only, exact strings). The offer line is built
 * by code from confirmed facts, never by the model. Limits are stated in the
 * prompt and enforced after (normalization + deterministic check).
 *
 * generatePackCopy: runs many angles in parallel with a small concurrency
 * limiter; partial success, never throws on a single failure.
 */
import type { AdAngle, AdCopy, AdLanguage, BrandDna, CopyCheckResult, ModelGateway, OfferInput } from './types.js'
import { checkAdCopy, repairAdCopy } from './check-copy.js'
import { complianceGuidance, getRequiredDisclaimer } from './compliance.js'
import {
  ADPACK_COPY_MODEL,
  briefBlock,
  buildCopyContext,
  defaultSceneFallback,
  factsAllowlistBlock,
  normalizeModelCopy,
  redactList,
  redactUnconfirmed,
  type CopyContext,
  type RawModelCopy,
} from './copy-shared.js'
import { buildOfferLine, extractNumericClaims, mergeFacts, numbersInFacts } from './facts.js'
import { archetypeBlock, IAN_CORE_RULES, REGISTER_CTA_VERBS, registerInstruction } from './ian-rules.js'
import { COPY_LIMITS, FORMAT_PATTERNS, formatGuidance, headlineMaxWords, UNIVERSAL_AD_RULES } from './patterns.js'
import { errorMessage, mapWithConcurrency } from './util.js'

export { buildOfferLine }

/** Deterministic offer line for an offer + DNA (confirmed price/bundle/shipping only). */
export function offerLineFor(dna: BrandDna, offer: OfferInput, language: AdLanguage): string | undefined {
  return buildOfferLine(mergeFacts(dna, offer), language)
}

/**
 * Craft rules added after the live benchmark (judge flagged repetition between
 * headline/subline/chips/caption, generic label-headlines and abstract chips).
 */
export const COPY_CRAFT_RULES: Record<AdLanguage, string> = {
  es: `OFICIO (lo que separa un anuncio que vende de uno genérico):
- UNA idea por anuncio: elegí 1–2 hechos foco (*) como prueba central y construí todo alrededor. No recorras la lista de hechos (envíos, pagos, variantes, ingredientes) en un mismo anuncio; el precio/paquete ya lo muestra la línea de oferta.
- Titular (se lee en 3 s) = la situación o el dolor concreto del comprador + algo específico (el tipo de producto, un dato confirmado o un momento/lugar preciso), dicho como lo diría él. Nada genérico ("Tu rutina ideal", "Calidad que se nota"), nunca una etiqueta de catálogo ni el nombre del producto solo.
- Dolores, deseos y frases de clientes describen al COMPRADOR, no son resultados del producto: no afirmes que el producto quita un dolor o logra un deseo ("no se estira", "sin dolor", "dura más", "menos azúcar", "para cocina y baño"…) salvo que lo diga un hecho confirmado. Lo que el producto ES y HACE sale solo de los hechos confirmados; "Qué es" es contexto, no una fuente de afirmaciones.
- CERO repetición: cada dato aparece UNA sola vez entre titular, subtítulo, chips y caption. Subtítulo = la razón para creer (un dato distinto al del titular). Chips = datos concretos nuevos (ingrediente con %, cantidad, tiempo, paso real); nada de adjetivos sueltos ("Calidad", "Natural").
- Caption (va debajo de la imagen; quien lo lee ya vio titular, chips y precio): NO repite titular, chips ni oferta. Aporta lo que la imagen no dice: responde la objeción principal o explica el cómo/por qué con un hecho confirmado y cierra con el CTA. 2–4 frases cortas.
- Variá la estructura del titular dentro del pack (situación, pregunta, dato, cita); "No compres…" como mucho en un anuncio del pack.`,
  en: `CRAFT (what separates an ad that sells from a generic one):
- ONE idea per ad: pick 1–2 focus facts (*) as the central proof and build everything around them. Do not walk through the facts list (shipping, payments, variants, ingredients) in one ad; the offer line already shows price/bundle.
- Headline (read in 3 s) = the buyer's concrete situation or pain + something specific (the product type, a confirmed fact or a precise moment/place), said the way they would say it. Nothing generic ("Your ideal routine", "Quality you can feel"), never a catalog label or the bare product name.
- Pains, desires and customer phrases describe the BUYER, they are not product results: never claim the product removes a pain or delivers a desire ("won't stretch", "pain-free", "lasts longer", "less sugar"…) unless a confirmed fact says so. What the product IS and DOES comes only from confirmed facts; "What it is" is context, not a source of claims.
- ZERO repetition: each fact appears ONCE across headline, subline, chips and caption. Subline = the reason to believe (a different fact than the headline). Chips = new concrete data (ingredient with %, quantity, time, real step); no lone adjectives ("Quality", "Natural").
- Caption (sits below the image; the reader already saw headline, chips and price): does NOT repeat the headline, chips or offer. It adds what the image does not say: answer the main objection or explain how/why with a confirmed fact, then the CTA. 2–4 short sentences.
- Vary the headline structure across the pack (situation, question, data point, quote); "Don't buy…" at most once per pack.`,
}

/** Headlines/sublines already used in the pack, so parallel ads don't converge on one line. */
function packDiversityBlock(others: AdCopy[] | undefined, language: AdLanguage): string {
  const used = (others ?? [])
    .flatMap((c) => [c.headline, c.subline ?? ''])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 16)
  if (!used.length) return ''
  const head =
    language === 'es'
      ? 'YA USADO EN ESTE PACK (no repitas estas frases ni su idea central):'
      : 'ALREADY USED IN THIS PACK (do not repeat these lines or their core idea):'
  return [head, ...used.map((u) => `- ${u}`)].join('\n')
}

export interface CopyPrompt {
  system: string
  user: string
}

function outputContract(ctx: CopyContext): string {
  const L = COPY_LIMITS
  const hMax = headlineMaxWords(ctx.angle.format)
  const es = ctx.language === 'es'
  const offerLineNote = ctx.offerLine
    ? es
      ? `La línea de oferta la pone el sistema, EXACTA: "${ctx.offerLine}". No la repitas en headline/subline/bullets ni la reescribas.`
      : `The system adds the offer line, EXACTLY: "${ctx.offerLine}". Do not repeat or rewrite it in headline/subline/bullets.`
    : es
      ? 'No hay precio/oferta confirmados: NO menciones precios, descuentos ni promociones.'
      : 'No confirmed price/offer: do NOT mention prices, discounts or promotions.'
  const lines = es
    ? [
        'DEVUELVE SOLO JSON con esta forma exacta:',
        '{"headline":"","subline":"","bullets":[""],"cta":"","caption":"","script":{"hook":"","development":"","cta":""},"sceneBrief":"","usedFactKeys":[""]}',
        'LÍMITES DUROS (se verifican por código; si te pasás, el anuncio se descarta):',
        `- headline: el GANCHO, ≤ ${hMax} palabras y ≤ ${L.headlineChars} caracteres. Filtra y segmenta.`,
        `- subline: opcional, ≤ ${L.sublineWords} palabras; desarrolla, no repite el headline.`,
        `- bullets: 0–${L.maxBullets} chips de ≤ ${L.bulletWords} palabras (sin contar y/de/en/con) y ≤ ${L.bulletChars} caracteres cada uno (datos tangibles o pasos; si un hecho es más largo, usá solo su parte clave).`,
        `- cta: ≤ ${L.ctaWords} palabras y ≤ ${L.ctaChars} caracteres, orden fría y directa en el trato de la marca (ej.: "${REGISTER_CTA_VERBS[ctx.dna.register ?? 'tuteo'][0]} para pedir"). Todo el anuncio (también caption y script) usa ese mismo trato.`,
        `- caption: ${L.captionMinChars}–${L.captionMaxChars} caracteres; gancho + certeza (datos confirmados, logística) + CTA. Sin saludos, sin hashtags de relleno.`,
        `- script: tríada hablada para versión UGC: hook ≤ ${L.scriptHookWords} palabras, development ≤ ${L.scriptDevelopmentWords}, cta ≤ ${L.scriptCtaWords}.`,
        '- sceneBrief: en inglés, 1–2 frases SOLO visuales y concretas para ESTE anuncio: el lugar real donde se usa el producto, superficie, 1–2 props, luz, encuadre. No hables de texto, espacio para texto, logos ni etiquetas (el sistema maneja el diseño).',
        `- ${offerLineNote}`,
        '- usedFactKeys: claves de la lista de hechos que usaste.',
      ]
    : [
        'RETURN JSON ONLY with this exact shape:',
        '{"headline":"","subline":"","bullets":[""],"cta":"","caption":"","script":{"hook":"","development":"","cta":""},"sceneBrief":"","usedFactKeys":[""]}',
        'HARD LIMITS (checked by code; exceeding them discards the ad):',
        `- headline: the HOOK, ≤ ${hMax} words and ≤ ${L.headlineChars} characters. Filters and segments.`,
        `- subline: optional, ≤ ${L.sublineWords} words; develops, never repeats the headline.`,
        `- bullets: 0–${L.maxBullets} chips of ≤ ${L.bulletWords} words (not counting and/of/in/with) and ≤ ${L.bulletChars} characters each (tangible data or steps; if a fact is longer, use only its key part).`,
        `- cta: ≤ ${L.ctaWords} words and ≤ ${L.ctaChars} characters, cold and direct instruction (e.g. "Message us to order").`,
        `- caption: ${L.captionMinChars}–${L.captionMaxChars} characters; hook + certainty (confirmed data, logistics) + CTA. No greetings, no filler hashtags.`,
        `- script: spoken triad for a UGC version: hook ≤ ${L.scriptHookWords} words, development ≤ ${L.scriptDevelopmentWords}, cta ≤ ${L.scriptCtaWords}.`,
        '- sceneBrief: in English, 1–2 concrete VISUAL sentences for THIS ad: the real place where the product is used, surface, 1–2 props, light, framing. Do not mention text, space for text, logos or labels (the system handles layout).',
        `- ${offerLineNote}`,
        '- usedFactKeys: keys from the facts list you used.',
      ]
  return lines.join('\n')
}

/** Build the single copy prompt. Exported for tests and for prompt inspection. */
export function buildCopyPrompt(input: { dna: BrandDna; offer: OfferInput; angle: AdAngle; language: AdLanguage; otherCopies?: AdCopy[]; brief?: string }): CopyPrompt {
  const ctx = buildCopyContext(input.dna, input.offer, input.angle, input.language)
  return buildCopyPromptFromContext({ ...ctx, otherCopies: input.otherCopies, brief: input.brief })
}

function buildCopyPromptFromContext(ctx: CopyContext & { otherCopies?: AdCopy[]; brief?: string }): CopyPrompt {
  const { dna, angle, language } = ctx
  const es = language === 'es'
  const compliance = complianceGuidance(dna.category, language)
  const system = [
    IAN_CORE_RULES[language],
    registerInstruction(dna.register, language, dna.locale),
    `${es ? 'REGLAS DE ANUNCIO ESTÁTICO' : 'STATIC AD RULES'}:\n${UNIVERSAL_AD_RULES[language].map((r) => `- ${r}`).join('\n')}`,
    `${es ? 'CUMPLIMIENTO (categoría' : 'COMPLIANCE (category'} ${dna.category}):\n${compliance.map((r) => `- ${r}`).join('\n')}`,
    COPY_CRAFT_RULES[language],
    outputContract(ctx),
  ].join('\n\n')

  const disclaimer = getRequiredDisclaimer(dna.category, angle.format, language)
  // A quote with a number that no confirmed fact backs ("me dura casi dos meses") would fail the
  // fact checker if quoted, so it never reaches the prompt.
  const confirmedNums = numbersInFacts(ctx.confirmed)
  const phrases = redactList(dna.customerPhrases, ctx).filter((p) => extractNumericClaims(p).every((c) => confirmedNums.has(c.value)))
  const brandLines = [
    `${es ? 'Marca' : 'Brand'}: ${dna.brandName}`,
    `${es ? 'Producto/oferta' : 'Product/offer'}: ${ctx.offer.name}`,
    dna.oneLiner ? `${es ? 'Qué es (contexto)' : 'What it is (context)'}: ${redactUnconfirmed(dna.oneLiner, ctx)}` : '',
    dna.voice ? `${es ? 'Voz de marca' : 'Brand voice'}: ${redactUnconfirmed(dna.voice, ctx)}` : '',
    dna.audience?.length ? `${es ? 'Audiencia' : 'Audience'}: ${redactList(dna.audience, ctx).join(' | ')}` : '',
    phrases.length
      ? es
        ? `Frases reales de clientes (voz del cliente, NO hechos del producto): ${phrases.join(' | ')}
  Úsalas para inspirar el gancho o cítalas entre comillas como opinión de un cliente ("…", dice una clienta). Nunca las conviertas en promesas o chips del producto.`
        : `Real customer phrases (customer voice, NOT product facts): ${phrases.join(' | ')}
  Use them to inspire the hook or quote them in quotation marks as a customer's words ("…", says a customer). Never turn them into product promises or chips.`
      : '',
  ].filter(Boolean)

  const forbidden = [...(dna.forbiddenPhrases ?? []), ...(dna.forbiddenClaims ?? [])].filter((p) => p.trim())
  // Brand phrases (kit must-use): wording only; a phrase with a number no confirmed fact backs is dropped.
  const mustUse = redactList(dna.mustUsePhrases, ctx, 8).filter((p) => extractNumericClaims(p).every((c) => confirmedNums.has(c.value)))
  const user = [
    brandLines.join('\n'),
    [
      `${es ? 'ÁNGULO DE ESTE ANUNCIO' : 'THIS AD\'S ANGLE'} (${angle.id}):`,
      `- ${es ? 'Mensaje único' : 'Single message'}: ${redactUnconfirmed(angle.message, ctx)}`,
      `- ${es ? 'Apunta a' : 'Targets'}: ${redactUnconfirmed(angle.target, ctx)}`,
      `- ${es ? 'Tipo de gancho' : 'Hook type'}: ${angle.hookType}`,
    ].join('\n'),
    archetypeBlock(angle.archetype, language),
    formatGuidance(angle.format, language),
    factsAllowlistBlock(ctx),
    packDiversityBlock(ctx.otherCopies, language),
    dna.gaps?.length
      ? es
        ? `Datos NO disponibles (no los menciones ni inventes): ${dna.gaps.join(', ')}`
        : `Data NOT available (do not mention or invent): ${dna.gaps.join(', ')}`
      : '',
    forbidden.length ? `${es ? 'FRASES PROHIBIDAS (nunca usar)' : 'FORBIDDEN PHRASES (never use)'}: ${forbidden.join(' | ')}` : '',
    mustUse.length
      ? es
        ? `Frases de marca (usá una solo si encaja natural; son estilo, no hechos): ${mustUse.join(' | ')}`
        : `Brand phrases (use one only if it fits naturally; style, not facts): ${mustUse.join(' | ')}`
      : '',
    briefBlock(ctx.brief, ctx.confirmed, language),
    disclaimer
      ? es
        ? `Incluye este disclaimer literal en subline o caption: "${disclaimer}"`
        : `Include this literal disclaimer in subline or caption: "${disclaimer}"`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  return { system, user }
}

export interface GenerateAdCopyInput {
  gateway: ModelGateway
  dna: BrandDna
  offer: OfferInput
  angle: AdAngle
  language: AdLanguage
  model?: string
  temperature?: number
  /** Other copies already in the pack (duplicate detection in the returned check). */
  otherCopies?: AdCopy[]
  /** Owner's campaign brief: creative direction only (numbers no confirmed fact backs are stripped). */
  brief?: string
}

export interface GeneratedAdCopy {
  copy: AdCopy
  /** Deterministic check of the normalized copy (limits, facts, compliance…). */
  check: CopyCheckResult
  costUsd: number
  model: string
}

export async function generateAdCopy(input: GenerateAdCopyInput): Promise<GeneratedAdCopy> {
  const ctx = buildCopyContext(input.dna, input.offer, input.angle, input.language)
  const prompt = buildCopyPromptFromContext({ ...ctx, otherCopies: input.otherCopies, brief: input.brief })
  const res = await input.gateway.json<RawModelCopy>({
    system: prompt.system,
    user: prompt.user,
    model: input.model ?? ADPACK_COPY_MODEL,
    temperature: input.temperature ?? 0.7,
    maxTokens: 1200,
  })
  if (!res || typeof res.data !== 'object' || res.data === null) throw new Error('copy_model_returned_no_json')
  const copy = normalizeModelCopy(res.data, ctx, defaultSceneFallback(ctx, FORMAT_PATTERNS[input.angle.format].sceneIntent))
  const check = checkAdCopy(copy, {
    dna: input.dna,
    offer: input.offer,
    angle: input.angle,
    language: input.language,
    otherCopies: input.otherCopies,
  })
  return { copy, check, costUsd: res.costUsd ?? 0, model: res.model }
}

// ---------------------------------------------------------------------------
// Pack (parallel, partial success)
// ---------------------------------------------------------------------------

export interface GeneratePackCopyInput {
  gateway: ModelGateway
  dna: BrandDna
  offer: OfferInput
  angles: AdAngle[]
  language: AdLanguage
  model?: string
  concurrency?: number
  /** One targeted repair for ads that fail the deterministic check (default true). */
  repair?: boolean
  brief?: string
}

export type PackCopyItem =
  | { angleId: string; ok: true; copy: AdCopy; check: CopyCheckResult; costUsd: number; repaired: boolean }
  | { angleId: string; ok: false; error: string; costUsd: number }

export interface PackCopyResult {
  items: PackCopyItem[]
  costUsd: number
  okCount: number
  failedCount: number
}

export async function generatePackCopy(input: GeneratePackCopyInput): Promise<PackCopyResult> {
  const { gateway, dna, offer, angles, language } = input
  const concurrency = input.concurrency ?? 5
  const doRepair = input.repair ?? true

  // Phase 1 — parallel generation.
  const gen = await mapWithConcurrency(angles, concurrency, (angle) =>
    generateAdCopy({ gateway, dna, offer, angle, language, model: input.model, brief: input.brief })
  )
  const items: PackCopyItem[] = angles.map((angle, i) => {
    const r = gen[i]
    if (!r.ok) return { angleId: angle.id, ok: false, error: errorMessage(r.error), costUsd: 0 }
    return { angleId: angle.id, ok: true, copy: r.value.copy, check: r.value.check, costUsd: r.value.costUsd, repaired: false }
  })

  // Phase 2 — deterministic re-check including near-duplicates vs earlier ads.
  const recheck = (i: number) => {
    const item = items[i]
    if (!item.ok) return
    const others = items.filter((x, j) => j < i && x.ok).map((x) => (x as Extract<PackCopyItem, { ok: true }>).copy)
    item.check = checkAdCopy(item.copy, { dna, offer, angle: angles[i], language, otherCopies: others })
  }
  for (let i = 0; i < items.length; i++) recheck(i)

  // Phase 3 — one targeted repair for failures, in parallel.
  if (doRepair) {
    const failing = items.map((x, i) => ({ x, i })).filter(({ x }) => x.ok && !x.check.ok)
    await mapWithConcurrency(failing, concurrency, async ({ x, i }) => {
      if (!x.ok) return
      const others = items.filter((y, j) => j !== i && y.ok).map((y) => (y as Extract<PackCopyItem, { ok: true }>).copy)
      const rep = await repairAdCopy({
        gateway,
        copy: x.copy,
        issues: x.check.issues,
        dna,
        offer,
        angle: angles[i],
        language,
        otherCopies: others,
        model: input.model,
      })
      x.copy = rep.copy
      x.check = rep.check
      x.costUsd += rep.costUsd
      x.repaired = rep.repaired
    })
    for (let i = 0; i < items.length; i++) recheck(i)
  }

  const okCount = items.filter((x) => x.ok).length
  return {
    items,
    costUsd: items.reduce((s, x) => s + x.costUsd, 0),
    okCount,
    failedCount: items.length - okCount,
  }
}
