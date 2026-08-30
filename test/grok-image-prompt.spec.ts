/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  GROK_IMAGE_MAX_PROMPT_LENGTH,
  grokPromptCodePointLength,
  isGrokPromptLengthError,
  prepareGrokImagePrompt,
  stripGrokFormatDirectives,
} from '../api/lib/grok-image-prompt'
import { friendlyImageError } from '../src/features/chat-shell/chatShellImageErrors'

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

  it('caps at 8000 Unicode code points and prefers user tail (Post path with script + product rules)', () => {
    const userCopy = 'Gancho: Arnés Forge. Desarrollo: postura. CTA: Comprá hoy.'
    const productRule = 'REGLA DE PRODUCTO (NO NEGOCIABLE): Se adjuntan fotos del PRODUCTO REAL. NO redibujes el producto.'
    const essays = `${'BRAND ESSAY '.repeat(900)}\n${'PRESET FILL '.repeat(900)}\n${'VOICE RULE '.repeat(900)}`
    const raw = [
      'FORMATO OBLIGATORIO: La imagen DEBE ser exactamente 9:16 vertical (1080×1920). No uses otro aspect ratio.',
      '',
      productRule,
      essays,
      userCopy,
    ].join('\n\n')
    expect(grokPromptCodePointLength(raw)).toBeGreaterThan(GROK_IMAGE_MAX_PROMPT_LENGTH)

    const prepared = prepareGrokImagePrompt(raw, { preferTail: userCopy })
    expect(prepared.preparedLength).toBeLessThanOrEqual(GROK_IMAGE_MAX_PROMPT_LENGTH)
    expect(prepared.preparedLength).toBeLessThanOrEqual(8000)
    expect(prepared.prompt).toContain(userCopy)
    expect(prepared.prompt).toContain('PRODUCTO REAL')
    expect(prepared.prompt).not.toMatch(/FORMATO OBLIGATORIO/i)
    expect(prepared.trimmed).toBe(true)
  })

  it('does not split emoji code points at the boundary', () => {
    const emoji = '🙂'
    const pad = 'x'.repeat(GROK_IMAGE_MAX_PROMPT_LENGTH - 1)
    const prepared = prepareGrokImagePrompt(pad + emoji + 'TAIL')
    expect(grokPromptCodePointLength(prepared.prompt)).toBe(GROK_IMAGE_MAX_PROMPT_LENGTH)
    expect(() => Array.from(prepared.prompt)).not.toThrow()
  })

  it('detects xAI prompt-length invalid-argument', () => {
    expect(
      isGrokPromptLengthError(
        'invalid-argument: Prompt length exceeds the maximum allowed length of 8000'
      )
    ).toBe(true)
    expect(isGrokPromptLengthError('Grok Imagine generation failed')).toBe(false)
  })
})

describe('friendlyImageError prompt length', () => {
  it('maps 8000 invalid-argument to Spanish by default', () => {
    expect(
      friendlyImageError(
        'invalid-argument: Prompt length exceeds the maximum allowed length of 8000',
        'es'
      )
    ).toMatch(/demasiado largo para Grok/)
  })

  it('maps to English only when language is en', () => {
    expect(
      friendlyImageError(
        'Prompt length exceeds the maximum allowed length of 8000',
        'en'
      )
    ).toMatch(/too long for Grok/)
  })
})
