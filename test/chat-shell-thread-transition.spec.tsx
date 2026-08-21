/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import ChatThread from '../src/features/chat-shell/ChatThread'
import type { Business, ChatSession, Message } from '../src/types'

afterEach(cleanup)

const brand: Business = {
  id: 'b1',
  owner_id: 'u1',
  name: 'ForgeCR',
  sales_channels: ['messages'],
  does_shipping: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const session: ChatSession = {
  id: 's2',
  user_id: 'u1',
  business_id: 'b1',
  product_id: null,
  title: 'Arnés ForgeCR',
  context: '',
  primary_channel: 'messages',
  awareness_level: null,
  status: 'active',
  framework: 'venta_directa',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const staleMessages: Message[] = [
  {
    id: 'm1',
    session_id: 's1',
    role: 'user',
    content: 'Crear post desde guión.',
    created_at: '2026-01-01T00:00:00Z',
  },
]

function renderThread(overrides: Partial<Parameters<typeof ChatThread>[0]> = {}) {
  const noop = vi.fn()
  const asyncNoop = vi.fn(async () => '')
  render(
    <ChatThread
      brand={brand}
      session={session}
      messages={staleMessages}
      loadingMessages={false}
      sending={false}
      savingScript={false}
      activeProduct={null}
      offerProductId={null}
      offerCount={0}
      latestImagesByOffer={new Map()}
      imageBusy={false}
      error={null}
      notice={null}
      failedBatch={null}
      onRetryFailedOffers={noop}
      onSend={noop}
      onSaveScript={asyncNoop}
      onEditScript={asyncNoop}
      onSaveVersion={asyncNoop}
      onOpenOfferImage={noop}
      onEditOfferImage={asyncNoop}
      language="es"
      {...overrides}
    />
  )
}

describe('ChatThread folder transitions', () => {
  it('keeps the previous transcript mounted while the next session loads', () => {
    renderThread({ loadingMessages: true, session })
    expect(screen.getByText('Crear post desde guión.')).toBeTruthy()
    expect(screen.getByText('Cargando conversación…')).toBeTruthy()
    expect(screen.getByRole('log').getAttribute('aria-busy')).toBe('true')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('does not blank an idle thread with a loading placeholder', () => {
    renderThread({ loadingMessages: false })
    expect(screen.getByText('Crear post desde guión.')).toBeTruthy()
    expect(screen.queryByText('Cargando conversación…')).toBeNull()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false)
  })

  it('shows the initial loader only when there is nothing to keep on screen', () => {
    renderThread({ loadingMessages: true, messages: [] })
    expect(screen.getByText('Cargando conversación…')).toBeTruthy()
    expect(screen.queryByText('Crear post desde guión.')).toBeNull()
  })
})
