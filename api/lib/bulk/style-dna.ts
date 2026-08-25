import type { StyleDna, StyleDnaKind } from './types.js'

const KIND: StyleDnaKind[] = ['organic', 'ads']

function asKind(value: unknown): StyleDnaKind {
  return value === 'organic' ? 'organic' : 'ads'
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 12)
}

export function normalizeStyleDna(raw: unknown, index = 0): StyleDna | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (!name) return null
  const id = typeof row.id === 'string' && row.id.trim()
    ? row.id.trim()
    : `dna_${index + 1}`
  return {
    id,
    name,
    kind: asKind(row.kind),
    referenceUrls: asStringArray(row.referenceUrls ?? row.reference_urls),
    notes: typeof row.notes === 'string' ? row.notes.trim().slice(0, 2000) : '',
  }
}

export function parseStyleDnas(raw: unknown): StyleDna[] {
  if (!Array.isArray(raw)) return []
  const out: StyleDna[] = []
  const seen = new Set<string>()
  raw.forEach((item, index) => {
    const dna = normalizeStyleDna(item, index)
    if (!dna || seen.has(dna.id)) return
    seen.add(dna.id)
    out.push(dna)
  })
  return out
}

export function upsertStyleDnaList(existing: StyleDna[], incoming: StyleDna): StyleDna[] {
  const next = existing.filter((dna) => dna.id !== incoming.id)
  next.push(incoming)
  return next
}

export function findStyleDna(list: StyleDna[], id?: string | null): StyleDna | null {
  if (!id) return null
  return list.find((dna) => dna.id === id) || null
}

export function isStyleDnaKind(value: unknown): value is StyleDnaKind {
  return typeof value === 'string' && KIND.includes(value as StyleDnaKind)
}
