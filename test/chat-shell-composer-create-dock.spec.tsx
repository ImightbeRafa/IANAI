/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatComposerCreateDock from '../src/features/chat-shell/ChatComposerCreateDock'

afterEach(cleanup)

describe('ChatComposerCreateDock', () => {
  it('keeps create and hide on the composer, and opens the panel without a chat card', async () => {
    const user = userEvent.setup()
    const onHide = vi.fn()
    const onShow = vi.fn()
    render(
      <ChatComposerCreateDock
        language="es"
        available
        hidden={false}
        onHide={onHide}
        onShow={onShow}
        panel={<div>Brand Kit listo</div>}
      />
    )
    expect(screen.queryByText('Brand Kit listo')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(screen.getByText('Brand Kit listo')).toBeTruthy()
    expect(screen.queryByText('Ocultar')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Ocultar widget de crear' }))
    expect(onHide).toHaveBeenCalledTimes(1)
    expect(onShow).not.toHaveBeenCalled()
  })

  it('restores the dock from a single composer icon when hidden', async () => {
    const user = userEvent.setup()
    const onShow = vi.fn()
    render(
      <ChatComposerCreateDock
        language="es"
        available
        hidden
        onHide={vi.fn()}
        onShow={onShow}
        panel={<div>Brand Kit listo</div>}
      />
    )
    expect(screen.queryByRole('button', { name: 'Crear' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Mostrar crear' }))
    expect(onShow).toHaveBeenCalledTimes(1)
  })
})
