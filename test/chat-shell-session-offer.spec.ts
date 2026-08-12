import { describe, expect, it } from 'vitest'
import {
  pickSafeChatSessionUpdates,
  resolveSessionOfferProductId,
} from '../src/features/chat-shell/sessionOffer'

describe('resolveSessionOfferProductId', () => {
  it('prefers session.product_id over offers', () => {
    expect(
      resolveSessionOfferProductId(
        { product_id: 'p-session' },
        [{ product_id: 'p-offer', position: 1 }]
      )
    ).toBe('p-session')
  })

  it('uses lowest-position offer when session product is null', () => {
    expect(
      resolveSessionOfferProductId(
        { product_id: null },
        [
          { product_id: 'p2', position: 2 },
          { product_id: 'p1', position: 1 },
        ]
      )
    ).toBe('p1')
  })

  it('returns null for offerless Quick sessions', () => {
    expect(resolveSessionOfferProductId({ product_id: null }, [])).toBeNull()
    expect(resolveSessionOfferProductId({ product_id: null }, null)).toBeNull()
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
