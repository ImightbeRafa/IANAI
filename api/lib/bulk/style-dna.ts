import type { StyleDna, StyleDnaAnalysis, StyleDnaKind } from './types.js'

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
  const analysis = asAnalysis(row.analysis)
  return {
    id,
    name,
    kind: asKind(row.kind),
    referenceUrls: asStringArray(row.referenceUrls ?? row.reference_urls),
    notes: typeof row.notes === 'string' ? row.notes.trim().slice(0, 2000) : '',
    ...(analysis ? { analysis } : {}),
  }
}

const ANALYSIS_ENUMS: Record<string, readonly string[]> = {
  layoutPattern: ['pill_overlay', 'editorial', 'split_panel', 'type_led', 'badge', 'card', 'native_ugc'],
  hierarchy: ['headline_first', 'product_first', 'price_first'],
  hookType: ['pain', 'desire', 'objection', 'social_proof', 'comparison', 'price_value', 'urgency_scarcity', 'curiosity', 'routine', 'identity'],
  density: ['minimal', 'standard', 'rich'],
  colorUsage: ['brand_blocks', 'accent_pops', 'neutral_photo'],
  typeWeight: ['heavy', 'regular'],
  ctaStyle: ['button', 'text', 'sticker'],
}

/** Keep a stored analysis only when every enum is valid (never trust jsonb blindly). */
function asAnalysis(raw: unknown): StyleDnaAnalysis | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  for (const [k, allowed] of Object.entries(ANALYSIS_ENUMS)) if (typeof r[k] !== 'string' || !allowed.includes(r[k] as string)) return undefined
  return {
    layoutPattern: r.layoutPattern as StyleDnaAnalysis['layoutPattern'],
    hierarchy: r.hierarchy as StyleDnaAnalysis['hierarchy'],
    hookType: r.hookType as StyleDnaAnalysis['hookType'],
    density: r.density as StyleDnaAnalysis['density'],
    colorUsage: r.colorUsage as StyleDnaAnalysis['colorUsage'],
    typeWeight: r.typeWeight as StyleDnaAnalysis['typeWeight'],
    ctaStyle: r.ctaStyle as StyleDnaAnalysis['ctaStyle'],
    ...(typeof r.notes === 'string' && r.notes.trim() ? { notes: r.notes.trim().slice(0, 300) } : {}),
    analyzedAt: typeof r.analyzedAt === 'string' ? r.analyzedAt : '',
    model: typeof r.model === 'string' ? r.model.slice(0, 80) : '',
    referenceCount: typeof r.referenceCount === 'number' ? r.referenceCount : 0,
    referenceHash: typeof r.referenceHash === 'string' ? r.referenceHash.slice(0, 64) : '',
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
