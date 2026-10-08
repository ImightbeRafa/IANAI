/**
 * Ad Pack engine — small pure helpers (text normalization, similarity,
 * deterministic PRNG, concurrency limiter). No runtime deps.
 */

/** Lowercase, strip accents/diacritics, collapse whitespace. */
export function normalizeText(text: string): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Words = whitespace tokens that contain at least one letter or digit. */
export function words(text: string): string[] {
  return String(text ?? '')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
}

export function wordCount(text: string | undefined): number {
  return text ? words(text).length : 0
}

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'y', 'o', 'a', 'en', 'con', 'por', 'para',
  'que', 'tu', 'su', 'tus', 'sus', 'es', 'al', 'lo', 'se', 'te', 'mi', 'sin', 'mas', 'muy', 'ya',
  'the', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'your', 'you', 'is', 'it', 'at', 'by', 'from',
])

/** Content-word token set for similarity checks. */
export function contentTokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of normalizeText(text).split(/[^a-z0-9]+/)) {
    if (!raw || STOPWORDS.has(raw)) continue
    out.add(raw)
  }
  return out
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union ? inter / union : 0
}

export function textSimilarity(a: string, b: string): number {
  return jaccard(contentTokens(a), contentTokens(b))
}

/** FNV-1a 32-bit hash, stable across runtimes. */
export function stableHash(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Deterministic PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Run `fn` over `items` with at most `limit` in flight; preserves order. Never rejects. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length)
  const max = Math.max(1, Math.floor(limit) || 1)
  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = { ok: true, value: await fn(items[i], i) }
      } catch (error) {
        results[i] = { ok: false, error }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(max, items.length) }, () => worker()))
  return results
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : JSON.stringify(error)
}

/** Trim, strip wrapping quotes, collapse whitespace. */
export function cleanString(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
    .trim()
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
