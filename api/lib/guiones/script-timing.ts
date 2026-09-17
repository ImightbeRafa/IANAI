import type { GeneratedScript, Language, ScriptFramework } from './types.js'

/** Spoken rate used for deterministic `~N s` chips (not model-guessed). */
export const SPOKEN_WORDS_PER_SECOND_ES = 2.6
export const SPOKEN_WORDS_PER_SECOND_EN = 2.8

const SALES_TYPES: ScriptFramework[] = [
  'venta_directa',
  'desvalidar_alternativas',
  'mostrar_servicio',
  'variedad_productos',
  'paso_a_paso',
]

export function countSpokenWords(text: string): number {
  const trimmed = (text || '').trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).filter(Boolean).length
}

/** Whole-second spoken duration. Empty → 0. */
export function estimateSpokenSeconds(text: string, language: Language = 'es'): number {
  const words = countSpokenWords(text)
  if (words <= 0) return 0
  const rate = language === 'en' ? SPOKEN_WORDS_PER_SECOND_EN : SPOKEN_WORDS_PER_SECOND_ES
  return Math.max(1, Math.round(words / rate))
}

export function attachSpokenTiming(script: GeneratedScript, language: Language): GeneratedScript {
  const hookSeconds = estimateSpokenSeconds(script.spokenScript.hook, language)
  const developmentSeconds = estimateSpokenSeconds(script.spokenScript.development, language)
  const ctaSeconds = estimateSpokenSeconds(script.spokenScript.ctaOrClose, language)
  return {
    ...script,
    timing: {
      hookSeconds,
      developmentSeconds,
      ctaSeconds,
      totalSeconds: hookSeconds + developmentSeconds + ctaSeconds,
    },
  }
}

export function isSalesScriptType(type: ScriptFramework): boolean {
  return SALES_TYPES.includes(type)
}

/** Warning-only: sales scripts over 40 s spoken. Does not fail the quality gate. */
export function spokenTimingWarning(script: GeneratedScript): string | undefined {
  const total = script.timing?.totalSeconds ?? 0
  if (!isSalesScriptType(script.scriptType) || total <= 40) return undefined
  return `spoken_over_40s:${total}`
}
