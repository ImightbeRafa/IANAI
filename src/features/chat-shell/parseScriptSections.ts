export type ScriptSectionKind = 'gancho' | 'desarrollo' | 'cta' | 'other'

export interface ScriptSection {
  kind: ScriptSectionKind
  label: string
  body: string
}

const SECTION_MARKER_RE =
  /\[(GANCHO[S]?|HOOK[S]?|DESARROLLO|DEVELOPMENT|CTA|CIERRE|CLOSE)(?:\s*[AB])?\]/gi

function classifyMarker(rawInner: string): { kind: ScriptSectionKind; label: string } {
  const key = rawInner.trim().toUpperCase().replace(/\s+[AB]$/, '')
  if (key.startsWith('GANCHO') || key.startsWith('HOOK')) {
    return { kind: 'gancho', label: 'Gancho' }
  }
  if (key.startsWith('DESARROLLO') || key.startsWith('DEVELOPMENT')) {
    return { kind: 'desarrollo', label: 'Desarrollo' }
  }
  if (key === 'CTA' || key.startsWith('CIERRE') || key.startsWith('CLOSE')) {
    return { kind: 'cta', label: 'CTA' }
  }
  return { kind: 'other', label: rawInner.trim() }
}

/**
 * Split script text on [GANCHO]/[DESARROLLO]/[CTA] (and aliases) into
 * section header + body blocks. Unmarked leading text becomes a body-only section.
 */
export function parseScriptSections(text: string): ScriptSection[] {
  const source = text.replace(/\r\n/g, '\n')
  if (!source.trim()) return []

  const matches = [...source.matchAll(SECTION_MARKER_RE)]
  if (matches.length === 0) {
    return [{ kind: 'other', label: '', body: source.trim() }]
  }

  const sections: ScriptSection[] = []
  const firstIndex = matches[0].index ?? 0
  const leading = source.slice(0, firstIndex).trim()
  if (leading) {
    sections.push({ kind: 'other', label: '', body: leading })
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const start = (match.index ?? 0) + match[0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? source.length) : source.length
    const body = source.slice(start, end).replace(/^\s*\n/, '').trim()
    const { kind, label } = classifyMarker(match[1] || match[0])
    sections.push({ kind, label, body })
  }

  return sections
}
