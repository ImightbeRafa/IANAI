import { describe, expect, it } from 'vitest'
import { IMAGE_PRESETS, PRODUCT_SUB_STYLES } from '../src/data/image-presets'
import {
  buildShellImageGenerateBody,
  DEFAULT_IMAGE_PREFERENCES,
  formatImageAssumptions,
  parseChatShellImageIntent,
  planImageClarifications,
  readImagePreferences,
  requiresProductReferences,
  resolveImagePreferences,
  writeImagePreferences,
} from '../src/features/chat-shell/chatShellImageIntent'

describe('parseChatShellImageIntent', () => {
  it('detects image asks without stealing script requests', () => {
    expect(parseChatShellImageIntent('generame 2 de venta', 'es').matched).toBe(false)
    expect(parseChatShellImageIntent('hazme una imagen', 'es').matched).toBe(true)
    expect(parseChatShellImageIntent('generame una foto 9:16', 'es').wantsImage).toBe(true)
  })

  it('resolves preset and product sub-style aliases', () => {
    for (const preset of IMAGE_PRESETS) {
      const intent = parseChatShellImageIntent(`haz imagen ${preset.nameEs}`, 'es')
      expect(intent.preferences.style, preset.id).toEqual({
        kind: 'preset',
        presetId: preset.id,
      })
    }
    for (const sub of PRODUCT_SUB_STYLES) {
      const intent = parseChatShellImageIntent(`imagen ${sub.nameEs}`, 'es')
      expect(intent.preferences.style, sub.id).toEqual({
        kind: 'product',
        productSubStyle: sub.id,
      })
    }
    expect(
      parseChatShellImageIntent('haz imagen venta directa', 'es').preferences.style
    ).toEqual({ kind: 'preset', presetId: 'venta-directa' })
  })

  it('parses aspect, model, density overrides', () => {
    const intent = parseChatShellImageIntent(
      'haz imagen comparison 1:1 nano-banana-pro densidad hard',
      'es'
    )
    expect(intent.preferences.aspectRatio).toBe('1:1')
    expect(intent.preferences.model).toBe('nano-banana-pro')
    expect(intent.preferences.density).toBe('hard')
    expect(intent.preferences.style).toEqual({ kind: 'preset', presetId: 'comparison' })
  })
})

describe('resolveImagePreferences / clarifications / stickies', () => {
  it('defaults to 9:16, Pro, Medium', () => {
    const resolved = resolveImagePreferences({}, {})
    expect(resolved.aspectRatio).toBe('9:16')
    expect(resolved.model).toBe('nano-banana-pro')
    expect(resolved.density).toBe('medium')
    expect(resolved.style).toBeUndefined()
    expect(DEFAULT_IMAGE_PREFERENCES.aspectRatio).toBe('9:16')
  })

  it('explicit overrides sticky', () => {
    const resolved = resolveImagePreferences(
      { aspectRatio: '1:1', model: 'nano-banana', density: 'hard' },
      {
        aspectRatio: '9:16',
        model: 'nano-banana-pro',
        density: 'medium',
        style: { kind: 'preset', presetId: 'collage' },
      }
    )
    expect(resolved.aspectRatio).toBe('1:1')
    expect(resolved.model).toBe('nano-banana')
    expect(resolved.density).toBe('hard')
    expect(resolved.style).toEqual({ kind: 'preset', presetId: 'collage' })
  })

  it('asks at most one mode question when style missing; none when sticky complete', () => {
    const missing = planImageClarifications(resolveImagePreferences({}, {}))
    expect(missing.needed).toBe(true)
    expect(missing.step).toBe('mode')

    const ready = planImageClarifications(
      resolveImagePreferences(
        {},
        { style: { kind: 'product', productSubStyle: 'studio-hero' } }
      )
    )
    expect(ready.needed).toBe(false)
    expect(ready.step).toBeNull()
  })

  it('normalizes invalid/stale storage', () => {
    const store: Record<string, string> = {
      'chat_shell:image:prefs:v1:s1': JSON.stringify({
        aspectRatio: '16:9',
        model: 'gpt-image-2',
        density: 'nope',
        style: { kind: 'preset', presetId: 'not-real' },
      }),
    }
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
    }
    const sticky = readImagePreferences(storage, 's1')
    expect(sticky.aspectRatio).toBeUndefined()
    expect(sticky.model).toBeUndefined()
    expect(sticky.style).toBeUndefined()
    expect(sticky.density).toBe('medium')

    writeImagePreferences(storage, 's1', {
      aspectRatio: '3:4',
      model: 'nano-banana-pro',
      density: 'standard',
      style: { kind: 'preset', presetId: 'testimonial' },
    })
    expect(readImagePreferences(storage, 's1').aspectRatio).toBe('3:4')
  })
})

describe('buildShellImageGenerateBody', () => {
  it('builds preset body with density + brand kit on first gen', () => {
    const body = buildShellImageGenerateBody({
      preferences: {
        style: { kind: 'preset', presetId: 'comparison' },
        aspectRatio: '3:4',
        model: 'nano-banana-pro',
        density: 'hard',
      },
      productId: 'p1',
      sessionId: 's1',
      prompt: 'From script',
      language: 'es',
      brandKitId: 'bk1',
      productImageIds: ['img1'],
      scriptText: 'GUIÓN 1',
    })
    expect(body).toMatchObject({
      mode: 'post',
      postStyle: 'preset',
      presetId: 'comparison',
      aspectRatio: '3:4',
      width: 1080,
      height: 1440,
      model: 'nano-banana-pro',
      textDensity: 'hard',
      brandKitId: 'bk1',
      productImageIds: ['img1'],
      scriptContext: 'GUIÓN 1',
    })
    expect(requiresProductReferences({ kind: 'preset', presetId: 'comparison' })).toBe(false)
  })

  it('requires refs for product mode and maps venta-directa', () => {
    expect(requiresProductReferences({ kind: 'product', productSubStyle: 'studio-hero' })).toBe(true)
    const body = buildShellImageGenerateBody({
      preferences: {
        style: { kind: 'product', productSubStyle: 'studio-hero' },
        aspectRatio: '9:16',
        model: 'nano-banana-pro',
        density: 'medium',
      },
      productId: 'p1',
      sessionId: 's1',
      prompt: 'hero',
      language: 'es',
      productImageIds: ['img1', 'img2'],
    })
    expect(body.postStyle).toBe('product')
    expect(body.productSubStyle).toBe('studio-hero')
    expect(body.height).toBe(1920)

    const venta = buildShellImageGenerateBody({
      preferences: {
        style: { kind: 'preset', presetId: 'venta-directa' },
        aspectRatio: '1:1',
        model: 'nano-banana-pro',
        density: 'medium',
      },
      productId: 'p1',
      sessionId: 's1',
      prompt: 'ad',
      language: 'es',
    })
    expect(venta.postStyle).toBe('venta-directa')
    expect(venta.width).toBe(1080)
    expect(venta.height).toBe(1080)
  })

  it('formats assumptions label', () => {
    const label = formatImageAssumptions({
      style: { kind: 'preset', presetId: 'comparison' },
      aspectRatio: '3:4',
      model: 'nano-banana-pro',
      density: 'medium',
    }, 'es')
    expect(label).toContain('Comparación')
    expect(label).toContain('3:4')
    expect(label).toContain('Nano Banana Pro')
  })
})
