export type ScriptSectionKind = 'gancho' | 'desarrollo' | 'cta' | 'cierre' | 'other'

export interface ScriptSection {
  kind: ScriptSectionKind
  label: string
  body: string
}

const SECTION_MARKER_RE =
  /\[(GANCHO[S]?|HOOK[S]?|DESARROLLO|DEVELOPMENT|CTA|CIERRE|CLOSE)(?:\s*[AB])?\]/gi

/** Normalize display labels — drop A/B suffixes (e.g. "Gancho A" → "Gancho"). */
export function normalizeSectionLabel(kind: ScriptSectionKind, rawInner: string): string {
  switch (kind) {
    case 'gancho':
      return 'Gancho'
    case 'desarrollo':
      return 'Desarrollo'
    case 'cta':
      return 'CTA'
    case 'cierre':
      return 'Cierre'
    case 'other': {
      const cleaned = rawInner
        .trim()
        .replace(/\s+[ABab]$/, '')
        .trim()
      return cleaned
    }
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

export function classifySectionMarker(rawInner: string): {
  kind: ScriptSectionKind
  label: string
} {
  const key = rawInner.trim().toUpperCase().replace(/\s+[AB]$/, '')
  if (key.startsWith('GANCHO') || key.startsWith('HOOK')) {
    return { kind: 'gancho', label: normalizeSectionLabel('gancho', rawInner) }
  }
  if (key.startsWith('DESARROLLO') || key.startsWith('DEVELOPMENT')) {
    return { kind: 'desarrollo', label: normalizeSectionLabel('desarrollo', rawInner) }
  }
  // CIERRE / CLOSE must never display as "CTA"
  if (key.startsWith('CIERRE') || key.startsWith('CLOSE')) {
    return { kind: 'cierre', label: normalizeSectionLabel('cierre', rawInner) }
  }
  if (key === 'CTA') {
    return { kind: 'cta', label: normalizeSectionLabel('cta', rawInner) }
  }
  return { kind: 'other', label: normalizeSectionLabel('other', rawInner) }
}

/** Strip leading colon + whitespace after a section marker (e.g. ": Hook…" → "Hook…"). */
export function stripLeadingColon(body: string): string {
  return body.replace(/^[\s\u00a0]*:+[\s\u00a0]*/, '').trim()
}

/**
 * Split script text on [GANCHO]/[DESARROLLO]/[CTA]/[CIERRE] (and aliases) into
 * section header + body blocks. Unmarked leading text becomes a body-only section.
 */
export function parseScriptSections(text: string): ScriptSection[] {
  const source = text.replace(/\r\n/g, '\n')
  if (!source.trim()) return []

  const matches = [...source.matchAll(SECTION_MARKER_RE)]
  if (matches.length === 0) {
    return [{ kind: 'other', label: '', body: stripLeadingColon(source) }]
  }

  const sections: ScriptSection[] = []
  const firstIndex = matches[0].index ?? 0
  const leading = stripLeadingColon(source.slice(0, firstIndex))
  if (leading) {
    sections.push({ kind: 'other', label: '', body: leading })
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const start = (match.index ?? 0) + match[0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? source.length) : source.length
    const rawBody = source.slice(start, end).replace(/^\s*\n/, '')
    const body = stripLeadingColon(rawBody)
    const { kind, label } = classifySectionMarker(match[1] || match[0])
    sections.push({ kind, label, body })
  }

  return sections
}
