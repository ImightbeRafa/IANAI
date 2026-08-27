import { describe, expect, it } from 'vitest'
import {
  buildCreditQuote,
  creditQuoteCopy,
  quoteImageCredits,
  quoteScriptCredits,
} from '../src/features/chat-shell/chatShellCreditQuote'
import { friendlyImageError } from '../src/features/chat-shell/chatShellImageErrors'

describe('chatShellCreditQuote', () => {
  it('quotes scripts as 3 × offers', () => {
    expect(quoteScriptCredits(2)).toBe(6)
    expect(buildCreditQuote({ kind: 'scripts', units: 2, remaining: 100 }).cost).toBe(6)
  })

  it('quotes images by model weight', () => {
    expect(quoteImageCredits('grok-imagine')).toBe(6)
    expect(quoteImageCredits('openai')).toBe(24)
  })

  it('builds Spanish confirm copy', () => {
    const copy = creditQuoteCopy(
      buildCreditQuote({ kind: 'scripts', units: 1, remaining: 247 }),
      'es'
    )
    expect(copy.question).toMatch(/3 créditos/)
    expect(copy.question).toMatch(/247/)
    expect(copy.confirm).toBe('Seguir')
  })
})

describe('friendlyImageError', () => {
  it('maps raw Grok English to Spanish', () => {
    expect(friendlyImageError('Grok Imagine generation failed', 'es')).toMatch(/No pudimos generar/)
  })

  it('maps missing provider key', () => {
    expect(friendlyImageError('xAI API key not configured', 'es')).toMatch(/clave del proveedor/)
  })
})
