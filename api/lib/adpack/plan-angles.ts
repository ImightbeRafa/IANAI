/**
 * Ad Pack engine — deterministic angle planner (no LLM).
 *
 * Spreads `size` angles across IAN archetypes × hook types × formats using the
 * category pattern library and compliance rules. Every angle is tied to fact keys
 * that exist and are confirmed, targets come from DNA pains/desires/objections/
 * customer phrases/audience, and no two angles share (hookType, format) or message.
 */
import type {
  AdAngle,
  AdFormat,
  AdLanguage,
  BrandDna,
  DnaFact,
  FactKey,
  HookType,
  IanArchetype,
  ModelGateway,
  OfferInput,
} from './types.js'
import { isFormatAllowed } from './compliance.js'
import { briefForPrompt } from './copy-shared.js'
import { confirmedKeys, extractNumericClaims, getConfirmed, mergeFacts, numbersInFacts } from './facts.js'
import { ALL_ARCHETYPES, ALL_FORMATS, ALL_HOOKS, FORMAT_PATTERNS, getCategoryPattern, preferenceRank } from './patterns.js'
import { cleanString, mulberry32, normalizeText, stableHash } from './util.js'

export const DEFAULT_PACK_SIZE = 10
export const MAX_PACK_SIZE = 20

export interface PlanAnglesInput {
  dna: BrandDna
  offer: OfferInput
  size?: number
  language?: AdLanguage
  seed?: string | number
}

interface Ctx {
  keys: Set<FactKey>
  facts: DnaFact[]
  pains: string[]
  desires: string[]
  objections: string[]
  phrases: string[]
  audience: string[]
}

const has = (ctx: Ctx, ...keys: FactKey[]) => keys.some((k) => ctx.keys.has(k))
const list = (v: string[] | undefined) => (v ?? []).map((s) => cleanString(s)).filter(Boolean)

// ---------------------------------------------------------------------------
// Feasibility
// ---------------------------------------------------------------------------

function hookAvailable(hook: HookType, ctx: Ctx, relaxed: boolean): boolean {
  switch (hook) {
    case 'pain':
      return relaxed || ctx.pains.length > 0 || ctx.phrases.length > 0
    case 'desire':
      return relaxed || ctx.desires.length > 0 || ctx.phrases.length > 0
    case 'objection':
      return ctx.objections.length > 0 || has(ctx, 'guarantee', 'returns')
    case 'social_proof':
      return has(ctx, 'proof_review', 'proof_number', 'certification')
    case 'comparison':
      return has(ctx, 'differentiator', 'ingredients_materials', 'how_it_works')
    case 'price_value':
      return has(ctx, 'price', 'bundle')
    case 'urgency_scarcity':
      // Only "real" urgency: a confirmed bundle/promo or a concrete delivery time.
      return has(ctx, 'bundle', 'delivery_time')
    case 'curiosity':
      return relaxed || has(ctx, 'how_it_works', 'differentiator', 'ingredients_materials', 'usage_steps')
    case 'routine':
      return relaxed || has(ctx, 'usage_steps', 'how_it_works') || ctx.desires.length > 0
    case 'identity':
      return relaxed || ctx.audience.length > 0
  }
}

function archetypeAvailable(archetype: IanArchetype, ctx: Ctx, category: BrandDna['category'], relaxed: boolean): boolean {
  switch (archetype) {
    case 'venta_directa':
      return true
    case 'desvalidar_alternativas':
      return relaxed || has(ctx, 'differentiator', 'ingredients_materials', 'how_it_works') || ctx.objections.length > 0
    case 'mostrar_servicio':
      return has(ctx, 'how_it_works', 'usage_steps') || category === 'services_local'
    case 'variedad_productos':
      return has(ctx, 'variants')
    case 'paso_a_paso':
      return relaxed || has(ctx, 'usage_steps', 'how_it_works', 'payment_methods', 'shipping', 'delivery_time', 'contact_channel')
  }
}

function formatAvailable(format: AdFormat, ctx: Ctx, category: BrandDna['category'], relaxed: boolean): boolean {
  if (!isFormatAllowed(category, format)) return false
  switch (format) {
    case 'variant_card':
      return has(ctx, 'variants')
    case 'how_to_steps':
      return relaxed || has(ctx, 'usage_steps', 'how_it_works', 'payment_methods', 'shipping', 'contact_channel')
    case 'explainer':
      return relaxed || has(ctx, 'how_it_works', 'ingredients_materials', 'differentiator')
    case 'before_after':
      return relaxed || has(ctx, 'differentiator', 'how_it_works', 'result_claim') || ctx.pains.length > 0
    default:
      return true
  }
}

