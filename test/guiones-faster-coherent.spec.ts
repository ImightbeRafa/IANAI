import { describe, expect, it } from 'vitest'
import { compactProfileForAngles } from '../api/lib/guiones/script-angle-inventory'
import { selectScriptBriefs } from '../api/lib/guiones/script-briefs'
import { buildScriptContextProfile } from '../api/lib/guiones/script-context-profile'
import { compactBriefForDraft, compactProfileForDraft, draftPromptCharEstimate } from '../api/lib/guiones/script-output'
import { getCategoryLens } from '../api/lib/guiones/script-prompts/category-lenses'
import { getTypeLens } from '../api/lib/guiones/script-prompts/type-lenses'
import { repairFailedScripts } from '../api/lib/guiones/script-quality'
import type { AngleCandidate, GeneratedScript, ScriptBrief, ScriptSettings } from '../api/lib/guiones/types'
import {
  ANGLE_MAX_TOKENS,
  angleInventoryNeeded,
  compactJson,
  draftMaxTokens,
} from '../api/lib/guiones/utils'
import { CREDIT_WEIGHTS } from '../api/lib/credits/catalog'
import { GROK_TEXT_MODEL_EFFICIENT } from '../api/lib/grok-models'

const settings: ScriptSettings = {
  framework: 'venta_directa',
  variations: 1,
  generationMode: 'mixed',
}

function sampleProfile() {
  return buildScriptContextProfile({
    businessContext: {
      name: 'Botella CR',
      sales_channels: ['messages'],
      does_shipping: true,
      shipping_method: 'envío 48h en GAM',
    },
    productContext: {
      name: 'Smart Bottle Pro',
      type: 'product',
      product_category: 'botella térmica',
      product_description: 'Mantiene el agua fría 24 horas',
      technical_specs: 'acero de doble pared',
      exact_price: '₡9.900',
      current_alternatives: 'botellas de plástico',
      alternatives_disadvantages: 'se calientan rápido',
      differentiation: 'tapa hermética + acero',
    },
    activeSalesChannel: 'messages',
    ctaStrength: 'sales',
  })
}

describe('guiones latency helpers', () => {
  it('requests 3 angle candidates for n=1 (not the old floor of 8)', () => {
    expect(angleInventoryNeeded(settings)).toBe(3)
    expect(angleInventoryNeeded({ ...settings, variations: 3 })).toBe(6)
    expect(angleInventoryNeeded({ ...settings, variations: 10 })).toBe(12)
    expect(ANGLE_MAX_TOKENS).toBe(1600)
    expect(draftMaxTokens(1)).toBe(1300)
    expect(draftMaxTokens(3)).toBe(3100)
    expect(GROK_TEXT_MODEL_EFFICIENT).toBe('grok-4.5')
  })

  it('compacts profile JSON without pretty-indent whitespace', () => {
    const profile = sampleProfile()
    const compact = compactJson(compactProfileForAngles(profile))
    const prettyLegacy = JSON.stringify(profile, null, 2)
    expect(compact.includes('\n  "')).toBe(false)
    expect(compact.length).toBeLessThan(prettyLegacy.length)
    expect(prettyLegacy.length - compact.length).toBeGreaterThan(200)
  })

  it('draft prompt estimate stays under legacy pretty+dual-lens baseline', () => {
    const profile = sampleProfile()
    const candidate: AngleCandidate = {
      id: 'a1',
      scriptType: 'venta_directa',
      hookMechanism: 'price_location',
      buyerStage: 'hot',
      audienceSegment: 'GAM',
      coreDoubt: 'si vale los ₡9.900',
      proofToUse: ['acero de doble pared', '₡9.900'],
      logisticsToUse: ['envío 48h en GAM'],
      hookDraft: '₡9.900 y llega en 48h',
      whyItCouldWin: 'precio + logística concreta',
      score: 9,
    }
    const briefs = selectScriptBriefs([candidate], settings, 'product', 'sales', 'messages', 'es')
    const estimate = draftPromptCharEstimate({
      briefs,
      profile,
      language: 'es',
      categoryLens: getCategoryLens('product', 'es'),
      ctaStrength: 'sales',
    })
    const legacyPretty = JSON.stringify(profile, null, 2).length
      + JSON.stringify(briefs, null, 2).length
      + getCategoryLens('product', 'es').length
      + getTypeLens('venta_directa', 'sales', 'es').length
      + getTypeLens('desvalidar_alternativas', 'sales', 'es').length
      + getTypeLens('mostrar_servicio', 'sales', 'es').length
    expect(estimate.userChars).toBeLessThan(legacyPretty)
    expect(compactBriefForDraft(briefs[0]).developmentBeats?.[0]).toMatch(/^Resolvé la duda:/)
    expect(compactJson(compactProfileForDraft(profile)).includes('\n  "')).toBe(false)
  })
})

