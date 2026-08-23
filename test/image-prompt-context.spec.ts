import { describe, expect, it } from 'vitest'
import {
  buildExplicitReferenceRoleContract,
  buildLifestyleCreativeBrief,
  normalizeImageReferenceRole,
  selectGrokReferenceBudget,
} from '../api/lib/image-prompt-context'

describe('image prompt context', () => {
  it('classifies product / scene / style from kind+label', () => {
    expect(normalizeImageReferenceRole({ kind: 'product', label: null })).toBe('product')
    expect(normalizeImageReferenceRole({ kind: 'context', label: 'Escena · contexto' })).toBe('scene')
    expect(normalizeImageReferenceRole({ kind: 'context', label: 'Estilo · post ref' })).toBe('style')
    expect(normalizeImageReferenceRole({ kind: 'context', label: null })).toBe('scene')
  })

  it('budgets Grok refs with product first then scene/style', () => {
    const picked = selectGrokReferenceBudget([
      { id: 'p1', role: 'product' as const },
      { id: 'p2', role: 'product' as const },
      { id: 'p3', role: 'product' as const },
      { id: 's1', role: 'scene' as const },
      { id: 'y1', role: 'style' as const },
    ], 3)
    expect(picked.map((row) => row.id)).toEqual(['p1', 'p2', 's1'])
  })

  it('emits explicit per-image role contracts', () => {
    const text = buildExplicitReferenceRoleContract({
      language: 'es',
      roles: ['product', 'scene', 'style'],
    })
    expect(text).toContain('IMAGEN 1 = PRODUCTO')
    expect(text).toContain('IMAGEN 2 = ESCENA')
    expect(text).toContain('IMAGEN 3 = ESTILO')
    expect(text).not.toContain('clasifica mentalmente')
  })

  it('asks for rich lifestyle while forbidding invented claims', () => {
    const brief = buildLifestyleCreativeBrief({
      language: 'es',
      postStyle: 'venta-directa',
      hasProductRef: true,
      hasSceneRef: false,
      hasStyleRef: false,
      scriptContext: 'Gancho: Sonrisa clínica\nCTA: Pedí el tuyo',
    })
    expect(brief).toMatch(/lifestyle/i)
    expect(brief).toMatch(/Prohibido/i)
    expect(brief).toContain('Pedí el tuyo')
  })

  it('keeps English lifestyle brief bilingual and fidelity-safe', () => {
    const brief = buildLifestyleCreativeBrief({
      language: 'en',
      postStyle: 'organic-single',
      hasProductRef: true,
      hasSceneRef: true,
      hasStyleRef: true,
      scriptContext: 'Hook: Cleaner smile\nCTA: Order yours',
    })
    expect(brief).toMatch(/LIFESTYLE/i)
    expect(brief).toMatch(/Forbidden: invented claims/i)
    expect(brief).toContain('Order yours')
    expect(brief).toMatch(/scene reference/i)
  })

  it('uses studio brief when studio-hero has no scene ref', () => {
    const brief = buildLifestyleCreativeBrief({
      language: 'en',
      postStyle: 'product',
      productSubStyle: 'studio-hero',
      hasProductRef: true,
      hasSceneRef: false,
      hasStyleRef: false,
    })
    expect(brief).toMatch(/clean premium product/i)
    expect(brief).not.toMatch(/invent a credible premium lifestyle/i)
  })

  it('prefers style when product slots are already filled in budget', () => {
    const picked = selectGrokReferenceBudget([
      { id: 'p1', role: 'product' as const },
      { id: 'p2', role: 'product' as const },
      { id: 'y1', role: 'style' as const },
      { id: 's1', role: 'scene' as const },
    ], 3)
    expect(picked.map((row) => row.id)).toEqual(['p1', 'p2', 's1'])
  })
})
