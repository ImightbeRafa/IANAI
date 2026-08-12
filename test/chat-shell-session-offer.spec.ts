import { describe, expect, it } from 'vitest'
import {
  canAddSessionOffer,
  CHAT_SHELL_MAX_OFFERS,
  normalizeOfferPositions,
  pickSafeChatSessionUpdates,
  resolveNextSessionId,
  resolveSessionOfferProductId,
} from '../src/features/chat-shell/sessionOffer'
import {
  planOfferGenerationWalk,
  planOfferProductIds,
  planRetryOfferWalk,
} from '../src/features/chat-shell/chatShellGeneration'
import { authorizeSessionOfferProduct } from '../api/lib/session-offer-auth'

describe('normalizeOfferPositions / cap', () => {
  it('rewrites gap-free positions 1..n and caps at 5', () => {
    expect(
      normalizeOfferPositions(['a', 'b', 'a', 'c', 'd', 'e', 'f'])
    ).toEqual([
      { product_id: 'a', position: 1 },
      { product_id: 'b', position: 2 },
      { product_id: 'c', position: 3 },
      { product_id: 'd', position: 4 },
      { product_id: 'e', position: 5 },
    ])
  })

  it('enforces canAddSessionOffer at max', () => {
    expect(canAddSessionOffer(0)).toBe(true)
    expect(canAddSessionOffer(CHAT_SHELL_MAX_OFFERS - 1)).toBe(true)
    expect(canAddSessionOffer(CHAT_SHELL_MAX_OFFERS)).toBe(false)
  })
})

describe('resolveSessionOfferProductId', () => {
  it('prefers position-1 offer over session.product_id when offers exist', () => {
    expect(
      resolveSessionOfferProductId(
        { product_id: 'p-session' },
        [
          { product_id: 'p2', position: 2 },
          { product_id: 'p1', position: 1 },
        ]
      )
    ).toBe('p1')
  })

  it('falls back to session.product_id when offers empty (legacy)', () => {
    expect(resolveSessionOfferProductId({ product_id: 'p-session' }, [])).toBe('p-session')
    expect(resolveSessionOfferProductId({ product_id: null }, [])).toBeNull()
    expect(resolveSessionOfferProductId({ product_id: null }, null)).toBeNull()
  })
})

describe('planOfferGenerationWalk', () => {
  it('walks ALL offers by position ascending — not primary only', () => {
    const walk = planOfferGenerationWalk([
      { product_id: 'c', position: 3, product: { name: 'C' } },
      { product_id: 'a', position: 1, product: { name: 'A' } },
      { product_id: 'b', position: 2, product: { name: 'B' } },
    ])
    expect(walk.map((s) => s.productId)).toEqual(['a', 'b', 'c'])
    expect(walk.map((s) => s.ordinal)).toEqual([1, 2, 3])
    expect(walk[0].name).toBe('A')
  })

  it('retry walk keeps failed ids in order and fresh ordinals', () => {
    const offers = [
      { product_id: 'a', position: 1, product: { name: 'A' } },
      { product_id: 'b', position: 2, product: { name: 'B' } },
      { product_id: 'c', position: 3, product: { name: 'C' } },
    ]
    const walk = planRetryOfferWalk(['c', 'a'], offers)
    expect(walk.map((s) => s.productId)).toEqual(['c', 'a'])
    expect(walk.map((s) => s.ordinal)).toEqual([1, 2])
  })

  it('planOfferProductIds normalizes + caps', () => {
    expect(planOfferProductIds(['x', 'y', 'x', 'z'])).toEqual(['x', 'y', 'z'])
  })
})

describe('authorizeSessionOfferProduct (C1b)', () => {
  it('allows product in session offers', () => {
    expect(
      authorizeSessionOfferProduct({
        offerProductIds: ['p1', 'p2'],
        sessionProductId: 'p-legacy',
        clientProductId: 'p2',
      })
    ).toEqual({ ok: true, productId: 'p2', mode: 'offers' })
  })

  it('denies foreign product_id not in offers (even if session.product_id)', () => {
    const result = authorizeSessionOfferProduct({
      offerProductIds: ['p1', 'p2'],
      sessionProductId: 'p-legacy',
      clientProductId: 'p-foreign',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
    }
  })

  it('denies stale session.product_id when offers exist and client sends it', () => {
    const result = authorizeSessionOfferProduct({
      offerProductIds: ['p1', 'p2'],
      sessionProductId: 'p-legacy',
      clientProductId: 'p-legacy',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('legacy: empty offers allows session.product_id only', () => {
    expect(
      authorizeSessionOfferProduct({
        offerProductIds: [],
        sessionProductId: 'p-legacy',
        clientProductId: 'p-legacy',
      })
    ).toEqual({ ok: true, productId: 'p-legacy', mode: 'legacy' })

    expect(
      authorizeSessionOfferProduct({
        offerProductIds: [],
        sessionProductId: 'p-legacy',
        clientProductId: null,
      })
    ).toEqual({ ok: true, productId: 'p-legacy', mode: 'legacy' })

    const foreign = authorizeSessionOfferProduct({
      offerProductIds: [],
      sessionProductId: 'p-legacy',
      clientProductId: 'p-other',
    })
    expect(foreign.ok).toBe(false)
    if (!foreign.ok) expect(foreign.status).toBe(403)
  })

  it('requires product when offers empty and no session product', () => {
    const result = authorizeSessionOfferProduct({
      offerProductIds: [],
      sessionProductId: null,
      clientProductId: 'p1',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })
})

describe('pickSafeChatSessionUpdates', () => {
  it('keeps only safe keys and drops ownership fields', () => {
    expect(
      pickSafeChatSessionUpdates({
        title: 'Hello',
        context: 'notes',
        primary_channel: 'messages',
        awareness_level: 'warm',
        user_id: 'stolen',
        business_id: 'stolen',
        product_id: 'stolen',
        unknown: 1,
      })
    ).toEqual({
      title: 'Hello',
      context: 'notes',
      primary_channel: 'messages',
      awareness_level: 'warm',
    })
  })
})

describe('resolveNextSessionId', () => {
  it('prefers live current selection over hydrate preferred', () => {
    expect(
      resolveNextSessionId({
        sessionIds: ['a', 'b', 'c'],
        preferredId: 'a',
        currentId: 'b',
        urlId: 'a',
      })
    ).toBe('b')
  })

  it('keeps optimistic current even when missing from list', () => {
    expect(
      resolveNextSessionId({
        sessionIds: ['a', 'b'],
        preferredId: 'a',
        currentId: 'new-optimistic',
        urlId: 'new-optimistic',
      })
    ).toBe('new-optimistic')
  })

  it('drops stale current that is neither in list nor URL/preferred', () => {
    expect(
      resolveNextSessionId({
        sessionIds: ['a', 'b'],
        preferredId: 'b',
        currentId: 'deleted',
        urlId: null,
      })
    ).toBe('b')
  })

  it('prefers URL when current is missing', () => {
    expect(
      resolveNextSessionId({
        sessionIds: ['a', 'b', 'c'],
        preferredId: 'a',
        currentId: null,
        urlId: 'c',
      })
    ).toBe('c')
  })

  it('falls back to preferred then first when nothing selected', () => {
    expect(
      resolveNextSessionId({
        sessionIds: ['a', 'b'],
        preferredId: 'b',
        currentId: null,
        urlId: null,
      })
    ).toBe('b')
    expect(
      resolveNextSessionId({
        sessionIds: ['a', 'b'],
        preferredId: 'gone',
        currentId: null,
        urlId: null,
      })
    ).toBe('a')
  })
})
