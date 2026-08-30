/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  GROK_IMAGE_MAX_PROMPT_LENGTH,
  GROK_IMAGE_SAFE_PROMPT_LENGTH,
  grokPromptCodePointLength,
  isGrokPromptLengthError,
  prepareGrokImagePrompt,
  stripGrokFormatDirectives,
  stripGrokLowPriorityEssays,
} from '../api/lib/grok-image-prompt'
import { friendlyImageError } from '../src/features/chat-shell/chatShellImageErrors'

function bloomLikePostPrompt(options?: { script?: string }): string {
  const script = options?.script || [
    'Gancho: Parches que se sienten como un tratamiento en clínica.',
    'Desarrollo: Micro-infusión dermal, 9 parches, resultados visibles.',
    'CTA: Pedí el tuyo hoy — ₡9.900.',
  ].join(' ')
  const productRule = 'REGLA DE PRODUCTO (NO NEGOCIABLE): Se adjuntan fotos del PRODUCTO REAL del usuario. El producto DEBE verse EXACTAMENTE como en las fotos de referencia. NO inventes ni reimagines el producto.'
  const roleContract = [
    'CONTRATO DE ROLES DE REFERENCIA (NO RENDERIZAR):',
    'IMAGEN 1 = PRODUCTO (verdad visual): copiá forma, color, empaque, etiqueta y proporciones EXACTAS.',
    'IMAGEN 2 = ESTILO (post de referencia): copiá SOLO layout, jerarquía, tipografía y densidad.',
  ].join('\n')
  const business = `=== CONTEXTO VERIFICADO DEL NEGOCIO Y LA OFERTA (NO RENDERIZAR ESTE BLOQUE) ===\n${'Bloom dermal patch oferta '.repeat(200)}\nUsalo solo para precisión factual.`
  const brandEssay = `${'BRAND ESSAY voice rules forever '.repeat(400)}\n${'PRESET FILL master prompt padding '.repeat(400)}`
  const format = 'FORMATO OBLIGATORIO: La imagen DEBE ser exactamente 1:1 cuadrado (1080×1080). No uses otro aspect ratio.'
  return [format, productRule, roleContract, business, brandEssay, script].join('\n\n')
}

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

  it('Bloom-like Post with script + product/style rules stays ≤ SAFE and keeps fidelity', () => {
    const userCopy = 'Gancho: Parches Bloom. CTA: Pedí hoy ₡9.900.'
    const raw = bloomLikePostPrompt({ script: userCopy })
    expect(grokPromptCodePointLength(raw)).toBeGreaterThan(GROK_IMAGE_MAX_PROMPT_LENGTH)

    const prepared = prepareGrokImagePrompt(raw, { preferTail: userCopy })
    expect(prepared.preparedLength).toBeLessThanOrEqual(GROK_IMAGE_SAFE_PROMPT_LENGTH)
    expect(prepared.preparedLength).toBeLessThanOrEqual(GROK_IMAGE_MAX_PROMPT_LENGTH)
    expect(prepared.prompt).toContain(userCopy)
    expect(prepared.prompt).toMatch(/PRODUCTO REAL|verdad visual|REGLA DE PRODUCTO/i)
    expect(prepared.prompt).not.toMatch(/FORMATO OBLIGATORIO/i)
    expect(prepared.prompt).not.toMatch(/Acortá el guion/i)
    // Generate would be attempted with this body — not rejected locally for length.
    expect(prepared.preparedLength).toBeGreaterThan(0)
  })

  it('product-mode path (no user copy in prompt) still clamps and keeps product rule', () => {
    const productPrompt = [
      'FORMATO OBLIGATORIO: 1:1.',
      'REGLA DE PRODUCTO (NO NEGOCIABLE): Se adjuntan fotos del PRODUCTO REAL. NO redibujes el producto.',
      '=== CONTEXTO VERIFICADO DEL NEGOCIO Y LA OFERTA (NO RENDERIZAR ESTE BLOQUE) ===',
      'x'.repeat(10_000),
      'Studio hero lighting master essay '.repeat(500),
    ].join('\n')
    const afterFormat = stripGrokFormatDirectives(productPrompt)
    const afterEssays = stripGrokLowPriorityEssays(afterFormat)
    expect(afterEssays).toMatch(/PRODUCTO REAL/)
    const prepared = prepareGrokImagePrompt(productPrompt, {
      preferTail: 'Quiero crear una foto de producto Estudio Hero',
    })
    expect(prepared.preparedLength).toBeLessThanOrEqual(GROK_IMAGE_SAFE_PROMPT_LENGTH)
    expect(prepared.prompt).toMatch(/PRODUCTO REAL|NO redibujes/i)
  })

  it('strips verified business context dumps', () => {
    const raw = bloomLikePostPrompt()
    const stripped = stripGrokLowPriorityEssays(stripGrokFormatDirectives(raw))
    expect(stripped.length).toBeLessThan(raw.length)
  })

  it('does not split emoji code points at the boundary', () => {
    const emoji = '🙂'
    const pad = 'x'.repeat(GROK_IMAGE_SAFE_PROMPT_LENGTH - 1)
    const prepared = prepareGrokImagePrompt(pad + emoji + 'TAIL')
    expect(grokPromptCodePointLength(prepared.prompt)).toBeLessThanOrEqual(GROK_IMAGE_SAFE_PROMPT_LENGTH)
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

describe('friendlyImageError never asks to shorten guion', () => {
  it('maps 8000 invalid-argument to generic Spanish retry, not acortá el guion', () => {
    const msg = friendlyImageError(
      'invalid-argument: Prompt length exceeds the maximum allowed length of 8000',
      'es'
    )
    expect(msg).not.toMatch(/Acortá el guion/i)
    expect(msg).toMatch(/No pudimos generar|Reintentá/i)
  })
})
