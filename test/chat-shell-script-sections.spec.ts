import { describe, expect, it } from 'vitest'
import {
  classifySectionMarker,
  parseScriptSections,
  stripLeadingColon,
} from '../src/features/chat-shell/parseScriptSections'

describe('stripLeadingColon', () => {
  it('strips leading colon and whitespace from section bodies', () => {
    expect(stripLeadingColon(': Hook line')).toBe('Hook line')
    expect(stripLeadingColon('  :  Body')).toBe('Body')
    expect(stripLeadingColon(':\nCTA text')).toBe('CTA text')
    expect(stripLeadingColon('No colon')).toBe('No colon')
  })
})

describe('classifySectionMarker', () => {
  it('maps CTA / CIERRE / CLOSE (bare or bracketed) to label Cierre', () => {
    expect(classifySectionMarker('CTA')).toEqual({ kind: 'cierre', label: 'Cierre' })
    expect(classifySectionMarker('[CTA]')).toEqual({ kind: 'cierre', label: 'Cierre' })
    expect(classifySectionMarker('cta')).toEqual({ kind: 'cierre', label: 'Cierre' })
    expect(classifySectionMarker('CIERRE')).toEqual({ kind: 'cierre', label: 'Cierre' })
    expect(classifySectionMarker('[CIERRE]')).toEqual({ kind: 'cierre', label: 'Cierre' })
    expect(classifySectionMarker('CLOSE')).toEqual({ kind: 'cierre', label: 'Cierre' })
    expect(classifySectionMarker('[CLOSE]')).toEqual({ kind: 'cierre', label: 'Cierre' })
  })

  it('strips Gancho A/B style suffixes from labels', () => {
    expect(classifySectionMarker('GANCHO A')).toEqual({ kind: 'gancho', label: 'Gancho' })
    expect(classifySectionMarker('GANCHO B')).toEqual({ kind: 'gancho', label: 'Gancho' })
    expect(classifySectionMarker('HOOK A')).toEqual({ kind: 'gancho', label: 'Gancho' })
  })
})

describe('parseScriptSections', () => {
  it('parses ordered GANCHO / DESARROLLO / CTA with Cierre display label', () => {
    const sections = parseScriptSections(
      '[GANCHO]\nHook line\n\n[DESARROLLO]\nBody line\n\n[CTA]\nComment LISTO'
    )
    expect(sections.map((s) => s.kind)).toEqual(['gancho', 'desarrollo', 'cierre'])
    expect(sections[0]).toMatchObject({ label: 'Gancho', body: 'Hook line' })
    expect(sections[1]).toMatchObject({ label: 'Desarrollo', body: 'Body line' })
    expect(sections[2]).toMatchObject({ label: 'Cierre', body: 'Comment LISTO' })
  })

  it('strips leading colons from bodies after markers', () => {
    const sections = parseScriptSections(
      '[GANCHO]: ¿Sigues perdiendo ventas?\n[DESARROLLO]: Con un guion claro…\n[CTA]: Comenta LISTO'
    )
    expect(sections.map((s) => s.label)).toEqual(['Gancho', 'Desarrollo', 'Cierre'])
    expect(sections[0].body).toBe('¿Sigues perdiendo ventas?')
    expect(sections[1].body).toBe('Con un guion claro…')
    expect(sections[2].body).toBe('Comenta LISTO')
  })

  it('maps CTA marker to Cierre for stored and fresh cards (re-parse)', () => {
    const stored = '[GANCHO]: Hook\n[DESARROLLO]: Body\n[CTA]: End'
    const fresh = parseScriptSections(stored)
    const again = parseScriptSections(stored)
    expect(fresh.map((s) => s.label)).toEqual(['Gancho', 'Desarrollo', 'Cierre'])
    expect(again.map((s) => s.label)).toEqual(['Gancho', 'Desarrollo', 'Cierre'])
    expect(fresh[2]).toMatchObject({ kind: 'cierre', label: 'Cierre', body: 'End' })
  })

  it('maps English aliases HOOK / DEVELOPMENT / CLOSE to display labels', () => {
    const sections = parseScriptSections(
      '[HOOK]\nH\n[DEVELOPMENT]\nD\n[CLOSE]\nC'
    )
    expect(sections.map((s) => ({ kind: s.kind, label: s.label }))).toEqual([
      { kind: 'gancho', label: 'Gancho' },
      { kind: 'desarrollo', label: 'Desarrollo' },
      { kind: 'cierre', label: 'Cierre' },
    ])
  })

  it('normalizes [GANCHO A] / [GANCHO B] labels', () => {
    const sections = parseScriptSections('[GANCHO A]: First\n[GANCHO B]: Second')
    expect(sections.map((s) => s.label)).toEqual(['Gancho', 'Gancho'])
    expect(sections[0].body).toBe('First')
    expect(sections[1].body).toBe('Second')
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
    expect(sections.map((s) => s.kind)).toEqual(['gancho', 'cierre'])
    expect(sections[0].body).toBe('Only hook')
    expect(sections[1]).toMatchObject({ label: 'Cierre', body: '' })
  })
})
