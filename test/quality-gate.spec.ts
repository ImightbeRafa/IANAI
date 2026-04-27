import { describe, expect, it } from 'vitest'
import { evaluateScriptBatch } from '../api/lib/guiones/script-quality'
import type { GeneratedScript, ScriptBrief } from '../api/lib/guiones/types'

const brief: ScriptBrief = {
  index: 1,
  scriptType: 'venta_directa',
  productType: 'product',
  angleId: 'a',
  hookMechanism: 'direct_offer',
  buyerStage: 'hot',
  openingPromise: 'offer',
  developmentBeats: [],
  mustIncludeFacts: ['steel', '48h', 'guarantee', 'DM'],
  mustAvoid: [],
  cta: { strength: 'sales', channel: 'messages', textDirection: 'DM' },
  coreDoubt: 'trust',
  proofToUse: ['steel'],
}

describe('evaluateScriptBatch', () => {
  it('flags generic scripts', () => {
    const scripts: GeneratedScript[] = [{
      index: 1,
      title: 'Generic',
      scriptType: 'venta_directa',
      hookMechanism: 'direct_offer',
      buyerStage: 'hot',
      spokenScript: {
        hook: 'La mejor opcion para vos',
        development: 'Alta calidad, rapido y facil.',
        ctaOrClose: 'Mandanos mensaje.',
      },
      qualityScore: 0,
    }]

    const [report] = evaluateScriptBatch(scripts, [brief])
    expect(report.passed).toBe(false)
    expect(report.genericPhrases.length).toBeGreaterThan(0)
  })
})

