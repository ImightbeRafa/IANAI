import { describe, expect, it } from 'vitest'
import { expandCtaMixSlots } from '../api/lib/guiones/cta-mix'
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
    expect(briefs.every((brief) => brief.cta.channel === 'messages')).toBe(true)
  })

  it('assigns mixed CTA channels per brief when ctaMix sums to the script total', () => {
    const mixed: ScriptSettings = {
      framework: 'venta_directa',
      variations: 5,
      generationMode: 'mixed',
      ctaStrength: 'sales',
      ctaMix: { website: 3, messages: 2, none: 0 },
    }
    const briefs = selectScriptBriefs(
      [0, 1, 2, 3, 4].map((i) => candidate(`m${i}`, 'venta_directa', `hook_${i}`, i % 3 === 0 ? 'cold' : i % 3 === 1 ? 'warm' : 'hot')),
      mixed,
      'product',
      'sales',
      'website'
    )
    expect(briefs.map((brief) => brief.cta.channel)).toEqual([
      'website', 'website', 'website', 'messages', 'messages',
    ])
  })

  it('uses none strength for Sin CTA slots in a mix', () => {
    const mixed: ScriptSettings = {
      framework: 'venta_directa',
      variations: 3,
      generationMode: 'mixed',
      ctaMix: { website: 1, messages: 1, none: 1 },
    }
    const briefs = selectScriptBriefs(
      [0, 1, 2].map((i) => candidate(`n${i}`, 'venta_directa', `hook_${i}`, 'warm')),
      mixed,
      'product',
      'sales',
      'website'
    )
    expect(briefs.map((brief) => brief.cta.strength)).toEqual(['sales', 'sales', 'none'])
    expect(briefs[2].cta.channel).toBeUndefined()
  })
})

describe('expandCtaMixSlots', () => {
  it('falls back to a single channel when mix does not sum to count', () => {
    const slots = expandCtaMixSlots(
      { website: 1, messages: 1, none: 0 },
      5,
      { channel: 'website', strength: 'sales' }
    )
    expect(slots).toHaveLength(5)
    expect(slots.every((slot) => slot.channel === 'website')).toBe(true)
  })
})
