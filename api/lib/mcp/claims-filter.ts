/**
 * Round 8: banned wording never reaches the Grok prompt or the code-rendered copy.
 *
 *  - the brand kit's `forbiddenPhrases` (literal, case / accent-insensitive), plus
 *  - a built-in list of regulated health claims the platform never wants on an ad ("sin efectos secundarios", "sin drogas ni químicos", "reducir el cortisol /
 *    la ansiedad", ...), because the offer texts saved by the brand often carry them and the engine injects those texts as "Contexto factual".
 *
 * Removal is CLAUSE-level (a clause ends at , ; . ! ? or a line break): the clause that carries a banned phrase is dropped, the rest of the text stays.
 */
const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

const BUILTIN: RegExp[] = [
  /\bsin (efectos? (secundarios?|adversos?|colaterales?)|drogas?|quimicos?|riesgos?|dependencia|contraindicaciones)\b/,
  /\b(reduc\w*|baj\w*|disminu\w*|calm\w*|elimin\w*|combat\w*|alivi\w*) (el |la |los |las |tu |su )?(cortisol|ansiedad|estres|insomnio|depresion)\b/,
  /\b(libre|libres) de (drogas|quimicos)\b/,
  /\bno (side effects|drugs|chemicals)\b/,
  /\b(without|free of) (side effects|drugs|chemicals)\b/,
  /\b(reduc\w*|lower\w*|cut\w*|relie\w*|cur\w*) (the |your )?(cortisol|anxiety|stress|insomnia)\b/,
]

/** Split at , ; . ! ? and line breaks, but NOT inside numbers ("₡12.900", "1,5"): the separator stays attached to its clause. */
function clauses(text: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    cur += ch
    const next = text[i + 1]
    const prev = text[i - 1]
    const digitsAround = /\d/.test(prev ?? '') && /\d/.test(next ?? '')
    const end = ch === '\n' || ((ch === ',' || ch === ';') && !digitsAround) || ((ch === '.' || ch === '!' || ch === '?') && (next === undefined || /\s/.test(next)))
    if (end) {
      // swallow the run of separators / one following space into the same clause
      while (i + 1 < text.length && /[,;.!?]/.test(text[i + 1])) { cur += text[++i] }
      out.push(cur)
      cur = ''
    }
  }
  if (cur) out.push(cur)
  return out
}

export type ClaimsFilterResult = { text: string; removed: string[] }

export function bannedMatcher(forbidden: string[] | null | undefined): (clause: string) => string | null {
  const lits = (forbidden || []).map((p) => p.trim()).filter(Boolean).map((p) => ({ raw: p, n: strip(p) }))
  return (clause: string) => {
    const n = strip(clause)
    for (const l of lits) if (n.includes(l.n)) return l.raw
    for (const re of BUILTIN) { const m = n.match(re); if (m) return m[0] }
    return null
  }
}

/** Drop every clause that carries a banned phrase. Returns the cleaned text and the removed phrases (as matched). */
export function scrubClaims(text: string, forbidden: string[] | null | undefined): ClaimsFilterResult {
  if (!text || !text.trim()) return { text: text || '', removed: [] }
  const hit = bannedMatcher(forbidden)
  const removed: string[] = []
  // keep the separator attached to its clause
  const parts = clauses(text)
  const kept: string[] = []
  for (const p of parts) {
    const h = hit(p)
    if (h) { removed.push(h); continue }
    kept.push(p)
  }
  if (!removed.length) return { text, removed: [] }
  let out = kept.join('').replace(/[ \t]+\n/g, '\n').replace(/\s{2,}/g, ' ').trim()
  // a clause removed at the end leaves a dangling comma / "y": close the sentence
  out = out.replace(/\s+(y|e|and|o|or)\s*([.,;])?$/i, '$2').replace(/[,;]\s*$/, '.')
  if (out && !/[.!?]$/.test(out) && !/\n/.test(text)) out = out
  return { text: out, removed }
}

/** Scrub each line of an on-image copy; a line that is entirely a banned clause is dropped. */
export function scrubCopy(copy: string, forbidden: string[] | null | undefined): ClaimsFilterResult {
  const removed: string[] = []
  const lines: string[] = []
  for (const line of copy.split(/\r?\n/)) {
    const r = scrubClaims(line, forbidden)
    removed.push(...r.removed)
    if (r.text.trim()) lines.push(r.text.trim())
  }
  return { text: lines.join('\n'), removed }
}

export const uniqueClaims = (xs: string[]): string[] => [...new Set(xs.map((x) => x.trim()).filter(Boolean))]
