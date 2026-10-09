/**
 * Structured brand kit profile (brand_kits.brand_profile, migration 085) — owner feedback B3/E3/C5.
 *
 * Holds what the classic kit columns cannot: several audiences with age range +
 * geo, locale + Spanish register as a HARD rule, do / don't lists, logo variants,
 * Style DNA selection, and uploaded winner ads / documents.
 *
 * Pure (no I/O). URL checks are injected so callers can reuse their own validator.
 */
import { isPlaceholderValue, stripPlaceholderParts, type IgnoredPlaceholder } from './placeholder-guard.js'

export type BrandRegister = 'voseo' | 'tuteo' | 'usted'
export type BrandLogoVariantKind = 'primary' | 'light' | 'dark' | 'badge' | 'wordmark' | 'icon'

export interface BrandAudience {
  label: string
  ageMin?: number
  ageMax?: number
  geo?: string
}

export interface BrandLogoVariant {
  url: string
  variant: BrandLogoVariantKind
  /** Original external URL when the file was copied into Advance storage. */
  sourceUrl?: string
}

export interface BrandDocument {
  url: string
  filename?: string
}

export interface BrandProfile {
  audiences?: BrandAudience[]
  locale?: string
  register?: BrandRegister
  do?: string[]
  dont?: string[]
  logoVariants?: BrandLogoVariant[]
  styleDnaIds?: string[]
  /** #22: the brand's default offer (set_default_offer), used when a tool omits offerId. */
  defaultOfferId?: string
  winnerAdUrls?: string[]
  documents?: BrandDocument[]
  updatedAt?: string
}

export class BrandProfileError extends Error {
  readonly code = 'BAD_INPUT'
  constructor(field: string, message: string) {
    super(`${field}: ${message}`)
    this.name = 'BrandProfileError'
  }
}

const REGISTERS: ReadonlySet<string> = new Set(['voseo', 'tuteo', 'usted'])
const VARIANTS: ReadonlySet<string> = new Set(['primary', 'light', 'dark', 'badge', 'wordmark', 'icon'])
const LOCALE_RE = /^[a-z]{2}(?:-[A-Z]{2})?$/
const MAX_ITEMS = 20
const MAX_TEXT = 200

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

function cleanText(field: string, raw: unknown, ignored: IgnoredPlaceholder[], max = MAX_TEXT): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') throw new BrandProfileError(field, 'must be a string')
  const v = raw.replace(/\s+/g, ' ').trim()
  if (!v) return undefined
  if (v.length > max) throw new BrandProfileError(field, `must be at most ${max} characters`)
  if (isPlaceholderValue(v)) {
    ignored.push({ field, value: v })
    return undefined
  }
  return v
}

function cleanList(field: string, raw: unknown, ignored: IgnoredPlaceholder[]): string[] {
  if (raw === null) return []
  if (!Array.isArray(raw)) throw new BrandProfileError(field, 'must be an array of strings')
  if (raw.length > MAX_ITEMS) throw new BrandProfileError(field, `at most ${MAX_ITEMS} items`)
  const out: string[] = []
  raw.forEach((item, i) => {
    const v = cleanText(`${field}[${i}]`, item, ignored)
    if (v && !out.includes(v)) out.push(v)
  })
  return out
}

function age(field: string, raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 100) throw new BrandProfileError(field, 'must be a whole number 0–100')
  return raw
}

export interface ParseBrandProfileOptions {
  /** Validates + normalizes an https URL (throws on bad input). */
  assertUrl: (url: string, label: string) => string
  /** Style DNA ids that exist on the kit; styleDnaIds must be a subset. */
  knownStyleDnaIds?: string[]
  now?: () => Date
}

/** Keys of BrandProfile accepted in a patch (top-level replace semantics; null clears). */
export const BRAND_PROFILE_PATCH_KEYS = ['audiences', 'locale', 'register', 'do', 'dont', 'logoVariants', 'styleDnaIds', 'defaultOfferId', 'winnerAdUrls', 'documents'] as const

