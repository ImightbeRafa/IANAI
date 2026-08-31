/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatShellBulkDialog from '../src/features/chat-shell/ChatShellBulkDialog'
import { fetchBulkAngles } from '../src/features/chat-shell/chatShellBulk'

afterEach(cleanup)

vi.mock('../src/features/chat-shell/chatShellBulk', () => ({
  clampComposerBulkCount: (value: unknown) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return 10
    return Math.min(25, Math.max(2, Math.round(n)))
  },
  fetchBulkAngles: vi.fn(),
  runBulkCampaignRequest: vi.fn(),
  runBulkScriptsRequest: vi.fn(),
}))

describe('ChatShellBulkDialog Pack sheet', () => {
  it('titles the sheet Pack (not Bulk / Pack) with footer Cancel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <ChatShellBulkDialog
        open
        language="es"
        brandId="b1"
        onClose={onClose}
        onDone={vi.fn()}
      />
    )
    expect(screen.getByRole('dialog', { name: 'Pack' })).toBeTruthy()
    expect(screen.queryByText('Bulk / Pack')).toBeNull()
    expect(screen.getByText('Paso 1 de 2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirmar y generar' })).toBeNull()
    const footerCancel = screen.getAllByRole('button', { name: 'Cancelar' })
      .find((btn) => btn.className.includes('chat-shell__modal-btn'))
    expect(footerCancel).toBeTruthy()
    await user.click(footerCancel!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows credits with Confirmar y generar on step 2 and footer Atrás · Cancelar · primary', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchBulkAngles).mockResolvedValueOnce({
      brandId: 'b1',
      offerId: 'o1',
      count: 2,
      source: 'fallback',
      styleDnas: [],
      angles: [
        { id: 'a1', title: 'A1', niche: 'n', whyItBuys: 'w', hookStyle: 'h', frameworkHint: 'f' },
        { id: 'a2', title: 'A2', niche: 'n', whyItBuys: 'w', hookStyle: 'h', frameworkHint: 'f' },
      ],
      quoteScripts: { totalCredits: 6, note: 'max' },
      quotePosts: { totalCredits: 12, note: 'max' },
      quoteCampaign: { totalCredits: 18, note: 'max' },
    })

    render(
      <ChatShellBulkDialog
        open
        language="es"
        brandId="b1"
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Proponer ángulos' }))
    await waitFor(() => expect(screen.getByText('Paso 2 de 2')).toBeTruthy())
    expect(screen.getByText(/Cotización máxima:\s*6/)).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Confirmar y generar' })
    expect(confirm).toBeTruthy()
    const footer = confirm.closest('.chat-shell__modal-actions')
    const labels = Array.from(footer?.querySelectorAll('button') || []).map((btn) => btn.textContent)
    expect(labels[0]).toBe('Atrás')
    expect(labels[1]).toBe('Cancelar')
    expect(labels[labels.length - 1]).toBe('Confirmar y generar')
  })
})
