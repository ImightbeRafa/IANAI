import { describe, expect, it } from 'vitest'
import {
  assignGlobalScriptOrdinals,
  splitOfferScriptContent,
} from '../src/features/chat-shell/chatShellScriptSplit'

describe('splitOfferScriptContent / assignGlobalScriptOrdinals', () => {
  it('splits GUIÓN headers into separate scripts', () => {
    const content = `GUIÓN 1 — Hook A
Body one here with enough text to be a script.

GUIÓN 2 — Hook B
Body two here with enough text to be a script.`
    const parts = splitOfferScriptContent(content, 'Offer')
    expect(parts).toHaveLength(2)
    expect(parts[0].index).toBe(1)
    expect(parts[1].index).toBe(2)
  })

  it('splits GUIÓN/OPCIÓN clustered blobs into one row per option', () => {
    const content = `### GUIÓN/OPCIÓN #1 — [Estilo: Venta Directa] — "Parche, no pastilla"
[GANCHO - 3 seg]: Dormís mal.
[DESARROLLO - 25 seg]: Cada parche.
[CTA - 4 seg]: Envianos un mensaje.

### GUIÓN/OPCIÓN #2 — [Estilo: Venta Directa] — "30 noches de calma"
[GANCHO - 3 seg]: Treinta noches.
[DESARROLLO - 28 seg]: Sleeping Patches.
[CTA - 4 seg]: Escribinos LISTO.`
    const parts = splitOfferScriptContent(content, 'Sleeping Patches')
    expect(parts).toHaveLength(2)
    expect(parts[0].title).toMatch(/Parche/)
    expect(parts[1].title).toMatch(/30 noches/)
  })

  it('falls back to a single script without headers', () => {
    const parts = splitOfferScriptContent('Just one plain script body.', 'Offer')
    expect(parts).toEqual([
      { index: 1, title: 'Offer', content: 'Just one plain script body.' },
    ])
  })

  it('assigns global ordinals offer-first script-second', () => {
    const ranked = assignGlobalScriptOrdinals([
      {
        id: 'a',
        scripts: [
          { index: 1, title: 'A1', content: 'a1' },
          { index: 2, title: 'A2', content: 'a2' },
        ],
      },
      {
        id: 'b',
        scripts: [{ index: 1, title: 'B1', content: 'b1' }],
      },
    ])
    expect(ranked[0].scripts.map((s) => s.ordinal)).toEqual([1, 2])
    expect(ranked[1].scripts.map((s) => s.ordinal)).toEqual([3])
  })
})