// ---------------------------------------------------------------------------
// Targets, fact keys, messages
// ---------------------------------------------------------------------------

function targetPools(hook: HookType, ctx: Ctx): string[][] {
  switch (hook) {
    case 'pain':
      return [ctx.pains, ctx.phrases]
    case 'desire':
      return [ctx.desires, ctx.phrases]
    case 'objection':
      return [ctx.objections, ctx.pains]
    case 'social_proof':
      return [ctx.phrases, ctx.desires]
    case 'comparison':
      return [ctx.objections, ctx.pains]
    case 'price_value':
      return [ctx.desires, ctx.objections]
    case 'urgency_scarcity':
      return [ctx.desires, ctx.pains]
    case 'curiosity':
      return [ctx.desires, ctx.pains, ctx.phrases]
    case 'routine':
      return [ctx.desires, ctx.pains]
    case 'identity':
      return [ctx.audience, ctx.desires]
  }
}

const HOOK_KEYS: Record<HookType, FactKey[]> = {
  pain: ['differentiator', 'how_it_works'],
  desire: ['differentiator', 'variants'],
  objection: ['guarantee', 'returns', 'delivery_time', 'shipping', 'payment_methods'],
  social_proof: ['proof_review', 'proof_number', 'certification'],
  comparison: ['differentiator', 'ingredients_materials', 'how_it_works'],
  price_value: ['price', 'compare_at_price', 'bundle', 'quantity_per_pack'],
  urgency_scarcity: ['bundle', 'delivery_time'],
  curiosity: ['how_it_works', 'differentiator', 'ingredients_materials'],
  routine: ['usage_steps', 'how_it_works'],
  identity: ['differentiator', 'variants'],
}

const ARCHETYPE_KEYS: Record<IanArchetype, FactKey[]> = {
  venta_directa: ['differentiator', 'price', 'shipping'],
  desvalidar_alternativas: ['differentiator', 'ingredients_materials'],
  mostrar_servicio: ['how_it_works', 'usage_steps', 'location'],
  variedad_productos: ['variants'],
  paso_a_paso: ['usage_steps', 'payment_methods', 'shipping', 'delivery_time', 'contact_channel'],
}

const FORMAT_KEYS: Record<AdFormat, FactKey[]> = {
  offer_graphic: ['price', 'bundle', 'shipping'],
  before_after: ['differentiator', 'result_claim'],
  how_to_steps: ['usage_steps', 'how_it_works'],
  variant_card: ['variants'],
  ugc_person: ['proof_review'],
  handheld_overlay: ['differentiator'],
  explainer: ['ingredients_materials', 'how_it_works'],
}

function factKeysFor(a: IanArchetype, h: HookType, f: AdFormat, ctx: Ctx): FactKey[] {
  const out: FactKey[] = []
  for (const k of ['offer_name', 'brand_name', ...HOOK_KEYS[h], ...ARCHETYPE_KEYS[a], ...FORMAT_KEYS[f]] as FactKey[]) {
    if (ctx.keys.has(k) && !out.includes(k)) out.push(k)
  }
  return out
}

/**
 * Primary confirmed fact value that anchors the message. Rotates across the pack:
 * the least-used candidate wins (ties keep hook/archetype order), so ten angles do
 * not all lean on the same fact (live benchmark: one ingredient line in 8/10 ads).
 */
function focusValue(a: IanArchetype, h: HookType, f: AdFormat, ctx: Ctx, used: Map<string, number>): string | undefined {
  const order: FactKey[] = [...HOOK_KEYS[h], ...ARCHETYPE_KEYS[a], ...FORMAT_KEYS[f], ...FOCUS_FALLBACK_KEYS].filter(
    (k) => !['price', 'compare_at_price', 'shipping', 'payment_methods'].includes(k)
  )
  const values: string[] = []
  for (const k of order) {
    const v = getConfirmed(ctx.facts, k)?.value
    if (v && v.length <= 80 && !values.includes(v)) values.push(v)
  }
  if (!values.length) return undefined
  // Only the first few candidates are relevant to this hook/archetype; rotate among them.
  const pool = values.slice(0, 3)
  return pool.reduce((best, v) => ((used.get(v) ?? 0) < (used.get(best) ?? 0) ? v : best), pool[0])
}

