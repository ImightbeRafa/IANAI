/**
 * Grok Imagine 2.0 rejects prompts over 8000 Unicode code points
 * (invalid-argument: "Prompt length exceeds the maximum allowed length of 8000").
 * Pass canvas via `aspect_ratio` only — strip textual FORMATO OBLIGATORIO prefixes.
 *
 * Never fail closed asking the user to shorten a guion: always condense until under budget.
 */

export const GROK_IMAGE_MAX_PROMPT_LENGTH = 8_000
/** Leave headroom — Grok's counter can disagree with JS code points. */
export const GROK_IMAGE_SAFE_PROMPT_LENGTH = 7_500
/** Aggressive retry budget after a prompt-too-long response. */
export const GROK_IMAGE_RETRY_PROMPT_LENGTH = 6_000
const USER_COPY_BUDGET = 1_200

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
 * Only the FORMATO line(s) — never swallow following product-fidelity rules.
 */
export function stripGrokFormatDirectives(prompt: string): string {
  let next = prompt
  next = next.replace(/^FORMATO OBLIGATORIO:[^\n]*\n?/gim, '')
  next = next.replace(/\nFORMATO OBLIGATORIO:[^\n]*/gim, '')
  next = next.replace(
    /(?:^|\n)La imagen DEBE ser exactamente [^\n]+/gim,
    '\n'
  )
  next = next.replace(/\n{3,}/g, '\n\n').trim()
  return next
}

/** Drop low-priority brand / session essays; keep product-fidelity and role contracts. */
export function stripGrokLowPriorityEssays(prompt: string): string {
  let next = prompt
  // Verified business / offer context dumps (often multi-KB)
  next = next.replace(
    /=== (?:VERIFIED BUSINESS AND OFFER CONTEXT|CONTEXTO VERIFICADO DEL NEGOCIO Y LA OFERTA)[\s\S]*?(?=\n===|\nREGLA|\nCONTRATO|\nIMAGEN \d|\nFORMATO|\n$)/gi,
    '\n'
  )
  next = next.replace(
    /=== (?:VERIFIED BUSINESS AND OFFER CONTEXT|CONTEXTO VERIFICADO DEL NEGOCIO Y LA OFERTA)[\s\S]*$/gi,
    '\n'
  )
  // Long "IMPORTANTE: USA SOLO ESTOS COLORES" already short; keep colors, drop verbose brand voice dumps
  next = next.replace(
    /(?:^|\n)(?:BRAND VOICE|VOZ DE MARCA|Brand voice|Permanent behavior)[^\n]*(?:\n(?!\n)[^\n]*){0,40}\n*/gim,
    '\n'
  )
  // Visual memory injection blocks
  next = next.replace(
    /(?:^|\n)(?:MEMORY|MEMORIA|Learned (?:style|preference)|Preferencias aprendidas)[^\n]*(?:\n(?!\n)[^\n]*){0,30}\n*/gim,
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
    || /grok_prompt_too_long/i.test(raw)
  )
}

function extractPriorityHead(prompt: string): string {
  const lines = prompt.split('\n')
  const kept: string[] = []
  for (const line of lines) {
    if (
      /REGLA DE PRODUCTO|PRODUCT \(visual truth\)|PRODUCTO \(verdad|CONTRATO DE ROLES|REFERENCE ROLE CONTRACT|IMAGEN \d+\s*=|IMAGE \d+\s*=|REGLA — LOGO|LOGO DE MARCA|COLORES:|TEXTO VISIBLE|Modo producto|Product mode|Modo post/i.test(line)
      || /Se adjuntan fotos del PRODUCTO|copy exact shape|verdad visual|PROHIBIDO.*redibuj/i.test(line)
    ) {
      kept.push(line)
    }
  }
  if (kept.length >= 3) return kept.join('\n').trim()
  // Fallback: first ~2500 code points (product strategy is usually at the front)
  return truncateGrokPromptCodePoints(prompt, 2_500).trim()
}

/**
 * Prepare a prompt for Grok Imagine: strip format + low-priority essays, keep
 * product-fidelity rules at the front, keep a short user-copy tail, hard-cap.
 * Always returns length ≤ maxLength (default SAFE 7500). Never asks the user to shorten.
 */
export function prepareGrokImagePrompt(
  prompt: string,
  options?: { preferTail?: string | null; maxLength?: number }
): PrepareGrokImagePromptResult {
  const maxLength = Math.min(
    options?.maxLength ?? GROK_IMAGE_SAFE_PROMPT_LENGTH,
    GROK_IMAGE_MAX_PROMPT_LENGTH
  )
  const originalLength = grokPromptCodePointLength(prompt)
  let prepared = stripGrokFormatDirectives(prompt)
  const strippedFormat = prepared !== prompt.trim() && prepared !== prompt
  prepared = stripGrokLowPriorityEssays(prepared)

  const preferTailRaw = (options?.preferTail || '').trim()
  const preferTail = preferTailRaw
    ? truncateGrokPromptCodePoints(preferTailRaw, USER_COPY_BUDGET).trim()
    : ''
  const fidelity = extractPriorityHead(prepared)

  if (grokPromptCodePointLength(prepared) > maxLength) {
    const sep = '\n\n'
    const tail = preferTail
    const tailLen = tail ? grokPromptCodePointLength(tail) + grokPromptCodePointLength(sep) : 0
    const headBudget = Math.max(400, maxLength - tailLen)
    // Prefer explicit fidelity lines; fall back to the front of the prompt (rules live there).
    let head = truncateGrokPromptCodePoints(
      fidelity || prepared,
      headBudget
    ).trim()
    if (!head) {
      head = truncateGrokPromptCodePoints(prepared, headBudget).trim()
    }
    prepared = tail ? `${head}${sep}${tail}` : head
  } else if (preferTail && !prepared.includes(preferTail)) {
    const sep = '\n\n'
    const base = (fidelity && prepared.includes(fidelity.slice(0, 40)))
      ? prepared
      : [fidelity, prepared].filter(Boolean).join(sep)
    const combined = `${base}${sep}${preferTail}`
    prepared = grokPromptCodePointLength(combined) <= maxLength
      ? combined
      : truncateGrokPromptCodePoints(
        `${truncateGrokPromptCodePoints(base, Math.max(400, maxLength - grokPromptCodePointLength(preferTail) - 2))}${sep}${preferTail}`,
        maxLength
      )
  }

  prepared = truncateGrokPromptCodePoints(prepared, maxLength).trim()
  // Last resort: if fidelity was wiped by a bad strip, prepend a short product lock.
  if (
    fidelity
    && !/PRODUCTO REAL|verdad visual|REGLA DE PRODUCTO|visual truth|Do not invent/i.test(prepared)
    && /PRODUCTO REAL|verdad visual|REGLA DE PRODUCTO|visual truth/i.test(fidelity)
  ) {
    const lock = truncateGrokPromptCodePoints(fidelity, 600)
    const room = Math.max(0, maxLength - grokPromptCodePointLength(lock) - 2)
    prepared = truncateGrokPromptCodePoints(`${lock}\n\n${prepared}`, maxLength).trim()
    void room
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
