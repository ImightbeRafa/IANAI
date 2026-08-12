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
