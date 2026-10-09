/**
 * Deterministic blocklist of generic ad clichés (ES/EN). Enforced by check-copy as a
 * repairable issue (`cliche`), stated in the copy prompt, and kept out of planned angle
 * messages and guide_bulk_angles hooks. Matching runs on accent-stripped lower case.
 */
import { normalizeText } from './util.js'

export interface ClichePattern {
  id: string
  /** Shown to the model / in issues. */
  example: string
  re: RegExp
}

// Sentence start = string start or after . ! ? ¡ ¿ : (normalized text keeps punctuation).
const START = '(?:^|[.!?¡¿:;"“]\\s*)'

export const CLICHE_PATTERNS: ClichePattern[] = [
  { id: 'pocos_saben', example: 'Lo que pocos saben', re: /\blo que (muy )?pocos saben\b/ },
  { id: 'nadie_dice', example: 'Lo que nadie te dice', re: /\blo que nadie te (dice|cuenta|conto|dijo)\b/ },
  { id: 'entra_rutina', example: 'Cómo entra en la rutina', re: /\bcomo (entra|encaja|se integra) en (la|tu|su) rutina\b/ },
  { id: 'descubri', example: 'Descubrí…', re: new RegExp(`${START}descubr(i|e|a|an|ilo|elo|ela|ila)\\b`) },
  { id: 'sabias_que', example: '¿Sabías que…?', re: /\bsabias que\b/ },
  { id: 'secreto', example: 'El secreto de/para…', re: /\b(el|tu|nuestro) secreto (de|para|mejor guardado)\b/ },
  { id: 'cambia_vida', example: 'Cambiará tu vida', re: /\bcambia(ra|r|ra por completo)? tu vida\b/ },
  { id: 'no_vas_a_creer', example: 'No vas a creer…', re: /\bno (vas a|lo vas a|podras) creer\b/ },
  { id: 'sorprendera', example: 'Te sorprenderá', re: /\bte (va a )?sorprender(a|as)?\b/ },
  { id: 'siguiente_nivel', example: 'Al siguiente nivel', re: /\b(al|a otro|al proximo) (siguiente )?nivel\b/ },
  { id: 'nunca_antes', example: 'Como nunca antes', re: /\bcomo nunca antes\b|\bnunca antes vist[oa]\b/ },
  { id: 'calidad_nota', example: 'Calidad que se nota', re: /\bcalidad que se nota\b/ },
  { id: 'aliado_ideal', example: 'Tu aliado ideal', re: /\btu (aliado|companero|complemento) (ideal|perfecto)\b/ },
  { id: 'rutina_ideal', example: 'Tu rutina ideal', re: /\btu rutina (ideal|perfecta)\b/ },
  { id: 'mejor_decision', example: 'La mejor decisión', re: /\bla mejor decision (que|de tu)\b/ },
  { id: 'few_know', example: 'What few people know', re: /\bwhat (few|most) people (don'?t )?know\b/ },
  { id: 'nobody_tells', example: 'What nobody tells you', re: /\bwhat nobody tells you\b/ },
  { id: 'did_you_know', example: 'Did you know…', re: /\bdid you know\b/ },
  { id: 'discover', example: 'Discover…', re: new RegExp(`${START}discover\\b`) },
  { id: 'game_changer', example: 'Game changer', re: /\bgame[- ]?changer\b/ },
  { id: 'secret_to', example: 'The secret to…', re: /\bthe secret (to|of|behind)\b/ },
  { id: 'wont_believe', example: "You won't believe", re: /\byou (won'?t|will not) believe\b/ },
  { id: 'next_level', example: 'Take it to the next level', re: /\bnext level\b/ },
  { id: 'life_changing', example: 'Life-changing', re: /\blife[- ]chang(ing|er)\b/ },
  { id: 'fits_routine', example: 'How it fits your routine', re: /\bhow it fits (into )?(the|your) routine\b/ },
]

/** Cliché examples (for prompts). */
export function clicheExamples(): string[] {
  return CLICHE_PATTERNS.map((p) => p.example)
}

/** Matched cliché ids + the matched text, in pattern order. */
export function findCliches(text: string | undefined | null): Array<{ id: string; match: string; example: string }> {
  const n = normalizeText(text ?? '')
  if (!n) return []
  const out: Array<{ id: string; match: string; example: string }> = []
  for (const p of CLICHE_PATTERNS) {
    const m = p.re.exec(n)
    if (m) out.push({ id: p.id, match: m[0].replace(/^[.!?¡¿:;"“\s]+/, ''), example: p.example })
  }
  return out
}

export function hasCliche(text: string | undefined | null): boolean {
  return findCliches(text).length > 0
}
