/** @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LanguageProvider } from '../src/contexts/LanguageContext'
import type { ChatShellOpenEnsureResult } from '../src/features/chat-shell/chatShellOpenApi'
import type { ChatShellKillSwitch } from '../src/features/chat-shell/chatShellRollout'

const ensureGift = vi.fn()
const authState: { user: { id: string; email: string; user_metadata: Record<string, unknown> } | null } = {
  user: { id: 'u1', email: 'qa@example.com', user_metadata: {} },
}
const rolloutState = {
  loading: false,
  canAccessChat: true,
  killSwitch: 'enabled' as ChatShellKillSwitch,
  refresh: vi.fn(),
}

vi.mock('../src/contexts/AuthContext', () => ({
  useAuth: () => authState,
}))

vi.mock('../src/features/chat-shell/ChatShellRolloutContext', () => ({
  useChatShellRollout: () => rolloutState,
}))

vi.mock('../src/features/chat-shell/ChatShell', () => ({
  default: () => <div data-testid="chat-shell-stub">shell</div>,
}))

vi.mock('../src/features/chat-shell/chatShellOpenApi', () => ({
  ensureChatShellOpenGift: (...args: unknown[]) => ensureGift(...args),
  markChatShellTourDoneClient: vi.fn(async () => true),
  markChatShellWelcomeSeenClient: vi.fn(async () => true),
}))

vi.mock('../src/hooks/useUsageLimits', () => ({
  invalidateUsageLimitsCache: vi.fn(),
}))

import ChatShellPage from '../src/pages/ChatShellPage'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  authState.user = { id: 'u1', email: 'qa@example.com', user_metadata: {} }
  rolloutState.loading = false
  rolloutState.canAccessChat = true
  rolloutState.killSwitch = 'enabled'
  localStorage.setItem('ai-language', 'es')
})

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <ChatShellPage />
      </MemoryRouter>
    </LanguageProvider>
  )
}

const openOk = (overrides: Partial<ChatShellOpenEnsureResult> = {}): ChatShellOpenEnsureResult => ({
  ok: true,
  granted: false,
  already: false,
  credits: 100,
  creditsRemaining: 0,
  showWelcome: false,
  tourDone: false,
  ...overrides,
})

describe('ChatShellPage onboarding mount', () => {
  it('mounts the tour wizard when first-open gift fails (must not skip to done)', async () => {
    ensureGift.mockRejectedValue(new Error('open failed'))
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Un chat para todo' })).toBeTruthy()
    })
    expect(screen.getByTestId('chat-shell-stub')).toBeTruthy()
  })

  it('mounts the tour wizard on first open when gift is skipped (Preview fail-closed)', async () => {
    ensureGift.mockResolvedValue(openOk({ tourDone: false, granted: false, showWelcome: false }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Un chat para todo' })).toBeTruthy()
    })
  })

  it('does not mount the wizard when tour is already done', async () => {
    ensureGift.mockResolvedValue(openOk({ tourDone: true }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('chat-shell-stub')).toBeTruthy()
    })
    expect(screen.queryByRole('dialog', { name: 'Un chat para todo' })).toBeNull()
  })

  it('shows kill-switch copy, never invite copy, when chat is off', () => {
    rolloutState.canAccessChat = false
    rolloutState.killSwitch = 'disabled'
    renderPage()
    expect(screen.getByRole('heading', { name: 'Chat aún no está habilitado' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Chat es por invitación' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Un chat para todo' })).toBeNull()
  })
})
