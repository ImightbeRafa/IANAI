// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatThread from '../src/features/chat-shell/ChatThread'
import type { ChatSession, Message } from '../src/types'

const session: ChatSession = {
  id: 'sess-1',
  user_id: 'u1',
  business_id: 'b1',
  title: 'Test',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

const emptyMessages: Message[] = []

describe('ChatThread composer attachments', () => {
  afterEach(() => {
    cleanup()
  })

  it('stages picked images as typed chips and sends them with the NL text', async () => {
    const onSend = vi.fn(async () => undefined)
    const { container } = render(
      <ChatThread
        brand={null}
        session={session}
        messages={emptyMessages}
        loadingMessages={false}
        sending={false}
        savingScript={false}
        activeProduct={null}
        offerProductId="prod-1"
        offerCount={1}
        latestImagesByOffer={new Map()}
        imageBusy={false}
        error={null}
        notice={null}
        failedBatch={null}
        onRetryFailedOffers={() => {}}
        language="es"
        onSend={onSend}
        onSaveScript={async () => null}
        onEditScript={async () => ''}
        onSaveVersion={async () => null}
        onOpenOfferImage={() => {}}
        onEditOfferImage={async () => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /adjuntar/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /producto/i }))

    const fileInput = container.querySelector(
      'input[type="file"][accept*="image/png"][multiple]'
    ) as HTMLInputElement
    expect(fileInput).toBeTruthy()
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'xyz-producto.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('Producto')).toBeTruthy()
      expect(screen.getByText('xyz-producto.png')).toBeTruthy()
    })

    fireEvent.click(screen.getByTitle(/tocá para cambiar tipo/i))
    expect(screen.getByText('Logo')).toBeTruthy()
    fireEvent.click(screen.getByTitle(/tocá para cambiar tipo/i))
    expect(screen.getByText('Contexto')).toBeTruthy()
    fireEvent.click(screen.getByTitle(/tocá para cambiar tipo/i))
    expect(screen.getByText('Producto')).toBeTruthy()

    const textarea = screen.getByRole('textbox', { name: /escribir mensaje/i })
    fireEvent.change(textarea, {
      target: {
        value: 'Generame 5 post para XYZ. CTA Mensajes.',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }))

    await waitFor(() => {
      expect(onSend).toHaveBeenCalled()
    })
    const [text, attachments] = onSend.mock.calls[0]
    expect(text).toMatch(/Generame 5 post/i)
    expect(attachments).toHaveLength(1)
    expect(attachments[0].role).toBe('product')
    expect(attachments[0].name).toBe('xyz-producto.png')
    expect(String(attachments[0].dataUrl)).toMatch(/^data:/)
  })
})
