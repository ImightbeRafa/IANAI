/** @vitest-environment happy-dom */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatComposerCreateDock, {
  type ComposerCreateAction,
} from '../src/features/chat-shell/ChatComposerCreateDock'

const SHELL_CSS = readFileSync('src/features/chat-shell/chat-shell.css', 'utf8')

afterEach(cleanup)

function makeActions(): ComposerCreateAction[] {
  return [
    { id: 'scripts', label: 'Guiones', onClick: vi.fn() },
    { id: 'post', label: 'Post', onClick: vi.fn() },
    { id: 'product', label: 'Foto', onClick: vi.fn() },
    { id: 'bulk', label: 'Pack', onClick: vi.fn() },
  ]
}

describe('ChatComposerCreateDock', () => {
  it('keeps the kit and hide control on the idle glass row, without a transcript card', async () => {
    const user = userEvent.setup()
    const onHide = vi.fn()
    const onShow = vi.fn()
    const actions = makeActions()
    render(
      <ChatComposerCreateDock
        language="es"
        available
        hidden={false}
        title="Brand Kit listo"
        onHide={onHide}
        onShow={onShow}
        actions={actions}
        reviewPanel={<div>Detalle del kit</div>}
      />
    )
    expect(screen.getByText('Brand Kit listo')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Guiones' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Post' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Foto' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pack' })).toBeTruthy()
    expect(document.querySelector('.chat-shell__idle-glass')).toBeTruthy()
    expect(document.querySelector('.chat-shell__idle-actions')).toBeTruthy()
    expect(screen.queryByText('Detalle del kit')).toBeNull()
    expect(screen.queryByText('× Ocultar')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Ocultar Brand Kit' }))
    expect(onHide).toHaveBeenCalledTimes(1)
    expect(onShow).not.toHaveBeenCalled()
    expect(actions[0].onClick).not.toHaveBeenCalled()
  })

  it('opens review from the glass row without covering the create actions', async () => {
    const user = userEvent.setup()
    render(
      <ChatComposerCreateDock
        language="es"
        available
        hidden={false}
        title="Brand Kit listo"
        onHide={vi.fn()}
        onShow={vi.fn()}
        actions={makeActions()}
        reviewPanel={<div>Detalle del kit</div>}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Revisar Brand Kit' }))
    expect(screen.getByText('Detalle del kit')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Guiones' })).toBeTruthy()
  })

  it('restores the kit from a single glass-row icon when hidden', async () => {
    const user = userEvent.setup()
    const onShow = vi.fn()
    render(
      <ChatComposerCreateDock
        language="es"
        available
        hidden
        title="Brand Kit listo"
        onHide={vi.fn()}
        onShow={onShow}
        actions={makeActions()}
        reviewPanel={<div>Detalle del kit</div>}
      />
    )
    expect(screen.queryByText('Brand Kit listo')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Mostrar Brand Kit' }))
    expect(onShow).toHaveBeenCalledTimes(1)
  })

  it('shows Primero el kit on glass verbs when the kit is blocked', () => {
    render(
      <ChatComposerCreateDock
        language="es"
        available
        hidden={false}
        title="Brand Kit incompleto"
        onHide={vi.fn()}
        onShow={vi.fn()}
        actions={[
          { id: 'scripts', label: 'Guiones', onClick: vi.fn(), disabled: true, blockedReason: 'kit' },
          { id: 'post', label: 'Post', onClick: vi.fn(), disabled: true, blockedReason: 'kit' },
          { id: 'product', label: 'Foto', onClick: vi.fn(), disabled: true, blockedReason: 'kit' },
          { id: 'bulk', label: 'Pack', onClick: vi.fn(), disabled: true, blockedReason: 'kit' },
        ]}
        reviewPanel={<div>Detalle del kit</div>}
      />
    )
    const blocked = screen.getAllByText('Primero el kit')
    expect(blocked.length).toBe(4)
    expect(screen.getByRole('button', { name: 'Guiones — Primero el kit' })).toBeTruthy()
  })

  it('does not show Primero el kit when verbs are enabled (soft Falta afinar)', () => {
    render(
      <ChatComposerCreateDock
        language="es"
        available
        hidden={false}
        title="Falta afinar"
        onHide={vi.fn()}
        onShow={vi.fn()}
        actions={makeActions()}
        reviewPanel={<div>Detalle del kit</div>}
      />
    )
    expect(screen.getByText('Falta afinar')).toBeTruthy()
    expect(screen.queryByText('Primero el kit')).toBeNull()
    expect((screen.getByRole('button', { name: 'Guiones' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps Guiones/Post/Foto/Pack fully labeled when the named Falta chip is long', () => {
    render(
      <ChatComposerCreateDock
        language="es"
        available
        hidden={false}
        title="Falta: Público, Fuentes"
        onHide={vi.fn()}
        onShow={vi.fn()}
        actions={makeActions()}
        reviewPanel={<div>Detalle del kit</div>}
      />
    )
    expect(screen.getByText('Falta: Público, Fuentes')).toBeTruthy()
    for (const label of ['Guiones', 'Post', 'Foto', 'Pack'] as const) {
      const button = screen.getByRole('button', { name: label })
      expect(button.querySelector('span')?.textContent).toBe(label)
    }
  })

  it('does not ellipsis glass verb labels or the named Falta chip', () => {
    const spanBlock = SHELL_CSS.split('.chat-shell__idle-actions button span {')[1]?.split('}')[0] || ''
    expect(spanBlock).toMatch(/overflow:\s*visible/)
    expect(spanBlock).not.toMatch(/text-overflow:\s*ellipsis/)
    const actionsBlock = SHELL_CSS.split('.chat-shell__idle-actions {')[1]?.split('}')[0] || ''
    expect(actionsBlock).toMatch(/flex:\s*0 0 auto/)
    expect(actionsBlock).not.toMatch(/overflow-x:\s*auto/)
    const titleBlock = SHELL_CSS.split('.chat-shell__idle-kit-title strong {')[1]?.split('}')[0] || ''
    expect(titleBlock).toMatch(/white-space:\s*normal/)
    expect(titleBlock).not.toMatch(/text-overflow:\s*ellipsis/)
    expect(titleBlock).not.toMatch(/white-space:\s*nowrap/)
  })
})
