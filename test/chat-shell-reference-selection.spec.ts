import { describe, expect, it } from 'vitest'
import {
  catalogOfferReferences,
  confirmedReferenceImageIds,
  hasKitProductVisuals,
  hasSelectedProductReference,
  mergeKitVisualsIntoCatalog,
  partitionReferenceCopies,
  postOptimizeVersionLabel,
  preselectOfferReferenceIds,
  selectedBrandLogoUrl,
  selectedKitProductUrls,
  shouldPersistPostOptimizeVersion,
  shouldPromptImageReferences,
  toggleReferenceSelection,
  withPreselectedReferences,
} from '../src/features/chat-shell/chatShellReferenceSelection'

const images = catalogOfferReferences([
  { id: 'p1', product_id: 'offer-a', kind: 'product', image_url: 'https://cdn/p1.webp', created_at: '2026-01-04T00:00:00Z' },
  { id: 'p2', product_id: 'offer-a', kind: 'product', image_url: 'https://cdn/p2.webp', created_at: '2026-01-03T00:00:00Z' },
  { id: 'p3', product_id: 'offer-a', kind: 'product', image_url: 'https://cdn/p3.webp', created_at: '2026-01-02T00:00:00Z' },
  { id: 'p4', product_id: 'offer-a', kind: 'product', image_url: 'https://cdn/p4.webp', created_at: '2026-01-01T00:00:00Z' },
  { id: 'c1', product_id: 'offer-a', kind: 'context', image_url: 'https://cdn/c1.webp', created_at: '2026-01-05T00:00:00Z' },
  { id: 'g1', product_id: 'offer-a', kind: 'generated', image_url: 'https://cdn/g1.webp', created_at: '2026-01-06T00:00:00Z' },
  { id: 'other', product_id: 'offer-b', kind: 'product', image_url: 'https://cdn/other.webp', created_at: '2026-01-07T00:00:00Z' },
])

describe('chat-shell reference selection', () => {
  it('always prompts for non-logo posts until the user confirms', () => {
    expect(shouldPromptImageReferences({ styleKind: 'preset' })).toBe(true)
    expect(shouldPromptImageReferences({ styleKind: 'product' })).toBe(true)
    expect(shouldPromptImageReferences({ styleKind: 'organic' })).toBe(true)
    expect(shouldPromptImageReferences({ styleKind: 'logo' })).toBe(false)
    expect(shouldPromptImageReferences({ styleKind: 'preset', referenceMode: 'use' })).toBe(false)
    expect(shouldPromptImageReferences({ styleKind: 'preset', referenceMode: 'none' })).toBe(false)
    // Foto studio-hero must still open Confirmá referencias until Generar sets mode.
    expect(shouldPromptImageReferences({ styleKind: 'product', referenceMode: undefined })).toBe(true)
  })

  it('preselects up to 3 current product angles and the kit logo', () => {
    expect(preselectOfferReferenceIds(images, 'offer-a')).toEqual(['p1', 'p2', 'p3'])
    const catalog = withPreselectedReferences(images, 'offer-a')
    expect(catalog.find((row) => row.id === 'c1')?.selected).toBe(false)
    expect(catalog.filter((row) => row.selected).map((row) => row.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('uses exact confirmed product IDs; preferred style stays off until opt-in', () => {
    const catalog = withPreselectedReferences(images, 'offer-a', ['p2', 'c1'])
    expect(confirmedReferenceImageIds(catalog)).toEqual(['p2'])
    expect(catalog.find((row) => row.id === 'c1')?.selected).toBe(false)
    expect(hasSelectedProductReference(catalog)).toBe(true)
  })

  it('copies foreign-offer images and keeps current-offer IDs', () => {
    expect(partitionReferenceCopies(
      [{ id: 'p1', productId: 'offer-a' }, { id: 'other', productId: 'offer-b' }],
      'offer-a'
    )).toEqual({ keepIds: ['p1'], copyIds: ['other'] })
  })

  it('caps selection at 4 when user opts in to more refs', () => {
    const catalog = withPreselectedReferences(images, 'offer-a')
    const withStyle = toggleReferenceSelection(catalog, 'c1')
    const extra = toggleReferenceSelection(withStyle, 'p4')
    expect(confirmedReferenceImageIds(extra)).toHaveLength(4)
    expect(postOptimizeVersionLabel('hard', 'es')).toBe('Post · Poco texto')
    expect(shouldPersistPostOptimizeVersion({
      latestContent: 'same',
      draft: 'same',
    })).toBe(false)
    expect(shouldPersistPostOptimizeVersion({
      latestContent: 'old',
      draft: 'new post copy',
    })).toBe(true)
  })

  it('classifies legacy context as scene and style labels as style', () => {
    const catalog = catalogOfferReferences([
      { id: 'c1', product_id: 'offer-a', kind: 'context', image_url: 'https://cdn/c1.webp', label: 'Escena · contexto' },
      { id: 's1', product_id: 'offer-a', kind: 'context', image_url: 'https://cdn/s1.webp', label: 'Estilo · post ref' },
      { id: 'legacy', product_id: 'offer-a', kind: 'context', image_url: 'https://cdn/legacy.webp', label: null },
    ])
    expect(catalog.find((row) => row.id === 'c1')?.kind).toBe('scene')
    expect(catalog.find((row) => row.id === 's1')?.kind).toBe('style')
    expect(catalog.find((row) => row.id === 'legacy')?.kind).toBe('scene')
  })

  it('classifies logo labels and preselects kit logo as brandLogoUrl', () => {
    const catalog = catalogOfferReferences([
      { id: 'p1', product_id: 'offer-a', kind: 'product', image_url: 'https://cdn/p1.webp', label: 'Producto' },
      { id: 'logo1', product_id: 'offer-a', kind: 'context', image_url: 'https://cdn/logo.webp', label: 'Logo · marca' },
    ])
    expect(catalog.find((row) => row.id === 'logo1')?.kind).toBe('logo')
    const preselected = withPreselectedReferences(catalog, 'offer-a', ['p1', 'logo1'])
    expect(confirmedReferenceImageIds(preselected)).toEqual(['p1'])
    expect(selectedBrandLogoUrl(preselected)).toBe('https://cdn/logo.webp')
  })

  it('merges brand-kit uploads as product + logo refs and preselects them', () => {
    const merged = mergeKitVisualsIntoCatalog(
      catalogOfferReferences([
        { id: 'p1', product_id: 'offer-a', kind: 'product', image_url: 'https://cdn/p1.webp', created_at: '2026-01-04T00:00:00Z' },
      ]),
      {
        logo_url: 'https://cdn/kit-logo.webp',
        reference_images: ['https://cdn/kit-product.webp', 'https://cdn/p1.webp'],
      },
      'offer-a'
    )
    expect(merged.find((row) => row.kind === 'logo')?.url).toBe('https://cdn/kit-logo.webp')
    expect(merged.filter((row) => row.kind === 'product').map((row) => row.url)).toEqual([
      'https://cdn/kit-product.webp',
      'https://cdn/p1.webp',
    ])
    const selected = withPreselectedReferences(merged, 'offer-a')
    expect(selected.filter((row) => row.selected).map((row) => row.kind).sort()).toEqual(['logo', 'product', 'product'])
    expect(selectedKitProductUrls(selected)).toEqual(['https://cdn/kit-product.webp'])
    expect(hasKitProductVisuals({ logo_url: 'https://cdn/kit-logo.webp', reference_images: [] })).toBe(true)
  })
})
