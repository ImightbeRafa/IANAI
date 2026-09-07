import { describe, expect, it } from 'vitest'
import {
  detectMissingIngredients,
  ingredientsPromptCopy,
  ingredientsSkippedAfterRefsConfirm,
  remainingIngredients,
  refsSoftMissingHint,
  shouldCheckImageIngredients,
  skipIngredientLabel,
} from '../src/features/chat-shell/chatShellIngredientsCheck'

describe('chatShellIngredientsCheck', () => {
  it('detects missing product photo, logo, and style', () => {
    expect(detectMissingIngredients({
      offerImages: [],
      productId: 'p1',
      brandLogoUrl: null,
    })).toEqual(['productPhoto', 'logo', 'style'])
  })

  it('treats Crear sin referencias as all three missing even when kit/rail has files', () => {
    expect(detectMissingIngredients({
      offerImages: [
        { id: '1', product_id: 'p1', kind: 'product', label: 'Producto' },
        { id: '2', product_id: 'p1', kind: 'context', label: 'Estilo · post ref' },
      ],
      productId: 'p1',
      brandLogoUrl: 'https://cdn/logo.png',
      referenceMode: 'none',
    })).toEqual(['productPhoto', 'logo', 'style'])
  })

  it('checks only selected refs when referenceMode is use', () => {
    expect(detectMissingIngredients({
      offerImages: [
        { id: '1', product_id: 'p1', kind: 'product', label: 'Producto' },
        { id: '2', product_id: 'p1', kind: 'context', label: 'Estilo · post ref' },
        { id: '3', product_id: 'p1', kind: 'product', label: 'Otro ángulo' },
      ],
      productId: 'p1',
      brandLogoUrl: 'https://cdn/logo.png',
      referenceMode: 'use',
      selectedReferenceImageIds: ['1'],
    })).toEqual(['style'])
  })

  it('detects only missing logo when product and style exist', () => {
    expect(detectMissingIngredients({
      offerImages: [
        { id: '1', product_id: 'p1', kind: 'product', label: 'Producto' },
        { id: '2', product_id: 'p1', kind: 'context', label: 'Estilo · post ref' },
      ],
      productId: 'p1',
      brandLogoUrl: '',
    })).toEqual(['logo'])
  })

  it('names each missing piece in Spanish voseo copy', () => {
    const copy = ingredientsPromptCopy(['productPhoto', 'logo'], 'es')
    expect(copy).toContain('foto de producto')
    expect(copy).toContain('logo')
    expect(copy).toMatch(/Podés subirla|Podés subirlas/)
  })

  it('provides per-ingredient skip labels', () => {
    expect(skipIngredientLabel('productPhoto', 'es')).toBe('Seguir sin foto de producto')
    expect(skipIngredientLabel('style', 'es')).toBe('Seguir sin estilo')
  })

  it('skips ingredients check for logo generate mode', () => {
    expect(shouldCheckImageIngredients('logo')).toBe(false)
    expect(shouldCheckImageIngredients('product')).toBe(true)
  })

  it('filters skipped ingredients', () => {
    expect(remainingIngredients(['productPhoto', 'logo'], new Set(['productPhoto']))).toEqual(['logo'])
  })

  it('after Confirmá referencias Generar, soft-skips style and logo (not product)', () => {
    expect(ingredientsSkippedAfterRefsConfirm('use')).toEqual(['logo', 'style'])
  })

  it('after Crear sin referencias, soft-skips all three so generate proceeds', () => {
    expect(ingredientsSkippedAfterRefsConfirm('none')).toEqual(['productPhoto', 'logo', 'style'])
  })

  it('product-only use mode + soft skips leaves nothing to gate', () => {
    const missing = detectMissingIngredients({
      offerImages: [
        { id: '1', product_id: 'p1', kind: 'product', label: 'Producto' },
        { id: '2', product_id: 'p1', kind: 'context', label: 'Estilo · post ref' },
      ],
      productId: 'p1',
      brandLogoUrl: null,
      referenceMode: 'use',
      selectedReferenceImageIds: ['1'],
    })
    expect(missing).toEqual(['logo', 'style'])
    expect(
      remainingIngredients(missing, new Set(ingredientsSkippedAfterRefsConfirm('use')))
    ).toEqual([])
  })

  it('refs soft hint is optional copy before Generar', () => {
    expect(refsSoftMissingHint(['style'], 'es')).toMatch(/estilo/i)
    expect(refsSoftMissingHint(['style', 'logo'], 'es')).toMatch(/Generá/i)
    expect(refsSoftMissingHint([], 'es')).toBeNull()
  })
})
