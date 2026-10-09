/**
 * Ad Pack engine — the copy stage shared by the pack runner and the free preview (P0 #2b).
 *
 *   generate (≤ 2 tries on transport errors)
 *     → deterministic check
 *     → up to MAX_COPY_REPAIR_ROUNDS free repair rounds fed with the checker's detailed issues
 *       (field, sentence, offending tokens, nearest fact). Round 2 regenerates with another hook
 *       type when the hook itself was rejected (comparison without a verified fact, headline),
 *       otherwise it is a from-scratch rewrite of the failing sentences.
 *     → blocking issues left → the ad fails with those issues (never charged); the pack runner then
 *       retries the item automatically (#16, ≤ 2, new hook + retryHint) before reporting it failed.
 *
 * Repair rounds only cost model tokens (logged on the item), never credits.
 */
import { checkAdCopy, hasVerifiedComparison, repairAdCopy } from './check-copy.js'
import { generateAdCopy } from './copy.js'
import { ANGLE_CATEGORIES } from './angle-catalog.js'
import { confirmedFacts, mergeFacts } from './facts.js'
import type { AdAngle, AdCopy, AdLanguage, BrandDna, CopyCheckIssue, CopyCheckResult, HookType, ModelGateway, OfferInput } from './types.js'
import { errorMessage } from './util.js'

export const MAX_COPY_REPAIR_ROUNDS = 2

/** Copy issues that block shipping after the repair rounds (facts, compliance, broken text, required facts, urgency). */
export const BLOCKING_COPY_CODES: ReadonlySet<CopyCheckIssue['code']> = new Set([
  'unconfirmed_fact',
  'number_mismatch',
  'compliance',
  'forbidden_phrase',
  'placeholder',
  'empty_field',
  'locale_register',
  'missing_fact',
  'urgency',
])

/**
 * Owner text edits are also rejected when they break length limits or drop a required fact; their
 * own urgency / telegraphic wording is the owner's choice (not blocking).
 */
export const EDIT_BLOCKING_COPY_CODES: ReadonlySet<CopyCheckIssue['code']> = new Set(
  [...BLOCKING_COPY_CODES, 'too_long' as const].filter((c) => c !== 'urgency'),
)

/** Blocking issues for an offer: with a verified-claims bank an unverified comparison is an untraceable claim too. */
export function blockingIssuesFor(check: CopyCheckResult, offer: Pick<OfferInput, 'strictClaims'>, codes: ReadonlySet<CopyCheckIssue['code']> = BLOCKING_COPY_CODES): CopyCheckIssue[] {
  return check.issues.filter((i) => codes.has(i.code) || (i.code === 'unverified_comparison' && offer.strictClaims === true))
}

const FALLBACK_HOOKS: HookType[] = ['desire', 'curiosity', 'routine', 'identity', 'pain']

/**
 * Another hook type for a retry of this angle (P1 #10): from the angle category's hooks, never the
 * rejected one, never `comparison` without a verified comparison fact, never urgency unless the kit
 * allows it. Rotates with the attempt number.
 */
export function alternateHook(angle: AdAngle, dna: BrandDna, offer: OfferInput, attempt = 1): HookType {
  const confirmed = confirmedFacts(mergeFacts(dna, offer))
  const verifiedComparison = hasVerifiedComparison(confirmed)
  const current = angle.retry?.hookType ?? angle.hookType
  const own = angle.category ? ANGLE_CATEGORIES[angle.category].hooks : []
  const pool = [...own, ...FALLBACK_HOOKS].filter((h, i, all) =>
    all.indexOf(h) === i &&
    h !== current &&
    h !== angle.hookType &&
    h !== 'social_proof' &&
    (h !== 'comparison' || verifiedComparison) &&
    (h !== 'urgency_scarcity' || dna.allowUrgency === true) &&
    (h !== 'price_value' || confirmed.some((f) => f.key === 'price' || f.key === 'bundle')),
  )
  return pool[(Math.max(1, attempt) - 1) % Math.max(1, pool.length)] ?? 'desire'
}

/** The hook itself was rejected: a fresh copy with another hook beats patching the same idea. */
function hookRejected(blocking: CopyCheckIssue[]): boolean {
  return blocking.some((i) => i.code === 'unverified_comparison' || i.field === 'headline')
}

