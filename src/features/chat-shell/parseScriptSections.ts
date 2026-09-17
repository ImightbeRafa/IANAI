import { parseScriptSectionsFromText } from '../../utils/scriptSections'

export type ScriptSectionKind = 'gancho' | 'desarrollo' | 'cierre' | 'other'

export interface ScriptSection {
  kind: ScriptSectionKind
  label: string
  body: string
  seconds?: number | null
}

/** Normalize display labels — drop A/B suffixes (e.g. "Gancho A" → "Gancho"). */
export function normalizeSectionLabel(kind: ScriptSectionKind, rawInner: string): string {
  switch (kind) {
    case 'gancho':
      return 'Gancho'
    case 'desarrollo':
      return 'Desarrollo'
    case 'cierre':
      // Product language: CTA / CIERRE / CLOSE all display as "Cierre"
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
  // Accept bracketed or bare markers from callers, including `[GANCHO - 3 seg]`.
  const key = rawInner
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim()
    .toUpperCase()
    .replace(/\s+[AB]$/, '')
    .replace(/\s*[-–—·:].*$/, '')
  if (key.startsWith('GANCHO') || key.startsWith('HOOK')) {
    return { kind: 'gancho', label: normalizeSectionLabel('gancho', rawInner) }
  }
  if (key.startsWith('DESARROLLO') || key.startsWith('DEVELOPMENT')) {
    return { kind: 'desarrollo', label: normalizeSectionLabel('desarrollo', rawInner) }
  }
  // CTA / CIERRE / CLOSE → displayed section header "Cierre" (raw copy text unchanged).
  if (key === 'CTA' || key.startsWith('CIERRE') || key.startsWith('CLOSE')) {
    return { kind: 'cierre', label: normalizeSectionLabel('cierre', rawInner) }
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
  const parsed = parseScriptSectionsFromText(text)
  return parsed.map((section) => ({
    kind: section.kind,
    label: section.displayLabel,
    body: section.text,
    seconds: section.seconds,
  }))
}
