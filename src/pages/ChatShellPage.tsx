import { useEffect, useLayoutEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import ChatShell from '../features/chat-shell/ChatShell'
import ChatShellGate from '../features/chat-shell/ChatShellGate'
import ChatShellWelcomeGiftModal from '../features/chat-shell/ChatShellWelcomeGiftModal'
import {
  ensureChatShellOpenGift,
  markChatShellTourDoneClient,
  markChatShellWelcomeSeenClient,
  type ChatShellOpenEnsureResult,
} from '../features/chat-shell/chatShellOpenApi'
import { invalidateUsageLimitsCache } from '../hooks/useUsageLimits'
import {
  applyChatShellTheme,
  clearChatShellTheme,
  getInitialChatShellTheme,
  persistChatShellTheme,
  type ChatShellTheme,
} from '../features/chat-shell/chatShellTheme'
import { useChatShellRollout } from '../features/chat-shell/ChatShellRolloutContext'
import '../features/chat-shell/chat-shell.css'
import '../features/chat-shell/chat-shell-feature-modals.css'

function displayNameFromUser(email?: string | null, fullName?: string | null): string {
  if (fullName && fullName.trim()) return fullName.trim()
  if (email) return email.split('@')[0] || 'Usuario'
  return 'Usuario'
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

type OnboardingPhase = 'loading' | 'gift' | 'done'

export default function ChatShellPage() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const { loading, canAccessChat, killSwitch, refresh } = useChatShellRollout()
  const [theme, setTheme] = useState<ChatShellTheme>(() => getInitialChatShellTheme())
  const [gift, setGift] = useState<ChatShellOpenEnsureResult | null>(null)
  const [phase, setPhase] = useState<OnboardingPhase>('loading')

  useLayoutEffect(() => {
    applyChatShellTheme(theme)
    return () => {
      clearChatShellTheme()
    }
  }, [theme])

  useEffect(() => {
    if (!canAccessChat || !user?.id) return
    let cancelled = false
    setPhase('loading')
    void ensureChatShellOpenGift()
      .then((result) => {
        if (cancelled) return
        setGift(result)
        if (result.granted || result.creditsRemaining > 0) {
          invalidateUsageLimitsCache()
        }
        if (result.tourDone) {
          setPhase('done')
          return
        }
        if (result.granted || result.showWelcome) {
          setPhase('gift')
          return
        }
        // First-run chrome is the empty composer CTA ("Empezá por tu marca") — not a multi-step tour.
        setPhase('done')
      })
      .catch((err) => {
        console.error('chat-shell open gift', err)
        if (!cancelled) setPhase('done')
      })
    return () => {
      cancelled = true
    }
  }, [canAccessChat, user?.id])

  const applyTheme = (next: ChatShellTheme) => {
    persistChatShellTheme(next)
    applyChatShellTheme(next)
    setTheme(next)
  }

  const toggleTheme = () => {
    applyTheme(theme === 'obsidian-dark' ? 'obsidian-light' : 'obsidian-dark')
  }

  const dismissGift = (_continueToTour: boolean) => {
    // Skip multi-step tour — empty composer CTA covers first-run.
    setPhase('done')
    void markChatShellWelcomeSeenClient().catch((err) => console.error(err))
    void markChatShellTourDoneClient().catch((err) => console.error(err))
  }

  const metaName =
    (typeof user?.user_metadata?.full_name === 'string' && user.user_metadata.full_name)
    || (typeof user?.user_metadata?.name === 'string' && user.user_metadata.name)
    || null
  const displayName = displayNameFromUser(user?.email, metaName)
  const initials = initialsFromName(displayName)
  const lang = language === 'en' ? 'en' : 'es'

  if (loading) {
    return (
      <div className="chat-shell__loading" data-theme={theme} aria-busy="true">
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="chat-shell__spinner" />
          Cargando chat…
        </div>
      </div>
    )
  }

  if (!canAccessChat) {
    const reason =
      killSwitch === 'unreadable'
        ? 'unreadable'
        : killSwitch === 'enabled'
          ? 'invite'
          : 'disabled'
    return (
      <ChatShellGate
        onRetry={refresh}
        theme={theme}
        onToggleTheme={toggleTheme}
        reason={reason}
      />
    )
  }

  if (!user) {
    return (
      <div className="chat-shell__loading" data-theme={theme} aria-busy="true">
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="chat-shell__spinner" />
          Cargando sesión…
        </div>
      </div>
    )
  }

  return (
    <>
      <ChatShell
        theme={theme}
        onThemeChange={applyTheme}
        displayName={displayName}
        initials={initials}
        userId={user.id}
      />
      {phase === 'gift' && gift ? (
        <ChatShellWelcomeGiftModal
          credits={gift.credits || 100}
          granted={gift.granted}
          language={lang}
          onContinue={() => dismissGift(true)}
          onDismiss={() => dismissGift(false)}
        />
      ) : null}
    </>
  )
}