export interface WriteAdCopyInput {
  gateway: ModelGateway
  dna: BrandDna
  offer: OfferInput
  angle: AdAngle
  language: AdLanguage
  model?: string
  otherCopies?: AdCopy[]
  brief?: string
  /** Max free repair rounds (default MAX_COPY_REPAIR_ROUNDS). */
  maxRepairRounds?: number
  /** #16: automatic item retry — why the previous attempt was rejected (appended to the prompt). */
  retryHint?: string
  temperature?: number
}

export interface WriteAdCopyResult {
  /** True when no blocking issue is left. */
  ok: boolean
  copy?: AdCopy
  check?: CopyCheckResult
  /** Blocking issues left after the repair rounds (empty when ok). */
  blocking: CopyCheckIssue[]
  /** Model text cost of generation + repairs (USD; never credits). */
  costUsd: number
  /** Repair rounds spent (0–2). */
  repairRounds: number
  /** Set when round 2 regenerated with another hook (the angle the delivered copy was written for). */
  retryAngle?: AdAngle
  /** Transport error when no copy could be written at all. */
  error?: string
}

export async function writeAdCopy(input: WriteAdCopyInput): Promise<WriteAdCopyResult> {
  const { gateway, dna, offer, language } = input
  const maxRounds = Math.max(0, Math.min(MAX_COPY_REPAIR_ROUNDS, input.maxRepairRounds ?? MAX_COPY_REPAIR_ROUNDS))
  let angle = input.angle
  let cost = 0
  let gen: Awaited<ReturnType<typeof generateAdCopy>> | null = null
  let lastError = ''
  for (let attempt = 0; attempt < 2 && !gen; attempt++) {
    try {
      gen = await generateAdCopy({ gateway, dna, offer, angle, language, model: input.model, otherCopies: input.otherCopies, brief: input.brief, ...(input.retryHint ? { retryHint: input.retryHint } : {}), ...(input.temperature !== undefined ? { temperature: input.temperature } : {}) })
    } catch (error) {
      lastError = errorMessage(error)
    }
  }
  if (!gen) return { ok: false, blocking: [], costUsd: cost, repairRounds: 0, error: `copy_failed: ${lastError}` }
  cost += gen.costUsd
  let copy = gen.copy
  let check = gen.check
  let rounds = 0
  let retryAngle: AdAngle | undefined
  const recheck = (c: AdCopy, a: AdAngle) => checkAdCopy(c, { dna, offer, angle: a, language, otherCopies: input.otherCopies })
  while (!check.ok && rounds < maxRounds) {
    const blocking = blockingIssuesFor(check, offer)
    // Round 1 fixes anything (clichés, grammar too); round 2 only runs for blocking issues.
    if (rounds >= 1 && !blocking.length) break
    rounds++
    if (rounds === 2 && hookRejected(blocking)) {
      const prior = angle.retry
      const next: AdAngle = {
        ...angle,
        retry: {
          attempt: (prior?.attempt ?? 0) + 1,
          avoidHeadlines: [...new Set([...(prior?.avoidHeadlines ?? []), copy.headline].filter(Boolean))].slice(-4),
          hookType: alternateHook(angle, dna, offer, (prior?.attempt ?? 0) + 1),
        },
      }
      try {
        const regen = await generateAdCopy({ gateway, dna, offer, angle: next, language, model: input.model, otherCopies: input.otherCopies, brief: input.brief })
        cost += regen.costUsd
        const regenCheck = recheck(regen.copy, next)
        if (blockingIssuesFor(regenCheck, offer).length <= blocking.length) {
          copy = regen.copy
          check = regenCheck
          angle = next
          retryAngle = next
        }
      } catch {
        // keep the repaired copy; the item fails below if blocking issues remain
      }
      continue
    }
    const rep = await repairAdCopy({ gateway, copy, issues: check.issues, dna, offer, angle, language, otherCopies: input.otherCopies, model: input.model, round: rounds })
    cost += rep.costUsd
    copy = rep.copy
    check = rep.check
  }
  const blocking = blockingIssuesFor(check, offer)
  return { ok: blocking.length === 0, copy, check, blocking, costUsd: cost, repairRounds: rounds, ...(retryAngle ? { retryAngle } : {}) }
}
