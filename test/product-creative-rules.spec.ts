import { describe, expect, it } from 'vitest'
import {
  BLOOM_DERMAL_PATCH_PRICE,
  BLOOM_DERMAL_PATCH_PRODUCT_IDS,
  buildEnhancePatchConstraints,
  buildLockedPriceRules,
  buildLogoStampRules,
  buildPostCtaGuardrails,
  buildProductSilhouetteBlock,
  isBloomDermalPatchSku,
  isDermalMicroPatchOffer,
  resolveLockedOfferPrice,
  resolveProductSilhouette,
} from '../api/lib/product-creative-rules'
import { buildProductPrompt } from '../api/data/image-presets'

const BLOOM_PRODUCT_ID = [...BLOOM_DERMAL_PATCH_PRODUCT_IDS][0]

const BLOOM_PATCH_ROW = {
  name: 'Bloom — Dermal Micro-Infusion Patch',
  product_description: 'Parches para granitos con micro-agujas.',
  technical_specs:
    'Micro-agujas de ácido hialurónico puro, diámetro de 12mm, 9 parches por paquete, transparente.',
  offer: null as string | null,
  price_range: 'economico',
}

const bloomScope = { productId: BLOOM_PRODUCT_ID }

describe('product creative rules — Bloom dermal patch', () => {
  it('matches only known product/kit ids, not keyword heuristics', () => {
    expect(isBloomDermalPatchSku(bloomScope)).toBe(true)
    expect(isDermalMicroPatchOffer(BLOOM_PATCH_ROW, 'Bloom', bloomScope)).toBe(true)
    expect(isDermalMicroPatchOffer(BLOOM_PATCH_ROW, 'Bloom')).toBe(false)
    expect(isBloomDermalPatchSku({ productId: '00000000-0000-0000-0000-000000000000' })).toBe(false)
  })

  it('E2: resolves 3×3 hojita silhouette when refs are missing', () => {
    const silhouette = resolveProductSilhouette(BLOOM_PATCH_ROW, 'es', 'Bloom', bloomScope)
    expect(silhouette).toMatch(/9 parches/i)
    expect(silhouette).toMatch(/3×3|3x3/i)
    expect(silhouette).toMatch(/caja sellada|cartón genérico/i)

    const block = buildProductSilhouetteBlock(silhouette, 'es', { hasReferenceImages: false })
    expect(block).toMatch(/SILUETA OBLIGATORIA/i)
    expect(block).toMatch(/No hay fotos de referencia/i)

    const prompt = buildProductPrompt('studio-hero', '1:1', 'es', {
      hasReferenceImages: false,
      productContext: {
        brandName: 'Bloom',
        name: BLOOM_PATCH_ROW.name,
        priceOffer: BLOOM_DERMAL_PATCH_PRICE,
        productSilhouette: silhouette || undefined,
      },
      productSilhouette: silhouette || undefined,
    })
    expect(prompt).toMatch(/hojita|9 parches/i)
    expect(prompt).not.toMatch(/caja sellada genérica como hero/i)
  })

  it('locks ₡9.900 when offer is null for patch SKU', () => {
    expect(resolveLockedOfferPrice(BLOOM_PATCH_ROW, 'Bloom', bloomScope)).toBe(BLOOM_DERMAL_PATCH_PRICE)
    expect(resolveLockedOfferPrice({ ...BLOOM_PATCH_ROW, offer: '₡12.500' }, 'Bloom', bloomScope)).toBe('₡12.500')
    expect(resolveLockedOfferPrice({ name: 'Random soap', offer: null }, 'Acme')).toBeNull()
  })

  it('E3: logo stamp rules forbid AI wordmark when logo is attached (Bloom only)', () => {
    const withLogo = buildLogoStampRules('es', true, { bloomSku: true })
    expect(withLogo).toMatch(/ESTAMPADO|COMPÓSITALO/i)
    expect(withLogo).toMatch(/PROHIBIDO.*BLOOM/i)
    expect(withLogo).toMatch(/DERMAL MICRO-INFUSION PATCH/i)

    const withoutLogo = buildLogoStampRules('es', false, { bloomSku: true })
    expect(withoutLogo).toMatch(/NO inventes wordmark/i)
    expect(withoutLogo).toMatch(/NO generes el lockup/i)

    const generic = buildLogoStampRules('es', true, { bloomSku: false })
    expect(generic).not.toMatch(/BLOOM/)
  })

  it('G2: enhance constraints keep 9-patch silhouette', () => {
    const block = buildEnhancePatchConstraints(BLOOM_PATCH_ROW, 'es', 'Bloom', {
      hasProductRef: false,
      productId: BLOOM_PRODUCT_ID,
    })
    expect(block).toMatch(/9 parches|3×3|3x3/i)
    expect(block).toMatch(/conservá exactamente esta silueta/i)
    expect(block).toMatch(/PROHIBIDO.*caja|empaque/i)
  })

  it('G3: enhance constraints forbid strikethrough on locked list price', () => {
    const block = buildEnhancePatchConstraints(BLOOM_PATCH_ROW, 'es', 'Bloom', {
      hasProductRef: false,
      productId: BLOOM_PRODUCT_ID,
    })
    expect(block).toMatch(/PROHIBIDO tachado|strikethrough/i)
    expect(buildLockedPriceRules('es', BLOOM_DERMAL_PATCH_PRICE)).toMatch(/₡9\.900/)
    expect(buildLockedPriceRules('es', BLOOM_DERMAL_PATCH_PRICE)).toMatch(/tachado|strikethrough/i)
  })

  it('post CTA guardrails block Ads Manager default', () => {
    expect(buildPostCtaGuardrails('es', 'soft')).toMatch(/Dale click a este anuncio/i)
    expect(buildPostCtaGuardrails('es', 'soft')).toMatch(/Escribime|Pedilo/i)
    expect(buildPostCtaGuardrails('es', 'sales')).toMatch(/Pedí acá|Comprá ahora/i)
  })
})
