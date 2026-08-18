import { describe, expect, it } from 'vitest'
import {
  catalogOfferReferences,
  confirmedReferenceImageIds,
  hasSelectedProductReference,
  partitionReferenceCopies,
  postOptimizeVersionLabel,
  preselectOfferReferenceIds,
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
  })

  it('preselects up to 3 current product angles plus one context and skips generated', () => {
    expect(preselectOfferReferenceIds(images, 'offer-a')).toEqual(['p1', 'p2', 'p3', 'c1'])
  })

  it('uses exact confirmed IDs without silently adding extra product photos', () => {
    const catalog = withPreselectedReferences(images, 'offer-a', ['p2', 'c1'])
    expect(confirmedReferenceImageIds(catalog)).toEqual(['p2', 'c1'])
    expect(hasSelectedProductReference(catalog)).toBe(true)
  })

  it('copies foreign-offer images and keeps current-offer IDs', () => {
    expect(partitionReferenceCopies(
      [{ id: 'p1', productId: 'offer-a' }, { id: 'other', productId: 'offer-b' }],
      'offer-a'
    )).toEqual({ keepIds: ['p1'], copyIds: ['other'] })
  })

  it('caps selection at 4 and labels saved post copy', () => {
    const catalog = withPreselectedReferences(images, 'offer-a')
    const extra = toggleReferenceSelection(catalog, 'p4')
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
})
