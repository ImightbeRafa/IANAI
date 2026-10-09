/**
 * Pure, deterministic merge of DnaParts (+ offer form + user facts) into `BrandDna`.
 *
 * Precedence: user > offer_form > upload > website > instagram > inferred.
 * - Facts are deduped by key. Multi-valued keys (reviews, differentiators…) keep
 *   every distinct value; single-valued keys keep the winner and demote conflicting
 *   values to `custom:<key>_alt_<n>` with evidence, plus a note.
 * - Only user / offer_form facts are confirmed (brand_name read verbatim from the
 *   website is trivially exact and may stay confirmed).
 */

import type { AdLanguage, BrandDna, BusinessCategory, DnaFact, DnaVisual, FactKey, FactSource } from '../types.js'
import { detectCountryHint, detectLanguage, detectRegister, heuristicCategory, scoreCategories } from './classify.js'
import { cleanText, dedupeAudiences, makeFact, uniqStrings, type DnaPart } from './part.js'

export const SOURCE_PRECEDENCE: FactSource[] = ['user', 'offer_form', 'upload', 'website', 'instagram', 'inferred']

const rank = (source: FactSource): number => {
  const index = SOURCE_PRECEDENCE.indexOf(source)
  return index === -1 ? SOURCE_PRECEDENCE.length : index
}

/** Keys where several distinct values are expected and never conflict. */
export const MULTI_VALUE_KEYS: ReadonlySet<string> = new Set([
  'proof_review', 'proof_number', 'differentiator', 'result_claim', 'variants', 'contact_channel',
  'certification', 'ingredients_materials', 'usage_steps', 'bundle',
])

/** Keys whose value is trivially exact when read verbatim (not a marketing claim). */
const TRIVIALLY_EXACT_KEYS: ReadonlySet<string> = new Set(['brand_name'])

const ALT_RE = /^custom:(.+)_alt_\d+$/

export function isAltKey(key: string): boolean {
  return ALT_RE.test(key)
}

function isMultiValue(key: string): boolean {
  return MULTI_VALUE_KEYS.has(key) || (key.startsWith('custom:') && !isAltKey(key) && key !== 'custom:link_in_bio')
}

/** Accent/case/punctuation-insensitive value identity. Price-ish values compare by digits. */
export function normalizeFactValue(key: FactKey, value: string): string {
  const base = value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (key === 'price' || key === 'compare_at_price') {
    const digits = base.replace(/[.,](\d{2})(?!\d)/, '').replace(/\D/g, '')
    if (digits) return digits
  }
  return base.replace(/[^a-z0-9ñ]+/g, ' ').trim()
}

export interface OfferFormInput {
  name?: string
  brandName?: string
  /** Exact values typed by the user in the offer form. */
  facts?: Partial<Record<FactKey, string>> | DnaFact[]
  productImageUrls?: string[]
}

export interface UserFactInput {
  key: FactKey
  value: string
  evidence?: string
}

export interface BuildBrandDnaInput {
  website?: DnaPart | null
  instagram?: DnaPart | null
  uploads?: DnaPart | null
  offerForm?: OfferFormInput | null
  userFacts?: UserFactInput[] | null
  /** Overrides (e.g. from the async LLM classifier or the user). */
  category?: BusinessCategory
  language?: AdLanguage
  register?: BrandDna['register']
  /** Extra source entries (e.g. failed sources recorded by the orchestrator). */
  extraSources?: BrandDna['sources']
  extraNotes?: string[]
}

function offerFormFacts(form: OfferFormInput | null | undefined): DnaFact[] {
  if (!form) return []
  const out: DnaFact[] = []
  if (form.brandName?.trim()) out.push(makeFact('brand_name', form.brandName, 'offer_form', undefined, true))
  if (form.name?.trim()) out.push(makeFact('offer_name', form.name, 'offer_form', undefined, true))
  if (Array.isArray(form.facts)) {
    for (const fact of form.facts) {
      if (fact?.key && fact.value?.trim()) out.push({ ...fact, value: fact.value.trim(), source: 'offer_form', confirmed: true })
    }
  } else if (form.facts) {
    for (const [key, value] of Object.entries(form.facts) as Array<[FactKey, string | undefined]>) {
      if (typeof value === 'string' && value.trim()) out.push(makeFact(key, value, 'offer_form', undefined, true))
    }
  }
  return out
}

interface MergeFactsResult { facts: DnaFact[]; notes: string[] }

