import { describe, expect, it } from 'vitest'
import { isReusableProductReference } from '../api/lib/product-image-refs'

describe('isReusableProductReference', () => {
  it('keeps kit product/context photos even when message_id is set', () => {
    expect(isReusableProductReference({ kind: 'product', message_id: 'msg-1' })).toBe(true)
    expect(isReusableProductReference({ kind: 'context', message_id: 'msg-1' })).toBe(true)
  })

  it('drops generated posts', () => {
    expect(isReusableProductReference({ kind: 'generated', message_id: null })).toBe(false)
    expect(isReusableProductReference({ kind: null, message_id: 'msg-1' })).toBe(false)
  })
})
