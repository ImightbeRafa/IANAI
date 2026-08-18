import { describe, expect, it } from 'vitest'
import { DENSITY_CONFIG, getStreamlineSystemPrompt } from '../api/lib/streamline-copy'

describe('streamline density contract', () => {
  it('keeps short copy readable instead of telegraphic scraps', () => {
    expect(DENSITY_CONFIG.hard.targetWords).toBe('28-36')
    expect(DENSITY_CONFIG.hard.maxWords).toBe(40)
    expect(DENSITY_CONFIG.hard.maxTokens).toBe(120)
    expect(DENSITY_CONFIG.hard.temperature).toBe(0.4)
    const prompt = getStreamlineSystemPrompt('venta-directa', 'es', { name: 'Forge' }, 'hard')
    expect(prompt).toContain('GANCHO (hook) → DESARROLLO (development) → CIERRE (CTA)')
    expect(prompt).toContain('independently understandable')
    expect(prompt).toContain('complete phrase')
    expect(prompt).not.toContain('Drop almost everything else')
    expect(prompt).not.toContain('25% of the input')
  })

  it('keeps medium copy to hook, short development, and CTA', () => {
    expect(DENSITY_CONFIG.medium.targetWords).toBe('34-44')
    expect(DENSITY_CONFIG.medium.maxWords).toBe(48)
    expect(DENSITY_CONFIG.medium.maxTokens).toBe(145)
    const prompt = getStreamlineSystemPrompt('venta-directa', 'es', undefined, 'medium')
    expect(prompt).toContain('2-3 concise development lines')
    expect(prompt).toContain('No extra paragraphs')
  })
})
