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
export function buildCopyPrompt(input: { dna: BrandDna; offer: OfferInput; angle: AdAngle; language: AdLanguage }): CopyPrompt {
  const ctx = buildCopyContext(input.dna, input.offer, input.angle, input.language)
  return buildCopyPromptFromContext(ctx)
}

function buildCopyPromptFromContext(ctx: CopyContext): CopyPrompt {
  const { dna, angle, language } = ctx
  const es = language === 'es'
  const compliance = complianceGuidance(dna.category, language)
  const system = [
    IAN_CORE_RULES[language],
    registerInstruction(dna.register, language),
    `${es ? 'REGLAS DE ANUNCIO ESTÁTICO' : 'STATIC AD RULES'}:\n${UNIVERSAL_AD_RULES[language].map((r) => `- ${r}`).join('\n')}`,
    `${es ? 'CUMPLIMIENTO (categoría' : 'COMPLIANCE (category'} ${dna.category}):\n${compliance.map((r) => `- ${r}`).join('\n')}`,
    outputContract(ctx),
  ].join('\n\n')

  const disclaimer = getRequiredDisclaimer(dna.category, angle.format, language)
  const brandLines = [
    `${es ? 'Marca' : 'Brand'}: ${dna.brandName}`,
    `${es ? 'Producto/oferta' : 'Product/offer'}: ${ctx.offer.name}`,
    dna.oneLiner ? `${es ? 'Qué es' : 'What it is'}: ${redactUnconfirmed(dna.oneLiner, ctx)}` : '',
    dna.voice ? `${es ? 'Voz de marca' : 'Brand voice'}: ${redactUnconfirmed(dna.voice, ctx)}` : '',
    dna.audience?.length ? `${es ? 'Audiencia' : 'Audience'}: ${redactList(dna.audience, ctx).join(' | ')}` : '',
    dna.customerPhrases?.length ? `${es ? 'Frases reales de clientes (material de gancho)' : 'Real customer phrases (hook material)'}: ${redactList(dna.customerPhrases, ctx).join(' | ')}` : '',
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
  const prompt = buildCopyPromptFromContext(ctx)
  const res = await input.gateway.json<RawModelCopy>({
    system: prompt.system,
    user: prompt.user,
    model: input.model,
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
