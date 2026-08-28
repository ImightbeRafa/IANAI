/**
 * Grok Imagine 2.0 rejects prompts over ~8000 units
 * (invalid-argument: "Prompt length exceeds the maximum allowed length of 8000").
 *
 * Empirically, capping Unicode code points still fails on Spanish venta-directa
 * stacks (buildPostPrompt alone is ~26KB). Enforce a UTF-8 byte budget with a
 * safety margin, and prefer a slim post prompt over truncating mega essays.
 * Canvas goes via `aspect_ratio` only — never FORMATO OBLIGATORIO.
 */

/** Hard send budget (UTF-8 bytes), under Grok's observed 8000 ceiling. */
export const GROK_IMAGE_MAX_PROMPT_BYTES = 7_200

/** @deprecated Prefer GROK_IMAGE_MAX_PROMPT_BYTES — kept for older callers/tests. */
export const GROK_IMAGE_MAX_PROMPT_LENGTH = GROK_IMAGE_MAX_PROMPT_BYTES

export type PrepareGrokImagePromptResult = {
  prompt: string
  originalLength: number
  preparedLength: number
  originalByteLength: number
  preparedByteLength: number
  trimmed: boolean
  strippedFormat: boolean
  lengthUnit: 'utf8_bytes'
}

export function grokPromptCodePointLength(text: string): number {
  return Array.from(text).length
}

export function grokPromptUtf8ByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** Truncate on UTF-8 byte budget without splitting code points. */
export function truncateGrokPromptUtf8Bytes(text: string, maxBytes: number): string {
  if (grokPromptUtf8ByteLength(text) <= maxBytes) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const size = Buffer.byteLength(ch, 'utf8')
    if (used + size > maxBytes) break
    out += ch
    used += size
  }
  return out
}

/** @deprecated Use truncateGrokPromptUtf8Bytes. */
export function truncateGrokPromptCodePoints(text: string, max: number): string {
  return truncateGrokPromptUtf8Bytes(text, max)
}

/**
 * Remove redundant format imperatives that conflict with native aspect_ratio
 * (e.g. FORMATO OBLIGATORIO … 9:16 when the user asked for 1:1).
 */
export function stripGrokFormatDirectives(prompt: string): string {
  let next = prompt
  next = next.replace(
    /^FORMATO OBLIGATORIO:[^\n]*(?:\n(?!\n)[^\n]*)*\n*/gim,
    ''
  )
  next = next.replace(
    /\n+FORMATO OBLIGATORIO:[^\n]*(?:\n(?!\n)[^\n]*)*/gim,
    '\n'
  )
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
  // Require explicit prompt-length wording — do not treat any "invalid-argument … 8000" as length.
  return /prompt length exceeds the maximum allowed length of\s*8000/i.test(raw)
    || /maximum allowed length of\s*8000/i.test(raw)
}

const SHELL_META_IMAGE_PROMPTS = new Set([
  'generar post',
  'generate post',
  'generar foto de producto',
  'generate product photo',
  'professional product photograph',
  'generar logo',
  'generate logo',
  'generar post orgánico',
  'generate organic post',
  'post publicitario',
  'ad post',
  'ad image',
  'foto de producto',
  'product photo',
])

/** Shell UI labels / meta prompts — never use as Grok visible copy. */
export function isShellMetaImagePrompt(text?: string | null): boolean {
  const normalized = (text || '').trim().toLowerCase()
  if (!normalized) return true
  if (SHELL_META_IMAGE_PROMPTS.has(normalized)) return true
  return /^foto de producto ·|^product photo ·/i.test(normalized)
}

function clampBlock(text: string | null | undefined, maxBytes: number): string {
  const trimmed = (text || '').trim()
  if (!trimmed) return ''
  return truncateGrokPromptUtf8Bytes(trimmed, maxBytes)
}

export type SlimGrokPostPromptOptions = {
  language?: string | null
  postStyle?: string | null
  textDensity?: 'hard' | 'medium' | 'standard' | string | null
  userCopy: string
  palette?: string | null
  brandVoice?: string | null
  brandVisual?: string | null
  businessContext?: string | null
  hasProductRefs?: boolean
}

/**
 * Compact Grok post prompt — keeps user copy + short fidelity rules.
 * Avoids buildPostPrompt / buildAnuncioPrompt mega-essays (~26KB).
 */
