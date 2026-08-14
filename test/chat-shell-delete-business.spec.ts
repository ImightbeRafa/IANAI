import { describe, expect, it, vi } from 'vitest'
import {
  assertBusinessProductsCleared,
  assertProductDeleteResult,
  planBusinessContentDeletion,
  runBusinessContentDeletion,
} from '../src/services/businessDelete'

describe('planBusinessContentDeletion', () => {
  it('deletes sessions first, then products, then verifies, then the folder', () => {
    expect(
      planBusinessContentDeletion({
        businessId: 'b1',
        sessionIds: ['s-active', 's-archived'],
        productIds: ['p1', 'p2'],
      })
    ).toEqual([
      { type: 'session', id: 's-active' },
      { type: 'session', id: 's-archived' },
      { type: 'product', id: 'p1' },
      { type: 'product', id: 'p2' },
      { type: 'verify-products' },
      { type: 'business', id: 'b1' },
    ])
  })

  it('allows a folder with no products or sessions', () => {
    expect(
      planBusinessContentDeletion({
        businessId: 'b1',
        sessionIds: [],
        productIds: [],
      })
    ).toEqual([
      { type: 'verify-products' },
      { type: 'business', id: 'b1' },
    ])
  })

  it('throws when the folder id is missing', () => {
    expect(() =>
      planBusinessContentDeletion({ businessId: '', sessionIds: [], productIds: [] })
    ).toThrow(/missing folder id/i)
  })
})

describe('assertProductDeleteResult', () => {
  it('fails closed on empty or missing rows', () => {
    expect(() => assertProductDeleteResult([])).toThrow(/not deleted/i)
    expect(() => assertProductDeleteResult(null)).toThrow(/not deleted/i)
    expect(() => assertProductDeleteResult([{ id: 'p1' }])).not.toThrow()
  })
})

describe('assertBusinessProductsCleared', () => {
  it('fails closed when products remain or verify is missing', () => {
    expect(() => assertBusinessProductsCleared(['p1'])).toThrow(/still linked/i)
    expect(() => assertBusinessProductsCleared(null)).toThrow(/could not verify/i)
    expect(() => assertBusinessProductsCleared([])).not.toThrow()
  })
})

describe('runBusinessContentDeletion', () => {
  it('runs steps in order and stops after the first failure', async () => {
    const calls: string[] = []
    const fns = {
      deleteSession: vi.fn(async (id: string) => {
        calls.push(`session:${id}`)
      }),
      deleteProduct: vi.fn(async (id: string) => {
        calls.push(`product:${id}`)
        if (id === 'p2') throw new Error('FK 23503')
      }),
      getRemainingProductIds: vi.fn(async () => {
        calls.push('verify')
        return []
      }),
      deleteBusinessRow: vi.fn(async (id: string) => {
        calls.push(`business:${id}`)
      }),
    }

    const steps = planBusinessContentDeletion({
      businessId: 'b1',
      sessionIds: ['s1'],
      productIds: ['p1', 'p2', 'p3'],
    })

    await expect(runBusinessContentDeletion(steps, fns)).rejects.toThrow(/23503/)
    expect(calls).toEqual(['session:s1', 'product:p1', 'product:p2'])
    expect(fns.getRemainingProductIds).not.toHaveBeenCalled()
    expect(fns.deleteBusinessRow).not.toHaveBeenCalled()
    expect(fns.deleteProduct).not.toHaveBeenCalledWith('p3')
  })

  it('verifies no products remain before deleting the folder', async () => {
    const fns = {
      deleteSession: vi.fn(async () => {}),
      deleteProduct: vi.fn(async () => {}),
      getRemainingProductIds: vi.fn(async () => ['leftover']),
      deleteBusinessRow: vi.fn(async () => {}),
    }

    await expect(
      runBusinessContentDeletion(
        planBusinessContentDeletion({
          businessId: 'b1',
          sessionIds: [],
          productIds: ['p1'],
        }),
        fns
      )
    ).rejects.toThrow(/still linked/)
    expect(fns.deleteBusinessRow).not.toHaveBeenCalled()
  })
})
