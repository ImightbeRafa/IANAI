import { describe, expect, it } from 'vitest'
import { progressStepsFor } from '../src/features/chat-shell/ChatShellProgress'

describe('ChatShellProgress steps', () => {
  it('uses setup reading steps, not the script quiz', () => {
    const steps = progressStepsFor('setup', 'es')
    expect(steps[0]).toMatch(/Leyendo/)
    expect(steps.join(' ')).not.toMatch(/conversión/)
  })

  it('keeps the familiar script thinking sequence', () => {
    const generic = progressStepsFor('script', 'es')
    expect(generic).toContain('Analizando tu pedido…')
    expect(generic.join(' ')).not.toMatch(/conversión/)
  })

  it('uses venta-directa steps instead of a generic quiz', () => {
    const steps = progressStepsFor('script', 'es', { scriptType: 'venta_directa' })
    expect(steps[0]).toMatch(/oferta/)
    expect(steps.join(' ')).toMatch(/gancho/)
    expect(steps.join(' ')).toMatch(/CTA/)
    expect(steps.join(' ')).not.toMatch(/conversión/)
  })

  it('has no text steps for the image frame', () => {
    expect(progressStepsFor('image', 'en')).toEqual([])
  })
})
