/**
 * Ad Pack engine — deterministic angle planner (no LLM).
 *
 * Spreads `size` angles across the shared angle catalog (angle-catalog.ts: regalo, cómo
 * funciona, valor/precio, qué incluye, uso real, detalle técnico, comparación, temporada,
 * problema→solución, prueba social) × IAN archetypes × hook types × formats, using the
 * category pattern library and compliance rules. Every angle is tied to fact keys that exist
 * and are confirmed, targets come from DNA pains/desires/objections/customer phrases/audience,
 * no two angles share (hookType, format) or message, and each carries a short rationale.
 * Ids are catalog ids (`<category>-<hookType>-<format>`), stable across pack sizes.
 */
import type {
  AdAngle,
  AngleCategory,
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
import { ANGLE_CATEGORIES, ALL_ANGLE_CATEGORIES, angleId, angleRationale, archetypeFor, parseAngleId, type CategoryContext } from './angle-catalog.js'
import { hasCliche } from './cliches.js'
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
  /** Owner campaign brief (enables the season/date category). Never a fact. */
  brief?: string
  /** Preferred hook type (from the brand's Style DNA winners). */
  preferHook?: HookType
}

interface Ctx {
  keys: Set<FactKey>
  cat: CategoryContext
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
  category: AngleCategory
  base: number
}

function buildCandidates(dna: BrandDna, ctx: Ctx, relaxed: boolean, rnd: () => number, preferHook?: HookType): Candidate[] {
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
          (preferHook && preferHook === hookType ? -0.6 : 0) +
          rnd() * 0.35
        // One candidate per catalog category that can honestly carry this hook.
        for (const category of ALL_ANGLE_CATEGORIES) {
          const spec = ANGLE_CATEGORIES[category]
          if (!spec.hooks.includes(hookType) || !spec.available(ctx.cat, relaxed)) continue
          const fit = (spec.formats.includes(format) ? 0 : 0.9) + (spec.archetypes.includes(archetype) ? 0 : 0.6) + preferenceRank(spec.hooks, hookType) * 0.15
          out.push({ archetype, hookType, format, category, base: base + fit })
        }
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
  const keys = confirmedKeys(facts)
  const ctx: Ctx = {
    keys,
    cat: categoryContext(dna, keys, input.brief),
    facts,
    pains: list(dna.pains),
    desires: list(dna.desires),
    objections: list(dna.objections),
    phrases: list(dna.customerPhrases),
    audience: list(dna.audience),
  }
  const offerName = cleanString(offer.name) || cleanString(dna.brandName)
  const fallbackTarget = cleanString(dna.oneLiner) || offerName

  const strict = buildCandidates(dna, ctx, false, rnd, input.preferHook)
  const relaxed = buildCandidates(dna, ctx, true, rnd, input.preferHook)

  const usedPairs = new Set<string>()
  const usedMessages = new Set<string>()
  const countA = new Map<IanArchetype, number>()
  const countH = new Map<HookType, number>()
  const countF = new Map<AdFormat, number>()
  const countC = new Map<AngleCategory, number>()
  const targetUse = new Map<string, number>()
  const focusUse = new Map<string, number>()
  const angles: AdAngle[] = []

  const usedTriples = new Set<string>()
  const usedIds = new Set<string>()
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
      // Catalog ids (<category>-<hook>-<format>) stay unique even when fill reuses a pair.
      if (usedIds.has(angleId(c.category, c.hookType, c.format))) continue
      const score =
        c.base +
        1.6 * (countA.get(c.archetype) ?? 0) +
        1.2 * (countF.get(c.format) ?? 0) +
        1.0 * (countH.get(c.hookType) ?? 0) +
        1.5 * (countC.get(c.category) ?? 0) +
        // A gift angle is the most-missed sale for physical products: surface it once.
        (c.category === 'regalo' && !countC.get('regalo') && angles.length > 0 ? -1.4 : 0) +
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
    usedIds.add(angleId(c.category, c.hookType, c.format))
    countA.set(c.archetype, (countA.get(c.archetype) ?? 0) + 1)
    countH.set(c.hookType, (countH.get(c.hookType) ?? 0) + 1)
    countF.set(c.format, (countF.get(c.format) ?? 0) + 1)
    countC.set(c.category, (countC.get(c.category) ?? 0) + 1)

    const focus = focusValue(c.archetype, c.hookType, c.format, ctx, focusUse)
    if (focus) focusUse.set(focus, (focusUse.get(focus) ?? 0) + 1)
    const archetypeText = ARCHETYPE_FRAMES[language][c.archetype](offerName, focus)
    // Candidate targets: least-used first, then pool order.
    // Primary pool wins; secondary pools only once primary targets are well used.
    const rank = new Map<string, number>()
    categoryPools(c.category, c.hookType, ctx).forEach((pool, poolIndex) => {
      for (const t of pool) if (!rank.has(t)) rank.set(t, poolIndex * 1.5)
    })
    const ordered = [...rank.keys()]
    if (!ordered.length) ordered.push(fallbackTarget)
    const cost = (t: string) => (targetUse.get(t) ?? 0) + (rank.get(t) ?? 0)
    ordered.sort((x, y) => cost(x) - cost(y))

    const frame = ANGLE_CATEGORIES[c.category].frame[language]
    let target = ordered[0]
    let message = `${frame(target)} ${archetypeText}`
    for (const t of ordered) {
      const m = `${frame(t)} ${archetypeText}`
      if (hasCliche(m)) continue
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

    angles.push({
      id: angleId(c.category, c.hookType, c.format),
      archetype: c.archetype,
      hookType: c.hookType,
      format: c.format,
      message,
      target,
      factKeys: factKeysFor(c.archetype, c.hookType, c.format, ctx),
      category: c.category,
      rationale: angleRationale(c.category, c.format, language, focus),
      sceneDirection: ANGLE_CATEGORIES[c.category].scene,
      source: 'planner',
    })
  }
  return angles
}

