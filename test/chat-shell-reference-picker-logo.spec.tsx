/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatShellReferencePicker from '../src/features/chat-shell/ChatShellReferencePicker'

afterEach(cleanup)

describe('ChatShellReferencePicker Subir logo', () => {
  it('shows Subir logo on the refs rail with empty-state copy mentioning logo', async () => {
    const user = userEvent.setup()
    const onUpload = vi.fn()
    render(
      <ChatShellReferencePicker
        images={[]}
        currentProductId="p1"
        language="es"
        onToggle={vi.fn()}
        onUpload={onUpload}
      />
    )
    expect(screen.getByText(/Subí producto, escena, estilo o logo/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Subir producto' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Subir escena' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Subir estilo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Subir logo' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Subir logo' }))
  })
})
