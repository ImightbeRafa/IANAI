/**
 * Apply user confirmations / edits / additions / removals to a BrandDna.
 * Pure: returns a new object, recomputes gaps, resolves conflicts the user settled.
 */

import type { BrandDna, DnaFact, FactKey } from '../types.js'
import { computeGaps, isAltKey, MULTI_VALUE_KEYS, normalizeFactValue } from './merge.js'
import { KNOWN_FACT_KEYS } from './part.js'

export type FactEdit =
  /** Confirm existing fact(s) with this key (only the matching value when given). */
  | { op: 'confirm'; key: FactKey; value?: string }
  /** Set the value (replaces the key's facts for single-value keys); becomes a confirmed user fact. */
  | { op: 'edit'; key: FactKey; value: string; previousValue?: string }
  /** Add a confirmed user fact. */
  | { op: 'add'; key: FactKey; value: string; evidence?: string }
  /** Remove fact(s) with this key (only the matching value when given). */
  | { op: 'remove'; key: FactKey; value?: string }

function altBase(key: string): string | null {
  const match = key.match(/^custom:(.+)_alt_\d+$/)
  if (!match) return null
  const base = match[1]
  return KNOWN_FACT_KEYS.has(base) ? base : `custom:${base}`
}

function sameValue(fact: DnaFact, value: string | undefined): boolean {
  if (value === undefined) return true
  return normalizeFactValue(fact.key, fact.value) === normalizeFactValue(fact.key, value)
}

function isSingleValue(key: string): boolean {
  return !MULTI_VALUE_KEYS.has(key) && !key.startsWith('custom:')
}

/** Drop alternates + conflict notes for `key` once the user settled it. */
function settle(facts: DnaFact[], notes: string[], key: string): { facts: DnaFact[]; notes: string[] } {
  return {
    facts: facts.filter((fact) => !(isAltKey(fact.key) && altBase(fact.key) === key)),
    notes: notes.filter((note) => !note.startsWith(`conflict:${key}:`)),
  }
}

export function confirmFacts(dna: BrandDna, edits: FactEdit[]): BrandDna {
  let facts: DnaFact[] = dna.facts.map((fact) => ({ ...fact }))
  let notes = [...(dna.notes || [])]

  for (const edit of edits || []) {
    if (!edit || !edit.key) continue
    if (edit.op === 'confirm') {
      // Confirming an alternate promotes it to the base key.
      const base = altBase(edit.key)
      if (base) {
        const alt = facts.find((fact) => fact.key === edit.key && sameValue(fact, edit.value))
        if (!alt) continue
        facts = facts.filter((fact) => fact !== alt && !(fact.key === base && isSingleValue(base)))
        facts.push({ ...alt, key: base as FactKey, source: 'user', confirmed: true })
        ;({ facts, notes } = settle(facts, notes, base))
        continue
      }
      let matched = false
      facts = facts.map((fact) => {
        if (fact.key !== edit.key || !sameValue(fact, edit.value)) return fact
        matched = true
        return { ...fact, confirmed: true }
      })
      if (matched && isSingleValue(edit.key)) ({ facts, notes } = settle(facts, notes, edit.key))
    } else if (edit.op === 'edit') {
      const value = edit.value?.trim()
      if (!value) continue
      const single = isSingleValue(edit.key)
      const previous = edit.previousValue
      facts = facts.filter((fact) => {
        if (fact.key !== edit.key) return true
        if (single) return false
        // Multi-value keys: replace the targeted value (if any) and drop duplicates of the new one.
        return !(previous !== undefined && sameValue(fact, previous)) && !sameValue(fact, value)
      })
      facts.push({ key: edit.key, value, source: 'user', confirmed: true })
      if (single) ({ facts, notes } = settle(facts, notes, edit.key))
    } else if (edit.op === 'add') {
      const value = edit.value?.trim()
      if (!value) continue
      if (isSingleValue(edit.key)) {
        facts = facts.filter((fact) => fact.key !== edit.key)
        ;({ facts, notes } = settle(facts, notes, edit.key))
      } else {
        facts = facts.filter((fact) => !(fact.key === edit.key && sameValue(fact, value)))
      }
      facts.push({ key: edit.key, value, source: 'user', confirmed: true, ...(edit.evidence ? { evidence: edit.evidence } : {}) })
    } else if (edit.op === 'remove') {
      facts = facts.filter((fact) => !(fact.key === edit.key && sameValue(fact, edit.value)))
      if (!facts.some((fact) => fact.key === edit.key)) ({ facts, notes } = settle(facts, notes, edit.key))
    }
  }

  const brandName = facts.find((fact) => fact.key === 'brand_name')?.value || dna.brandName
  const next: BrandDna = { ...dna, brandName, facts }
  if (notes.length) next.notes = notes
  else delete next.notes
  next.gaps = computeGaps(next)
  return next
}