describe('guiones Spanish coherence', () => {
  it('writes ES brief beats and CTA in Spanish voseo', () => {
    const briefs = selectScriptBriefs([
      {
        id: 'a',
        scriptType: 'venta_directa',
        hookMechanism: 'direct_offer',
        buyerStage: 'hot',
        audienceSegment: 'compradores',
        coreDoubt: 'si conviene pedir por DM',
        proofToUse: ['₡9.900'],
        logisticsToUse: ['DM'],
        hookDraft: 'Pedila hoy por DM',
        whyItCouldWin: 'canal claro',
        score: 8,
      },
    ], settings, 'product', 'sales', 'messages', 'es')

    expect(briefs[0].developmentBeats[0]).toBe('Resolvé la duda: si conviene pedir por DM')
    expect(briefs[0].cta.textDirection).toBe('Llevá a mandar mensaje/DM con un siguiente paso concreto.')
  })

  it('category and type ES lenses forbid bracket placeholders', () => {
    const category = getCategoryLens('product', 'es')
    const type = getTypeLens('desvalidar_alternativas', 'sales', 'es')
    const venta = getTypeLens('venta_directa', 'sales', 'es')
    expect(category.toLowerCase()).not.toContain('placeholders')
    expect(type.toLowerCase()).not.toContain('placeholders')
    expect(category).toMatch(/omit/i)
    expect(venta).toContain('elegí')
    expect(venta).toContain('escribí')
  })

  it('repair scrub removes English scaffold leaks and never adds brackets', () => {
    const brief: ScriptBrief = {
      index: 1,
      scriptType: 'venta_directa',
      productType: 'product',
      angleId: 'a',
      hookMechanism: 'direct_offer',
      buyerStage: 'hot',
      openingPromise: 'offer',
      developmentBeats: [],
      mustIncludeFacts: ['acero de doble pared'],
      mustAvoid: [],
      cta: { strength: 'sales', channel: 'messages', textDirection: 'DM' },
      coreDoubt: 'trust',
      proofToUse: ['acero'],
    }
    const scripts: GeneratedScript[] = [{
      index: 1,
      title: 'Leak',
      scriptType: 'venta_directa',
      hookMechanism: 'direct_offer',
      buyerStage: 'hot',
      spokenScript: {
        hook: 'Resolve doubt: ¿vale la pena?',
        development: 'Use proof: queda corto.',
        ctaOrClose: 'Drive to send a message/DM with a concrete next step.',
      },
      qualityScore: 0,
    }]
    const reports = [{
      index: 1,
      passed: false,
      specificity: 3,
      hookStrength: 3,
      detailDensity: 3,
      categoryFit: 3,
      ctaFit: 3,
      repetitionRisk: 10,
      inventedClaimRisk: 9,
      genericPhrases: [],
      repairInstruction: 'fix',
    }]
    const [fixed] = repairFailedScripts(scripts, reports, [brief])
    expect(fixed.spokenScript.hook).toBe('¿vale la pena?')
    expect(fixed.spokenScript.development).toContain('queda corto')
    expect(fixed.spokenScript.development).toContain('acero de doble pared')
    expect(fixed.spokenScript.development.includes('[')).toBe(false)
    expect(fixed.spokenScript.ctaOrClose).toBe('')
  })
})

describe('guiones quote/charge unchanged', () => {
  it('keeps guion_oferta at 3 credits', () => {
    expect(CREDIT_WEIGHTS.guion_oferta).toBe(3)
  })
})
