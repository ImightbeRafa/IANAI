import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as apiParse from '../api/lib/guiones/script-sections-parse'
import * as spaParse from '../src/utils/scriptSections'

const clustered = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/scripts/sleeping-patches-clustered.txt'),
  'utf8'
)

const FIXTURES = [
  clustered,
  'OPCIÓN #1 — Venta Directa — "A"\n[GANCHO · ~3 s]\nHook\n\n[DESARROLLO · ~10 s]\nBody\n\n[CTA · ~2 s]\nCta',
  'OPTION #2 — Direct Sale — "B"\n[HOOK · ~2 s]\nH\n\n[DEVELOPMENT · ~8 s]\nD\n\n[CLOSE · ~2 s]\nC',
  '### GUIÓN #1 — Title one\n[GANCHO]: Line\n[DESARROLLO]: Mid\n[CTA]: End',
  '**OPCIÓN 1:** Demo\n[GANCHO A]: First\n[GANCHO B]: Second\n[CTA]: Close',
  'SCRIPT #3 - Educational - "Learn"\n[HOOK - 4 seg]: Start\n[DEVELOPMENT - 20 seg]: Mid\n[CLOSE - 3 seg]: End',
  'Guión 1: Solo gancho\n[GANCHO]\nSolo esto',
  'OPCIÓN #1\n[DESARROLLO]: Solo cuerpo\n[CIERRE]: Fin',
  'Plain unmarked script without headers or markers at all.',
  '## Guion 1: Hook Demo\n**Gancho:** Probá hoy.\n**CTA:** Escribinos.\n\n## Guion 2: Social\n**Gancho:** Ya lo usan.',
  'OPCIÓN #1 — [Estilo: Storytelling] — «Noche larga»\n[GANCHO - 5 s]: Era tarde.\n[DESARROLLO]: Pasó esto.\n[CIERRE]: Fin.',
  'GUIÓN/OPCIÓN #1 — [Estilo: Educativo] — "Dato"\n[GANCHO]: Pregunta\n[DESARROLLO]: Respuesta\n[CTA]: Guardalo',
]

describe('A3 server ↔ SPA parser parity', () => {
  it('returns identical JSON for 12 fixtures', () => {
    expect(FIXTURES).toHaveLength(12)
    for (const [index, fixture] of FIXTURES.entries()) {
      const api = apiParse.parseScriptBatch(fixture, 'es')
      const spa = spaParse.parseScriptBatch(fixture, 'es')
      expect(spa, `fixture ${index}`).toEqual(api)
      expect(spaParse.parsedOptionsToSectionDtos(spa, 'es')).toEqual(
        apiParse.parsedOptionsToSectionDtos(api, 'es')
      )
    }
  })
})
