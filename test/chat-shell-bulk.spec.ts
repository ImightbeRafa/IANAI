import { describe, expect, it } from 'vitest'
import { clampComposerBulkCount, sanitizeComposerBulkCountDraft, stepComposerBulkCount, packFailureCopy } from '../src/features/chat-shell/chatShellBulk'

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

  it('keeps a draft so typing 15 is possible', () => {
    expect(sanitizeComposerBulkCountDraft('1')).toBe('1')
    expect(sanitizeComposerBulkCountDraft('15')).toBe('15')
    expect(sanitizeComposerBulkCountDraft('150')).toBe('15')
    expect(sanitizeComposerBulkCountDraft('ab')).toBe('')
    expect(stepComposerBulkCount('2', -1)).toBe('2')
    expect(stepComposerBulkCount('2', 1)).toBe('3')
    expect(stepComposerBulkCount('25', 1)).toBe('25')
  })

  it('writes a Spanish in-chat pack error, never a silent empty', () => {
    expect(packFailureCopy('Brand has no offers', 'es')).toMatch(/^No pude generar el pack/)
    expect(packFailureCopy('Brand has no offers', 'es')).toMatch(/ofertas/)
    expect(packFailureCopy('Request failed (402)', 'es')).toMatch(/solicitud falló/)
  })
})
