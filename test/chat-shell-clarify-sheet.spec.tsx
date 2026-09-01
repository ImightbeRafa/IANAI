/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatShellClarifySheet from '../src/features/chat-shell/ChatShellClarifySheet'
import type { ScriptClarifyState } from '../src/features/chat-shell/useChatSessionThread'
import { DEFAULT_SCRIPT_SETTINGS } from '../src/services/grokApi'

afterEach(cleanup)

function scriptState(partial: Partial<ScriptClarifyState> = {}): ScriptClarifyState {
  return {
    sessionId: 's1',
    step: 'type',
    originText: 'Quiero crear guiones',
    settings: { ...DEFAULT_SCRIPT_SETTINGS, variations: 3 },
    remaining: ['count', 'cta'],
    history: [],
    ...partial,
  }
}

describe('ChatShellClarifySheet', () => {
  it('shows Guiones types in a Pack-family sheet with footer Cancel, not a chip Cancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ChatShellClarifySheet
        language="es"
        scriptClarify={scriptState()}
        imageClarify={null}
        onCancelScriptClarify={onCancel}
      />
    )
    expect(screen.getByRole('dialog', { name: 'Guiones' })).toBeTruthy()
    expect(screen.getByText('Paso 1 de 3')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Venta directa' })).toBeTruthy()
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancelar' })
    expect(cancelButtons.some((btn) => btn.className.includes('chat-shell__modal-btn'))).toBe(true)
    await user.click(cancelButtons.find((btn) => btn.className.includes('chat-shell__modal-btn'))!)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows credits before Generar on the CTA step', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(
      <ChatShellClarifySheet
        language="es"
        scriptClarify={scriptState({
          step: 'cta',
          remaining: [],
          ctaChannel: 'website',
          history: [scriptState()],
        })}
        imageClarify={null}
        onAnswerScriptClarify={onAnswer}
        onBackScriptClarify={vi.fn()}
      />
    )
    expect(screen.getByText(/créditos/i)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Generar' }))
    expect(onAnswer).toHaveBeenCalledWith({ confirm: true })
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeTruthy()
  })

  it('keeps credits on Guiones Paso 3 and shows Generar only after CTA pick', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    const { rerender } = render(
      <ChatShellClarifySheet
        language="es"
        scriptClarify={scriptState({
          step: 'cta',
          remaining: [],
          history: [scriptState()],
        })}
        imageClarify={null}
        onAnswerScriptClarify={onAnswer}
        onBackScriptClarify={vi.fn()}
      />
    )
    expect(screen.getByText(/créditos/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Generar' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Comprar en web' }))
    expect(onAnswer).toHaveBeenCalledWith({ ctaChannel: 'website' })

    rerender(
      <ChatShellClarifySheet
        language="es"
        scriptClarify={scriptState({
          step: 'cta',
          remaining: [],
          ctaChannel: 'website',
          history: [scriptState()],
        })}
        imageClarify={null}
        onAnswerScriptClarify={onAnswer}
        onBackScriptClarify={vi.fn()}
      />
    )
    expect(screen.getByText(/créditos/i)).toBeTruthy()
    const generar = screen.getByRole('button', { name: 'Generar' })
    expect(generar).toBeTruthy()
    const footer = generar.closest('.chat-shell__modal-actions')
    const labels = Array.from(footer?.querySelectorAll('button') || []).map((btn) => btn.textContent)
    expect(labels).toEqual(['Atrás', 'Cancelar', 'Generar'])
  })

  it('renders Post script picker as a sheet grid with footer Cancel only', () => {
    render(
      <ChatShellClarifySheet
        language="es"
        scriptClarify={null}
        imageClarify={{
          sessionId: 's1',
          step: 'script',
          originText: 'Quiero crear un post',
          productId: 'p1',
          source: 'composer',
          partial: {},
          history: [],
          scriptChoices: [
            {
              id: 'a1',
              title: 'Hook A',
              preview: 'Preview A',
              scriptText: 'Full A',
              productId: 'p1',
              productName: 'Offer',
            },
            {
              id: 'a2',
              title: 'Hook B',
              preview: 'Preview B',
              scriptText: 'Full B',
              productId: 'p1',
            },
          ],
        }}
        onCancelImageClarify={vi.fn()}
      />
    )
    expect(screen.getByRole('dialog', { name: 'Post' })).toBeTruthy()
    expect(screen.getByText('Hook A')).toBeTruthy()
    expect(screen.getByText('Hook B')).toBeTruthy()
    expect(screen.queryByText(/## Guion/)).toBeNull()
    const footerCancel = screen.getAllByRole('button', { name: 'Cancelar' })
      .filter((btn) => btn.className.includes('chat-shell__modal-btn'))
    expect(footerCancel).toHaveLength(1)
    expect(screen.queryByText('Optimizar texto')).toBeNull()
  })

  it('shows Back on Foto step 2+ (aspect after style)', () => {
    render(
      <ChatShellClarifySheet
        language="es"
        scriptClarify={null}
        imageClarify={{
          sessionId: 's1',
          step: 'aspect',
          mode: 'product',
          originText: 'foto',
          productId: 'p1',
          source: 'composer',
          partial: { style: { kind: 'product', productSubStyle: 'studio-hero' } },
          preferences: {
            style: { kind: 'product', productSubStyle: 'studio-hero' },
            aspectRatio: '9:16',
            model: 'grok-imagine',
            density: 'hard',
          },
          history: [{
            sessionId: 's1',
            step: 'style',
            mode: 'product',
            originText: 'foto',
            productId: 'p1',
            source: 'composer',
            partial: {},
          }],
        }}
        onCancelImageClarify={vi.fn()}
        onBackImageClarify={vi.fn()}
      />
    )
    expect(screen.getByRole('dialog', { name: 'Foto' })).toBeTruthy()
    expect(screen.getByText(/Paso 2 de/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reel/ })).toBeTruthy()
    const atras = screen.getByRole('button', { name: 'Atrás' })
    const footer = atras.closest('.chat-shell__modal-actions')
    const labels = Array.from(footer?.querySelectorAll('button') || []).map((btn) => btn.textContent)
    expect(labels).toEqual(['Atrás', 'Cancelar'])
  })

  it('unmounts Post refs sheet when parent clears imageClarify after Generar', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    const refsState = {
      sessionId: 's1',
      step: 'refs' as const,
      originText: 'Quiero crear un post',
      productId: 'p1',
      source: 'composer' as const,
      partial: {},
      history: [],
      preferences: {
        style: { kind: 'preset' as const, presetId: 'venta-directa' as const },
        aspectRatio: '9:16' as const,
        model: 'grok-imagine' as const,
        density: 'hard' as const,
      },
      referencesRequired: true,
      referenceImages: [{
        id: 'img1',
        url: 'https://cdn.example/product.webp',
        kind: 'product' as const,
        dbKind: 'product' as const,
        productId: 'p1',
        selected: true,
      }],
    }
    const { rerender } = render(
      <ChatShellClarifySheet
        language="es"
        scriptClarify={null}
        imageClarify={refsState}
        onAnswerImageClarify={onAnswer}
      />
    )
    expect(screen.getByRole('dialog', { name: 'Post' })).toBeTruthy()
    expect(screen.getByText(/Confirmá referencias/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Generar' }))
    expect(onAnswer).toHaveBeenCalledWith({ useReferences: true })
    rerender(
      <ChatShellClarifySheet
        language="es"
        scriptClarify={null}
        imageClarify={null}
        onAnswerImageClarify={onAnswer}
      />
    )
    expect(screen.queryByRole('dialog', { name: 'Post' })).toBeNull()
  })

  it('hides Post refs sheet while Generando even if imageClarify is still set', () => {
    const refsState = {
      sessionId: 's1',
      step: 'refs' as const,
      originText: 'Quiero crear un post',
      productId: 'p1',
      source: 'composer' as const,
      partial: {},
      history: [],
      preferences: {
        style: { kind: 'preset' as const, presetId: 'venta-directa' as const },
        aspectRatio: '9:16' as const,
        model: 'grok-imagine' as const,
        density: 'hard' as const,
      },
      referencesRequired: true,
      referenceImages: [{
        id: 'img1',
        url: 'https://cdn.example/product.webp',
        kind: 'product' as const,
        dbKind: 'product' as const,
        productId: 'p1',
        selected: true,
      }],
    }
    render(
      <ChatShellClarifySheet
        language="es"
        scriptClarify={null}
        imageClarify={refsState}
        imageBusy
        onAnswerImageClarify={vi.fn()}
      />
    )
    expect(screen.queryByRole('dialog', { name: 'Post' })).toBeNull()
  })
})
