export interface ParsedScript {
  index: number
  title: string
  content: string
}

/**
 * Parses an AI response containing multiple scripts into individual scripts.
 * Handles various formats:
 * - "GUION 1 — TITLE" / "GUIÓN 1 — TITLE"
 * - "SCRIPT 1 — TITLE" / "Script 1: TITLE"
 * - "**GUION 1:**" / "**Script 1:**"
 * - "---" separators between numbered scripts
 * - Numbered headers like "1." "2." "3." at top level
 */
export function parseScripts(text: string): ParsedScript[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  // Try pattern-based splitting first
  // Match: GUION/GUIÓN/SCRIPT + number + optional separator + optional title
  const scriptHeaderRegex = /^(?:\*{0,2})(?:GUI[OÓ]N|SCRIPT|Gui[oó]n|Script)\s*#?\s*(\d+)\s*[:\-—–.]?\s*(.*?)(?:\*{0,2})$/gm

  const headers: { index: number; pos: number; title: string }[] = []
  let match: RegExpExecArray | null

  while ((match = scriptHeaderRegex.exec(trimmed)) !== null) {
    headers.push({
      index: parseInt(match[1]),
      pos: match.index,
      title: match[2].replace(/^\*+|\*+$/g, '').trim()
    })
  }

  if (headers.length >= 2) {
    return headers.map((header, i) => {
      const start = header.pos
      const end = i < headers.length - 1 ? headers[i + 1].pos : trimmed.length
      const fullBlock = trimmed.slice(start, end).trim()
      // Remove the header line itself from content
      const firstNewline = fullBlock.indexOf('\n')
      const content = firstNewline > -1 ? fullBlock.slice(firstNewline + 1).trim() : fullBlock

      return {
        index: header.index,
        title: header.title || `Script ${header.index}`,
        content
      }
    })
  }

  // Fallback: try splitting by horizontal rules (--- or ===) between substantial blocks
  const hrParts = trimmed.split(/\n\s*(?:---+|===+)\s*\n/)
  if (hrParts.length >= 2) {
    const scripts = hrParts
      .map(part => part.trim())
      .filter(part => part.length > 50) // filter out tiny separators

    if (scripts.length >= 2) {
      return scripts.map((content, i) => {
        const title = extractTitleFromBlock(content) || `Script ${i + 1}`
        return { index: i + 1, title, content }
      })
    }
  }

  // Fallback: try splitting by double newlines + numbered pattern
  const numberedRegex = /\n\n+(?=(?:\*{0,2})\d+\.\s)/
  const numberedParts = trimmed.split(numberedRegex)
  if (numberedParts.length >= 2) {
    // Verify these look like scripts (substantial content)
    const substantial = numberedParts.filter(p => p.trim().length > 80)
    if (substantial.length >= 2) {
      return substantial.map((content, i) => {
        const cleaned = content.trim()
        const title = extractTitleFromBlock(cleaned) || `Script ${i + 1}`
        return { index: i + 1, title, content: cleaned }
      })
    }
  }

  // No multi-script pattern found — return as single script
  return [{
    index: 1,
    title: extractTitleFromBlock(trimmed) || 'Script 1',
    content: trimmed
  }]
}

function extractTitleFromBlock(block: string): string {
  const firstLine = block.split('\n')[0].trim()
  // Remove markdown bold, leading numbers, dashes
  let title = firstLine
    .replace(/^\*{1,2}/, '')
    .replace(/\*{1,2}$/, '')
    .replace(/^#+\s*/, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/^(?:GUI[OÓ]N|SCRIPT|Gui[oó]n|Script)\s*#?\s*\d+\s*[:\-—–.]?\s*/i, '')
    .trim()

  if (title.length > 80) title = title.slice(0, 77) + '...'
  if (title.length < 3) return ''
  return title
}

/**
 * Check if an AI message likely contains script content (vs conversational reply)
 */
export function isScriptContent(text: string): boolean {
  if (text.length < 150) return false

  const scriptIndicators = [
    /GUI[OÓ]N\s*#?\s*\d/i,
    /SCRIPT\s*#?\s*\d/i,
    /Gancho|Hook/i,
    /Desarrollo|Development/i,
    /Cierre|Closing|CTA/i,
    /\(0[–-]\d+s?\)/,
    /\(\d+[–-]\d+s?\)/
  ]

  const matchCount = scriptIndicators.filter(r => r.test(text)).length
  return matchCount >= 2
}