function categoryContext(dna: BrandDna, keys: Set<FactKey>, brief?: string): CategoryContext {
  return {
    keys,
    category: dna.category,
    pains: list(dna.pains).length + list(dna.customerPhrases).length,
    desires: list(dna.desires).length,
    objections: list(dna.objections).length,
    hasBrief: Boolean(brief && brief.trim()),
  }
}

/** Target pools: the category's own lists first, then the hook's. */
function categoryPools(category: AngleCategory, hook: HookType, ctx: Ctx): string[][] {
  const lists = { pains: ctx.pains, desires: ctx.desires, objections: ctx.objections, phrases: ctx.phrases, audience: ctx.audience }
  return [...ANGLE_CATEGORIES[category].targetPools.map((k) => lists[k]), ...targetPools(hook, ctx)]
}

// ---------------------------------------------------------------------------
// Angles by id (catalog ids from adpack_angles / guide_bulk_angles / an agent)
// ---------------------------------------------------------------------------

export interface AngleFromIdInput {
  id: string
  dna: BrandDna
  offer: OfferInput
  language?: AdLanguage
  brief?: string
  /** Wording from the angle source (guide board): kept untruncated, sanitized by the caller. */
  hook?: string
  message?: string
  target?: string
  source?: AdAngle['source']
}

export type AngleFromIdResult = { ok: true; angle: AdAngle } | { ok: false; reason: string }

/**
 * Build the angle a catalog id names for this offer, with the same honesty rules as the
 * planner: the category must be available for the confirmed facts (prueba_social only with
 * verified proof, valor_precio only with a price…) and the format allowed for the category.
 */
