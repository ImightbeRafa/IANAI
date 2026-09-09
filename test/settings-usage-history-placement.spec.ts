import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Plan y facturación Uso history placement', () => {
  it('renders UsageHistoryCard at the bottom of the billing section', () => {
    const source = readFileSync(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8')
    const billingStart = source.indexOf("{show('billing') && (")
    const billingEnd = source.indexOf("{show('general') && (", billingStart)
    expect(billingStart).toBeGreaterThan(-1)
    expect(billingEnd).toBeGreaterThan(billingStart)
    const billing = source.slice(billingStart, billingEnd)
    const historyIdx = billing.lastIndexOf('<UsageHistoryCard')
    const plansIdx = billing.indexOf('PUBLIC_BILLING_PLANS')
    const paymentsIdx = billing.indexOf('Historial de Pagos')
    expect(historyIdx).toBeGreaterThan(-1)
    expect(plansIdx).toBeGreaterThan(-1)
    expect(historyIdx).toBeGreaterThan(plansIdx)
    expect(historyIdx).toBeGreaterThan(paymentsIdx)
    // Mid-section meters must not still host the history card.
    const metersBlock = billing.slice(0, plansIdx)
    expect(metersBlock).not.toContain('<UsageHistoryCard')
  })
})