export function buildSlimGrokPostPrompt(options: SlimGrokPostPromptOptions): string {
  const es = options.language !== 'en'
  const style = (options.postStyle || 'venta-directa').trim() || 'venta-directa'
  const density = options.textDensity === 'medium' || options.textDensity === 'standard'
    ? options.textDensity
    : 'hard'
  const userCopy = (options.userCopy || '').trim()
  const densityLine = density === 'hard'
    ? (es
      ? 'Densidad HARD: 1 headline corto, 1–2 micro-puntos, 1 CTA. Sin párrafos.'
      : 'HARD density: 1 short headline, 1–2 micro-points, 1 CTA. No paragraphs.')
    : density === 'medium'
      ? (es
        ? 'Densidad MEDIA: 1 headline, 2–3 puntos cortos, 1 CTA.'
        : 'MEDIUM density: 1 headline, 2–3 short points, 1 CTA.')
      : (es
        ? 'Densidad ESTÁNDAR: 1 headline, hasta 5 puntos, 1 CTA. Sin párrafos largos.'
        : 'STANDARD density: 1 headline, up to 5 points, 1 CTA. No long paragraphs.')

  const modeLine = style === 'anuncio-conversion'
    ? (es
      ? 'Modo: anuncio de conversión (Instagram Ads). Alto impacto, scroll-stop, deseo, clic.'
      : 'Mode: conversion ad (Instagram Ads). High impact, scroll-stop, desire, click.')
    : (es
      ? 'Modo: venta directa. Un solo slide con gancho → desarrollo → CTA.'
      : 'Mode: direct-sale. One slide with hook → body → CTA.')

  const parts: string[] = [
    es
      ? 'Creá UNA imagen publicitaria profesional. El canvas ya está definido por aspect_ratio del API — no inventes otro formato ni menciones píxeles/dimensiones.'
      : 'Create ONE professional ad image. Canvas is already set by the API aspect_ratio — do not invent another format or mention pixels/dimensions.',
    modeLine,
    densityLine,
    es
      ? 'Texto visible: copiá el copy del usuario TAL CUAL (no traduzcas ni parafrasees). Solo ese copy en la imagen — no vuelques contexto de negocio ni placeholders.'
      : 'Visible text: copy the user text EXACTLY (do not translate or paraphrase). Only that copy on the image — no business-context dump or placeholders.',
  ]

  if (options.hasProductRefs) {
    parts.push(es
      ? 'Hay fotos de referencia adjuntas: usá el producto con fidelidad; no inventes otro producto.'
      : 'Reference photos are attached: keep product fidelity; do not invent another product.')
  } else {
    parts.push(es
      ? 'Sin foto de producto: diseñá un anuncio tipográfico/editorial limpio (sin inventar un producto fotorealista falso).'
      : 'No product photo: design a clean typographic/editorial ad (do not invent a fake photoreal product).')
  }

  const palette = clampBlock(options.palette, 120)
  if (palette) {
    parts.push(es ? `Paleta: ${palette}.` : `Palette: ${palette}.`)
  }

  const voice = clampBlock(options.brandVoice, 360)
  if (voice) {
    parts.push(es ? `Voz de marca (resumen): ${voice}` : `Brand voice (summary): ${voice}`)
  }

  const visual = clampBlock(options.brandVisual, 280)
  if (visual) {
    parts.push(es ? `Estilo visual (resumen): ${visual}` : `Visual style (summary): ${visual}`)
  }

  const biz = clampBlock(options.businessContext, 480)
  if (biz) {
    parts.push(es
      ? `Contexto factual (NO renderizar): ${biz}`
      : `Factual context (DO NOT render): ${biz}`)
  }

  parts.push(es
    ? `COPY DEL USUARIO (única fuente de texto visible):\n${userCopy && !isShellMetaImagePrompt(userCopy) ? userCopy : '(sin copy — inventá un gancho corto genérico de la marca)'}`
    : `USER COPY (only visible text source):\n${userCopy && !isShellMetaImagePrompt(userCopy) ? userCopy : '(no copy — invent a short generic brand hook)'}`)

  return parts.join('\n\n')
}

/**
 * Prepare a prompt for Grok Imagine: strip format essays, then cap at UTF-8 budget.
 * Prefer keeping `preferTail` (user copy / edit direction).
 */
export function prepareGrokImagePrompt(
  prompt: string,
  options?: { preferTail?: string | null; maxBytes?: number }
): PrepareGrokImagePromptResult {
  const maxBytes = options?.maxBytes ?? GROK_IMAGE_MAX_PROMPT_BYTES
  const originalLength = grokPromptCodePointLength(prompt)
  const originalByteLength = grokPromptUtf8ByteLength(prompt)
  const stripped = stripGrokFormatDirectives(prompt)
  const strippedFormat = stripped !== prompt.trim() && stripped !== prompt

  let prepared = stripped
  const preferTail = (options?.preferTail || '').trim()

  if (grokPromptUtf8ByteLength(prepared) > maxBytes) {
    if (preferTail) {
      const tail = truncateGrokPromptUtf8Bytes(preferTail, maxBytes)
      const tailBytes = grokPromptUtf8ByteLength(tail)
      const sep = '\n\n'
      const sepBytes = grokPromptUtf8ByteLength(sep)
      const headBudget = Math.max(0, maxBytes - tailBytes - sepBytes)
      let headSource = prepared
      if (prepared.endsWith(preferTail)) {
        headSource = prepared.slice(0, Math.max(0, prepared.length - preferTail.length)).trimEnd()
      } else if (prepared.includes(preferTail)) {
        headSource = prepared.replace(preferTail, '').replace(/\n{3,}/g, '\n\n').trim()
      }
      const head = truncateGrokPromptUtf8Bytes(headSource, headBudget).trim()
      prepared = head ? `${head}${sep}${tail}` : tail
      prepared = truncateGrokPromptUtf8Bytes(prepared, maxBytes)
    } else {
      prepared = truncateGrokPromptUtf8Bytes(prepared, maxBytes)
    }
  }

  const preparedLength = grokPromptCodePointLength(prepared)
  const preparedByteLength = grokPromptUtf8ByteLength(prepared)
  return {
    prompt: prepared,
    originalLength,
    preparedLength,
    originalByteLength,
    preparedByteLength,
    trimmed: preparedByteLength < originalByteLength || strippedFormat,
    strippedFormat,
    lengthUnit: 'utf8_bytes',
  }
}
