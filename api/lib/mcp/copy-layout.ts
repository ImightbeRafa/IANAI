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
  const facts = pick(() => true)
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
