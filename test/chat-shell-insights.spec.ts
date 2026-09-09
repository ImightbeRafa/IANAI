import { describe, expect, it } from 'vitest'
import {
  insightsThemeBackgroundBlock,
  sanitizeInsights,
} from '../src/features/chat-shell/chatShellInsights'
import { insightsThemeBackgroundBlock as apiInsightsBlock, sanitizeInsights as apiSanitize } from '../api/lib/insights'
import { buildShellImageGenerateBody } from '../src/features/chat-shell/chatShellImageIntent'

describe('chat-shell Insights', () => {
  it('sanitizes and caps Insights text', () => {
    expect(sanitizeInsights('  cocina   cálida  ')).toBe('cocina cálida')
    expect(sanitizeInsights('x'.repeat(600)).length).toBe(500)
    expect(apiSanitize('  same  ')).toBe('same')
  })

  it('builds a theme/background steering block when filled', () => {
    const block = insightsThemeBackgroundBlock('luz natural suave', 'es')
    expect(block).toContain('INSIGHTS DEL USUARIO')
    expect(block).toContain('luz natural suave')
    expect(block).toMatch(/fondo|ambiente|tema/i)
    expect(insightsThemeBackgroundBlock('   ', 'es')).toBe('')
    expect(apiInsightsBlock('golden hour kitchen', 'en')).toContain('USER INSIGHTS')
  })

  it('threads Insights into the generate-image body for Post and Foto', () => {
    const postBody = buildShellImageGenerateBody({
      preferences: {
        style: { kind: 'preset', presetId: 'venta-directa' },
        aspectRatio: '9:16',
        density: 'hard',
        model: 'grok-imagine',
      },
      productId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      prompt: 'Guion de prueba',
      language: 'es',
      insights: 'cocina cálida al atardecer',
    })
    expect(postBody.insights).toBe('cocina cálida al atardecer')
    expect(postBody.backgroundDescription).toBeUndefined()

    const fotoBody = buildShellImageGenerateBody({
      preferences: {
        style: { kind: 'product', productSubStyle: 'lifestyle' },
        aspectRatio: '1:1',
        density: 'hard',
        model: 'grok-imagine',
      },
      productId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      prompt: '',
      language: 'es',
      insights: 'mesa de madera, luz de ventana',
    })
    expect(fotoBody.insights).toBe('mesa de madera, luz de ventana')
    expect(fotoBody.backgroundDescription).toBe('mesa de madera, luz de ventana')
    expect(fotoBody.postStyle).toBe('product')
  })
})
