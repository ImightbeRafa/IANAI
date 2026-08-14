import { useLayoutEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import ChatShell from '../features/chat-shell/ChatShell'
import ChatShellGate from '../features/chat-shell/ChatShellGate'
import {
  applyChatShellTheme,
  clearChatShellTheme,
  getInitialChatShellTheme,
  persistChatShellTheme,
  type ChatShellTheme,
} from '../features/chat-shell/chatShellTheme'
import { useChatShellRollout } from '../features/chat-shell/ChatShellRolloutContext'
import '../features/chat-shell/chat-shell.css'

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

export default function ChatShellPage() {
  const { user } = useAuth()
  const { loading, canAccessChat, killSwitch, refresh } = useChatShellRollout()
  const [theme, setTheme] = useState<ChatShellTheme>(() => getInitialChatShellTheme())

  useLayoutEffect(() => {
    applyChatShellTheme(theme)
    return () => {
      clearChatShellTheme()
    }
  }, [theme])

  const applyTheme = (next: ChatShellTheme) => {
    persistChatShellTheme(next)
    applyChatShellTheme(next)
    setTheme(next)
  }

  const toggleTheme = () => {
    applyTheme(theme === 'obsidian-dark' ? 'obsidian-light' : 'obsidian-dark')
  }

  const metaName =
    (typeof user?.user_metadata?.full_name === 'string' && user.user_metadata.full_name)
    || (typeof user?.user_metadata?.name === 'string' && user.user_metadata.name)
    || null
  const displayName = displayNameFromUser(user?.email, metaName)
  const initials = initialsFromName(displayName)

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
    <ChatShell
      theme={theme}
      onThemeChange={applyTheme}
      displayName={displayName}
      initials={initials}
      userId={user.id}
    />
  )
}
