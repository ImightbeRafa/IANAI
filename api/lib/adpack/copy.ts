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
  buildCopyContext,
  defaultSceneFallback,
  factsAllowlistBlock,
  normalizeModelCopy,
  redactList,
  redactUnconfirmed,
  type CopyContext,
  type RawModelCopy,
} from './copy-shared.js'
import { buildOfferLine, mergeFacts } from './facts.js'
import { archetypeBlock, IAN_CORE_RULES, registerInstruction } from './ian-rules.js'
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
- Titular = la situación, dolor, deseo o dato duro del comprador, dicho como lo diría él. Nunca una etiqueta de catálogo ("Sérum de noche", "Paso a paso", "Calidad premium") ni el nombre del producto solo.
- Cada pieza aporta algo NUEVO: el subtítulo no repite el titular ni los chips; los chips no repiten el subtítulo; el caption no copia los chips literalmente ni repite la línea de oferta.
- Chips = resultado o dato concreto (ingrediente con su %, cantidad, tiempo, paso real), ≤ 4 palabras. Nada de adjetivos sueltos ("Calidad", "Natural", "Lo mejor").
- Subtítulo = la razón para creer (el porqué funciona o el diferenciador), no una lista de ingredientes repetida en todos los anuncios.
- Caption: abre con el gancho en otras palabras, responde la objeción principal con un hecho confirmado, cierra con el CTA. Frases cortas.`,
  en: `CRAFT (what separates an ad that sells from a generic one):
- Headline = the buyer's situation, pain, desire or hard fact, said the way they would say it. Never a catalog label ("Night serum", "Step by step", "Premium quality") or the bare product name.
- Every piece adds something NEW: the subline does not repeat the headline or chips; chips do not repeat the subline; the caption does not copy the chips verbatim or repeat the offer line.
- Chips = a concrete outcome or data point (ingredient with its %, quantity, time, real step), ≤ 4 words. No lone adjectives ("Quality", "Natural", "The best").
- Subline = the reason to believe (why it works or the differentiator), not the same ingredient list in every ad.
- Caption: open with the hook in other words, answer the main objection with a confirmed fact, close with the CTA. Short sentences.`,
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
        `- bullets: 0–${L.maxBullets} chips de ≤ ${L.bulletWords} palabras cada uno (beneficios tangibles o pasos).`,
        `- cta: ≤ ${L.ctaWords} palabras, orden fría y directa.`,
        `- caption: ${L.captionMinChars}–${L.captionMaxChars} caracteres; gancho + certeza (datos confirmados, logística) + CTA. Sin saludos, sin hashtags de relleno.`,
        `- script: tríada hablada para versión UGC: hook ≤ ${L.scriptHookWords} palabras, development ≤ ${L.scriptDevelopmentWords}, cta ≤ ${L.scriptCtaWords}.`,
        '- sceneBrief: en inglés, SOLO lo visual (escena, producto real visible y grande, luz, encuadre, espacio libre para el texto). PROHIBIDO pedir texto, letras, números, logos, carteles o etiquetas escritas en la escena.',
        `- ${offerLineNote}`,
        '- usedFactKeys: claves de la lista de hechos que usaste.',
      ]
    : [
        'RETURN JSON ONLY with this exact shape:',
        '{"headline":"","subline":"","bullets":[""],"cta":"","caption":"","script":{"hook":"","development":"","cta":""},"sceneBrief":"","usedFactKeys":[""]}',
        'HARD LIMITS (checked by code; exceeding them discards the ad):',
        `- headline: the HOOK, ≤ ${hMax} words and ≤ ${L.headlineChars} characters. Filters and segments.`,
        `- subline: optional, ≤ ${L.sublineWords} words; develops, never repeats the headline.`,
        `- bullets: 0–${L.maxBullets} chips of ≤ ${L.bulletWords} words each (tangible benefits or steps).`,
        `- cta: ≤ ${L.ctaWords} words, cold and direct instruction.`,
        `- caption: ${L.captionMinChars}–${L.captionMaxChars} characters; hook + certainty (confirmed data, logistics) + CTA. No greetings, no filler hashtags.`,
        `- script: spoken triad for a UGC version: hook ≤ ${L.scriptHookWords} words, development ≤ ${L.scriptDevelopmentWords}, cta ≤ ${L.scriptCtaWords}.`,
        '- sceneBrief: in English, VISUALS ONLY (setting, real product visible and large, light, framing, empty space for text). NEVER ask for text, letters, numbers, logos, signs or written labels in the scene.',
        `- ${offerLineNote}`,
        '- usedFactKeys: keys from the facts list you used.',
      ]
  return lines.join('\n')
}

/** Build the single copy prompt. Exported for tests and for prompt inspection. */
export function buildCopyPrompt(input: { dna: BrandDna; offer: OfferInput; angle: AdAngle; language: AdLanguage; otherCopies?: AdCopy[] }): CopyPrompt {
  const ctx = buildCopyContext(input.dna, input.offer, input.angle, input.language)
  return buildCopyPromptFromContext({ ...ctx, otherCopies: input.otherCopies })
}

function buildCopyPromptFromContext(ctx: CopyContext & { otherCopies?: AdCopy[] }): CopyPrompt {
  const { dna, angle, language } = ctx
  const es = language === 'es'
  const compliance = complianceGuidance(dna.category, language)
  const system = [
    IAN_CORE_RULES[language],
    registerInstruction(dna.register, language),
    `${es ? 'REGLAS DE ANUNCIO ESTÁTICO' : 'STATIC AD RULES'}:\n${UNIVERSAL_AD_RULES[language].map((r) => `- ${r}`).join('\n')}`,
    `${es ? 'CUMPLIMIENTO (categoría' : 'COMPLIANCE (category'} ${dna.category}):\n${compliance.map((r) => `- ${r}`).join('\n')}`,
    COPY_CRAFT_RULES[language],
    outputContract(ctx),
  ].join('\n\n')

  const disclaimer = getRequiredDisclaimer(dna.category, angle.format, language)
  const brandLines = [
    `${es ? 'Marca' : 'Brand'}: ${dna.brandName}`,
    `${es ? 'Producto/oferta' : 'Product/offer'}: ${ctx.offer.name}`,
    dna.oneLiner ? `${es ? 'Qué es' : 'What it is'}: ${redactUnconfirmed(dna.oneLiner, ctx)}` : '',
    dna.voice ? `${es ? 'Voz de marca' : 'Brand voice'}: ${redactUnconfirmed(dna.voice, ctx)}` : '',
    dna.audience?.length ? `${es ? 'Audiencia' : 'Audience'}: ${redactList(dna.audience, ctx).join(' | ')}` : '',
    dna.customerPhrases?.length
      ? es
        ? `Frases reales de clientes (voz del cliente, NO hechos del producto): ${redactList(dna.customerPhrases, ctx).join(' | ')}
  Úsalas para inspirar el gancho o cítalas entre comillas como opinión de un cliente ("…", dice una clienta). Nunca las conviertas en promesas o chips del producto.`
        : `Real customer phrases (customer voice, NOT product facts): ${redactList(dna.customerPhrases, ctx).join(' | ')}
  Use them to inspire the hook or quote them in quotation marks as a customer's words ("…", says a customer). Never turn them into product promises or chips.`
      : '',
  ].filter(Boolean)

  const forbidden = (dna.forbiddenPhrases ?? []).filter((p) => p.trim())
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
  const prompt = buildCopyPromptFromContext({ ...ctx, otherCopies: input.otherCopies })
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
    generateAdCopy({ gateway, dna, offer, angle, language, model: input.model })
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
