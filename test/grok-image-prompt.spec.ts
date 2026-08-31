import { describe, expect, it } from 'vitest'
import {
  GROK_IMAGE_MAX_PROMPT_BYTES,
  GROK_IMAGE_RETRY_PROMPT_BYTES,
  buildSlimGrokPostPrompt,
  grokPromptCodePointLength,
  grokPromptUtf8ByteLength,
  isGrokPromptLengthError,
  isShellMetaImagePrompt,
  prepareGrokImagePrompt,
  stripGrokFormatDirectives,
} from '../api/lib/grok-image-prompt'
import { friendlyImageError } from '../src/features/chat-shell/chatShellImageErrors'

const SHORT_ES_SCRIPT = [
  '¿Granito la noche antes de un evento importante?',
  'Actuá mientras dormís: sin dolor y no se nota.',
  'Son 9 parches por ₡9.900 para emergencias de piel.',
  'Dale click a este anuncio y hacé tu pedido.',
].join('\n')

describe('grok-image-prompt', () => {
  it('strips FORMATO OBLIGATORIO directives', () => {
    const raw = [
      'FORMATO OBLIGATORIO: La imagen DEBE ser exactamente 9:16 vertical (1080×1920). No uses otro aspect ratio.',
      '',
      'Copy del producto: parches para acné.',
    ].join('\n')
    const stripped = stripGrokFormatDirectives(raw)
    expect(stripped).not.toMatch(/FORMATO OBLIGATORIO/i)
    expect(stripped).toMatch(/parches para acné/)
  })

  it('builds a slim venta-directa prompt well under the byte budget and keeps user copy', () => {
    const slim = buildSlimGrokPostPrompt({
      language: 'es',
      postStyle: 'venta-directa',
      textDensity: 'hard',
      userCopy: SHORT_ES_SCRIPT,
      palette: '#111, #eee',
      brandVoice: 'Cercana, clara, costa rica.',
      businessContext: 'Bloom vende parches de micro-agujas para acné.',
      hasProductRefs: false,
    })
    expect(slim).toContain('Granito')
    expect(slim).toContain('₡9.900')
    expect(slim).not.toMatch(/FORMATO OBLIGATORIO/i)
    expect(slim).not.toMatch(/1080×1920|9:16/)
    expect(grokPromptUtf8ByteLength(slim)).toBeLessThan(3_500)
  })

  it('first-pass no-ref venta-directa uses hojita silhouette instead of typographic-only', () => {
    const silhouette =
      'Hojita de 9 parches: lámina cuadrada transparente con 9 parches circulares en grilla 3×3.'
    const slim = buildSlimGrokPostPrompt({
      language: 'es',
      postStyle: 'venta-directa',
      textDensity: 'hard',
      userCopy: SHORT_ES_SCRIPT,
      hasProductRefs: false,
      productSilhouette: silhouette,
      lockedOfferPrice: '₡9.900',
      hasBrandLogo: true,
      logoStampRules: 'REGLA — LOGO: estampar tal cual.',
      ctaGuardrails: 'CTA: Comprá ahora.',
    })
    expect(slim).toMatch(/hojita|9 parches/i)
    expect(slim).toMatch(/FOTORREALISTA visible/i)
    expect(slim).not.toMatch(/anuncio tipográfico\/editorial limpio/i)
    expect(slim).toMatch(/PROHIBIDO tachado|strikethrough/i)
    expect(slim).toMatch(/Comprá ahora|Dale click a este anuncio/i)
    expect(slim).toMatch(/ESTAMPADO|estampar/i)
  })

  it('caps on UTF-8 bytes with safety margin and prefers user tail', () => {
    const userCopy = SHORT_ES_SCRIPT
    // Fat Spanish-heavy essays (multi-byte) that would blow a naive 8000 code-point cap in bytes.
    const essays = `${'BRAND ESSAY ñáéíóú '.repeat(900)}\n${'PRESET FILL ¿¡ '.repeat(900)}`
    const raw = `FORMATO OBLIGATORIO: 9:16 vertical (1080×1920).\n\n${essays}\n\n${userCopy}`
    expect(grokPromptUtf8ByteLength(raw)).toBeGreaterThan(GROK_IMAGE_MAX_PROMPT_BYTES)

    const prepared = prepareGrokImagePrompt(raw, { preferTail: userCopy })
    expect(prepared.preparedByteLength).toBeLessThanOrEqual(GROK_IMAGE_MAX_PROMPT_BYTES)
    expect(prepared.preparedByteLength).toBe(grokPromptUtf8ByteLength(prepared.prompt))
    expect(prepared.originalByteLength).toBeGreaterThan(prepared.preparedByteLength)
    expect(prepared.lengthUnit).toBe('utf8_bytes')
    expect(prepared.prompt).toContain('Granito')
    expect(prepared.prompt).not.toMatch(/FORMATO OBLIGATORIO/i)
    expect(prepared.trimmed).toBe(true)
  })

  it('does not split emoji / multi-byte chars at the byte boundary', () => {
    const emoji = '🙂'
    const pad = 'á'.repeat(8000)
    const prepared = prepareGrokImagePrompt(pad + emoji + 'TAIL')
    expect(prepared.preparedByteLength).toBeLessThanOrEqual(GROK_IMAGE_MAX_PROMPT_BYTES)
    expect(() => Array.from(prepared.prompt)).not.toThrow()
    // No lone surrogates — full string is valid UTF-8 round-trip
    expect(Buffer.from(prepared.prompt, 'utf8').toString('utf8')).toBe(prepared.prompt)
  })

  it('detects xAI prompt-length invalid-argument narrowly', () => {
    expect(
      isGrokPromptLengthError(
        'invalid-argument: Prompt length exceeds the maximum allowed length of 8000'
      )
    ).toBe(true)
    expect(isGrokPromptLengthError('Grok Imagine generation failed')).toBe(false)
    // Unrelated invalid-argument that happens to mention 8000 must NOT match
    expect(isGrokPromptLengthError('invalid-argument: width must be <= 8000')).toBe(false)
  })

  it('code-point helper still works for logging', () => {
    expect(grokPromptCodePointLength('ab🙂')).toBe(3)
  })
})