export function parseBrandProfilePatch(
  patch: Record<string, unknown>,
  existing: BrandProfile | null | undefined,
  options: ParseBrandProfileOptions,
): { profile: BrandProfile; ignoredPlaceholders: IgnoredPlaceholder[]; changedKeys: string[] } {
  const ignored: IgnoredPlaceholder[] = []
  const next: BrandProfile = { ...(existing ?? {}) }
  const changed: string[] = []
  const has = (key: string) => Object.prototype.hasOwnProperty.call(patch, key)
  const set = <K extends keyof BrandProfile>(key: K, value: BrandProfile[K] | undefined, keepEmpty = false) => {
    changed.push(key)
    if (value === undefined || (Array.isArray(value) && !value.length && !keepEmpty)) delete next[key]
    else next[key] = value
  }

  if (has('audiences')) {
    const raw = patch.audiences
    if (raw === null) set('audiences', undefined)
    else {
      if (!Array.isArray(raw)) throw new BrandProfileError('audiences', 'must be an array of { label, ageMin?, ageMax?, geo? }')
      if (raw.length > 8) throw new BrandProfileError('audiences', 'at most 8 audiences')
      const audiences: BrandAudience[] = []
      raw.forEach((a, i) => {
        if (!isObj(a)) throw new BrandProfileError(`audiences[${i}]`, 'must be { label, ageMin?, ageMax?, geo? }')
        const label = cleanText(`audiences[${i}].label`, a.label, ignored, 160)
        const ageMin = age(`audiences[${i}].ageMin`, a.ageMin)
        const ageMax = age(`audiences[${i}].ageMax`, a.ageMax)
        if (ageMin !== undefined && ageMax !== undefined && ageMin > ageMax) throw new BrandProfileError(`audiences[${i}]`, 'ageMin must be ≤ ageMax')
        const geo = cleanText(`audiences[${i}].geo`, a.geo, ignored, 120)
        if (!label) return // placeholder or empty label: the whole audience says nothing
        audiences.push({ label, ...(ageMin !== undefined ? { ageMin } : {}), ...(ageMax !== undefined ? { ageMax } : {}), ...(geo ? { geo } : {}) })
      })
      set('audiences', audiences)
    }
  }
  if (has('locale')) {
    const raw = patch.locale
    if (raw !== null && (typeof raw !== 'string' || !LOCALE_RE.test(raw))) throw new BrandProfileError('locale', 'must look like "es-CR" or "en"')
    set('locale', (raw as string | null) ?? undefined)
  }
  if (has('register')) {
    const raw = patch.register
    if (raw !== null && (typeof raw !== 'string' || !REGISTERS.has(raw))) throw new BrandProfileError('register', 'must be voseo, tuteo or usted')
    set('register', (raw as BrandRegister | null) ?? undefined)
  }
  if (has('do')) set('do', cleanList('do', patch.do, ignored))
  if (has('dont')) set('dont', cleanList('dont', patch.dont, ignored))
  if (has('logoVariants')) {
    const raw = patch.logoVariants
    if (raw === null) set('logoVariants', undefined)
    else {
      if (!Array.isArray(raw) || raw.length > 8) throw new BrandProfileError('logoVariants', 'must be an array (max 8) of { url, variant }')
      const variants: BrandLogoVariant[] = raw.map((v, i) => {
        if (!isObj(v) || typeof v.url !== 'string') throw new BrandProfileError(`logoVariants[${i}]`, 'must be { url, variant }')
        const variant = typeof v.variant === 'string' && VARIANTS.has(v.variant) ? v.variant as BrandLogoVariantKind : null
        if (!variant) throw new BrandProfileError(`logoVariants[${i}].variant`, 'must be primary, light, dark, badge, wordmark or icon')
        return {
          url: options.assertUrl(v.url, `logoVariants[${i}].url`),
          variant,
          ...(typeof v.sourceUrl === 'string' && v.sourceUrl ? { sourceUrl: v.sourceUrl } : {}),
        }
      })
      set('logoVariants', variants)
    }
  }
  if (has('styleDnaIds')) {
    // #12: [] is an explicit "no Style DNA" (kept); null clears the selection (every kit Style DNA applies).
    if (patch.styleDnaIds === null) set('styleDnaIds', undefined)
    else {
      const ids = cleanList('styleDnaIds', patch.styleDnaIds, ignored)
      const known = options.knownStyleDnaIds
      const unknown = known ? ids.filter((id) => !known.includes(id)) : []
      if (unknown.length) throw new BrandProfileError('styleDnaIds', `unknown Style DNA id(s): ${unknown.join(', ')} (see list_style_dnas)`)
      set('styleDnaIds', ids, true)
    }
  }
  if (has('defaultOfferId')) {
    const raw = patch.defaultOfferId
    if (raw !== null && (typeof raw !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw))) throw new BrandProfileError('defaultOfferId', 'must be an offer id (uuid) or null')
    set('defaultOfferId', (raw as string | null) ?? undefined)
  }
  if (has('winnerAdUrls')) {
    const raw = patch.winnerAdUrls
    if (raw !== null && (!Array.isArray(raw) || raw.length > MAX_ITEMS)) throw new BrandProfileError('winnerAdUrls', `must be an array of https URLs (max ${MAX_ITEMS})`)
    set('winnerAdUrls', raw === null ? undefined : (raw as unknown[]).map((u, i) => {
      if (typeof u !== 'string') throw new BrandProfileError(`winnerAdUrls[${i}]`, 'must be a URL string')
      return options.assertUrl(u, `winnerAdUrls[${i}]`)
    }))
  }
  if (has('documents')) {
    const raw = patch.documents
    if (raw !== null && (!Array.isArray(raw) || raw.length > MAX_ITEMS)) throw new BrandProfileError('documents', `must be an array (max ${MAX_ITEMS}) of { url, filename? }`)
    set('documents', raw === null ? undefined : (raw as unknown[]).map((d, i) => {
      if (!isObj(d) || typeof d.url !== 'string') throw new BrandProfileError(`documents[${i}]`, 'must be { url, filename? }')
      return { url: options.assertUrl(d.url, `documents[${i}].url`), ...(typeof d.filename === 'string' && d.filename.trim() ? { filename: d.filename.trim().slice(0, 120) } : {}) }
    }))
  }
  if (changed.length) next.updatedAt = (options.now ?? (() => new Date()))().toISOString()
  return { profile: next, ignoredPlaceholders: ignored, changedKeys: changed }
}

