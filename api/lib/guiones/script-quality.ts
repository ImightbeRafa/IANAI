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

const INTERNAL_ENUM_LEAKS = [
  'opción económica',
  'opcion economica',
  'economico',
  'price_range',
  'buyerstage',
]

function listPlaceholders(text: string): string[] {
  const matches = text.match(/\[[A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 _./-]{1,60}\]/g) || []
  return [...new Set(matches)]
}

function countDetails(text: string): number {
  // Placeholders are failures, not specificity points.
  const numbers = (text.match(/\b\d+[\w%.$¢₡]*\b/g) || []).length
  const separators = (text.match(/,|;|\n/g) || []).length
  const concreteWords = (text.match(/\b(env[ií]o|garant[ií]a|material|modelo|talla|precio|ubicaci[oó]n|horario|paso|m[eé]todo|habitaciones|ba[nñ]os|gramos|menu|men[uú]|delivery|warranty|material|size|price|location|schedule|step|method|bedrooms|bathrooms)\b/gi) || []).length
  return numbers + Math.min(separators, 3) + concreteWords
}

function scoreFromCount(count: number, max = 10): number {
  return Math.max(1, Math.min(max, Math.round((count / 4) * 10)))
}

function forbiddenHits(text: string, phrases: string[]): string[] {
  const lower = text.toLowerCase()
  return phrases.filter((phrase) => phrase && lower.includes(phrase.toLowerCase()))
}

export function evaluateScriptBatch(
  scripts: GeneratedScript[],
  briefs: ScriptBrief[],
  options?: { forbiddenPhrases?: string[] }
): ScriptQualityReport[] {
  const comboCounts = new Map<string, number>()
  for (const script of scripts) {
    const combo = `${script.hookMechanism}:${script.buyerStage}`
    comboCounts.set(combo, (comboCounts.get(combo) || 0) + 1)
  }
  const kitForbidden = options?.forbiddenPhrases || []

  return scripts.map(script => {
    const fullText = `${script.spokenScript.hook}\n${script.spokenScript.development}\n${script.spokenScript.ctaOrClose}`
    const lower = fullText.toLowerCase()
    const placeholders = listPlaceholders(fullText)
    const genericPhrases = GENERIC_PHRASES.filter(phrase => lower.includes(phrase))
    const enumLeaks = INTERNAL_ENUM_LEAKS.filter((phrase) => lower.includes(phrase))
    const forbiddenPhrases = [
      ...forbiddenHits(fullText, kitForbidden),
      ...enumLeaks,
    ]
    const detailCount = countDetails(fullText)
    const brief = briefs.find(item => item.index === script.index)
    const combo = `${script.hookMechanism}:${script.buyerStage}`
    const repetition = (comboCounts.get(combo) || 0) > 1 ? 4 : 10
    const ctaFit = brief?.cta.strength === 'none' && /\b(compra|compr[aá]|mensaje|dm|click|agenda|ordena|buy|order|message)\b/i.test(script.spokenScript.ctaOrClose)
      ? 3
      : 9
    const specificity = scoreFromCount(detailCount)
    const weakHook = /hola|bienvenid|hello|welcome|hoy te (quiero|voy)|today i want/i.test(script.spokenScript.hook)
    const hookStrength =
      script.spokenScript.hook.length > 28 && !weakHook
        ? 9
        : script.spokenScript.hook.length > 20 && !weakHook
          ? 7
          : 3
    const detailDensity = scoreFromCount(detailCount)
    const categoryFit = placeholders.length > 0 ? 2 : detailCount >= 4 ? 8 : 5
    const inventedClaimRisk = /\bgarantizado|garantizada|100%|numero uno|#1|the best\b/i.test(fullText)
      ? 5
      : 9
    const average = (specificity + hookStrength + detailDensity + categoryFit + ctaFit + repetition + inventedClaimRisk) / 7
    const hardFail =
      placeholders.length > 0 ||
      forbiddenPhrases.length > 0 ||
      genericPhrases.length > 0 ||
      hookStrength < 5
    const repairInstruction = hardFail || average < 7.5
      ? [
          'Rewrite with a sharp concrete hook (pain, clear desire, direct offer, or myth bust — not a greeting).',
          'Use only proven offer facts; never invent prices.',
          placeholders.length ? `Remove unresolved placeholders: ${placeholders.join(', ')}.` : '',
          forbiddenPhrases.length ? `Remove forbidden/internal phrases: ${forbiddenPhrases.join(', ')}.` : '',
          'Do not append new [PLACEHOLDER] tokens.',
        ].filter(Boolean).join(' ')
      : undefined

    return {
      index: script.index,
      passed: !hardFail && average >= 7.5,
      specificity,
      hookStrength,
      detailDensity,
      categoryFit,
      ctaFit,
      repetitionRisk: repetition,
      inventedClaimRisk,
      genericPhrases,
      unresolvedPlaceholders: placeholders,
      forbiddenPhrases,
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

/**
 * Soft repair: inject missing concrete facts from the brief when available.
 * Never append new bracket placeholders.
 */
export function repairFailedScripts(scripts: GeneratedScript[], reports: ScriptQualityReport[], briefs: ScriptBrief[]): GeneratedScript[] {
  return scripts.map(script => {
    const report = reports.find(item => item.index === script.index)
    if (!report || report.passed) return script
    const brief = briefs.find(item => item.index === script.index)
    if (!brief) return script
    const missingFacts = brief.mustIncludeFacts
      .filter((fact) => !fact.includes('['))
      .filter(fact => !`${script.spokenScript.hook} ${script.spokenScript.development} ${script.spokenScript.ctaOrClose}`.includes(fact))
      .slice(0, 3)
    if (missingFacts.length === 0) return script
    return {
      ...script,
      spokenScript: {
        ...script.spokenScript,
        development: `${script.spokenScript.development} ${missingFacts.join('. ')}.`,
      },
    }
  })
}
