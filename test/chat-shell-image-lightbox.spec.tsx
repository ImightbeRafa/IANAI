// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatShellImageLightbox from '../src/features/chat-shell/ChatShellImageLightbox'

describe('ChatShellImageLightbox edit attachments', () => {
  afterEach(() => {
    cleanup()
  })

  it('requires an instruction and accepts image attachments for post edits', () => {
    const onRequestEdit = vi.fn()
    render(
      <ChatShellImageLightbox
        open
        url="https://example.com/post.webp"
        language="es"
        onClose={() => {}}
        onRequestEdit={onRequestEdit}
      />
    )

    expect((screen.getByRole('button', { name: /pedir edición/i }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('¿Qué debería cambiar?'), {
      target: { value: 'Poné el arnés de frente' },
    })
    expect(screen.getByRole('button', { name: /^imagen$/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /pedir edición/i }))
    expect(onRequestEdit).toHaveBeenCalledWith('Poné el arnés de frente', [])
  })

  it('exposes magic enhance and rebuild actions', () => {
    const onQuickEnhance = vi.fn()
    render(
      <ChatShellImageLightbox
        open
        url="https://example.com/post.webp"
        language="es"
        onClose={() => {}}
        onQuickEnhance={onQuickEnhance}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /mejora mágica/i }))
    fireEvent.click(screen.getByRole('button', { name: /reconstruir/i }))
    expect(onQuickEnhance).toHaveBeenNthCalledWith(1, 'magic')
    expect(onQuickEnhance).toHaveBeenNthCalledWith(2, 'rebuild')
    expect(screen.getByRole('button', { name: /descargar/i })).toBeTruthy()
  })
})
