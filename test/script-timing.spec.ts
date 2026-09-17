import { describe, expect, it } from 'vitest'
import { estimateSpokenSeconds, spokenTimingWarning } from '../api/lib/guiones/script-timing'
import type { GeneratedScript } from '../api/lib/guiones/types'

describe('A8 estimateSpokenSeconds', () => {
  it('maps 65 ES words to 25 s ± 1', () => {
    const words = Array.from({ length: 65 }, (_, i) => `palabra${i + 1}`).join(' ')
    expect(estimateSpokenSeconds(words, 'es')).toBeGreaterThanOrEqual(24)
    expect(estimateSpokenSeconds(words, 'es')).toBeLessThanOrEqual(26)
    expect(estimateSpokenSeconds(words, 'es')).toBe(25)
  })

  it('returns 0 for empty text', () => {
    expect(estimateSpokenSeconds('', 'es')).toBe(0)
    expect(estimateSpokenSeconds('   ', 'en')).toBe(0)
  })

  it('warns sales scripts over 40 spoken seconds without failing', () => {
    const script: GeneratedScript = {
      index: 1,
      title: 'Long',
      scriptType: 'venta_directa',
      hookMechanism: 'direct_offer',
      buyerStage: 'hot',
      spokenScript: { hook: 'a', development: 'b', ctaOrClose: 'c' },
      qualityScore: 8,
      timing: { hookSeconds: 10, developmentSeconds: 30, ctaSeconds: 5, totalSeconds: 45 },
    }
    expect(spokenTimingWarning(script)).toBe('spoken_over_40s:45')
  })
})
