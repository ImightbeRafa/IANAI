/**
 * Pure credit catalog + FIFO tests (no DB).
 */
import { describe, expect, it } from 'vitest'
import {
  CREDIT_WEIGHTS,
  PLAN_CATALOG,
  CREDIT_PACK,
  quoteCredits,
  resolveImageCreditAction,
  legacyActionToCredit,
} from '../api/lib/credits/catalog'
import {
  applyMonthlyGrant,
  bonusImagesToCredits,
  planFifoSpend,
  sortLotsForSpend,
  sumRemaining,
  type CreditLot,
} from '../api/lib/credits/fifo'

describe('credit catalog', () => {
  it('locks action weights', () => {
    expect(CREDIT_WEIGHTS.guion_oferta).toBe(3)
    expect(CREDIT_WEIGHTS.guion_edit).toBe(1)
    expect(CREDIT_WEIGHTS.image_standard).toBe(6)
    expect(CREDIT_WEIGHTS.image_pro).toBe(24)
    expect(CREDIT_WEIGHTS.image_edit).toBe(18)
    expect(CREDIT_WEIGHTS.image_enhance).toBe(18)
    expect(CREDIT_WEIGHTS.site_analysis_extra).toBe(3)
    expect(CREDIT_WEIGHTS.url_fetch).toBe(0)
    expect(CREDIT_WEIGHTS.chat_no_artifact).toBe(0)
  })

  it('quotes units for carousel slides', () => {
    expect(quoteCredits('carousel_slide_pro', 5)).toBe(120)
    expect(quoteCredits('carousel_slide_standard', 3)).toBe(18)
  })

  it('maps image models to Estándar vs Pro', () => {
    expect(resolveImageCreditAction({ action: 'generate', model: 'grok-imagine' })).toBe('image_standard')
    expect(resolveImageCreditAction({ action: 'generate', model: 'nano-banana-pro' })).toBe('image_pro')
    expect(resolveImageCreditAction({ action: 'enhance', model: 'grok-imagine' })).toBe('image_enhance')
    expect(resolveImageCreditAction({ action: 'carousel', model: 'nano-banana-pro' })).toBe('carousel_slide_pro')
  })

  it('maps legacy enhance to 18 not half-image', () => {
    expect(legacyActionToCredit({ action: 'enhance' })).toEqual({
      creditAction: 'image_enhance',
      units: 1,
    })
    expect(quoteCredits('image_enhance')).toBe(18)
  })

  it('defines public plans without unlimited', () => {
    expect(PLAN_CATALOG.starter.creditsPerMonth).toBe(750)
    expect(PLAN_CATALOG.pro.creditsPerMonth).toBe(1500)
    expect(PLAN_CATALOG.business.creditsPerMonth).toBe(4800)
    expect(PLAN_CATALOG.free.welcomeOnce).toBe(150)
    expect(CREDIT_PACK.credits).toBe(500)
    expect(CREDIT_PACK.priceUsd).toBe(25)
    // Existing links wired; new SKUs placeholder
    expect(PLAN_CATALOG.starter.paymentLink).toMatch(/^https:\/\/tp\.cr\//)
    expect(PLAN_CATALOG.pro.paymentLink).toMatch(/^https:\/\/tp\.cr\//)
    expect(PLAN_CATALOG.business.paymentLink).toBeNull()
    expect(CREDIT_PACK.paymentLink).toBeNull()
  })
})

describe('credit FIFO', () => {
  const now = 1_000_000

  function lot(partial: Partial<CreditLot> & Pick<CreditLot, 'id' | 'kind' | 'remaining'>): CreditLot {
    return {
      expiresAtMs: null,
      createdAtMs: now,
      ...partial,
    }
  }

  it('spends monthly before pack', () => {
    const lots = [
      lot({ id: 'p', kind: 'pack', remaining: 100, createdAtMs: now - 10 }),
      lot({ id: 'm', kind: 'monthly', remaining: 10, expiresAtMs: now + 1000 }),
    ]
    const res = planFifoSpend(lots, 15, now)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.deltas).toEqual([
      { lotId: 'm', delta: -10 },
      { lotId: 'p', delta: -5 },
    ])
  })

  it('skips expired lots', () => {
    const lots = [
      lot({ id: 'old', kind: 'monthly', remaining: 50, expiresAtMs: now - 1 }),
      lot({ id: 'pack', kind: 'pack', remaining: 20 }),
    ]
    expect(sumRemaining(lots, now)).toBe(20)
    const res = planFifoSpend(lots, 20, now)
    expect(res.ok).toBe(true)
  })

  it('fails closed when insufficient', () => {
    const lots = [lot({ id: 'm', kind: 'monthly', remaining: 2 })]
    const res = planFifoSpend(lots, 3, now)
    expect(res.ok).toBe(false)
  })

  it('caps monthly+rollover at 2× on grant', () => {
    const lots = [
      lot({ id: 'm1', kind: 'monthly', remaining: 700, expiresAtMs: now + 100 }),
    ]
    const next = applyMonthlyGrant({
      lots,
      allotment: 750,
      nowMs: now,
      periodEndMs: now + 50,
      nextPeriodEndMs: now + 2000,
      newMonthlyLotId: 'm2',
      newRolloverLotId: 'r1',
    })
    const pool = next
      .filter((l) => l.kind === 'monthly' || l.kind === 'rollover')
      .reduce((s, l) => s + l.remaining, 0)
    expect(pool).toBeLessThanOrEqual(1500)
    expect(next.some((l) => l.id === 'm2' && l.remaining === 750)).toBe(true)
  })

  it('converts bonus_images at 24 credits each', () => {
    expect(bonusImagesToCredits(100)).toBe(2400)
    expect(bonusImagesToCredits(0)).toBe(0)
  })

  it('sorts welcome before pack', () => {
    const ordered = sortLotsForSpend([
      lot({ id: 'pack', kind: 'pack', remaining: 1 }),
      lot({ id: 'wel', kind: 'welcome', remaining: 1 }),
    ], now)
    expect(ordered.map((l) => l.id)).toEqual(['wel', 'pack'])
  })
})
