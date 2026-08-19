/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatBrandProfileCard from '../src/features/chat-shell/ChatBrandProfileCard'
import { emptySetupFacts } from '../src/features/chat-shell/chatShellBrandSetupFlow'
import { dedupeLegacySetupSummaries } from '../src/features/chat-shell/ChatThread'
import type { Message } from '../src/types'

afterEach(cleanup)

function renderCard(overrides: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const onSave = vi.fn(async () => true)
  const onCreateScripts = vi.fn()
  const onCreatePost = vi.fn()
  const onHide = vi.fn()
  const facts = {
    ...emptySetupFacts('Forge'),
    offerName: 'Arnés Forge',
    product_description: 'Corrector postural',
    sourceUrl: 'https://forge.example',
    salesChannels: ['website'] as const,
    ...overrides,
  }
  render(
    <ChatBrandProfileCard
      language="es"
      facts={facts}
      onSave={onSave}
      onUpload={vi.fn()}
      onCreateScripts={onCreateScripts}
      onCreatePost={onCreatePost}
      onCreateProductPhoto={vi.fn()}
      onCreateOther={vi.fn()}
      onHide={onHide}
      {...props}
    />
  )
  return { onSave, onCreateScripts, onCreatePost, onHide }
}

describe('ChatBrandProfileCard', () => {
  it('hides an identical legacy setup summary even when a user reply sits between copies', () => {
    const base = {
      session_id: 's1',
      created_at: '2026-01-01T00:00:00Z',
    }
    const messages: Message[] = [
      { ...base, id: 'a1', role: 'assistant', content: 'Armé este resumen con lo que me diste\n• Oferta: Arnés' },
      { ...base, id: 'u1', role: 'user', content: 'coorrecto' },
      { ...base, id: 'a2', role: 'assistant', content: 'Armé este resumen con lo que me diste\n• Oferta: Arnés' },
    ]
    expect(dedupeLegacySetupSummaries(messages).map((message) => message.id)).toEqual(['a1', 'u1'])
  })

  it('keeps only the first welcome, even if HMR or reload persisted another copy', () => {
    const base = {
      session_id: 's1',
      created_at: '2026-01-01T00:00:00Z',
    }
    const messages: Message[] = [
      { ...base, id: 'w1', role: 'assistant', content: '¡Hola! Bienvenido a Advance AI. Compartí logos.' },
      { ...base, id: 'u1', role: 'user', content: 'https://www.forge.shopping/' },
      { ...base, id: 'w2', role: 'assistant', content: '¡Hola! Bienvenido a Advance AI. Compartí logos.' },
    ]
    expect(dedupeLegacySetupSummaries(messages).map((message) => message.id)).toEqual(['w1', 'u1'])
  })

  it('starts compact and reveals the context source and missing brand areas on request', async () => {
    const user = userEvent.setup()
    renderCard()
    expect(screen.queryByText('Web analizada')).toBeNull()
    expect(screen.getByText(/Forge$/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Revisar/i }))
    expect(screen.getByText('Web analizada')).toBeTruthy()
    expect(screen.getAllByText('Falta afinar').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Público' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Voz de marca' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Identidad visual' })).toBeTruthy()
  })

  it('edits the profile inline and confirms the complete draft', async () => {
    const user = userEvent.setup()
    const { onSave } = renderCard({ icp: 'atletas', brand_voice: 'directa' })
    await user.click(screen.getByRole('button', { name: /Revisar/i }))
    await user.click(screen.getByRole('button', { name: /Editar/i }))
    const audience = screen.getByLabelText('Cliente ideal')
    await user.clear(audience)
    await user.type(audience, 'atletas y profesionales de oficina')
    await user.click(screen.getByRole('button', { name: 'Confirmar y empezar a crear' }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        businessName: 'Forge',
        offerName: 'Arnés Forge',
        icp: 'atletas y profesionales de oficina',
      }),
      true
    )
  })

  it('shows the logo and next-step actions on the compact card', () => {
    renderCard({ logo_url: 'https://cdn.example/logo.png', primary_color: '#111111' })
    const logo = screen.getByRole('img', { name: 'Logo oficial' }) as HTMLImageElement
    expect(logo.getAttribute('src')).toBe('https://cdn.example/logo.png')
    expect(screen.getByText('¿Qué hacemos primero?')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Crear guiones/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Crear post/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Foto de producto/i })).toBeTruthy()
  })

  it('marks the active create path on the brand kit actions', () => {
    renderCard({ logo_url: 'https://cdn.example/logo.png' }, { activeCreateAction: 'post' })
    expect(screen.getByRole('button', { name: /Crear post/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Crear guiones/i }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: /Foto de producto/i }).getAttribute('aria-pressed')).toBe('false')
  })

  it('confirms the brand then starts scripts from the compact card', async () => {
    const user = userEvent.setup()
    const { onSave, onCreateScripts } = renderCard()
    await user.click(screen.getByRole('button', { name: /Crear guiones/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ offerName: 'Arnés Forge' }), true)
    expect(onCreateScripts).toHaveBeenCalledTimes(1)
  })

  it('lets the user hide the create widget without running setup', async () => {
    const user = userEvent.setup()
    const { onHide, onCreateScripts } = renderCard()
    await user.click(screen.getByRole('button', { name: 'Ocultar' }))
    expect(onHide).toHaveBeenCalledTimes(1)
    expect(onCreateScripts).not.toHaveBeenCalled()
  })
})
