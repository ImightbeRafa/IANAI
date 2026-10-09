/**
 * Bridge between the bulk angle board (`guide_bulk_angles`) and the Ad Pack.
 *
 * Every board item gets an `adpackAngleId` (shared catalog id) and an `adpackAngle`
 * {id, category, hookType, format, message, target, hook} that `adpack_start {angles}` accepts
 * as-is. The board's own wording (title, why it buys, full hook) travels untruncated; the
 * service rebuilds the angle against the offer's confirmed facts, so honesty rules still apply.
 */
import { ANGLE_CATEGORIES, angleId, categoryFromText, isAngleCategory, parseAngleId, type AngleCategory } from './angle-catalog.js'
import { hasCliche } from './cliches.js'
import type { AdFormat, AdLanguage, HookType } from './types.js'

export interface GuideBoardItemLike {
  id?: string
  title?: string
  niche?: string
  whyItBuys?: string
  hookStyle?: string
  /** Full hook line (never truncated). */
  hook?: string
  frameworkHint?: string
  /** Optional explicit category / format from the model. */
  category?: string
  format?: string
}

/** What adpack_start {angles: [...]} accepts (also returned by guide_bulk_angles). */
export interface AdpackAngleInput {
  id: string
  category: AngleCategory
  hookType: HookType
  format: AdFormat
  /** Internal single message (from the board's title / why it buys). */
  message: string
  /** Buyer niche / pain the angle targets. */
  target: string
  /** Full hook line suggested by the board (inspiration for the headline). */
  hook?: string
  rationale: string
}

const FORMATS: AdFormat[] = ['offer_graphic', 'before_after', 'how_to_steps', 'variant_card', 'ugc_person', 'handheld_overlay', 'explainer']
/** Categories that need verified facts the board cannot see: mapped to an honest neighbour. */
const NEEDS_FACTS: Partial<Record<AngleCategory, { category: AngleCategory; hook: HookType }>> = {
  prueba_social: { category: 'uso_real', hook: 'identity' },
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/**
 * Map board items to adpack angles with unique (hookType, format) pairs (the pack's diversity
 * rule). Deterministic for the same board.
 */
export function boardToAdpackAngles(items: GuideBoardItemLike[], language: AdLanguage): AdpackAngleInput[] {
  const used = new Set<string>()
  return items.map((item, i) => {
    const text = [item.category, item.hookStyle, item.frameworkHint, item.title, item.whyItBuys, item.hook].filter(Boolean).join(' · ')
    let { category, hookType } = isAngleCategory(item.category) ? { category: item.category, hookType: ANGLE_CATEGORIES[item.category].hooks[0] } : categoryFromText(text)
    const swap = NEEDS_FACTS[category]
    if (swap) ({ category, hook: hookType } = { category: swap.category, hook: swap.hook })
    const spec = ANGLE_CATEGORIES[category]
    const preferred = FORMATS.includes(item.format as AdFormat) ? [item.format as AdFormat, ...spec.formats] : spec.formats
    const rotated = [...preferred.slice(i % preferred.length), ...preferred.slice(0, i % preferred.length)]
    const hooks = [hookType, ...spec.hooks.filter((h) => h !== hookType)]
    let format = rotated[0]
    let hook = hooks[0]
    search: for (const h of hooks) {
      for (const f of [...rotated, ...FORMATS]) {
        if (!used.has(`${h}|${f}`)) {
          format = f
          hook = h
          break search
        }
      }
    }
    used.add(`${hook}|${format}`)
    const hookLine = clean(item.hook, 400) || clean(item.title, 300)
    const why = clean(item.whyItBuys, 600)
    const target = clean(item.niche, 200) || clean(item.title, 200)
    const message = [clean(item.title, 300), why].filter(Boolean).join(' — ') || spec.frame[language](target || '—')
    return {
      id: angleId(category, hook, format),
      category,
      hookType: hook,
      format,
      message,
      target,
      ...(hookLine && !hasCliche(hookLine) ? { hook: hookLine } : {}),
      rationale: why || spec.why[language],
    }
  })
}

/** Loose validation of `angles` objects passed to adpack_start (from guide_bulk_angles / an agent). */
export function parseAdpackAngleInputs(raw: unknown, max: number): { ok: true; angles: AdpackAngleInput[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, angles: [] }
  if (!Array.isArray(raw)) return { ok: false, error: 'angles must be an array of adpackAngle objects (from guide_bulk_angles)' }
  if (raw.length > max) return { ok: false, error: `at most ${max} angles` }
  const out: AdpackAngleInput[] = []
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i] as Record<string, unknown>
    if (!a || typeof a !== 'object') return { ok: false, error: `angles[${i}] must be an object` }
    const parsed = typeof a.id === 'string' ? parseAngleId(a.id) : null
    if (!parsed) return { ok: false, error: `angles[${i}].id must be a catalog angle id like "regalo-desire-handheld_overlay"` }
    out.push({
      id: angleId(parsed.category, parsed.hookType, parsed.format),
      category: parsed.category,
      hookType: parsed.hookType,
      format: parsed.format,
      message: clean(a.message, 600),
      target: clean(a.target, 200),
      ...(clean(a.hook, 400) ? { hook: clean(a.hook, 400) } : {}),
      rationale: clean(a.rationale, 300),
    })
  }
  return { ok: true, angles: out }
}
