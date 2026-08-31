import { describe, expect, it } from 'vitest'
import { parseScripts } from '../src/utils/scriptParser'

describe('parseScripts markdown headers', () => {
  it('splits ## Guion 1 / ## Guion 2 into one card each (not a markdown dump)', () => {
    const scripts = parseScripts(`## Guion 1: Hook Demo

**Gancho:** Probá el Arnes Demo hoy.
**Desarrollo:** Hecho para durar.
**CTA:** Escribinos.

## Guion 2: Prueba Social

**Gancho:** Ya lo usan 200 talleres.
**Desarrollo:** Menos fricción.
**CTA:** Pedí el tuyo.`)
    expect(scripts).toHaveLength(2)
    expect(scripts[0].title).toMatch(/Hook Demo/i)
    expect(scripts[1].title).toMatch(/Prueba Social/i)
    expect(scripts[0].content).not.toMatch(/Guion 2/)
    expect(scripts[1].content).not.toMatch(/Guion 1/)
  })
})
