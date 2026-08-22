import { describe, expect, it } from 'vitest'

/**
 * Pure helper mirroring chat_sessions_resolved.resolved_business_id.
 * Keeps classic→shell placement logic testable without PostgREST.
 */
export function resolveSessionBusinessId(input: {
  business_id?: string | null
  product_business_id?: string | null
}): string | null {
  return input.business_id || input.product_business_id || null
}

describe('resolveSessionBusinessId', () => {
  it('prefers explicit session business_id', () => {
    expect(resolveSessionBusinessId({
      business_id: 'brand-a',
      product_business_id: 'brand-b',
    })).toBe('brand-a')
  })

  it('falls back to product.business_id for classic sessions', () => {
    expect(resolveSessionBusinessId({
      business_id: null,
      product_business_id: 'brand-a',
    })).toBe('brand-a')
  })

  it('returns null when neither is set', () => {
    expect(resolveSessionBusinessId({
      business_id: null,
      product_business_id: null,
    })).toBeNull()
  })
})
