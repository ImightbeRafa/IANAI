import { describe, expect, it } from 'vitest'
import {
  detectMissingIngredients,
  ingredientsPromptCopy,
  remainingIngredients,
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
})
