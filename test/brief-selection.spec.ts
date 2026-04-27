import { describe, expect, it } from 'vitest'
import { selectScriptBriefs } from '../api/lib/guiones/script-briefs'
import type { AngleCandidate, ScriptSettings } from '../api/lib/guiones/types'

const settings: ScriptSettings = {
  framework: 'venta_directa',
  variations: 3,
  generationMode: 'by_type',
  scriptTypeConfig: {
    venta_directa: 1,
    desvalidar_alternativas: 2,
    mostrar_servicio: 0,
    variedad_productos: 0,
    paso_a_paso: 0,
    reconocimiento: 0,
    educativo: 0,
    storytelling: 0,
    tendencia: 0,
    engagement: 0,
  },
}

function candidate(id: string, scriptType: AngleCandidate['scriptType'], hookMechanism: string, buyerStage: AngleCandidate['buyerStage']): AngleCandidate {
  return {
    id,
    scriptType,
    hookMechanism,
    buyerStage,
    audienceSegment: 'buyers',
    coreDoubt: `${hookMechanism} doubt`,
    proofToUse: [`${hookMechanism} proof`],
    logisticsToUse: ['DM'],
    hookDraft: `${hookMechanism} hook`,
    whyItCouldWin: 'distinct',
    score: 8,
  }
}

describe('selectScriptBriefs', () => {
  it('honors counts and avoids duplicate hook/stage combos', () => {
    const briefs = selectScriptBriefs([
      candidate('a', 'venta_directa', 'direct_offer', 'hot'),
      candidate('b', 'desvalidar_alternativas', 'hidden_cost', 'warm'),
      candidate('c', 'desvalidar_alternativas', 'checklist', 'cold'),
    ], settings, 'product', 'sales', 'messages')

    expect(briefs).toHaveLength(3)
    expect(briefs.map(b => b.scriptType)).toEqual(['venta_directa', 'desvalidar_alternativas', 'desvalidar_alternativas'])
    expect(new Set(briefs.map(b => `${b.hookMechanism}:${b.buyerStage}`)).size).toBe(3)
  })
})

