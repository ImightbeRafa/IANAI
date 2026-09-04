import { describe, expect, it } from 'vitest'
import {
  adjustMixCount,
  defaultMixForChannel,
  isValidCtaMix,
  mixTotal,
  toggleMixChannel,
} from '../src/features/chat-shell/chatShellCtaMix'

describe('chatShellCtaMix', () => {
  it('defaults the first pick to all scripts of that type', () => {
    const mix = toggleMixChannel(undefined, 'website', 5)
    expect(mix).toEqual({ website: 5, messages: 0, none: 0 })
    expect(isValidCtaMix(mix, 5)).toBe(true)
  })

  it('steals one from the largest bucket when a second type is picked', () => {
    const first = defaultMixForChannel('website', 5)
    const mixed = toggleMixChannel(first, 'messages', 5)
    expect(mixed).toEqual({ website: 4, messages: 1, none: 0 })
    expect(mixTotal(mixed)).toBe(5)
  })

  it('does not reset a selected type on a second click', () => {
    const mixed = { website: 3, messages: 2, none: 0 }
    expect(toggleMixChannel(mixed, 'website', 5)).toEqual(mixed)
  })

  it('rebalances with plus and minus without changing the total', () => {
    const start = { website: 3, messages: 2, none: 0 }
    const plus = adjustMixCount(start, 'messages', 1, 5)
    expect(plus).toEqual({ website: 2, messages: 3, none: 0 })
    const minus = adjustMixCount(plus, 'messages', -1, 5)
    expect(minus).toEqual({ website: 3, messages: 2, none: 0 })
    expect(adjustMixCount(start, 'website', -1, 5).website + adjustMixCount(start, 'website', -1, 5).messages).toBe(5)
  })

  it('refuses to zero the last remaining type', () => {
    const only = defaultMixForChannel('website', 5)
    expect(adjustMixCount(only, 'website', -1, 5)).toEqual(only)
  })
})
