import { describe, expect, it } from 'vitest'
import { buildScriptContextProfile } from '../api/lib/guiones/script-context-profile'

describe('buildScriptContextProfile', () => {
  it('extracts generic product facts and placeholders', () => {
    const profile = buildScriptContextProfile({
      businessContext: { name: 'Acme', sales_channels: ['messages'], does_shipping: true, shipping_method: '48h delivery' },
      productContext: {
        name: 'Smart Bottle',
        type: 'product',
        product_category: 'water bottle',
        product_description: 'Keeps water cold for 24 hours',
        technical_specs: 'double-wall steel',
        current_alternatives: 'plastic bottles',
        alternatives_disadvantages: 'get warm fast',
      },
      activeSalesChannel: 'messages',
    })

    expect(profile.productType).toBe('product')
    expect(profile.productName).toBe('Smart Bottle')
    expect(profile.offerFacts.join(' ')).toContain('Keeps water cold')
    expect(profile.proof.join(' ')).toContain('double-wall steel')
    expect(profile.alternatives[0].name).toContain('plastic bottles')
    expect(profile.logistics.join(' ')).toContain('48h delivery')
  })

  it('uses real estate price placeholder when missing', () => {
    const profile = buildScriptContextProfile({
      productContext: {
        name: 'Escazu Apartment',
        type: 'real_estate',
        re_location: 'Escazu',
        re_bedrooms: '2',
      },
    })

    expect(profile.missingFacts).toContain('[PRECIO]')
  })
})