/** Tolerant read of a stored brand_profile (never throws, drops placeholders). */
export function readBrandProfile(raw: unknown): BrandProfile | null {
  if (!isObj(raw) || !Object.keys(raw).length) return null
  const out: BrandProfile = {}
  for (const key of BRAND_PROFILE_PATCH_KEYS) {
    if (!(key in raw)) continue
    try {
      Object.assign(out, parseBrandProfilePatch({ [key]: raw[key] }, out, { assertUrl: (u) => {
        if (!/^https:\/\//i.test(u)) throw new Error('https only')
        return u
      } }).profile)
    } catch {
      // skip a corrupt key
    }
  }
  delete out.updatedAt
  if (typeof raw.updatedAt === 'string') out.updatedAt = raw.updatedAt
  return Object.keys(out).length ? out : null
}

/**
 * #12: the kit Style DNAs that may shape a pack. `useStyleDna: false` → none; a saved
 * `styleDnaIds` selection → exactly those ([] = none, never an implicit dna_1); no selection → all.
 */
export function activeStyleDnaIds(allIds: string[], profile: BrandProfile | null | undefined, useStyleDna?: boolean): string[] {
  if (useStyleDna === false) return []
  const selected = profile?.styleDnaIds
  if (selected) return allIds.filter((id) => selected.includes(id))
  return allIds
}

/** One human line per audience for the DNA ("Papás 30–45, GAM"); placeholders never survive. */
export function audienceLines(profile: BrandProfile | null | undefined): string[] {
  const out: string[] = []
  for (const a of profile?.audiences ?? []) {
    const ages = a.ageMin !== undefined && a.ageMax !== undefined
      ? ` ${a.ageMin}–${a.ageMax}`
      : a.ageMin !== undefined ? ` ${a.ageMin}+` : ''
    const line = stripPlaceholderParts([`${a.label}${ages}`, a.geo ?? ''].filter(Boolean).join(', '))
    if (line && !out.includes(line)) out.push(line)
  }
  return out
}
