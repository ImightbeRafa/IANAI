import { describe, expect, it } from 'vitest'
import { isBrandKitFkError, isMissingRowError, isMissingRpcError, isRlsDeniedError } from '../src/services/database'

describe('isMissingRpcError', () => {
  it('detects PostgREST missing-function codes', () => {
    expect(isMissingRpcError({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true)
    expect(isMissingRpcError({ code: '42883', message: 'function does not exist' })).toBe(true)
    expect(isMissingRpcError({ code: '404', message: '' })).toBe(true)
  })

  it('ignores unrelated errors', () => {
    expect(isMissingRpcError({ code: '42501', message: 'row-level security' })).toBe(false)
    expect(isMissingRpcError(null)).toBe(false)
  })
})

describe('isRlsDeniedError', () => {
  it('detects RLS insert denials', () => {
    expect(isRlsDeniedError({
      code: '42501',
      message: 'new row violates row-level security policy for table "brand_kits"',
    })).toBe(true)
    expect(isRlsDeniedError({
      message: 'new row violates row-level security policy for table "brand_kits"',
    })).toBe(true)
  })

  it('ignores missing-RPC errors', () => {
    expect(isRlsDeniedError({ code: 'PGRST202', message: 'Could not find the function' })).toBe(false)
  })
})

describe('isMissingRowError', () => {
  it('detects PostgREST zero-row coerce errors', () => {
    expect(isMissingRowError({
      code: 'PGRST116',
      details: 'The result contains 0 rows',
      message: 'Cannot coerce the result to a single JSON object',
    })).toBe(true)
  })
})

describe('isBrandKitFkError', () => {
  it('detects chat_sessions brand kit foreign keys', () => {
    expect(isBrandKitFkError({
      code: '23503',
      message: 'insert or update on table "chat_sessions" violates foreign key constraint "chat_sessions_brand_kit_business_fkey"',
    })).toBe(true)
    expect(isBrandKitFkError({ code: '409', message: 'Conflict' })).toBe(true)
  })
})
