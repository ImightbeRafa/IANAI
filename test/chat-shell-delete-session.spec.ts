import { describe, expect, it } from 'vitest'
import {
  assertChatSessionDeleteResult,
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
})
