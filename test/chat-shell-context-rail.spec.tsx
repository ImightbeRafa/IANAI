/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ChatContextRail from '../src/features/chat-shell/ChatContextRail'
import type { Business, ChatSession, Product } from '../src/types'

function incompleteSession(id: string): ChatSession {
  return {
    id,
    user_id: 'u1',
    business_id: 'b1',
    product_id: null,
    title: 'New chat',
    context: 'Oferta: Arnés ForgeCR\nTipo: indumentaria',
    primary_channel: 'messages',
    awareness_level: null,
    status: 'active',
    framework: 'venta_directa',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

const brand: Business = {
  id: 'b1',
  owner_id: 'u1',
  name: 'ForgeCostaRica',
  sales_channels: ['messages', 'website'],
  does_shipping: false,
  icp_description: 'Athletes and office workers',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const offer: Product = {
  id: 'p1',
  name: 'Arnés ForgeCR',
  type: 'indumentaria',
}

describe('ChatContextRail inspector', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows folder facts instead of the old session notes form', () => {
    render(
      <MemoryRouter>
        <ChatContextRail
          tab="context"
          pane="detail"
          onTabChange={() => {}}
          onClose={() => {}}
          brand={brand}
          session={incompleteSession('s1')}
          activeProduct={offer}
          language="en"
        />
      </MemoryRouter>
    )
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(screen.queryByLabelText('Session setup')).toBeNull()
    expect(screen.queryByPlaceholderText('Session notes…')).toBeNull()
    expect(screen.getAllByText('ForgeCostaRica').length).toBeGreaterThan(0)
    expect(screen.getByText('Athletes and office workers')).toBeTruthy()
    expect(screen.getAllByText(/Arnés ForgeCR/).length).toBeGreaterThan(0)
    expect(screen.getByText(/source of truth used by AI/i)).toBeTruthy()
  })

  it('saves chat name on blur', async () => {
    const user = userEvent.setup()
    const onPatchSession = vi.fn()
    render(
      <MemoryRouter>
        <ChatContextRail
          tab="context"
          pane="detail"
          onTabChange={() => {}}
          onClose={() => {}}
          session={incompleteSession('s1')}
          language="en"
          onPatchSession={onPatchSession}
        />
      </MemoryRouter>
    )
    const input = screen.getByDisplayValue('New chat')
    await user.clear(input)
    await user.type(input, 'Forge brief')
    input.blur()
    expect(onPatchSession).toHaveBeenCalledWith({ title: 'Forge brief' })
  })

  it('shows a compact widget of thread items and options', async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    render(
      <MemoryRouter>
        <ChatContextRail
          tab="context"
          pane="index"
          onTabChange={onTabChange}
          onClose={() => {}}
          brand={brand}
          session={incompleteSession('s1')}
          activeProduct={offer}
          language="en"
        />
      </MemoryRouter>
    )
    expect(screen.queryByText('This chat')).toBeNull()
    expect(screen.getByText('Options')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Arnés ForgeCR/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Context' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Offers/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Offers/ }))
    expect(onTabChange).toHaveBeenCalledWith('offers')
  })

  it('still shows options when the thread has no pieces yet', () => {
    render(
      <MemoryRouter>
        <ChatContextRail
          tab="context"
          pane="index"
          onTabChange={() => {}}
          onClose={() => {}}
          language="en"
        />
      </MemoryRouter>
    )
    expect(screen.queryByText('Nothing in this chat yet.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Context' })).toBeTruthy()
  })

  it('lets you delete leftover unassigned products from Offers', async () => {
    const user = userEvent.setup()
    const onDeleteUnassignedProduct = vi.fn()
    const onClearUnassignedProducts = vi.fn()
    const leftover: Product = { id: 'orphan-1', name: 'Arnés ForgeCR', type: 'indumentaria' }
    const leftoverTwo: Product = { id: 'orphan-2', name: 'Arnés ForgeCR', type: 'indumentaria' }
    render(
      <MemoryRouter>
        <ChatContextRail
          tab="offers"
          pane="detail"
          onTabChange={() => {}}
          onClose={() => {}}
          brand={brand}
          session={incompleteSession('s1')}
          unassignedProducts={[leftover, leftoverTwo]}
          onDeleteUnassignedProduct={onDeleteUnassignedProduct}
          onClearUnassignedProducts={onClearUnassignedProducts}
          language="en"
        />
      </MemoryRouter>
    )
    expect(screen.getByText('Unassigned products')).toBeTruthy()
    const deleteButtons = screen.getAllByRole('button', { name: /Delete unassigned product/ })
    await user.click(deleteButtons[0]!)
    expect(onDeleteUnassignedProduct).toHaveBeenCalledWith('orphan-1')
    vi.stubGlobal('confirm', () => true)
    await user.click(screen.getByRole('button', { name: 'Remove all unassigned' }))
    expect(onClearUnassignedProducts).toHaveBeenCalled()
  })

  it('shows the active offer in Offers even when the attached list is empty', () => {
    render(
      <MemoryRouter>
        <ChatContextRail
          tab="offers"
          pane="detail"
          onTabChange={() => {}}
          onClose={() => {}}
          brand={brand}
          session={{ ...incompleteSession('s1'), product_id: offer.id }}
          offers={[]}
          activeProduct={offer}
          language="en"
        />
      </MemoryRouter>
    )
    expect(screen.getByText('Arnés ForgeCR')).toBeTruthy()
    expect(screen.getByText('Primary')).toBeTruthy()
    expect(screen.queryByText('No offers attached yet.')).toBeNull()
  })
})