/** Dedupe + precedence + conflict demotion. Input order breaks ties within one source. */
export function mergeFacts(all: DnaFact[]): MergeFactsResult {
  const notes: string[] = []
  const indexed = all
    .filter((fact) => fact && fact.key && typeof fact.value === 'string' && fact.value.trim())
    .map((fact, order) => ({
      fact: {
        ...fact,
        value: fact.value.trim(),
        confirmed: fact.source === 'user' || fact.source === 'offer_form'
          ? true
          : TRIVIALLY_EXACT_KEYS.has(fact.key) && fact.source === 'website' ? Boolean(fact.confirmed) : false,
      },
      order,
    }))
    .sort((a, b) => rank(a.fact.source) - rank(b.fact.source) || a.order - b.order)

  const byKey = new Map<string, DnaFact[]>()
  const keyOrder: string[] = []
  for (const { fact } of indexed) {
    const list = byKey.get(fact.key)
    if (list) list.push(fact)
    else {
      byKey.set(fact.key, [fact])
      keyOrder.push(fact.key)
    }
  }

  const out: DnaFact[] = []
  const alts: DnaFact[] = []
  for (const key of keyOrder) {
    const list = byKey.get(key) || []
    const distinct: DnaFact[] = []
    const seen = new Map<string, DnaFact>()
    for (const fact of list) {
      const norm = normalizeFactValue(fact.key, fact.value)
      const existing = seen.get(norm)
      if (existing) {
        // Same value from a lower-precedence source: corroboration, keep evidence if missing.
        if (!existing.evidence && fact.evidence) existing.evidence = fact.evidence
        if (fact.confirmed) existing.confirmed = true
        continue
      }
      seen.set(norm, fact)
      distinct.push(fact)
    }
    if (isMultiValue(key) || distinct.length === 1) {
      out.push(...distinct.slice(0, isMultiValue(key) ? 8 : 1))
      continue
    }
    const [winner, ...losers] = distinct
    out.push(winner)
    losers.slice(0, 3).forEach((loser, index) => {
      const altKey = `custom:${key.replace(/^custom:/, '')}_alt_${index + 1}` as FactKey
      alts.push({
        key: altKey,
        value: loser.value,
        source: loser.source,
        confirmed: false,
        evidence: `conflicts with ${key}="${winner.value}" (${winner.source})${loser.evidence ? `; ${loser.evidence}` : ''}`.slice(0, 300),
      })
    })
    notes.push(`conflict:${key}: ${[winner, ...losers].map((f) => `"${f.value}" (${f.source})`).join(' vs ')}`.slice(0, 300))
  }
  return { facts: [...out, ...alts], notes }
}

const NO_SHIPPING_CATEGORIES: ReadonlySet<BusinessCategory> = new Set(['services_local', 'education', 'finance'])

/** Missing facts that would materially improve ads. Deterministic order. */
export function computeGaps(dna: Pick<BrandDna, 'facts' | 'category' | 'customerPhrases'>): FactKey[] {
  const has = (...keys: string[]) => dna.facts.some((fact) => keys.includes(fact.key) && fact.value.trim())
  const gaps: FactKey[] = []
  if (!has('price')) gaps.push('price')
  if (!NO_SHIPPING_CATEGORIES.has(dna.category) && !has('shipping', 'delivery_time')) gaps.push('delivery_time')
  if (!has('payment_methods')) gaps.push('payment_methods')
  if (!has('guarantee', 'returns')) gaps.push('guarantee')
  if (!has('proof_review', 'proof_number', 'custom:rating') && !(dna.customerPhrases && dna.customerPhrases.length)) gaps.push('proof_review')
  return gaps
}

function firstString(parts: Array<DnaPart | null | undefined>, pick: (p: DnaPart) => string | undefined): string | undefined {
  for (const part of parts) {
    const value = part ? cleanText(pick(part), 400) : ''
    if (value) return value
  }
  return undefined
}

function mergeLists(parts: Array<DnaPart | null | undefined>, pick: (p: DnaPart) => string[] | undefined, limit: number): string[] {
  return uniqStrings(parts.flatMap((part) => (part ? pick(part) || [] : [])), limit)
}

function mergeVisual(parts: Array<DnaPart | null | undefined>): DnaVisual {
  const visual: DnaVisual = {}
  const fields: Array<Exclude<keyof DnaVisual, 'formatsSeen' | 'styleProfile'>> = ['primaryColor', 'secondaryColor', 'accentColor', 'headingFont', 'bodyFont', 'headingFontUrl', 'bodyFontUrl', 'logoUrl', 'styleNotes']
  for (const field of fields) {
    for (const part of parts) {
      const value = part?.visual?.[field]
      if (typeof value === 'string' && value.trim()) {
        visual[field] = value.trim()
        break
      }
    }
  }
  const formats = [...new Set(parts.flatMap((part) => part?.visual?.formatsSeen || []))]
  if (formats.length) visual.formatsSeen = formats
  return visual
}