export function angleFromId(input: AngleFromIdInput): AngleFromIdResult {
  const parsed = parseAngleId(input.id)
  if (!parsed) return { ok: false, reason: 'unknown angle id' }
  const { dna, offer } = input
  const language: AdLanguage = input.language ?? dna.language ?? 'es'
  const facts = mergeFacts(dna, offer)
  const keys = confirmedKeys(facts)
  const ctx: Ctx = {
    keys,
    cat: categoryContext(dna, keys, input.brief),
    facts,
    pains: list(dna.pains),
    desires: list(dna.desires),
    objections: list(dna.objections),
    phrases: list(dna.customerPhrases),
    audience: list(dna.audience),
  }
  const spec = ANGLE_CATEGORIES[parsed.category]
  if (!spec.available(ctx.cat, true)) return { ok: false, reason: `category ${parsed.category} needs facts this offer does not have` }
  if (parsed.hookType === 'social_proof' && !hookAvailable('social_proof', ctx, true)) return { ok: false, reason: 'social proof needs a confirmed review, number or certification' }
  if (parsed.hookType === 'price_value' && !hookAvailable('price_value', ctx, true)) return { ok: false, reason: 'price/value needs a confirmed price or bundle' }
  if (!isFormatAllowed(dna.category, parsed.format)) return { ok: false, reason: `format ${parsed.format} is not allowed for ${dna.category}` }
  if (parsed.format === 'variant_card' && !keys.has('variants')) return { ok: false, reason: 'variant_card needs confirmed variants' }
  const archetype = parsed.archetype ?? archetypeFor(parsed.category, parsed.format)
  const offerName = cleanString(offer.name) || cleanString(dna.brandName)
  const focus = focusValue(archetype, parsed.hookType, parsed.format, ctx, new Map())
  const pools = categoryPools(parsed.category, parsed.hookType, ctx)
  const target = cleanString(input.target) || pools.flat()[0] || cleanString(dna.oneLiner) || offerName
  const message =
    cleanString(input.message) || `${spec.frame[language](target)} ${ARCHETYPE_FRAMES[language][archetype](offerName, focus)}`
  return {
    ok: true,
    angle: {
      id: angleId(parsed.category, parsed.hookType, parsed.format),
      archetype,
      hookType: parsed.hookType,
      format: parsed.format,
      message,
      target,
      factKeys: factKeysFor(archetype, parsed.hookType, parsed.format, ctx),
      category: parsed.category,
      rationale: angleRationale(parsed.category, parsed.format, language, focus),
      sceneDirection: spec.scene,
      ...(input.hook ? { hook: input.hook } : {}),
      source: input.source ?? 'agent',
    },
  }
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
 * The exact angles a pack will run — the ONE resolver behind quote, approval and start, so
 * the approved count can never silently shrink (F1). Variations multiply this list (planPack).
 *
 * - No selection: exactly `size` angles (planAngles fills); fewer → AnglePlanError('infeasible').
 * - Selection = guide angles (`angles`, already rebuilt against the offer's facts) first, then
 *   `angleIds` in the given order. Each id is resolved against the full MAX_PACK_SIZE board (the
 *   planner is greedy and prefix-stable for one dna/offer/seed, so ids from a board of ANY size
 *   resolve to the same angles), else built from the shared catalog (`<category>-<hook>-<format>`,
 *   or a legacy `aNN-archetype-hook-format` id) with the planner's honesty rules.
 *   Ids that cannot be honored → AnglePlanError('unknown_angle_ids') listing every one
 *   (`unknownAngleIds` + `rejectedAngles[{id, reason}]`) — never dropped.
 */
export function resolvePackAngles(input: PlanAnglesInput & { angleIds?: string[]; angles?: AdAngle[] }): AdAngle[] {
  const ids = input.angleIds?.length ? [...new Set(input.angleIds)] : null
  const guide = input.angles?.length ? input.angles : null
  if (!ids && !guide) {
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
  const out: AdAngle[] = []
  const seen = new Set<string>()
  for (const a of guide ?? []) {
    if (seen.has(a.id)) continue
    seen.add(a.id)
    out.push(a)
  }
  if (!ids) return out
  const board = new Map(planAngles({ ...input, size: MAX_PACK_SIZE }).map((a) => [a.id, a]))
  const rejected: Array<{ id: string; reason: string }> = []
  for (const id of ids) {
    if (seen.has(id)) continue
    const hit = board.get(id)
    if (hit) {
      out.push(hit)
      seen.add(id)
      continue
    }
    const built = angleFromId({ id, dna: input.dna, offer: input.offer, language: input.language, brief: input.brief, source: 'agent' })
    if (!built.ok) {
      rejected.push({ id, reason: built.reason })
      continue
    }
    seen.add(id)
    if (seen.has(built.angle.id) && built.angle.id !== id) continue
    seen.add(built.angle.id)
    out.push(built.angle)
  }
  if (rejected.length) {
    throw new AnglePlanError(
      'unknown_angle_ids',
      `Unknown or unusable angle ids for this offer: ${rejected.slice(0, 5).map((r) => `${r.id} (${r.reason})`).join('; ')} — use ids from adpack_angles / guide_bulk_angles for this brand/offer`,
      { unknownAngleIds: rejected.map((r) => r.id), rejectedAngles: rejected },
    )
  }
  return out
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
