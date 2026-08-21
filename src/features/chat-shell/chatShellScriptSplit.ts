import { parseScripts } from '../../utils/scriptParser'

export interface SplitOfferScript {
  index: number
  title: string
  content: string
}

/**
 * Split one /api/chat response into individual scripts for artifact rows.
 * Falls back to a single script when headers are absent.
 */
export function splitOfferScriptContent(
  content: string,
  fallbackTitle: string
): SplitOfferScript[] {
  const trimmed = (content || '').trim()
  if (!trimmed) return []

  const parsed = parseScripts(trimmed)
  if (parsed.length >= 2) {
    return parsed.map((p) => ({
      index: p.index,
      title: p.title || fallbackTitle,
      content: p.content || trimmed,
    }))
  }

  if (parsed.length === 1) {
    return [{
      index: parsed[0].index || 1,
      title: fallbackTitle,
      content: parsed[0].content || trimmed,
    }]
  }

  return [{ index: 1, title: fallbackTitle, content: trimmed }]
}

/**
 * Assign global ordinals offer-first, script-second.
 * Two offers × two scripts → ordinals 1..4.
 */
export function assignGlobalScriptOrdinals<T extends { scripts: SplitOfferScript[] }>(
  offers: T[]
): Array<T & { scripts: Array<SplitOfferScript & { ordinal: number }> }> {
  let ordinal = 1
  return offers.map((offer) => ({
    ...offer,
    scripts: offer.scripts.map((script) => ({
      ...script,
      ordinal: ordinal++,
    })),
  }))
}
