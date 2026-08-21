import { describe, expect, it } from 'vitest'
import {
  assertChatSessionDeleteResult,
  assertSessionThreadLinkagesCleared,
  formatChatSessionDeleteError,
} from '../src/services/database'

describe('assertChatSessionDeleteResult', () => {
  it('throws a clear error when delete returns zero rows (silent RLS)', () => {
    expect(() => assertChatSessionDeleteResult([])).toThrow(/not deleted/i)
    expect(() => assertChatSessionDeleteResult(null)).toThrow(/not deleted/i)
    expect(() => assertChatSessionDeleteResult(undefined)).toThrow(/RLS/i)
  })

  it('accepts a deleted id row', () => {
    expect(() => assertChatSessionDeleteResult([{ id: 's1' }])).not.toThrow()
  })
})

describe('assertSessionThreadLinkagesCleared', () => {
  it('passes when verify select returns empty', () => {
    expect(() => assertSessionThreadLinkagesCleared('product_images', [])).not.toThrow()
    expect(() => assertSessionThreadLinkagesCleared('posts', [])).not.toThrow()
  })

  it('throws when rows remain after cleanup (silent RLS UPDATE)', () => {
    expect(() =>
      assertSessionThreadLinkagesCleared('product_images', [{ id: 'img-1' }])
    ).toThrow(/product_images still linked|RLS/i)
    expect(() => assertSessionThreadLinkagesCleared('posts', [{ id: 'p-1' }])).toThrow(
      /posts still linked|RLS/i
    )
  })

  it('throws fail-closed when verify result is null/undefined', () => {
    expect(() => assertSessionThreadLinkagesCleared('product_images', null)).toThrow(
      /could not verify/i
    )
    expect(() => assertSessionThreadLinkagesCleared('posts', undefined)).toThrow(
      /could not verify/i
    )
  })
})

describe('formatChatSessionDeleteError', () => {
  it('surfaces PostgREST message and code (e.g. 23503)', () => {
    const err = formatChatSessionDeleteError({
      message: 'update or delete on table "chat_session_offers" violates foreign key constraint',
      code: '23503',
      details: 'Key is still referenced from table "product_images".',
    })
    expect(err.message).toContain('23503')
    expect(err.message).toMatch(/foreign key|product_images/i)
  })

  it('surfaces check-constraint 23514 (message_requires_session)', () => {
    const err = formatChatSessionDeleteError({
      message:
        'new row for relation "product_images" violates check constraint "product_images_message_requires_session"',
      code: '23514',
    })
    expect(err.message).toContain('23514')
    expect(err.message).toMatch(/product_images_message_requires_session/)
  })

  it('preserves assert Error messages for toast (err.message)', () => {
    const original = new Error('Session delete blocked: product_images still linked after cleanup')
    const err = formatChatSessionDeleteError(original)
    expect(err.message).toBe(original.message)
  })
})