/** Generic facts that can anchor any angle once the hook-specific ones are used up. */
const FOCUS_FALLBACK_KEYS: FactKey[] = ['differentiator', 'how_it_works', 'ingredients_materials', 'usage_steps', 'quantity_per_pack', 'variants']

const HOOK_FRAMES: Record<AdLanguage, Record<HookType, (t: string) => string>> = {
  es: {
    pain: (t) => `Para quien vive "${t}":`,
    desire: (t) => `Para quien quiere "${t}":`,
    objection: (t) => `Desarma la duda "${t}":`,
    social_proof: (t) => `Prueba real ("${t}"):`,
    comparison: (t) => `Frente a la opción tradicional ("${t}"):`,
    price_value: (t) => `Valor claro por lo que pagás ("${t}"):`,
    urgency_scarcity: (t) => `Motivo concreto para pedir hoy ("${t}"):`,
    curiosity: (t) => `Lo que pocos saben sobre "${t}":`,
    routine: (t) => `Cómo entra en la rutina ("${t}"):`,
    identity: (t) => `Hecho para ${t}:`,
  },
  en: {
    pain: (t) => `For people dealing with "${t}":`,
    desire: (t) => `For people who want "${t}":`,
    objection: (t) => `Defuse the doubt "${t}":`,
    social_proof: (t) => `Real proof ("${t}"):`,
    comparison: (t) => `Versus the usual option ("${t}"):`,
    price_value: (t) => `Clear value for the price ("${t}"):`,
    urgency_scarcity: (t) => `A concrete reason to order today ("${t}"):`,
    curiosity: (t) => `What few people know about "${t}":`,
    routine: (t) => `How it fits the routine ("${t}"):`,
    identity: (t) => `Made for ${t}:`,
  },
}

const ARCHETYPE_FRAMES: Record<AdLanguage, Record<IanArchetype, (o: string, f?: string) => string>> = {
  es: {
    venta_directa: (o, f) => `${o} como la opción directa${f ? ` (${f})` : ''}.`,
    desvalidar_alternativas: (o, f) => `${o} supera a la alternativa común${f ? ` por ${f}` : ''}.`,
    mostrar_servicio: (o, f) => `así funciona ${o} de principio a fin${f ? ` (${f})` : ''}.`,
    variedad_productos: (o, f) => `una variante de ${o} para cada perfil${f ? ` (${f})` : ''}.`,
    paso_a_paso: (o, f) => `conseguir o usar ${o} en pasos simples${f ? ` (${f})` : ''}.`,
  },
  en: {
    venta_directa: (o, f) => `${o} as the direct choice${f ? ` (${f})` : ''}.`,
    desvalidar_alternativas: (o, f) => `${o} beats the usual alternative${f ? ` thanks to ${f}` : ''}.`,
    mostrar_servicio: (o, f) => `how ${o} works start to finish${f ? ` (${f})` : ''}.`,
    variedad_productos: (o, f) => `a ${o} variant for each profile${f ? ` (${f})` : ''}.`,
    paso_a_paso: (o, f) => `getting or using ${o} in simple steps${f ? ` (${f})` : ''}.`,
  },
}