function buildOneLiner(brandName: string, facts: DnaFact[], parts: Array<DnaPart | null | undefined>): string {
  const fromPart = firstString(parts, (p) => p.oneLiner)
  if (fromPart) return fromPart.slice(0, 200)
  const offer = facts.find((f) => f.key === 'offer_name')?.value
  const diff = facts.find((f) => f.key === 'differentiator')?.value
  if (offer && diff) return `${brandName}: ${offer} — ${diff}`.slice(0, 200)
  if (offer) return `${brandName}: ${offer}`.slice(0, 200)
  if (diff) return `${brandName} — ${diff}`.slice(0, 200)
  return brandName
}

/** Pure + deterministic. */
export function buildBrandDna(input: BuildBrandDnaInput): BrandDna {
  // Part precedence for non-fact fields: upload > website > instagram.
  const parts = [input.uploads, input.website, input.instagram]
  const userFacts: DnaFact[] = (input.userFacts || [])
    .filter((f) => f && f.key && typeof f.value === 'string' && f.value.trim())
    .map((f) => makeFact(f.key, f.value, 'user', f.evidence, true))
  const allFacts: DnaFact[] = [
    ...userFacts,
    ...offerFormFacts(input.offerForm),
    ...(input.uploads?.facts || []),
    ...(input.website?.facts || []),
    ...(input.instagram?.facts || []),
  ]
  // Part brand names become brand_name facts so precedence + conflicts apply uniformly.
  for (const part of parts) {
    if (part?.brandName && !part.facts.some((f) => f.key === 'brand_name')) {
      allFacts.push(makeFact('brand_name', part.brandName, part.source, undefined, part.source === 'website'))
    }
  }
  const merged = mergeFacts(allFacts)
  const brandName = merged.facts.find((f) => f.key === 'brand_name')?.value || 'Marca'

  const textSample = [
    brandName,
    ...merged.facts.filter((f) => !isAltKey(f.key)).map((f) => f.value),
    ...parts.map((p) => p?.textSample || ''),
  ].join('\n')
  const language: AdLanguage = input.language || detectLanguage(textSample)
  const category: BusinessCategory = input.category || heuristicCategory(textSample) || scoreCategories(textSample)[0]?.category || 'other'
  const locationText = merged.facts.filter((f) => f.key === 'location').map((f) => f.value).join(' ')
  const register = input.register
    || (language === 'en' ? 'tuteo' : detectRegister(textSample, detectCountryHint(`${locationText}\n${textSample}`)))

  const customerPhrases = mergeLists(parts, (p) => p.customerPhrases, 15)
  const dna: BrandDna = {
    version: 1,
    brandName,
    category,
    language,
    register,
    oneLiner: buildOneLiner(brandName, merged.facts, parts),
    facts: merged.facts,
    visual: mergeVisual(parts),
    gaps: [],
    sources: [
      ...parts.filter((p): p is DnaPart => Boolean(p)).map((p) => p.sourceEntry),
      ...(input.extraSources || []),
    ].sort((a, b) => rank(a.kind) - rank(b.kind)),
  }
  const voice = firstString(parts, (p) => p.voice)
  if (voice) dna.voice = voice
  const lists: Array<[keyof Pick<BrandDna, 'pains' | 'desires' | 'objections' | 'forbiddenPhrases'>, number]> = [
    ['pains', 10], ['desires', 10], ['objections', 10], ['forbiddenPhrases', 20],
  ]
  for (const [field, limit] of lists) {
    const values = mergeLists(parts, (p) => p[field], limit)
    if (values.length) dna[field] = values
  }
  // #22: audiences from every source, near-duplicates merged into the most specific line, max 3.
  const audience = dedupeAudiences(mergeLists(parts, (p) => p.audience, 24), 3)
  if (audience.length) dna.audience = audience
  if (customerPhrases.length) dna.customerPhrases = customerPhrases

  const productImageUrls = uniqStrings([...(input.offerForm?.productImageUrls || []), ...(input.uploads?.productImageUrls || [])], 12)
  if (productImageUrls.length) dna.productImageUrls = productImageUrls
  const referenceImageUrls = mergeLists(parts, (p) => p.referenceImageUrls, 16)
  if (referenceImageUrls.length) dna.referenceImageUrls = referenceImageUrls
  const notes = uniqStrings([...merged.notes, ...parts.flatMap((p) => p?.notes || []), ...(input.extraNotes || [])], 30)
  if (notes.length) dna.notes = notes

  dna.gaps = computeGaps(dna)
  return dna
}
