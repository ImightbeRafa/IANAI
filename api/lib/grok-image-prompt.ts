/**
 * Grok Imagine 2.0 rejects prompts over 8000 Unicode code points
 * (invalid-argument: "Prompt length exceeds the maximum allowed length of 8000").
 * Pass canvas via `aspect_ratio` only — strip textual FORMATO OBLIGATORIO prefixes.
 */

export const GROK_IMAGE_MAX_PROMPT_LENGTH = 8_000

export type PrepareGrokImagePromptResult = {
  prompt: string
  originalLength: number
  preparedLength: number
  trimmed: boolean
  strippedFormat: boolean
}

/** Count Unicode code points (Grok's "Unicode chars"), not UTF-16 units. */
export function grokPromptCodePointLength(text: string): number {
  return Array.from(text).length
}

export function truncateGrokPromptCodePoints(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return chars.slice(0, Math.max(0, max)).join('')
}

/**
 * Remove redundant format imperatives that conflict with native aspect_ratio
 * (e.g. FORMATO OBLIGATORIO … 9:16 when the user asked for 1:1).
 */
export function stripGrokFormatDirectives(prompt: string): string {
  let next = prompt
  // Full FORMATO OBLIGATORIO paragraphs / first lines
  next = next.replace(
    /^FORMATO OBLIGATORIO:[^\n]*(?:\n(?!\n)[^\n]*)*\n*/gim,
    ''
  )
  next = next.replace(
    /\n+FORMATO OBLIGATORIO:[^\n]*(?:\n(?!\n)[^\n]*)*/gim,
    '\n'
  )
  // Residual dimension-only imperatives that duplicate aspect_ratio
  next = next.replace(
    /(?:^|\n)La imagen DEBE ser exactamente [^\n]+\n*/gim,
    '\n'
  )
  next = next.replace(/\n{3,}/g, '\n\n').trim()
  return next
}

export function isGrokPromptLengthError(text: string | null | undefined): boolean {
  const raw = (text || '').trim()
  if (!raw) return false
  return (
    /prompt length exceeds the maximum allowed length of\s*8000/i.test(raw)
    || (/invalid[-_ ]?argument/i.test(raw) && /8000/.test(raw))
    || /maximum allowed length of\s*8000/i.test(raw)
  )
}

/**
 * Prepare a prompt for Grok Imagine: strip format essays, then cap at 8000
 * code points. Prefer keeping `preferTail` (user copy / edit direction).
 */
export function prepareGrokImagePrompt(
  prompt: string,
  options?: { preferTail?: string | null }
): PrepareGrokImagePromptResult {
  const originalLength = grokPromptCodePointLength(prompt)
  const stripped = stripGrokFormatDirectives(prompt)
  const strippedFormat = stripped !== prompt.trim() && stripped !== prompt

  let prepared = stripped
  const preferTail = (options?.preferTail || '').trim()

  if (grokPromptCodePointLength(prepared) > GROK_IMAGE_MAX_PROMPT_LENGTH) {
    if (preferTail) {
      const tail = truncateGrokPromptCodePoints(preferTail, GROK_IMAGE_MAX_PROMPT_LENGTH)
      const tailLen = grokPromptCodePointLength(tail)
      const sep = '\n\n'
      const headBudget = Math.max(0, GROK_IMAGE_MAX_PROMPT_LENGTH - tailLen - grokPromptCodePointLength(sep))
      // Drop system / brand essays from the front; keep head remnant + user tail.
      let headSource = prepared
      if (prepared.endsWith(preferTail)) {
        headSource = prepared.slice(0, Math.max(0, prepared.length - preferTail.length)).trimEnd()
      } else if (prepared.includes(preferTail)) {
        headSource = prepared.replace(preferTail, '').replace(/\n{3,}/g, '\n\n').trim()
      }
      const head = truncateGrokPromptCodePoints(headSource, headBudget).trim()
      prepared = head ? `${head}${sep}${tail}` : tail
      // Final hard cap (separator edge cases)
      prepared = truncateGrokPromptCodePoints(prepared, GROK_IMAGE_MAX_PROMPT_LENGTH)
    } else {
      prepared = truncateGrokPromptCodePoints(prepared, GROK_IMAGE_MAX_PROMPT_LENGTH)
    }
  }

  const preparedLength = grokPromptCodePointLength(prepared)
  return {
    prompt: prepared,
    originalLength,
    preparedLength,
    trimmed: preparedLength < originalLength || strippedFormat,
    strippedFormat,
  }
}
