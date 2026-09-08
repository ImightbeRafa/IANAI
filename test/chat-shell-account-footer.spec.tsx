/** @vitest-environment happy-dom */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '../src/contexts/LanguageContext'

vi.mock('../src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

vi.mock('../src/hooks/useUsageLimits', () => ({
  useUsageLimits: () => ({
    loading: false,
    plan: 'free',
    scriptsUsed: 0,
    scriptsLimit: 10,
    imagesUsed: 0,
    imagesLimit: 1,
    bonusImages: 0,
    descriptionsUsed: 0,
    descriptionsLimit: 10,
    repliesUsed: 0,
    repliesLimit: 10,
    creditsRemaining: 42,
    creditsEnabled: true,
    refresh: () => {},
  }),
  invalidateUsageLimitsCache: vi.fn(),
}))

import ChatSidebar from '../src/features/chat-shell/ChatSidebar'

const SHELL_CSS = readFileSync('src/features/chat-shell/chat-shell.css', 'utf8')

afterEach(cleanup)

beforeEach(() => {
  localStorage.setItem('ai-language', 'es')
})

const longName = 'Rafael González Ortega de los Santos Premium Agency CR'

describe('chat-shell account footer name', () => {
  it('ellipsizes long display names instead of wrapping into a fat multi-line block', () => {
    const nameBlock = SHELL_CSS.split('.chat-shell__user-name-text {')[1]?.split('}')[0] || ''
    expect(nameBlock).toMatch(/overflow:\s*hidden/)
    expect(nameBlock).toMatch(/text-overflow:\s*ellipsis/)
    expect(nameBlock).toMatch(/white-space:\s*nowrap/)
    expect(nameBlock).not.toMatch(/overflow-wrap:\s*anywhere/)
    expect(nameBlock).not.toMatch(/word-break:\s*break-word/)
    expect(nameBlock).not.toMatch(/white-space:\s*normal/)
  })

  it('keeps the long name as a single truncated text node with title for hover', () => {
    render(
      <LanguageProvider>
        <MemoryRouter>
          <ChatSidebar
            displayName={longName}
            initials="RG"
            businesses={[]}
            sessions={[]}
            sessionCounts={{}}
            firstUserPreviews={{}}
            activeBrandId={null}
            activeSessionId={null}
            loadingBusinesses={false}
            loadingSessions={false}
            busy={false}
            error={null}
            notice={null}
            onSelectBrand={() => {}}
            onSelectSession={() => {}}
            onNewChat={() => {}}
            onNewSession={() => {}}
            onNewBrand={() => {}}
            onDeleteSession={async () => {}}
            onDeleteBrand={async () => {}}
            onOpenSettings={() => {}}
            onOpenTour={() => {}}
            onSignOut={() => {}}
          />
        </MemoryRouter>
      </LanguageProvider>
    )

    const name = screen.getByText(longName)
    expect(name.className).toContain('chat-shell__user-name-text')
    expect(name.getAttribute('title')).toBe(longName)
    expect(screen.getByRole('button', { name: 'Cómo funciona' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Configuración' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeTruthy()
    expect(document.querySelectorAll('.chat-shell__user-icons .chat-shell__icon-btn').length).toBe(3)
  })
})
