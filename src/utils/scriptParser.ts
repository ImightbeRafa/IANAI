import { parseScriptBatch } from './scriptSections'

export interface ParsedScript {
  index: number
  title: string
  content: string
  scriptTypeLabel?: string
  totalSeconds?: number
}

/**
 * Parses an AI response containing multiple scripts into individual scripts.
 * Uses the shared tolerant parser (GUIÓN/OPCIÓN, v2 OPCIÓN, markdown headers).
 */
export function parseScripts(text: string): ParsedScript[] {
  const options = parseScriptBatch(text)
  if (!options.length) return []
  return options.map((option) => ({
    index: option.index,
    title: option.title || `Script ${option.index}`,
    content: option.content || option.sections.map((s) => s.text).join('\n\n'),
    scriptTypeLabel: option.scriptTypeLabel || undefined,
    totalSeconds: option.totalSeconds || undefined,
  }))
}

/**
 * Check if an AI message likely contains script content (vs conversational reply)
 */
export function isScriptContent(text: string): boolean {
  if (text.length < 150) return false

  // If there are 2+ distinct script headers (GUIÓN #1, GUIÓN #2, etc.),
  // it's definitely script content — covers recognition/awareness scripts
  // that lack Gancho/Desarrollo/CTA structure.
  const headerMatches = text.match(/(?:GUI[OÓ]N|SCRIPT|OPCI[OÓ]N|Gui[oó]n|Script|Opci[oó]n)\s*#?\s*\d/gi)
  if (headerMatches && headerMatches.length >= 2) return true

  // A single script header with substantial content is still a script
  // (covers single reconocimiento / awareness scripts without Gancho/CTA)
  const singleHeader = text.match(/(?:GUI[OÓ]N|SCRIPT|OPCI[OÓ]N|Gui[oó]n|Script|Opci[oó]n)\s*#?\s*\d/i)
  if (singleHeader && text.length >= 200) return true

  const scriptIndicators = [
    /GUI[OÓ]N\s*#?\s*\d/i,
    /SCRIPT\s*#?\s*\d/i,
    /OPCI[OÓ]N\s*#?\s*\d/i,
    /Gancho|Hook/i,
    /Desarrollo|Development/i,
    /Cierre|Closing|CTA/i,
    /\(0[–-]\d+s?\)/,
    /\(\d+[–-]\d+s?\)/
  ]

  const matchCount = scriptIndicators.filter(r => r.test(text)).length
  return matchCount >= 2
}
