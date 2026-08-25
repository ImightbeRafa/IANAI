import { describe, expect, it } from 'vitest'
import { resolveGrokAspectRatio } from '../api/lib/grok-image-edit'
import {
  assertProductReferenceGate,
  listUnresolvedScriptPlaceholders,
  mapPriceRangeLabel,
} from '../api/lib/mcp/reference-gate'
import { evaluateScriptBatch } from '../api/lib/guiones/script-quality'
import { buildScriptContextProfile } from '../api/lib/guiones/script-context-profile'
import type { GeneratedScript, ScriptBrief } from '../api/lib/guiones/types'

describe('resolveGrokAspectRatio fail-closed', () => {
  it('accepts native ratios', () => {
    expect(resolveGrokAspectRatio('9:16')).toBe('9:16')
    expect(resolveGrokAspectRatio('1:1')).toBe('1:1')
    expect(resolveGrokAspectRatio('3:4')).toBe('3:4')
  })

  it('rejects 4:5 without fallback', () => {
    expect(() => resolveGrokAspectRatio('4:5')).toThrow(/Unsupported aspectRatio/)
  })

  it('maps 4:5 only when allowFallback', () => {
    expect(resolveGrokAspectRatio('4:5', { allowFallback: true })).toBe('3:4')
  })
})

describe('assertProductReferenceGate', () => {
  it('blocks empty product library', () => {
    expect(() => assertProductReferenceGate({
      toolName: 'execute_image_generate',
      productRefCount: 0,
    })).toThrow(/no product reference/)
  })

  it('requires confirmed ids when product refs exist', () => {
    expect(() => assertProductReferenceGate({
      toolName: 'execute_image_generate',
      productRefCount: 2,
    })).toThrow(/none were confirmed/)
  })

  it('accepts confirmed product ids', () => {
    expect(() => assertProductReferenceGate({
      toolName: 'execute_image_generate',
      productRefCount: 2,
      referenceImageIds: ['img-1'],
    })).not.toThrow()
  })
})

describe('offer facts + quality', () => {
  it('maps price enums and keeps exact Sleep price in profile', () => {
    expect(mapPriceRangeLabel('economico', 'es')).toMatch(/accesible/)
    const profile = buildScriptContextProfile({
      businessContext: { name: 'Sleep', sales_channels: ['messages'] },
      productContext: {
        name: 'Sleep patches',
        type: 'product',
        product_description: 'Parches para dormir',
        differentiation: 'Transdermico natural',
        exact_price: '₡9.900',
        price_range: 'economico',
      },
    })
    expect(profile.offerFacts.some((f) => f.includes('₡9.900'))).toBe(true)
    expect(profile.offerFacts.some((f) => /\bopción económica\b/i.test(f))).toBe(false)
    expect(profile.offerFacts.some((f) => f === 'economico')).toBe(false)
  })

  it('fails scripts that leak placeholders or price enums', () => {
    const brief: ScriptBrief = {
      index: 1,
      scriptType: 'venta_directa',
      productType: 'product',
      angleId: 'a',
      hookMechanism: 'direct_offer',
      buyerStage: 'hot',
      openingPromise: 'offer',
      developmentBeats: [],
      mustIncludeFacts: ['₡9.900'],
      mustAvoid: [],
      cta: { strength: 'sales', channel: 'messages', textDirection: 'DM' },
      coreDoubt: 'trust',
      proofToUse: ['₡9.900'],
    }
    const scripts: GeneratedScript[] = [{
      index: 1,
      title: 'Leak',
      scriptType: 'venta_directa',
      hookMechanism: 'direct_offer',
      buyerStage: 'hot',
      spokenScript: {
        hook: 'Conoce nuestra opción económica [DIFERENCIADOR TANGIBLE]',
        development: 'Precio [PRECIO EXACTO] y alta calidad.',
        ctaOrClose: 'Mándanos mensaje.',
      },
      qualityScore: 0,
    }]
    const [report] = evaluateScriptBatch(scripts, [brief])
    expect(report.passed).toBe(false)
    expect(report.unresolvedPlaceholders?.length).toBeGreaterThan(0)
    expect(listUnresolvedScriptPlaceholders(scripts[0].spokenScript.hook).length).toBeGreaterThan(0)
  })
})
