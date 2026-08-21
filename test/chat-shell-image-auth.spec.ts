import { describe, expect, it } from 'vitest'
import {
  authorizeProductImageForSession,
  authorizeSessionImageProduct,
  authorizeShellImagePoll,
  normalizeProductImageIdList,
} from '../api/lib/image-access'
import {
  buildOptimizeForPostPrompt,
  canShowImageActionsForOffer,
  filterImagesForOffer,
  latestImageByProductId,
  normalizePostTextDensity,
  resolveActiveImageOfferId,
  selectProductReferenceImageIds,
  sortArtifactsByOrdinal,
} from '../src/features/chat-shell/chatShellImages'

describe('authorizeSessionImageProduct (C3)', () => {
  it('requires product in offers (no legacy fallback)', () => {
    expect(
      authorizeSessionImageProduct({
        offerProductIds: [],
        clientProductId: 'p1',
      }).ok
    ).toBe(false)

    expect(
      authorizeSessionImageProduct({
        offerProductIds: ['p1', 'p2'],
        clientProductId: 'p2',
      })
    ).toEqual({ ok: true, productId: 'p2' })

    const foreign = authorizeSessionImageProduct({
      offerProductIds: ['p1'],
      clientProductId: 'p-foreign',
    })
    expect(foreign.ok).toBe(false)
    if (!foreign.ok) expect(foreign.status).toBe(403)
  })
})

describe('authorizeProductImageForSession', () => {
  it('rejects foreign product or other-session image', () => {
    expect(
      authorizeProductImageForSession({
        image: null,
        sessionId: 's1',
        productId: 'p1',
      }).ok
    ).toBe(false)

    expect(
      authorizeProductImageForSession({
        image: { id: 'i1', product_id: 'p2', session_id: null },
        sessionId: 's1',
        productId: 'p1',
      }).ok
    ).toBe(false)

    expect(
      authorizeProductImageForSession({
        image: { id: 'i1', product_id: 'p1', session_id: 's-other' },
        sessionId: 's1',
        productId: 'p1',
      }).ok
    ).toBe(false)

    expect(
      authorizeProductImageForSession({
        image: { id: 'i1', product_id: 'p1', session_id: null },
        sessionId: 's1',
        productId: 'p1',
      })
    ).toEqual({ ok: true, productId: 'p1' })
  })
})

describe('authorizeShellImagePoll', () => {
  it('rejects unbound session poll', () => {
    const denied = authorizeShellImagePoll({ sessionId: 's1', hasBoundTask: false })
    expect(denied.ok).toBe(false)
    expect(authorizeShellImagePoll({ sessionId: null, hasBoundTask: false })).toEqual({ ok: true })
  })
})

describe('chatShellImages helpers', () => {
  it('resolves sticky then primary offer', () => {
    expect(
      resolveActiveImageOfferId({
        offerProductIds: ['a', 'b', 'c'],
        preferredId: 'b',
        primaryProductId: 'a',
      })
    ).toBe('b')
    expect(
      resolveActiveImageOfferId({
        offerProductIds: ['a', 'b'],
        preferredId: 'gone',
        primaryProductId: 'a',
      })
    ).toBe('a')
  })

  it('filters images by offer and hides other-session generated', () => {
    const images = [
      { id: '1', product_id: 'a', kind: 'product', session_id: null },
      { id: '2', product_id: 'a', kind: 'generated', session_id: 's1' },
      { id: '3', product_id: 'a', kind: 'generated', session_id: 's2' },
      { id: '4', product_id: 'b', kind: 'product', session_id: null },
    ]
    expect(filterImagesForOffer(images, 'a', { sessionId: 's1' }).map((i) => i.id)).toEqual([
      '1',
      '2',
    ])
    expect(filterImagesForOffer(images, 'b', { sessionId: 's1' }).map((i) => i.id)).toEqual(['4'])
  })

  it('latest image by product and ScriptCard gating', () => {
    const map = latestImageByProductId([
      { id: 'old', product_id: 'a', created_at: '2020-01-01T00:00:00Z' },
      { id: 'new', product_id: 'a', created_at: '2024-01-01T00:00:00Z' },
    ])
    expect(map.get('a')?.id).toBe('new')
    expect(canShowImageActionsForOffer({ productId: 'a', latestByProduct: map })).toBe(true)
    expect(canShowImageActionsForOffer({ productId: 'b', latestByProduct: map })).toBe(false)
  })

  it('normalize density + optimize prompt', () => {
    expect(normalizePostTextDensity('nope')).toBe('medium')
    expect(buildOptimizeForPostPrompt({ scriptText: 'Hook…', density: 'hard' })).toContain('CORTA')
    expect(buildOptimizeForPostPrompt({ scriptText: 'Hook…', density: 'hard' })).toContain('Hook')
  })

  it('sorts artifacts by ordinal', () => {
    expect(
      sortArtifactsByOrdinal([
        { ordinal: 3 },
        { ordinal: 1 },
        { ordinal: 2 },
      ]).map((a) => a.ordinal)
    ).toEqual([1, 2, 3])
  })

  it('selectProductReferenceImageIds prefers product refs and skips generated', () => {
    expect(
      selectProductReferenceImageIds([
        { id: 'g1', kind: 'generated', created_at: '2025-01-03T00:00:00Z' },
        { id: 'c1', kind: 'context', created_at: '2025-01-02T00:00:00Z' },
        { id: 'p1', kind: 'product', created_at: '2025-01-01T00:00:00Z' },
        { id: 'p2', kind: 'product', created_at: '2025-01-04T00:00:00Z' },
      ])
    ).toEqual(['p2', 'p1', 'c1'])
  })

  it('treats message-linked rows as generated even if kind is missing', () => {
    expect(
      selectProductReferenceImageIds([
        { id: 'g1', kind: null, message_id: 'm1', created_at: '2025-01-05T00:00:00Z' },
        { id: 'p1', kind: 'product', created_at: '2025-01-01T00:00:00Z' },
      ])
    ).toEqual(['p1'])
  })

  it('can omit leftover style/context refs for an independent new post', () => {
    expect(
      selectProductReferenceImageIds(
        [
          { id: 'c1', kind: 'context', created_at: '2025-01-02T00:00:00Z' },
          { id: 'g1', kind: 'generated', created_at: '2025-01-03T00:00:00Z' },
          { id: 'p1', kind: 'product', created_at: '2025-01-01T00:00:00Z' },
        ],
        4,
        { includeContext: false }
      )
    ).toEqual(['p1'])
  })

  it('normalizeProductImageIdList caps and dedupes', () => {
    expect(normalizeProductImageIdList(['a', 'a', 'b', 'c', 'd', 'e', 1, null])).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
    expect(normalizeProductImageIdList(null)).toEqual([])
  })
})
