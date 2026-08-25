import { describe, expect, it } from 'vitest'
import { clampComposerBulkCount } from '../src/features/chat-shell/chatShellBulk'

describe('ChatShell bulk count', () => {
  it('clamps composer count to 2–25 with default 10', () => {
    expect(clampComposerBulkCount(undefined)).toBe(10)
    expect(clampComposerBulkCount('')).toBe(10)
    expect(clampComposerBulkCount(1)).toBe(2)
    expect(clampComposerBulkCount(2)).toBe(2)
    expect(clampComposerBulkCount(10)).toBe(10)
    expect(clampComposerBulkCount(25)).toBe(25)
    expect(clampComposerBulkCount(40)).toBe(25)
  })
})