const FORMAT_LABEL: Record<AdLanguage, Record<AdFormat, string>> = {
  es: {
    offer_graphic: 'oferta destacada',
    before_after: 'comparación lado a lado',
    how_to_steps: 'pasos numerados',
    variant_card: 'variante destacada',
    ugc_person: 'persona real usándolo',
    handheld_overlay: 'en mano, en uso',
    explainer: 'cómo funciona',
  },
  en: {
    offer_graphic: 'featured offer',
    before_after: 'side-by-side comparison',
    how_to_steps: 'numbered steps',
    variant_card: 'featured variant',
    ugc_person: 'real person using it',
    handheld_overlay: 'in hand, in use',
    explainer: 'how it works',
  },
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

interface Candidate {
  archetype: IanArchetype
  hookType: HookType
  format: AdFormat
  base: number
}

function buildCandidates(dna: BrandDna, ctx: Ctx, relaxed: boolean, rnd: () => number): Candidate[] {
  const cat = getCategoryPattern(dna.category)
  const out: Candidate[] = []
  for (const archetype of ALL_ARCHETYPES) {
    if (!archetypeAvailable(archetype, ctx, dna.category, relaxed)) continue
    for (const hookType of ALL_HOOKS) {
      if (!hookAvailable(hookType, ctx, relaxed)) continue
      for (const format of ALL_FORMATS) {
        if (!formatAvailable(format, ctx, dna.category, relaxed)) continue
        const fp = FORMAT_PATTERNS[format]
        if (!relaxed && !fp.archetypes.includes(archetype)) continue
        const base =
          (3 * preferenceRank(cat.formats, format)) / cat.formats.length +
          (2 * preferenceRank(cat.hooks, hookType)) / cat.hooks.length +
          (2 * preferenceRank(cat.archetypes, archetype)) / cat.archetypes.length +
          (fp.hooks.includes(hookType) ? 0 : 1) +
          (relaxed ? 3 : 0) +
          rnd() * 0.35
        out.push({ archetype, hookType, format, base })
      }
    }
  }
  return out
}

export function planAngles(input: PlanAnglesInput): AdAngle[] {
  const { dna, offer } = input
  const language: AdLanguage = input.language ?? dna.language ?? 'es'
  const size = Math.max(1, Math.min(MAX_PACK_SIZE, Math.floor(input.size ?? DEFAULT_PACK_SIZE) || DEFAULT_PACK_SIZE))
  const seedNum =
    typeof input.seed === 'number' ? input.seed >>> 0 : stableHash(String(input.seed ?? `${dna.brandName}|${offer.name}`))
  const rnd = mulberry32(seedNum)

  const facts = mergeFacts(dna, offer)
  const ctx: Ctx = {
    keys: confirmedKeys(facts),
    facts,
    pains: list(dna.pains),
    desires: list(dna.desires),
    objections: list(dna.objections),
    phrases: list(dna.customerPhrases),
    audience: list(dna.audience),
  }
  const offerName = cleanString(offer.name) || cleanString(dna.brandName)
  const fallbackTarget = cleanString(dna.oneLiner) || offerName

  const strict = buildCandidates(dna, ctx, false, rnd)
  const relaxed = buildCandidates(dna, ctx, true, rnd)

  const usedPairs = new Set<string>()
  const usedMessages = new Set<string>()
  const countA = new Map<IanArchetype, number>()
  const countH = new Map<HookType, number>()
  const countF = new Map<AdFormat, number>()
  const targetUse = new Map<string, number>()
  const focusUse = new Map<string, number>()
  const angles: AdAngle[] = []

  const usedTriples = new Set<string>()
  /**
   * `fill` = every distinct (hookType, format) pair is used up (narrow category / few facts):
   * reuse a pair with a different archetype so the plan still has exactly `size` angles
   * (F1: never plan fewer ads than were quoted and approved).
   */
  const pick = (pool: Candidate[], fill = false): Candidate | undefined => {
    let best: Candidate | undefined
    let bestScore = Infinity
    for (const c of pool) {
      if (!fill && usedPairs.has(`${c.hookType}|${c.format}`)) continue
      if (usedTriples.has(`${c.archetype}|${c.hookType}|${c.format}`)) continue
      const score =
        c.base +
        1.6 * (countA.get(c.archetype) ?? 0) +
        1.2 * (countF.get(c.format) ?? 0) +
        1.0 * (countH.get(c.hookType) ?? 0) +
        (angles.length === 0 && c.archetype !== 'venta_directa' ? 2 : 0) +
        (fill && usedPairs.has(`${c.hookType}|${c.format}`) ? 4 : 0)
      if (score < bestScore) {
        bestScore = score
        best = c
      }
    }
    return best
  }

  while (angles.length < size) {
    const c = pick(strict) ?? pick(relaxed) ?? pick(relaxed, true)
    if (!c) break
    usedPairs.add(`${c.hookType}|${c.format}`)
    usedTriples.add(`${c.archetype}|${c.hookType}|${c.format}`)
    countA.set(c.archetype, (countA.get(c.archetype) ?? 0) + 1)
    countH.set(c.hookType, (countH.get(c.hookType) ?? 0) + 1)
    countF.set(c.format, (countF.get(c.format) ?? 0) + 1)

    const focus = focusValue(c.archetype, c.hookType, c.format, ctx, focusUse)
    if (focus) focusUse.set(focus, (focusUse.get(focus) ?? 0) + 1)
    const archetypeText = ARCHETYPE_FRAMES[language][c.archetype](offerName, focus)
    // Candidate targets: least-used first, then pool order.
    // Primary pool wins; secondary pools only once primary targets are well used.
    const rank = new Map<string, number>()
    targetPools(c.hookType, ctx).forEach((pool, poolIndex) => {
      for (const t of pool) if (!rank.has(t)) rank.set(t, poolIndex * 1.5)
    })
    const ordered = [...rank.keys()]
    if (!ordered.length) ordered.push(fallbackTarget)
    const cost = (t: string) => (targetUse.get(t) ?? 0) + (rank.get(t) ?? 0)
    ordered.sort((x, y) => cost(x) - cost(y))

    let target = ordered[0]
    let message = `${HOOK_FRAMES[language][c.hookType](target)} ${archetypeText}`
    for (const t of ordered) {
      const m = `${HOOK_FRAMES[language][c.hookType](t)} ${archetypeText}`
      if (!usedMessages.has(normalizeText(m))) {
        target = t
        message = m
        break
      }
    }
    if (usedMessages.has(normalizeText(message))) {
      message = `${message.replace(/\.$/, '')} — ${FORMAT_LABEL[language][c.format]}.`
    }
    for (let n = 2; usedMessages.has(normalizeText(message)); n++) {
      message = `${message.replace(/(?: · v\d+)?\.$/, '')} · v${n}.`
    }
    usedMessages.add(normalizeText(message))
    targetUse.set(target, (targetUse.get(target) ?? 0) + 1)

    const index = angles.length + 1
    angles.push({
      id: `a${String(index).padStart(2, '0')}-${c.archetype}-${c.hookType}-${c.format}`,
      archetype: c.archetype,
      hookType: c.hookType,
      format: c.format,
      message,
      target,
      factKeys: factKeysFor(c.archetype, c.hookType, c.format, ctx),
    })
  }
  return angles
}

// ---------------------------------------------------------------------------
// Exact pack plan (quote == approval == execution)
// ---------------------------------------------------------------------------

export type AnglePlanErrorReason = 'unknown_angle_ids' | 'infeasible'

export class AnglePlanError extends Error {
  readonly reason: AnglePlanErrorReason
  readonly details: Record<string, unknown>
  constructor(reason: AnglePlanErrorReason, message: string, details: Record<string, unknown>) {
    super(message)
    this.name = 'AnglePlanError'
    this.reason = reason
    this.details = details
  }
}

/**
 * The exact angles a pack will run — the single function behind quote, approval and start,
 * so the approved count can never silently shrink (F1).
 *
 * - No `angleIds`: exactly `size` angles (planAngles fills); fewer → AnglePlanError('infeasible').
 * - `angleIds`: resolved against the full MAX_PACK_SIZE board. The planner is greedy and
 *   prefix-stable for one dna/offer/seed, so ids from a board of ANY size resolve to the same
 *   angles (before: the ids were filtered against a re-plan of `size`, so ids beyond that size
 *   were dropped silently — 2 approved ads became 1). Unknown ids → AnglePlanError('unknown_angle_ids').
 */
export function resolvePackAngles(input: PlanAnglesInput & { angleIds?: string[] }): AdAngle[] {
  const ids = input.angleIds?.length ? [...new Set(input.angleIds)] : null
  if (!ids) {
    const size = Math.max(1, Math.min(MAX_PACK_SIZE, Math.floor(input.size ?? DEFAULT_PACK_SIZE) || DEFAULT_PACK_SIZE))
    const angles = planAngles({ ...input, size })
    if (angles.length < size) {
      throw new AnglePlanError('infeasible', `Only ${angles.length} distinct angles can be planned for this offer (asked for ${size}); lower size or add facts`, {
        requested: size,
        feasible: angles.length,
      })
    }
    return angles
  }
  const board = planAngles({ ...input, size: MAX_PACK_SIZE })
  const known = new Set(board.map((a) => a.id))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length) {
    throw new AnglePlanError('unknown_angle_ids', `Unknown angle ids for this offer: ${unknown.slice(0, 5).join(', ')} — use ids from adpack_angles for this brand/offer`, {
      unknownAngleIds: unknown,
    })
  }
  const keep = new Set(ids)
  return board.filter((a) => keep.has(a.id))
}

