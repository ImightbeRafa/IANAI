import type { AIModel } from '../../types'

export const TEXT_MODEL_STORAGE_KEY = 'advance-ai:text-model'

export type TextModelProfile = Extract<AIModel, 'best' | 'efficient'>

function isTextModelProfile(value: string | null): value is TextModelProfile {
  return value === 'best' || value === 'efficient'
}

/** User-facing text model: Best (Grok 4.6) or Efficient (Grok 4.5). */
export function getTextModelPreference(): TextModelProfile {
  try {
    const raw = localStorage.getItem(TEXT_MODEL_STORAGE_KEY)
    if (isTextModelProfile(raw)) return raw
  } catch {
    /* storage unavailable */
  }
  return 'best'
}

export function setTextModelPreference(profile: TextModelProfile): void {
  try {
    localStorage.setItem(TEXT_MODEL_STORAGE_KEY, profile)
  } catch {
    /* storage unavailable */
  }
}
