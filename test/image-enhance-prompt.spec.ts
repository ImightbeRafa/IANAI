import { describe, expect, it } from 'vitest'
import {
  appendEnhanceUserDirection,
  buildEnhanceColorOverride,
  buildEnhanceSystemPrompt,
  normalizeEnhanceColors,
  resolveEnhanceTier,
  resolveEnhanceUserDirection,
} from '../api/lib/image-enhance'

describe('enhance prompt helpers', () => {
  it('prefers editPrompt over originalPrompt and ignores blanks', () => {
    expect(resolveEnhanceUserDirection('  Keep the logo  ', 'old prompt')).toBe('Keep the logo')
    expect(resolveEnhanceUserDirection('   ', 'Use original')).toBe('Use original')
    expect(resolveEnhanceUserDirection('', '')).toBeNull()
    expect(resolveEnhanceUserDirection(undefined, undefined)).toBeNull()
  })

  it('lets client colors override the brand-kit color block', () => {
    expect(normalizeEnhanceColors([' #111 ', '#111', '#222', '#333', '#444', 12])).toEqual([
      '#111',
      '#222',
      '#333',
    ])
    const override = buildEnhanceColorOverride(
      ['#AA0000', '#00AA00'],
      'USA SOLO ESTOS COLORES DE MARCA: #ABCDEF.'
    )
    expect(override).toContain('#AA0000, #00AA00')
    expect(override).not.toContain('#ABCDEF')
    expect(buildEnhanceColorOverride([], 'USA SOLO ESTOS COLORES DE MARCA: #112233.')).toBe(
      'USA SOLO ESTOS COLORES DE MARCA: #112233.'
    )
    expect(buildEnhanceColorOverride([], '  ')).toBeNull()
  })

  it('appends user direction after hard constraints', () => {
    const prompt = appendEnhanceUserDirection(
      'REGLA #1 — TEXTO\nREGLA #3 — LOGO INTACTO',
      'Match the official logo to the product photo.'
    )
    expect(prompt.startsWith('REGLA #1 — TEXTO')).toBe(true)
    expect(prompt).toContain('DIRECCIÓN DEL USUARIO (subordinada a las reglas #0–#4)')
    expect(prompt).toContain('Match the official logo to the product photo.')
    expect(appendEnhanceUserDirection('BASE', '   ')).toBe('BASE')
  })

  it('polish locks composition and does not claim a new set', () => {
    const polish = buildEnhanceSystemPrompt({
      language: 'es',
      tier: resolveEnhanceTier('polish'),
      hasProductRef: false,
    })
    expect(polish).toMatch(/POLISH/)
    expect(polish).toMatch(/set original|set nuevo/i)
    expect(polish).not.toMatch(/SCENE RECIPE/)
  })
})
