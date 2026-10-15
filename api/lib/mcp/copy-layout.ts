/**
 * MCP copy layout cap: an ad carries at most a headline, ONE price line, ONE facts line and ONE CTA (plus the logo).
 * Longer copies are condensed deterministically; the overflow lines are returned so the caller can put them in the
 * caption instead (nothing is silently lost: they are reported in the result as `copyOverflow`).
 */
const CTA_RE = /(escrib|\bdm\b|whatsapp|wasap|pedí|pedi\b|comprá|compra\b|cotiz|reserv|ordená|mensaje|link en bio|visit|llamá|contact|order|buy|shop|message us|book|call)/i
export const PRICE_RE = /([₡$€£]\s?\d|\d[\d.,]*\s?(colones|usd|mxn|eur|dólares|dolares)\b|\bprecio\b|\bprice\b)/i

export type CappedCopy = { onImage: string; overflow: string[]; cta?: string; capped: boolean }

export function findCtaLine(lines: string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) if (CTA_RE.test(lines[i]) && !PRICE_RE.test(lines[i])) return lines[i]
  return undefined
}

/** 0 = shipping / delivery, 1 = has figures, 2 = other, 3 = age / "not included" notes (the least useful on the image). */
export const factRankOf = (l: string): number => (/env[ií]o|gratis|entrega|free shipping|shipping|delivery/i.test(l) ? 0 : /no incluid|años|edad|supervisi|not included|ages?\b/i.test(l) ? 3 : /\d/.test(l) ? 1 : 2)
export const rankFacts = (lines: string[]): string[] => lines.map((l, i) => ({ l, i })).sort((a, b) => factRankOf(a.l) - factRankOf(b.l) || a.i - b.i).map((x) => x.l)

/** Round 12: a multi-unit offer with a price ("2 kits por ₡29.800", "3 x ₡25.000", "2x1"). */
export const BUNDLE_RE = /(\b\d+\s*(?:x|×)\s*1\b)|(\b\d+\s*(?:kits?|unidades|bolsas?|cajas?|pares|paquetes|packs?|piezas|x|×)\b[^\n]{0,24}(?:₡|\$|colones|\bpor\b\s*\d))/i

export function capCopyBlocks(copy: string, maxBlocks = 4): CappedCopy {
  const lines = copy.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const cta = findCtaLine(lines)
  if (lines.length <= maxBlocks) return { onImage: lines.join('\n'), overflow: [], cta, capped: false }
  const used = new Set<number>()
  const pick = (pred: (line: string, i: number) => boolean): number => {
    const i = lines.findIndex((l, idx) => !used.has(idx) && pred(l, idx))
    if (i >= 0) used.add(i)
    return i
  }
  const ctaIdx = cta ? lines.lastIndexOf(cta) : -1
  if (ctaIdx >= 0) used.add(ctaIdx)
  const headline = pick(() => true)
  const price = pick((l) => PRICE_RE.test(l))
  // Round 8: the facts line that stays on the image is the most useful one (shipping / delivery first, then lines with figures, age / "not included" notes last), not just the first.
  const factRank = factRankOf
  const candidates = lines.map((l, idx) => ({ l, idx })).filter((c) => !used.has(c.idx))
  const factIdx = candidates.length ? candidates.reduce((best, c) => (factRank(c.l) < factRank(best.l) ? c : best), candidates[0]).idx : -1
  // Round 12: a bundle offer line ("2 kits por ₡29.800", "3x₡…", "2 bolsas por …") is the deal — it takes the facts
  // slot ahead of shipping / age notes (those go to the caption), never dropped for them.
  const bundleIdx = candidates.find((c) => BUNDLE_RE.test(c.l))?.idx ?? -1
  const facts = bundleIdx >= 0 ? (used.add(bundleIdx), bundleIdx) : factIdx >= 0 ? (used.add(factIdx), factIdx) : pick(() => true)
  const keep = [headline, price, facts, ctaIdx].filter((i) => i >= 0).sort((a, b) => a - b)
  const overflow = lines.filter((_, i) => !keep.includes(i))
  return { onImage: keep.map((i) => lines[i]).join('\n'), overflow, cta, capped: overflow.length > 0 }
}

const END_PUNCT_RE = /[.!?…:]$/

/**
 * Ready-to-paste caption (deterministic, no model call): the on-image headline / price / facts, then every line the
 * layout cap moved off the image (not-included, age, shipping detail …), then the CTA. Short, one idea per line,
 * es-CR voseo when the copy already uses it (nothing is reworded, only joined and punctuated).
 */
export function buildCaption(input: { onImage: string; overflow: string[]; cta?: string; language?: 'es' | 'en' }): string {
  const lines = input.onImage.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const cta = input.cta?.trim()
  const body = lines.filter((l) => l !== cta)
  const head = body[0]
  const rest = body.slice(1)
  const tidy = (l: string) => (END_PUNCT_RE.test(l) ? l : `${l}.`)
  const blocks: string[] = []
  if (head) blocks.push(END_PUNCT_RE.test(head) ? head : head)
  const facts = [...rest, ...input.overflow.map((l) => l.trim()).filter(Boolean)]
  const seen = new Set<string>()
  const uniq = facts.filter((l) => { const k = l.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
  if (uniq.length) blocks.push(uniq.map(tidy).join('\n'))
  if (cta) blocks.push(`👉 ${cta}`)
  return blocks.join('\n\n').slice(0, 1200)
}
