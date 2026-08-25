import type { AngleCandidate, CTAStrength, SalesChannel, ScriptBrief, ScriptFramework, ScriptSettings } from './types.js'
import { getRequestedScriptTypes } from './utils.js'

function ctaDirection(strength: CTAStrength, channel?: SalesChannel): string {
  if (strength === 'none') return 'Close with a thought, payoff, or memorable line. No CTA.'
  if (strength === 'soft') return 'Use one soft CTA: save, share, follow, comment, or tag.'
  if (strength === 'brand_mention') return 'Mention the brand subtly in one line without asking for a sale.'
  if (channel === 'physical') return 'Drive to visit the physical location with a simple direct instruction.'
  if (channel === 'website') return 'Drive to click the ad, website, or link to order.'
  if (channel === 'messages') return 'Drive to send a message/DM with a concrete next step.'
  return 'Use one direct sales CTA that matches the available purchase channel.'
}

function defaultFacts(candidate: AngleCandidate): string[] {
  const facts = [...candidate.proofToUse, ...candidate.logisticsToUse]
    .filter(Boolean)
    .filter((fact) => !fact.includes('['))
  return facts.slice(0, 5)
}

export function selectScriptBriefs(
  inventory: AngleCandidate[],
  settings: ScriptSettings | undefined,
  productType: ScriptBrief['productType'],
  ctaStrength: CTAStrength,
  activeSalesChannel?: SalesChannel
): ScriptBrief[] {
  const requestedTypes = getRequestedScriptTypes(settings)
  const selected: ScriptBrief[] = []
  const usedCombos = new Set<string>()
  const usedIds = new Set<string>()

  for (const scriptType of requestedTypes) {
    const candidates = inventory
      .filter(candidate => candidate.scriptType === scriptType && !usedIds.has(candidate.id))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
    const fallback = inventory
      .filter(candidate => !usedIds.has(candidate.id))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
    const pool = candidates.length > 0 ? candidates : fallback
    let chosen = pool.find(candidate => !usedCombos.has(`${candidate.hookMechanism}:${candidate.buyerStage}`))
    if (!chosen) chosen = pool[0]
    if (!chosen) {
      chosen = {
        id: `fallback_${selected.length + 1}`,
        scriptType,
        hookMechanism: `fallback_${selected.length + 1}`,
        buyerStage: selected.length % 3 === 0 ? 'cold' : selected.length % 3 === 1 ? 'warm' : 'hot',
        audienceSegment: 'primary audience',
        coreDoubt: 'why this is worth buying',
        proofToUse: [],
        logisticsToUse: [],
        hookDraft: '',
        whyItCouldWin: 'fallback brief',
        score: 5,
      }
    }

    usedIds.add(chosen.id)
    usedCombos.add(`${chosen.hookMechanism}:${chosen.buyerStage}`)
    selected.push({
      index: selected.length + 1,
      scriptType: scriptType as ScriptFramework,
      productType,
      angleId: chosen.id,
      hookMechanism: chosen.hookMechanism,
      buyerStage: chosen.buyerStage,
      openingPromise: chosen.hookDraft || chosen.coreDoubt,
      developmentBeats: [
        `Resolve doubt: ${chosen.coreDoubt}`,
        `Use proof: ${chosen.proofToUse.filter((f) => !f.includes('[')).join(' | ') || 'only proven offer facts'}`,
        `Use logistics: ${chosen.logisticsToUse.filter((f) => !f.includes('[')).join(' | ') || 'only proven logistics'}`,
      ],
      mustIncludeFacts: defaultFacts(chosen),
      mustAvoid: [
        'generic filler: alta calidad, mejor opcion, rapido y facil, solucion ideal',
        'invented prices, claims, quantities, cases, locations, dishes, guarantees',
        'same hook mechanism as another script in this batch',
        'unresolved bracket placeholders like [PRECIO EXACTO] or [DIFERENCIADOR TANGIBLE]',
        'internal enums as sales copy: economico, medio, premium, opción económica',
      ],
      cta: {
        strength: ctaStrength,
        channel: activeSalesChannel,
        textDirection: ctaDirection(ctaStrength, activeSalesChannel),
      },
      coreDoubt: chosen.coreDoubt,
      proofToUse: chosen.proofToUse,
    })
  }

  return selected
}