describe('friendlyImageError prompt length', () => {
  it('maps 8000 prompt-length error to Spanish by default', () => {
    expect(
      friendlyImageError(
        'invalid-argument: Prompt length exceeds the maximum allowed length of 8000',
        'es'
      )
    ).toMatch(/No pudimos generar la imagen con Grok/i)
  })

  it('maps to English only when language is en', () => {
    expect(
      friendlyImageError(
        'Prompt length exceeds the maximum allowed length of 8000',
        'en'
      )
    ).toMatch(/could not generate the image with Grok/i)
  })

  it('treats shell meta prompts as non-copy', () => {
    expect(isShellMetaImagePrompt('Professional product photograph')).toBe(true)
    expect(isShellMetaImagePrompt('Foto de producto · Estudio Hero · 1:1')).toBe(true)
    expect(isShellMetaImagePrompt('¿Granito la noche antes de un evento importante?')).toBe(false)
  })

  it('FORMATO strip is line-only — keeps following product-fidelity rules', () => {
    const raw = [
      'FORMATO OBLIGATORIO: La imagen DEBE ser exactamente 1:1 cuadrado (1080×1080). No uses otro aspect ratio.',
      'REGLA DE PRODUCTO (NO NEGOCIABLE): Se adjuntan fotos del PRODUCTO REAL.',
      'IMAGEN 1 = PRODUCTO (verdad visual): copiá forma exacta.',
    ].join('\n')
    const stripped = stripGrokFormatDirectives(raw)
    expect(stripped).not.toMatch(/FORMATO OBLIGATORIO/i)
    expect(stripped).toMatch(/REGLA DE PRODUCTO/)
    expect(stripped).toMatch(/verdad visual/)
  })

  it('maps prompt-too-long to generic retry copy — never asks to shorten the guion', () => {
    const es = friendlyImageError(
      'Prompt length exceeds the maximum allowed length of 8000',
      'es',
    )
    expect(es.toLowerCase()).not.toMatch(/acort/)
    expect(es.toLowerCase()).toMatch(/reintent/)
  })

  it('exports an aggressive retry byte budget under the hard max', () => {
    expect(GROK_IMAGE_RETRY_PROMPT_BYTES).toBeLessThan(GROK_IMAGE_MAX_PROMPT_BYTES)
    expect(GROK_IMAGE_RETRY_PROMPT_BYTES).toBeGreaterThan(1_000)
  })

})
