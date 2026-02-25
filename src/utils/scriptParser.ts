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
 * - "OPCIÓN 1 — TITLE" / "OPCION 1 - TITLE"
 * - "**GUION 1:**" / "**Script 1:**"
 * - "---" separators between numbered scripts
 * - Numbered headers like "1." "2." "3." at top level
 */
export function parseScripts(text: string): ParsedScript[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  // Try pattern-based splitting first
  // Match: GUION/GUIÓN/SCRIPT/OPCIÓN/OPCION + number + optional separator + optional title
  const scriptHeaderRegex = /^(?:\*{0,2})(?:GUI[OÓ]N|SCRIPT|Gui[oó]n|Script|OPCI[OÓ]N|Opci[oó]n)\s*#?\s*(\d+)\s*[:\-—–.]?\s*(.*?)(?:\*{0,2})$/gm

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
      let content = firstNewline > -1 ? fullBlock.slice(firstNewline + 1).trim() : fullBlock
      // Strip trailing --- or === separators left over from between scripts
      content = content.replace(/\n\s*(?:---+|===+)\s*$/, '').trim()

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
  // If there's exactly one header, strip it from content (same as multi-script path)
  let singleContent = trimmed
  if (headers.length === 1) {
    const block = trimmed.slice(headers[0].pos).trim()
    const firstNewline = block.indexOf('\n')
    if (firstNewline > -1) {
      singleContent = block.slice(firstNewline + 1).trim()
    }
  }
  return [{
    index: 1,
    title: extractTitleFromBlock(trimmed) || 'Script 1',
    content: singleContent
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
    .replace(/^(?:GUI[OÓ]N|SCRIPT|Gui[oó]n|Script|OPCI[OÓ]N|Opci[oó]n)\s*#?\s*\d+\s*[:\-—–.]?\s*/i, '')
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