// ---------------------------------------------------------------------------
// Optional LLM refinement (wording only)
// ---------------------------------------------------------------------------

export interface RefineAnglesInput {
  gateway: ModelGateway
  angles: AdAngle[]
  dna: BrandDna
  offer: OfferInput
  language?: AdLanguage
  model?: string
  /** Owner's campaign brief: theme/emphasis only; numbers no confirmed fact backs are stripped. */
  brief?: string
}

export interface RefineAnglesResult {
  angles: AdAngle[]
  costUsd: number
  refined: number
  error?: string
}

/**
 * Ask the model to sharpen `message`/`target` wording only. Structure (id,
 * archetype, hookType, format, factKeys) never changes. Any refined text that
 * introduces numbers not present in confirmed facts, duplicates another message
 * or is empty is discarded. Never throws.
 */
export async function refineAnglesWithLlm(input: RefineAnglesInput): Promise<RefineAnglesResult> {
  const { gateway, angles, dna, offer } = input
  const language: AdLanguage = input.language ?? dna.language ?? 'es'
  const facts = mergeFacts(dna, offer)
  const allowedNums = numbersInFacts(facts.filter((f) => f.confirmed))
  const system =
    language === 'es'
      ? 'Sos estratega de anuncios de venta directa (método IAN). Reescribí SOLO el texto de "message" (un único mensaje de venta, ≤ 22 palabras, concreto y tangible) y "target" (el dolor/deseo/objeción en palabras del cliente, ≤ 12 palabras). No cambies ids ni agregues cifras, precios, plazos o promesas nuevas. "campaignContext" (si existe) es solo dirección creativa del dueño (tema, temporada, énfasis), nunca un dato ni una promesa. Responde SOLO JSON: {"angles":[{"id":"...","message":"...","target":"..."}]}'
      : 'You are a direct-response ad strategist (IAN method). Rewrite ONLY "message" (one single selling message, ≤ 22 words, concrete and tangible) and "target" (the pain/desire/objection in customer words, ≤ 12 words). Do not change ids or add new figures, prices, timings or promises. "campaignContext" (when present) is creative direction from the owner only (theme, season, emphasis), never a fact or a promise. Reply with JSON only: {"angles":[{"id":"...","message":"...","target":"..."}]}'
  const campaignContext = briefForPrompt(input.brief, facts.filter((f) => f.confirmed))
  const user = JSON.stringify({
    brand: dna.brandName,
    offer: offer.name,
    voice: dna.voice ?? '',
    // Creative direction only (theme / season / emphasis) — never a fact, number or promise.
    ...(campaignContext ? { campaignContext } : {}),
    angles: angles.map((a) => ({ id: a.id, archetype: a.archetype, hookType: a.hookType, format: a.format, message: a.message, target: a.target })),
  })
  try {
    const res = await gateway.json<{ angles?: Array<{ id?: unknown; message?: unknown; target?: unknown }> }>({
      system,
      user,
      model: input.model,
      temperature: 0.4,
      maxTokens: 1800,
    })
    const byId = new Map<string, { message: string; target: string }>()
    for (const r of res.data?.angles ?? []) {
      if (typeof r?.id !== 'string') continue
      byId.set(r.id, { message: cleanString(r.message), target: cleanString(r.target) })
    }
    const seen = new Set<string>()
    let refined = 0
    const out = angles.map((a) => {
      const r = byId.get(a.id)
      const ok = (text: string, max: number) =>
        text.length > 0 &&
        text.length <= max &&
        extractNumericClaims(text).every((c) => allowedNums.has(c.value) || extractNumericClaims(a.message + ' ' + a.target).some((o) => o.value === c.value))
      const message = r && ok(r.message, 220) && !seen.has(normalizeText(r.message)) ? r.message : a.message
      const target = r && ok(r.target, 140) ? r.target : a.target
      if (message !== a.message || target !== a.target) refined++
      seen.add(normalizeText(message))
      return { ...a, message, target }
    })
    // Final guard: if any refined message collides with an original, revert all.
    if (seen.size !== out.length) return { angles, costUsd: res.costUsd, refined: 0, error: 'duplicate_messages' }
    return { angles: out, costUsd: res.costUsd, refined }
  } catch (error) {
    return { angles, costUsd: 0, refined: 0, error: error instanceof Error ? error.message : String(error) }
  }
}
