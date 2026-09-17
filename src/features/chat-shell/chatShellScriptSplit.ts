import { parseScripts } from '../../utils/scriptParser'
import type { ScriptSectionsDto } from '../../utils/scriptSections'

export interface SplitOfferScript {
  index: number
  title: string
  content: string
  scriptTypeLabel?: string
  totalSeconds?: number
}

/**
 * Split one /api/chat response into individual scripts for artifact rows.
 * Prefers structured `scripts[]` DTO when present; otherwise tolerant parse.
 */
function asSplitScript(
  index: number,
  title: string,
  content: string,
  extra?: { scriptTypeLabel?: string; totalSeconds?: number }
): SplitOfferScript {
  const script: SplitOfferScript = { index, title, content }
  if (extra?.scriptTypeLabel) script.scriptTypeLabel = extra.scriptTypeLabel
  if (extra?.totalSeconds) script.totalSeconds = extra.totalSeconds
  return script
}

export function splitOfferScriptContent(
  content: string,
  fallbackTitle: string,
  scriptsDto?: ScriptSectionsDto[] | null
): SplitOfferScript[] {
  if (Array.isArray(scriptsDto) && scriptsDto.length > 0) {
    return scriptsDto.map((dto) => asSplitScript(
      dto.index || 1,
      dto.title || fallbackTitle,
      dto.content || content,
      { scriptTypeLabel: dto.scriptTypeLabel, totalSeconds: dto.totalSeconds }
    ))
  }

  const trimmed = (content || '').trim()
  if (!trimmed) return []

  const parsed = parseScripts(trimmed)
  if (parsed.length >= 2) {
    return parsed.map((p) => asSplitScript(
      p.index,
      p.title || fallbackTitle,
      p.content || trimmed,
      { scriptTypeLabel: p.scriptTypeLabel, totalSeconds: p.totalSeconds }
    ))
  }

  if (parsed.length === 1) {
    return [asSplitScript(
      parsed[0].index || 1,
      fallbackTitle,
      parsed[0].content || trimmed,
      { scriptTypeLabel: parsed[0].scriptTypeLabel, totalSeconds: parsed[0].totalSeconds }
    )]
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
