import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { labeledCopyText, parseScriptBatch } from '../api/lib/guiones/script-sections-parse'
import { parseScripts } from '../src/utils/scriptParser'

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/scripts/sleeping-patches-clustered.txt')
const SLEEPING_PATCHES = readFileSync(fixturePath, 'utf8')

describe('A1 tolerant parser — Sleeping Patches clustered blob', () => {
  it('splits GUIÓN/OPCIÓN headers into two scripts with timed sections', () => {
    const options = parseScriptBatch(SLEEPING_PATCHES)
    expect(options).toHaveLength(2)
    expect(options[0].title).toBe('Parche, no pastilla')
    expect(options[1].title).toBe('30 noches de calma')
    expect(options.map((o) => o.scriptTypeLabel)).toEqual(['Venta Directa', 'Venta Directa'])
    expect(options[0].sections.map((s) => s.kind)).toEqual(['gancho', 'desarrollo', 'cierre'])
    expect(options[1].sections.map((s) => s.kind)).toEqual(['gancho', 'desarrollo', 'cierre'])
    expect(options[0].sections.map((s) => s.seconds)).toEqual([3, 25, 4])
    expect(options[1].sections.map((s) => s.seconds)).toEqual([3, 28, 4])
    for (const option of options) {
      expect(option.content).not.toMatch(/###/)
      expect(option.headerLine).not.toMatch(/###/)
      expect(JSON.stringify(option)).not.toMatch(/###/)
    }
  })

  it('parseScripts yields one card per option', () => {
    const scripts = parseScripts(SLEEPING_PATCHES)
    expect(scripts).toHaveLength(2)
    expect(scripts[0].content).not.toMatch(/GUIÓN\/OPCIÓN #2|OPCIÓN #2/)
    expect(scripts[1].title).toMatch(/30 noches/)
  })

  it('Copiar labeled text is v2 without markdown hashes', () => {
    const [first] = parseScriptBatch(SLEEPING_PATCHES)
    const copy = labeledCopyText(first, 'es')
    expect(copy).toMatch(/^OPCIÓN #1 — Venta Directa — "Parche, no pastilla"/)
    expect(copy).toContain('[GANCHO · ~3 s]')
    expect(copy).toContain('[DESARROLLO · ~25 s]')
    expect(copy).not.toMatch(/###/)
    expect(copy).not.toMatch(/\[Estilo:/)
  })
})
