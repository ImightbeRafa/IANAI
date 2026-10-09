/**
 * Ad Pack engine — LLM-judge rubric (0–10) on IAN criteria, for the benchmark.
 * Not used to gate shipping; deterministic checks do that.
 */
import type { AdAngle, AdCopy, AdLanguage, BrandDna, ModelGateway, OfferInput } from './types.js'
import { confirmedFacts, mergeFacts } from './facts.js'
import { registerInstruction } from './ian-rules.js'
import { cleanString } from './util.js'

export const SCORE_CRITERIA = [
  'hook_filters',
  'single_message',
  'tangible_benefit',
  'no_repetition',
  'cold_direct_cta',
  'on_image_brevity',
  'faithful_to_facts',
  'register',
] as const

export type ScoreCriterion = (typeof SCORE_CRITERIA)[number]

const CRITERIA_TEXT: Record<AdLanguage, Record<ScoreCriterion, string>> = {
  es: {
    hook_filters: 'El titular filtra y segmenta al comprador en ≤3 s (contexto, precio, situación o prueba real).',
    single_message: 'Un solo mensaje claro en todo el anuncio.',
    tangible_benefit: 'Beneficio tangible y concreto, no abstracto ni slogan.',
    no_repetition: 'No reitera la misma idea entre titular, subtítulo, chips y caption.',
    cold_direct_cta: 'CTA frío, seco y directo; sin "por favor", sin despedidas ni saludos.',
    on_image_brevity: 'Texto en imagen breve y legible en celular.',
    faithful_to_facts: 'Solo usa hechos confirmados; nada inventado.',
    register: 'Respeta el registro e idioma pedidos.',
  },
  en: {
    hook_filters: 'Headline filters and segments the buyer in ≤3 s (context, price, situation or real proof).',
    single_message: 'One single clear message across the ad.',
    tangible_benefit: 'Tangible, concrete benefit, not abstract or a slogan.',
    no_repetition: 'Does not repeat the same idea across headline, subline, chips and caption.',
    cold_direct_cta: 'Cold, dry, direct CTA; no "please", sign-offs or greetings.',
    on_image_brevity: 'On-image text is brief and phone-legible.',
    faithful_to_facts: 'Uses confirmed facts only; nothing invented.',
    register: 'Respects the requested register and language.',
  },
}

export interface ScoreAdCopyInput {
  gateway: ModelGateway
  copy: AdCopy
  angle: AdAngle
  dna: BrandDna
  language: AdLanguage
  /** Optional offer, so offer facts count as confirmed context for the judge. */
  offer?: OfferInput
  model?: string
}

export interface ScoreAdCopyResult {
  /** 0–10, mean of criteria (or the judge's overall when criteria are missing). */
  score: number
  reasons: string[]
  criteria: Partial<Record<ScoreCriterion, number>>
  costUsd: number
  model: string
}

const clamp = (n: number) => Math.max(0, Math.min(10, n))

export async function scoreAdCopy(input: ScoreAdCopyInput): Promise<ScoreAdCopyResult> {
  const { gateway, copy, angle, dna, language } = input
  const es = language === 'es'
  const criteria = SCORE_CRITERIA.map((c) => `- ${c}: ${CRITERIA_TEXT[language][c]}`).join('\n')
  const system = [
    es
      ? 'Eres un juez estricto de anuncios estáticos de venta directa bajo el MÉTODO IAN (certeza total, cero saludos, gancho que filtra, desarrollo tangible, CTA frío, un solo mensaje).'
      : 'You are a strict judge of static direct-response ads under the IAN METHOD (total certainty, zero greetings, filtering hook, tangible development, cold CTA, one message).',
    es ? 'Puntúa cada criterio de 0 a 10:' : 'Score each criterion from 0 to 10:',
    criteria,
    registerInstruction(dna.register, language, dna.locale),
    es
      ? 'customerQuotes son frases reales de clientes: citarlas como voz del cliente es fiel a los hechos; convertirlas en promesa del producto no lo es. offerLine la pone el sistema desde hechos confirmados.'
      : 'customerQuotes are real customer words: quoting them as customer voice is faithful; turning them into product promises is not. offerLine is set by the system from confirmed facts.',
    es
      ? 'script es una versión hablada aparte (video UGC): que retome la idea del anuncio no es reiteración; no_repetition se juzga entre titular, subtítulo, chips y caption.'
      : 'script is a separate spoken version (UGC video): echoing the ad there is not repetition; judge no_repetition across headline, subline, chips and caption.',
    es
      ? 'Responde SOLO JSON: {"criteria":{"hook_filters":0,...},"overall":0,"reasons":["frase corta por cada punto débil"]}'
      : 'Reply with JSON only: {"criteria":{"hook_filters":0,...},"overall":0,"reasons":["short phrase per weak point"]}',
  ].join('\n\n')
  const user = JSON.stringify({
    brand: dna.brandName,
    category: dna.category,
    angle: { archetype: angle.archetype, hookType: angle.hookType, format: angle.format, message: angle.message, target: angle.target },
    confirmedFacts: confirmedFacts(input.offer ? mergeFacts(dna, input.offer) : dna.facts).map((f) => ({ key: f.key, value: f.value })),
    customerQuotes: dna.customerPhrases ?? [],
    copy,
  })
  const res = await gateway.json<{ criteria?: Record<string, unknown>; overall?: unknown; reasons?: unknown }>({
    system,
    user,
    model: input.model,
    temperature: 0,
    maxTokens: 600,
  })
  const data = res.data ?? {}
  const parsed: Partial<Record<ScoreCriterion, number>> = {}
  for (const c of SCORE_CRITERIA) {
    const v = Number((data.criteria ?? {})[c])
    if (Number.isFinite(v)) parsed[c] = clamp(v)
  }
  const values = Object.values(parsed) as number[]
  const overall = Number(data.overall)
  const score = values.length
    ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10
    : Number.isFinite(overall)
      ? clamp(overall)
      : 0
  const reasons = (Array.isArray(data.reasons) ? data.reasons : []).map((r) => cleanString(r)).filter(Boolean).slice(0, 10)
  return { score, reasons, criteria: parsed, costUsd: res.costUsd ?? 0, model: res.model }
}
