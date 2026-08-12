import { describe, expect, it } from 'vitest'
import { assertChatSessionDeleteResult } from '../src/services/database'

describe('assertChatSessionDeleteResult', () => {
  it('throws a clear error when delete returns zero rows (silent RLS)', () => {
    expect(() => assertChatSessionDeleteResult([])).toThrow(/no row deleted/i)
    expect(() => assertChatSessionDeleteResult(null)).toThrow(/no row deleted/i)
    expect(() => assertChatSessionDeleteResult(undefined)).toThrow(/CASCADE/i)
  })

  it('accepts a deleted id row', () => {
    expect(() => assertChatSessionDeleteResult([{ id: 's1' }])).not.toThrow()
  })
})
