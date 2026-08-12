import { describe, expect, it } from 'vitest'
import { DEFAULT_SCRIPT_SETTINGS } from '../src/services/grokApi'
import { parseChatShellScriptIntent } from '../src/features/chat-shell/chatShellScriptIntent'
import {
  readAiMemoryEnabled,
  resolveBrandKitIdForProduct,
} from '../src/features/chat-shell/chatShellGenerationPreferences'

describe('parseChatShellScriptIntent', () => {
  it('parses "generame 2 de venta" as by_type venta_directa×2', () => {
    const intent = parseChatShellScriptIntent(
      'generame 2 de venta',
      'es',
      DEFAULT_SCRIPT_SETTINGS
    )
    expect(intent.matched).toBe(true)
    expect(intent.settings.generationMode).toBe('by_type')
    expect(intent.settings.scriptTypeConfig.venta_directa).toBe(2)
    expect(intent.settings.variations).toBe(2)
    expect(intent.expectedCount).toBe(2)
    expect(intent.orderedTypes).toEqual(['venta_directa'])
  })

  it('parses English "generate 2 sales scripts"', () => {
    const intent = parseChatShellScriptIntent(
      'generate 2 sales scripts',
      'en',
      DEFAULT_SCRIPT_SETTINGS
    )
    expect(intent.matched).toBe(true)
    expect(intent.settings.generationMode).toBe('by_type')
    expect(intent.settings.scriptTypeConfig.venta_directa).toBe(2)
  })

  it('uses mixed mode with count when no type is named', () => {
    const intent = parseChatShellScriptIntent(
      'generame 4 guiones',
      'es',
      DEFAULT_SCRIPT_SETTINGS
    )
    expect(intent.matched).toBe(true)
    expect(intent.settings.generationMode).toBe('mixed')
    expect(intent.settings.variations).toBe(4)
  })

  it('distributes global count across multiple named types', () => {
    const intent = parseChatShellScriptIntent(
      'generame 3 venta y educativo',
      'es',
      DEFAULT_SCRIPT_SETTINGS
    )
    expect(intent.settings.generationMode).toBe('by_type')
    expect(intent.settings.scriptTypeConfig.venta_directa).toBeGreaterThan(0)
    expect(intent.settings.scriptTypeConfig.educativo).toBeGreaterThan(0)
    expect(intent.expectedCount).toBe(3)
  })

  it('respects local counts "2 venta y 1 educativo"', () => {
    const intent = parseChatShellScriptIntent(
      'generame 2 venta y 1 educativo',
      'es',
      DEFAULT_SCRIPT_SETTINGS
    )
    expect(intent.settings.scriptTypeConfig.venta_directa).toBe(2)
    expect(intent.settings.scriptTypeConfig.educativo).toBe(1)
    expect(intent.expectedCount).toBe(3)
  })

  it('maps framework aliases (ES/EN)', () => {
    const cases: Array<[string, string]> = [
      ['generame 1 desvalidar', 'desvalidar_alternativas'],
      ['generate 1 invalidate alternatives', 'desvalidar_alternativas'],
      ['generame 1 mostrar servicio', 'mostrar_servicio'],
      ['generame 1 paso a paso', 'paso_a_paso'],
      ['generate 1 step-by-step', 'paso_a_paso'],
      ['generame 1 reconocimiento', 'reconocimiento'],
      ['generate 1 awareness', 'reconocimiento'],
      ['generame 1 storytelling', 'storytelling'],
      ['generame 1 tendencia', 'tendencia'],
      ['generame 1 engagement', 'engagement'],
      ['generame 1 variedad', 'variedad_productos'],
    ]
    for (const [text, key] of cases) {
      const intent = parseChatShellScriptIntent(text, 'es', DEFAULT_SCRIPT_SETTINGS)
      expect(intent.settings.generationMode).toBe('by_type')
      expect(
        (intent.settings.scriptTypeConfig as Record<string, number>)[key],
        text
      ).toBe(1)
    }
  })

  it('parses CTA modes and organic/recognition defaults', () => {
    expect(
      parseChatShellScriptIntent('generame 1 venta sin CTA', 'es', DEFAULT_SCRIPT_SETTINGS)
        .settings.ctaStrength
    ).toBe('none')
    expect(
      parseChatShellScriptIntent('generame 1 venta CTA suave', 'es', DEFAULT_SCRIPT_SETTINGS)
        .settings.ctaStrength
    ).toBe('soft')
    expect(
      parseChatShellScriptIntent('generame 1 venta mención de marca', 'es', DEFAULT_SCRIPT_SETTINGS)
        .settings.ctaStrength
    ).toBe('brand_mention')
    expect(
      parseChatShellScriptIntent('generame 1 venta CTA de venta', 'es', DEFAULT_SCRIPT_SETTINGS)
        .settings.ctaStrength
    ).toBe('sales')
    expect(
      parseChatShellScriptIntent('generame 1 educativo', 'es', DEFAULT_SCRIPT_SETTINGS)
        .settings.ctaStrength
    ).toBe('soft')
    expect(
      parseChatShellScriptIntent('generame 1 reconocimiento', 'es', DEFAULT_SCRIPT_SETTINGS)
        .settings.ctaStrength
    ).toBe('none')
  })

  it('enables fresh angles + structured pipeline', () => {
    const intent = parseChatShellScriptIntent(
      'generame 2 venta con ángulos frescos',
      'es',
      DEFAULT_SCRIPT_SETTINGS
    )
    expect(intent.settings.forceFreshAngles).toBe(true)
    expect(intent.settings.useStructuredPipeline).toBe(true)
  })

  it('normalizes accents/case/punctuation', () => {
    const intent = parseChatShellScriptIntent(
      '¡Generáme DOS GUIÓNES de VENTA!',
      'es',
      DEFAULT_SCRIPT_SETTINGS
    )
    expect(intent.settings.scriptTypeConfig.venta_directa).toBe(2)
  })

  it('caps counts at 10 with warning', () => {
    const intent = parseChatShellScriptIntent(
      'generame 99 guiones de venta',
      'es',
      DEFAULT_SCRIPT_SETTINGS
    )
    expect(intent.settings.scriptTypeConfig.venta_directa).toBe(10)
    expect(intent.settings.variations).toBe(10)
    expect(intent.warnings).toContain('capped_at_10')
  })

  it('does not treat 2x1 / prices as counts', () => {
    const promo = parseChatShellScriptIntent(
      'el producto tiene oferta 2x1',
      'es',
      DEFAULT_SCRIPT_SETTINGS
    )
    expect(promo.matched).toBe(false)

    const price = parseChatShellScriptIntent(
      'cuesta $2 en la tienda',
      'es',
      DEFAULT_SCRIPT_SETTINGS
    )
    expect(price.matched).toBe(false)
  })

  it('clones defaults and never mutates the input object', () => {
    const defaults = {
      ...DEFAULT_SCRIPT_SETTINGS,
      scriptTypeConfig: { ...DEFAULT_SCRIPT_SETTINGS.scriptTypeConfig },
    }
    const before = JSON.stringify(defaults)
    const intent = parseChatShellScriptIntent('generame 2 de venta', 'es', defaults)
    expect(JSON.stringify(defaults)).toBe(before)
    intent.settings.scriptTypeConfig.venta_directa = 99
    expect(defaults.scriptTypeConfig.venta_directa).toBe(
      DEFAULT_SCRIPT_SETTINGS.scriptTypeConfig.venta_directa
    )
  })

  it('returns default clone when no intent cues', () => {
    const intent = parseChatShellScriptIntent(
      'hola como estas',
      'es',
      DEFAULT_SCRIPT_SETTINGS
    )
    expect(intent.matched).toBe(false)
    expect(intent.settings.variations).toBe(DEFAULT_SCRIPT_SETTINGS.variations)
  })
})

describe('chatShellGenerationPreferences', () => {
  it('defaults ai memory to true when missing', () => {
    expect(readAiMemoryEnabled({ getItem: () => null })).toBe(true)
    expect(readAiMemoryEnabled(null)).toBe(true)
    expect(readAiMemoryEnabled({ getItem: () => 'false' })).toBe(false)
    expect(readAiMemoryEnabled({ getItem: () => 'true' })).toBe(true)
  })

  it('resolves brand kit: stored → default → undefined', () => {
    const kits = [
      { id: 'a', is_default: false, is_active: true },
      { id: 'b', is_default: true, is_active: true },
    ]
    const storage = {
      store: { bk_p1: 'a' } as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null
      },
    }
    expect(resolveBrandKitIdForProduct('p1', kits, storage)).toBe('a')
    expect(resolveBrandKitIdForProduct('p2', kits, storage)).toBe('b')
    expect(resolveBrandKitIdForProduct('p1', [], storage)).toBeUndefined()
    storage.store.bk_p1 = 'stale'
    expect(resolveBrandKitIdForProduct('p1', kits, storage)).toBe('b')
  })
})
