import { describe, expect, it } from 'vitest'
import { parseScriptSections } from '../src/features/chat-shell/parseScriptSections'

describe('parseScriptSections', () => {
  it('parses ordered GANCHO / DESARROLLO / CTA blocks', () => {
    const sections = parseScriptSections(
      '[GANCHO]\nHook line\n\n[DESARROLLO]\nBody line\n\n[CTA]\nComment LISTO'
    )
    expect(sections.map((s) => s.kind)).toEqual(['gancho', 'desarrollo', 'cta'])
    expect(sections[0]).toMatchObject({ label: 'Gancho', body: 'Hook line' })
    expect(sections[1]).toMatchObject({ label: 'Desarrollo', body: 'Body line' })
    expect(sections[2]).toMatchObject({ label: 'CTA', body: 'Comment LISTO' })
  })

  it('maps English aliases HOOK / DEVELOPMENT / CLOSE', () => {
    const sections = parseScriptSections(
      '[HOOK]\nH\n[DEVELOPMENT]\nD\n[CLOSE]\nC'
    )
    expect(sections.map((s) => ({ kind: s.kind, label: s.label }))).toEqual([
      { kind: 'gancho', label: 'Gancho' },
      { kind: 'desarrollo', label: 'Desarrollo' },
      { kind: 'cta', label: 'CTA' },
    ])
  })

  it('keeps unmarked leading text without dropping it', () => {
    const sections = parseScriptSections('Intro note\n\n[GANCHO]\nHook')
    expect(sections).toHaveLength(2)
    expect(sections[0]).toMatchObject({ kind: 'other', label: '', body: 'Intro note' })
    expect(sections[1]).toMatchObject({ kind: 'gancho', body: 'Hook' })
  })

  it('returns a single unmarked section when no markers exist', () => {
    expect(parseScriptSections('Plain script body')).toEqual([
      { kind: 'other', label: '', body: 'Plain script body' },
    ])
  })

  it('handles missing middle sections and empty bodies', () => {
    const sections = parseScriptSections('[GANCHO]\nOnly hook\n[CTA]\n')
    expect(sections.map((s) => s.kind)).toEqual(['gancho', 'cta'])
    expect(sections[0].body).toBe('Only hook')
    expect(sections[1].body).toBe('')
  })
})
