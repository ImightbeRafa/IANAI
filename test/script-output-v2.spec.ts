import { describe, expect, it } from 'vitest'
import { renderOneScriptAsText, renderScriptsAsText } from '../api/lib/guiones/script-output'
import { attachSpokenTiming } from '../api/lib/guiones/script-timing'
import type { GeneratedScript } from '../api/lib/guiones/types'

function sample(partial: Partial<GeneratedScript> & Pick<GeneratedScript, 'scriptType' | 'spokenScript'>): GeneratedScript {
  return attachSpokenTiming({
    index: 1,
    title: 'Parche, no pastilla',
    hookMechanism: 'direct_offer',
    buyerStage: 'hot',
    qualityScore: 8,
    ...partial,
  }, 'es')
}

describe('A2 canonical text v2', () => {
  it('renders ES sales labels on their own lines with local ~N s chips', () => {
    const script = sample({
      scriptType: 'venta_directa',
      spokenScript: {
        hook: 'Dormís mal y al día siguiente lo pagás.',
        development: 'Cada parche de doce por diecisiete trae fórmula nocturna para dormir profundo sin pastillas y sin resaca.',
        ctaOrClose: 'Envianos un mensaje para pedir tu bolsa.',
      },
    })
    const text = renderOneScriptAsText(script, 'es')
    expect(text).toMatch(/^OPCIÓN #1 — Venta Directa — "Parche, no pastilla"\n\[GANCHO · ~\d+ s\]\n/)
    expect(text).toContain('\n\n[DESARROLLO · ~')
    expect(text).toContain('\n\n[CTA · ~')
    expect(text).not.toMatch(/\[GANCHO\]:/)
  })

  it('uses CIERRE for organic types and OPTION/HOOK/DEVELOPMENT/CLOSE in EN', () => {
    const organic = sample({
      scriptType: 'educativo',
      spokenScript: {
        hook: 'Por qué el parche gana a la pastilla.',
        development: 'La piel absorbe la fórmula mientras dormís, sin pasar por el estómago.',
        ctaOrClose: 'Guardá este dato para la próxima noche difícil.',
      },
    })
    const es = renderScriptsAsText([organic], 'es')
    expect(es).toContain('[CIERRE · ~')
    expect(es).not.toContain('[CTA · ~')

    const en = attachSpokenTiming({
      ...organic,
      title: 'Patch not pill',
    }, 'en')
    const enText = renderOneScriptAsText(en, 'en')
    expect(enText).toMatch(/^OPTION #1 — Educational — "Patch not pill"/)
    expect(enText).toContain('[HOOK · ~')
    expect(enText).toContain('[DEVELOPMENT · ~')
    expect(enText).toContain('[CLOSE · ~')
  })
})
