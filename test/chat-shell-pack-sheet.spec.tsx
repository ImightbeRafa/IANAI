/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatShellBulkDialog from '../src/features/chat-shell/ChatShellBulkDialog'

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
    const footerCancel = screen.getAllByRole('button', { name: 'Cancelar' })
      .find((btn) => btn.className.includes('chat-shell__modal-btn'))
    expect(footerCancel).toBeTruthy()
    await user.click(footerCancel!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
