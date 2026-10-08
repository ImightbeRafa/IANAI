/**
 * Brand DNA ingest — internal shapes + small runtime-agnostic helpers.
 * Each source (website / instagram / uploads) produces a `DnaPart`; `merge.ts`
 * folds parts into the shared `BrandDna` contract.
 */

import type { AdFormat, BrandDna, DnaFact, DnaVisual, FactKey, FactSource } from '../types.js'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type DnaSourceEntry = BrandDna['sources'][number]

/** Partial Brand DNA contributed by one source. */
export interface DnaPart {
  source: FactSource
  sourceEntry: DnaSourceEntry
  brandName?: string
  oneLiner?: string
  voice?: string
  audience?: string[]
  pains?: string[]
  desires?: string[]
  objections?: string[]
  customerPhrases?: string[]
  forbiddenPhrases?: string[]
  facts: DnaFact[]
  visual: DnaVisual
  productImageUrls?: string[]
  referenceImageUrls?: string[]
  /** Free text used by category / register / language detection. */
  textSample?: string
  notes?: string[]
  costUsd: number
}

export const KNOWN_FACT_KEYS: ReadonlySet<string> = new Set([
  'brand_name', 'offer_name', 'price', 'compare_at_price', 'bundle', 'shipping', 'delivery_time',
  'payment_methods', 'guarantee', 'returns', 'ingredients_materials', 'how_it_works', 'usage_steps',
  'variants', 'quantity_per_pack', 'proof_review', 'proof_number', 'certification', 'location',
  'contact_channel', 'differentiator', 'result_claim',
])

export const AD_FORMATS: ReadonlySet<AdFormat> = new Set<AdFormat>([
  'offer_graphic', 'before_after', 'how_to_steps', 'variant_card', 'ugc_person', 'handheld_overlay', 'explainer',
])

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'fact'
}

/** Coerces a model-provided key into a valid FactKey (`custom:<slug>` when unknown). */
export function toFactKey(raw: unknown): FactKey | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim()
  if (!key) return null
  if (KNOWN_FACT_KEYS.has(key)) return key as FactKey
  if (key.startsWith('custom:')) return `custom:${slugify(key.slice(7))}`
  return `custom:${slugify(key)}`
}

/** Removes emoji / pictographs and collapses whitespace. */
export function stripEmoji(value: string): string {
  return value
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function cleanText(value: unknown, max = 400): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

export function uniqStrings(values: Array<string | null | undefined>, limit = 50): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (!value) continue
    const norm = value.toLowerCase()
    if (seen.has(norm)) continue
    seen.add(norm)
    out.push(value)
    if (out.length >= limit) break
  }
  return out
}

export function stringArray(raw: unknown, limit = 12, max = 200): string[] {
  if (!Array.isArray(raw)) return []
  return uniqStrings(raw.map((item) => cleanText(item, max)), limit)
}

export function makeFact(key: FactKey, value: string, source: FactSource, evidence?: string, confirmed = false): DnaFact {
  const fact: DnaFact = { key, value: value.trim(), source, confirmed }
  const ev = evidence?.trim()
  if (ev) fact.evidence = ev.slice(0, 300)
  return fact
}

/** Model-output facts → validated DnaFact[] (never confirmed). */
export function factsFromModel(raw: unknown, source: FactSource, limit = 20): DnaFact[] {
  if (!Array.isArray(raw)) return []
  const out: DnaFact[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const key = toFactKey(row.key)
    const value = cleanText(row.value, 240)
    if (!key || !value) continue
    out.push(makeFact(key, value, source, cleanText(row.evidence, 300) || undefined))
    if (out.length >= limit) break
  }
  return out
}

export function formatsFromModel(raw: unknown): AdFormat[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((item): item is AdFormat => typeof item === 'string' && AD_FORMATS.has(item as AdFormat)))]
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())
}

export class DnaTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`)
    this.name = 'DnaTimeoutError'
  }
}

/** Races a promise against a timer; the timer is always cleared. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DnaTimeoutError(label, ms)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/** Reads a response body up to `maxBytes` (then stops reading) and decodes it as UTF-8. */
export async function readTextCapped(response: Response, maxBytes: number): Promise<string> {
  const body = response.body
  if (!body || typeof body.getReader !== 'function') {
    const text = await response.text()
    return text.slice(0, maxBytes)
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    try { await reader.cancel() } catch { /* already closed */ }
  }
  const merged = new Uint8Array(Math.min(total, maxBytes))
  let offset = 0
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.max(0, merged.byteLength - offset))
    merged.set(slice, offset)
    offset += slice.byteLength
    if (offset >= merged.byteLength) break
  }
  return new TextDecoder('utf-8').decode(merged)
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
