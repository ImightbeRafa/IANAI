import { describe, expect, it } from 'vitest'
import { buildProductPrompt } from '../api/data/image-presets'

describe('buildProductPrompt no-ref quality', () => {
  it('includes offer context and anti-generic-box guidance without refs', () => {
    const prompt = buildProductPrompt('studio-hero', '1:1', 'es', {
      hasReferenceImages: false,
      productContext: {
        brandName: 'Bloom',
        name: 'Parches micro-agujas',
        description: '9 parches para granitos. Micro-agujas. ₡9.900. Costa Rica.',
        priceOffer: '₡9.900',
        category: 'skincare',
      },
    })
    expect(prompt).toContain('Bloom')
    expect(prompt).toContain('₡9.900')
    expect(prompt).toMatch(/caja sellada genérica/i)
    expect(prompt).toMatch(/Generar post/)
  })
})
