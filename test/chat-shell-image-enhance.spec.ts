import { describe, expect, it } from 'vitest'
import {
  buildShellImageEnhanceBody,
  collectOfferEnhanceReferences,
  mapEnhanceModeToTier,
} from '../src/features/chat-shell/chatShellImageEnhance'

describe('mapEnhanceModeToTier', () => {
  it('maps magic to modernize and rebuild to rebuild', () => {
    expect(mapEnhanceModeToTier('magic')).toBe('modernize')
    expect(mapEnhanceModeToTier('rebuild')).toBe('rebuild')
  })
})

describe('collectOfferEnhanceReferences', () => {
  it('keeps current-offer product and context refs, newest first, excluding generated and other offers', () => {
    const refs = collectOfferEnhanceReferences([
      {
        id: 'old-product',
        product_id: 'offer-a',
        kind: 'product',
        image_url: 'https://cdn.example/old-product.webp',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'new-product',
        product_id: 'offer-a',
        kind: 'product',
        image_url: 'https://cdn.example/new-product.webp',
        created_at: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'context',
        product_id: 'offer-a',
        kind: 'context',
        image_url: 'https://cdn.example/context.webp',
        created_at: '2026-05-01T00:00:00.000Z',
      },
      {
        id: 'generated',
        product_id: 'offer-a',
        kind: 'generated',
        image_url: 'https://cdn.example/generated.webp',
        created_at: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'other-offer',
        product_id: 'offer-b',
        kind: 'product',
        image_url: 'https://cdn.example/other.webp',
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ], 'offer-a')

    expect(refs.productUrls).toEqual([
      'https://cdn.example/new-product.webp',
      'https://cdn.example/old-product.webp',
    ])
    expect(refs.contextUrls).toEqual(['https://cdn.example/context.webp'])
  })

  it('excludes the image being enhanced and caps each role at 4', () => {
    const images = Array.from({ length: 6 }, (_, index) => ({
      id: `p-${index}`,
      product_id: 'offer-a',
      kind: 'product' as const,
      image_url: `https://cdn.example/p-${index}.webp`,
      created_at: `2026-01-0${index + 1}T00:00:00.000Z`,
    }))
    const refs = collectOfferEnhanceReferences(images, 'offer-a', 'p-5')
    expect(refs.productUrls).toEqual([
      'https://cdn.example/p-4.webp',
      'https://cdn.example/p-3.webp',
      'https://cdn.example/p-2.webp',
      'https://cdn.example/p-1.webp',
    ])
  })
})

describe('buildShellImageEnhanceBody', () => {
  it('sends logo, colors, refs, tier, and the user instruction', () => {
    expect(buildShellImageEnhanceBody({
      productId: 'prod-1',
      sessionId: 'sess-1',
      enhanceImage: 'data:image/webp;base64,aaa',
      enhanceTier: 'rebuild',
      language: 'es',
      editPrompt: 'Keep the official logo and product.',
      brandKitId: 'kit-1',
      brandLogoUrl: 'https://cdn.example/logo.png',
      customColors: ['#111111', '#222222', '#333333', '#444444'],
      productReferenceImages: ['data:image/webp;base64,prod'],
      contextReferenceImages: ['data:image/webp;base64,ctx'],
      aspectRatio: '9:16',
    })).toEqual({
      action: 'enhance',
      model: 'grok-imagine',
      productId: 'prod-1',
      sessionId: 'sess-1',
      enhanceImage: 'data:image/webp;base64,aaa',
      enhanceTier: 'rebuild',
      language: 'es',
      editPrompt: 'Keep the official logo and product.',
      brandKitId: 'kit-1',
      brandLogoUrl: 'https://cdn.example/logo.png',
      customColors: ['#111111', '#222222', '#333333'],
      productReferenceImages: ['data:image/webp;base64,prod'],
      contextReferenceImages: ['data:image/webp;base64,ctx'],
      aspectRatio: '9:16',
    })
  })

  it('omits empty optional fields', () => {
    expect(buildShellImageEnhanceBody({
      productId: 'prod-1',
      sessionId: 'sess-1',
      enhanceImage: 'data:image/webp;base64,aaa',
      enhanceTier: 'modernize',
      language: 'en',
      editPrompt: '   ',
    })).toEqual({
      action: 'enhance',
      model: 'grok-imagine',
      productId: 'prod-1',
      sessionId: 'sess-1',
      enhanceImage: 'data:image/webp;base64,aaa',
      enhanceTier: 'modernize',
      language: 'en',
    })
  })
})
