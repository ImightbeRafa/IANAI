/**
 * Layout-family assignment for a pack (pure, deterministic by seed).
 *
 * - With a Style DNA render profile (or an explicit family): its families, alternating in
 *   preference order, skipping a family only when it does not suit the format.
 * - Otherwise rotate across all families: at most ceil(2·n/10) ads per family (2 in a pack of
 *   10), never the same family twice in a row, format compatibility first (FAMILY_SPECS.formats),
 *   ties broken by a seeded shuffle.
 * - Variations of one angle (same copy) always get different families.
 */
import { ALL_FAMILIES, FAMILY_SPECS } from './render/families.js'
import type { AdFormat, LayoutFamily, StyleRenderProfile } from './types.js'
import { mulberry32, stableHash } from './util.js'

export interface FamilySlot {
  format: AdFormat
  /** Angle id (variations of the same angle share it). */
  angleId: string
}

export interface AssignFamiliesInput {
  slots: FamilySlot[]
  seed?: string | number
  /** Style DNA profile: families come from it. */
  profile?: Pick<StyleRenderProfile, 'families'> | null
  /** Force one family for every ad (agent / brand setting); variations still differ. */
  family?: LayoutFamily
}

export function maxPerFamily(n: number): number {
  return Math.max(1, Math.ceil((2 * n) / 10))
}

export function assignLayoutFamilies(input: AssignFamiliesInput): LayoutFamily[] {
  const n = input.slots.length
  const seed = typeof input.seed === 'number' ? input.seed >>> 0 : stableHash(String(input.seed ?? 'families'))
  const rnd = mulberry32(seed)
  const order = [...ALL_FAMILIES]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const rank = new Map(order.map((f, i) => [f, i]))
  const fits = (f: LayoutFamily, format: AdFormat) => FAMILY_SPECS[f].formats.includes(format)
  const usedByAngle = new Map<string, Set<LayoutFamily>>()
  const count = new Map<LayoutFamily, number>()
  const out: LayoutFamily[] = []

  const preferred: LayoutFamily[] | null = input.family ? [input.family] : input.profile?.families?.length ? [...new Set(input.profile.families)] : null

  input.slots.forEach((slot, i) => {
    const used = usedByAngle.get(slot.angleId) ?? new Set<LayoutFamily>()
    let pick: LayoutFamily | undefined
    if (preferred) {
      // Alternate the brand's families; a variation takes the next one not used by its angle.
      const pool = preferred.filter((f) => !used.has(f))
      const cycle = pool.length ? pool : preferred
      const k = out.filter((f) => preferred.includes(f)).length
      const rotated = [...cycle.slice(k % cycle.length), ...cycle.slice(0, k % cycle.length)]
      pick = rotated.find((f) => fits(f, slot.format) || preferred.length === 1) ?? rotated[0]
      if (used.has(pick)) {
        // Variation of an angle already in the brand's only family: closest compatible extra family.
        pick = order.find((f) => !used.has(f) && fits(f, slot.format)) ?? pick
      }
    } else {
      const cap = maxPerFamily(n)
      const prev = out[i - 1]
      const score = (f: LayoutFamily) =>
        (fits(f, slot.format) ? 0 : 100) + ((count.get(f) ?? 0) >= cap ? 150 : 0) + (f === prev ? 20 : 0) + (used.has(f) ? 200 : 0) + (count.get(f) ?? 0) * 3 + (rank.get(f) ?? 0) * 0.1
      pick = [...ALL_FAMILIES].sort((a, b) => score(a) - score(b))[0]
    }
    out.push(pick)
    count.set(pick, (count.get(pick) ?? 0) + 1)
    used.add(pick)
    usedByAngle.set(slot.angleId, used)
  })
  return out
}
