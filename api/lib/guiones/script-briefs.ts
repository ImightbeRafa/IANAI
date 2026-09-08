import type { AngleCandidate, CTAStrength, Language, SalesChannel, ScriptBrief, ScriptFramework, ScriptSettings } from './types.js'
import { expandCtaMixSlots } from './cta-mix.js'
import { getRequestedScriptTypes } from './utils.js'

function ctaDirection(strength: CTAStrength, channel: SalesChannel | undefined, language: Language): string {
  const isEs = language === 'es'
  if (strength === 'none') {
    return isEs
      ? 'Cerrá con una idea, payoff o línea memorable. Sin CTA.'
      : 'Close with a thought, payoff, or memorable line. No CTA.'
  }
  if (strength === 'soft') {
    return isEs
      ? 'Usá un CTA suave: guardar, compartir, seguir, comentar o etiquetar.'
      : 'Use one soft CTA: save, share, follow, comment, or tag.'
  }
  if (strength === 'brand_mention') {
    return isEs
      ? 'Mencioná la marca en una línea sin pedir la venta.'
      : 'Mention the brand subtly in one line without asking for a sale.'
  }
  if (channel === 'physical') {
    return isEs
      ? 'Llevá a visitar el local con una instrucción directa y simple.'
      : 'Drive to visit the physical location with a simple direct instruction.'
  }
  if (channel === 'website') {
    return isEs
      ? 'Llevá a hacer clic en el anuncio, web o link para ordenar.'
      : 'Drive to click the ad, website, or link to order.'
  }
  if (channel === 'messages') {
    return isEs
      ? 'Llevá a mandar mensaje/DM con un siguiente paso concreto.'
      : 'Drive to send a message/DM with a concrete next step.'
  }
  return isEs
    ? 'Usá un CTA de venta directo que coincida con el canal de compra disponible.'
    : 'Use one direct sales CTA that matches the available purchase channel.'
}

function developmentBeats(
  candidate: AngleCandidate,
  language: Language
): string[] {
  const isEs = language === 'es'
  const proof = candidate.proofToUse.filter((f) => !f.includes('[')).join(' | ')
  const logistics = candidate.logisticsToUse.filter((f) => !f.includes('[')).join(' | ')
  if (isEs) {
    return [
      `Resolvé la duda: ${candidate.coreDoubt}`,
      `Usá prueba: ${proof || 'solo hechos comprobados de la oferta'}`,
      `Usá logística: ${logistics || 'solo logística comprobada'}`,
    ]
  }
  return [
    `Resolve doubt: ${candidate.coreDoubt}`,
    `Use proof: ${proof || 'only proven offer facts'}`,
    `Use logistics: ${logistics || 'only proven logistics'}`,
  ]
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
  activeSalesChannel?: SalesChannel,
  language: Language = 'es'
): ScriptBrief[] {
  const requestedTypes = getRequestedScriptTypes(settings)
  const ctaSlots = expandCtaMixSlots(settings?.ctaMix, requestedTypes.length, {
    channel: activeSalesChannel,
    strength: ctaStrength,
  })
  const selected: ScriptBrief[] = []
  const usedCombos = new Set<string>()
  const usedIds = new Set<string>()
  const isEs = language === 'es'

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
        audienceSegment: isEs ? 'audiencia principal' : 'primary audience',
        coreDoubt: isEs ? 'por qué vale la pena comprar esto' : 'why this is worth buying',
        proofToUse: [],
        logisticsToUse: [],
        hookDraft: '',
        whyItCouldWin: isEs ? 'brief de respaldo' : 'fallback brief',
        score: 5,
      }
    }

    usedIds.add(chosen.id)
    usedCombos.add(`${chosen.hookMechanism}:${chosen.buyerStage}`)
    const slot = ctaSlots[selected.length] || { channel: activeSalesChannel, strength: ctaStrength }
    selected.push({
      index: selected.length + 1,
      scriptType: scriptType as ScriptFramework,
      productType,
      angleId: chosen.id,
      hookMechanism: chosen.hookMechanism,
      buyerStage: chosen.buyerStage,
      openingPromise: chosen.hookDraft || chosen.coreDoubt,
      developmentBeats: developmentBeats(chosen, language),
      mustIncludeFacts: defaultFacts(chosen),
      mustAvoid: isEs
        ? [
            'relleno genérico: alta calidad, mejor opción, rápido y fácil, solución ideal',
            'precios, claims, cantidades, casos, ubicaciones, platos o garantías inventados',
            'mismo hookMechanism que otro guion del lote',
            'placeholders entre corchetes como [PRECIO EXACTO] o [DIFERENCIADOR TANGIBLE]',
            'enums internos como copy: economico, medio, premium, opción económica, cold/warm/hot',
          ]
        : [
            'generic filler: alta calidad, mejor opcion, rapido y facil, solucion ideal',
            'invented prices, claims, quantities, cases, locations, dishes, guarantees',
            'same hook mechanism as another script in this batch',
            'unresolved bracket placeholders like [PRECIO EXACTO] or [DIFERENCIADOR TANGIBLE]',
            'internal enums as sales copy: economico, medio, premium, opción económica',
          ],
      cta: {
        strength: slot.strength,
        channel: slot.channel,
        textDirection: ctaDirection(slot.strength, slot.channel, language),
      },
      coreDoubt: chosen.coreDoubt,
      proofToUse: chosen.proofToUse,
    })
  }

  return selected
}
