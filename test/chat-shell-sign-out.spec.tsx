/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '../src/contexts/LanguageContext'
import { signOutFromChatShell } from '../src/features/chat-shell/chatShellSignOut'
import { resolveProtectedRoute } from '../src/lib/protectedRouteGate'

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
    creditsRemaining: 0,
    creditsEnabled: false,
    refresh: () => {},
  }),
  invalidateUsageLimitsCache: vi.fn(),
}))

import ChatSidebar from '../src/features/chat-shell/ChatSidebar'

afterEach(cleanup)

beforeEach(() => {
  localStorage.setItem('ai-language', 'es')
})

const emptySidebarProps = {
  displayName: 'Rafa',
  initials: 'RA',
  businesses: [],
  sessions: [],
  sessionCounts: {},
  firstUserPreviews: {},
  activeBrandId: null,
  activeSessionId: null,
  loadingBusinesses: false,
  loadingSessions: false,
  busy: false,
  error: null,
  notice: null,
  onSelectBrand: () => {},
  onSelectSession: () => {},
  onNewChat: () => {},
  onNewSession: () => {},
  onNewBrand: () => {},
  onDeleteSession: async () => {},
  onDeleteBrand: async () => {},
  onOpenSettings: () => {},
}

/**
 * Harness mirrors /chat account footer → AuthContext.signOut → /login.
 * Asserts the literal observed result (logged-out destination), not that a mock ran.
 */
function ChatShellSignOutHarness() {
  const [user, setUser] = useState<{ id: string } | null>({ id: 'user-1' })
  const [path, setPath] = useState('/chat')

  if (!user) {
    return <div data-testid="signed-out-landing">Logged out at {path}</div>
  }

  return (
    <LanguageProvider>
      <MemoryRouter>
        <ChatSidebar
          {...emptySidebarProps}
          onSignOut={() => {
            void signOutFromChatShell({
              signOut: async () => {
                setUser(null)
              },
              navigate: (to) => setPath(to),
            })
          }}
        />
      </MemoryRouter>
    </LanguageProvider>
  )
}

describe('chat-shell Cerrar sesión', () => {
  it('clears the session then lands on /login (same path as classic Layout)', async () => {
    let session: { id: string } | null = { id: 'sess-1' }
    let location = '/chat'

    await signOutFromChatShell({
      signOut: async () => {
        session = null
      },
      navigate: (to) => {
        location = to
      },
    })

    expect(session).toBeNull()
    expect(location).toBe('/login')
    expect(
      resolveProtectedRoute({
        loading: false,
        user: session,
        isAdmin: false,
        adminResolved: true,
      })
    ).toBe('login')
  })

  it('from the sidebar account footer: Cerrar sesión → logged out at /login', async () => {
    const user = userEvent.setup()
    render(<ChatShellSignOutHarness />)

    expect(screen.queryByTestId('signed-out-landing')).toBeNull()
    const button = screen.getByRole('button', { name: 'Cerrar sesión' })
    expect(button).toBeTruthy()

    await user.click(button)

    await waitFor(() => {
      expect(screen.getByTestId('signed-out-landing').textContent).toBe('Logged out at /login')
    })
  })
})
