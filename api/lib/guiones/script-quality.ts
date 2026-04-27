import type { GeneratedScript, ScriptBrief, ScriptQualityReport } from './types.js'

const GENERIC_PHRASES = [
  'alta calidad',
  'mejor opcion',
  'mejor opción',
  'rapido y facil',
  'rápido y fácil',
  'solucion ideal',
  'solución ideal',
  'servicio personalizado',
  'high quality',
  'best option',
  'fast and easy',
  'ideal solution',
  'personalized service',
]

function countDetails(text: string): number {
  const placeholders = (text.match(/\[[^\]]+\]|___|\([^)]+\)/g) || []).length
  const numbers = (text.match(/\b\d+[\w%.$¢]*\b/g) || []).length
  const separators = (text.match(/,|;|\n/g) || []).length
  const concreteWords = (text.match(/\b(env[ií]o|garant[ií]a|material|modelo|talla|precio|ubicaci[oó]n|horario|paso|m[eé]todo|habitaciones|ba[nñ]os|gramos|menu|men[uú]|delivery|warranty|material|size|price|location|schedule|step|method|bedrooms|bathrooms)\b/gi) || []).length
  return placeholders + numbers + Math.min(separators, 3) + concreteWords
}

function scoreFromCount(count: number, max = 10): number {
  return Math.max(1, Math.min(max, Math.round((count / 4) * 10)))
}

export function evaluateScriptBatch(scripts: GeneratedScript[], briefs: ScriptBrief[]): ScriptQualityReport[] {
  const comboCounts = new Map<string, number>()
  for (const script of scripts) {
    const combo = `${script.hookMechanism}:${script.buyerStage}`
    comboCounts.set(combo, (comboCounts.get(combo) || 0) + 1)
  }

  return scripts.map(script => {
    const fullText = `${script.spokenScript.hook}\n${script.spokenScript.development}\n${script.spokenScript.ctaOrClose}`
    const lower = fullText.toLowerCase()
    const genericPhrases = GENERIC_PHRASES.filter(phrase => lower.includes(phrase))
    const detailCount = countDetails(fullText)
    const brief = briefs.find(item => item.index === script.index)
    const combo = `${script.hookMechanism}:${script.buyerStage}`
    const repetition = (comboCounts.get(combo) || 0) > 1 ? 4 : 10
    const ctaFit = brief?.cta.strength === 'none' && /\b(compra|compr[aá]|mensaje|dm|click|agenda|ordena|buy|order|message)\b/i.test(script.spokenScript.ctaOrClose)
      ? 3
      : 9
    const specificity = scoreFromCount(detailCount)
    const hookStrength = script.spokenScript.hook.length > 20 && !/hola|bienvenid|hello|welcome/i.test(script.spokenScript.hook) ? 8 : 5
    const detailDensity = scoreFromCount(detailCount)
    const categoryFit = fullText.includes('[') || detailCount >= 4 ? 8 : 5
    const inventedClaimRisk = /\bgarantizado|garantizada|100%|numero uno|#1|the best\b/i.test(fullText) && !fullText.includes('[') ? 5 : 9
    const average = (specificity + hookStrength + detailDensity + categoryFit + ctaFit + repetition + inventedClaimRisk) / 7
    const repairInstruction = average < 7.5
      ? 'Rewrite with more concrete context, remove generic phrases, preserve the locked brief, and use placeholders instead of invented claims.'
      : undefined

    return {
      index: script.index,
      passed: average >= 7.5 && genericPhrases.length === 0,
      specificity,
      hookStrength,
      detailDensity,
      categoryFit,
      ctaFit,
      repetitionRisk: repetition,
      inventedClaimRisk,
      genericPhrases,
      repairInstruction,
    }
  })
}

export function applyQualityScores(scripts: GeneratedScript[], reports: ScriptQualityReport[]): GeneratedScript[] {
  return scripts.map(script => {
    const report = reports.find(item => item.index === script.index)
    if (!report) return script
    const qualityScore = Math.round((
      report.specificity +
      report.hookStrength +
      report.detailDensity +
      report.categoryFit +
      report.ctaFit +
      report.repetitionRisk +
      report.inventedClaimRisk
    ) / 7 * 10) / 10
    return { ...script, qualityScore }
  })
}

export function repairFailedScripts(scripts: GeneratedScript[], reports: ScriptQualityReport[], briefs: ScriptBrief[]): GeneratedScript[] {
  return scripts.map(script => {
    const report = reports.find(item => item.index === script.index)
    if (!report || report.passed) return script
    const brief = briefs.find(item => item.index === script.index)
    if (!brief) return script
    const missingFacts = brief.mustIncludeFacts
      .filter(fact => !`${script.spokenScript.hook} ${script.spokenScript.development} ${script.spokenScript.ctaOrClose}`.includes(fact))
      .slice(0, 3)
    const developmentSuffix = missingFacts.length > 0
      ? ` ${missingFacts.join('. ')}.`
      : ' [AGREGA UN DATO CONCRETO], [PRUEBA] y [LOGISTICA].'
    return {
      ...script,
      spokenScript: {
        ...script.spokenScript,
        development: `${script.spokenScript.development}${developmentSuffix}`,
      },
    }
  })
}
