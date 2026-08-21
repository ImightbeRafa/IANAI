// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatShellImageCard from '../src/features/chat-shell/ChatShellImageCard'
import type { MessageArtifact } from '../src/types'

vi.mock('../src/features/chat-shell/chatShellDownload', () => ({
  downloadShellImage: vi.fn(async () => {}),
  filenameForShellImage: () => 'ForgeCR.webp',
}))

function image(id: string, createdAt: string) {
  return {
    id,
    product_id: 'offer-a',
    image_url: `https://cdn.example/${id}.webp`,
    label: id,
    kind: 'generated' as const,
    created_at: createdAt,
  }
}

describe('ChatShellImageCard workspaces', () => {
  afterEach(() => {
    cleanup()
  })

  it('lets you switch versions on one workspace instead of dumping every generate together', () => {
    const onOpen = vi.fn()
    const artifact = {
      id: 'art-1',
      artifact_type: 'image',
      ordinal: 1,
      product_id: 'offer-a',
      product_image: image('gen-1', '2026-01-01T00:00:00.000Z'),
      action_metadata: { assumptions: 'Venta directa · 9:16' },
    } as MessageArtifact

    render(
      <ChatShellImageCard
        artifact={artifact}
        productName="ForgeCR"
        language="es"
        versions={[
          image('gen-1', '2026-01-01T00:00:00.000Z'),
          image('edit-1', '2026-01-02T00:00:00.000Z'),
        ]}
        onOpen={onOpen}
      />
    )

    expect(screen.getByRole('button', { name: 'Original' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Última' })).toBeTruthy()
    const shot = screen.getByAltText('edit-1') as HTMLImageElement
    expect(shot.src).toContain('edit-1.webp')
    fireEvent.click(screen.getByRole('button', { name: 'Original' }))
    expect((screen.getByAltText('gen-1') as HTMLImageElement).src).toContain('gen-1.webp')
    fireEvent.click(screen.getByRole('button', { name: /ver imagen/i }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'gen-1' }))
  })
})
