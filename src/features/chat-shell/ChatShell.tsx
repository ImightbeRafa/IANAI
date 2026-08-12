import { useEffect, useState } from 'react'
import { Menu, PanelRight } from 'lucide-react'
import ChatSidebar from './ChatSidebar'
import ChatThread from './ChatThread'
import ChatContextRail from './ChatContextRail'
import ThemeToggle from './ThemeToggle'
import type { ChatShellTheme } from './chatShellTheme'

interface ChatShellProps {
  theme: ChatShellTheme
  onToggleTheme: () => void
  displayName: string
  initials: string
}

export default function ChatShell({
  theme,
  onToggleTheme,
  displayName,
  initials,
}: ChatShellProps) {
  const [navOpen, setNavOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavOpen(false)
        setRailOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const shellClass = [
    'chat-shell',
    navOpen ? 'is-nav-open' : '',
    railOpen ? 'is-rail-open' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={shellClass} data-theme={theme}>
      {(navOpen || railOpen) && (
        <button
          type="button"
          className="chat-shell__drawer-backdrop"
          aria-label="Close panels"
          onClick={() => {
            setNavOpen(false)
            setRailOpen(false)
          }}
        />
      )}

      <ChatSidebar displayName={displayName} initials={initials} />

      <section className="chat-shell__main">
        <header className="chat-shell__topbar">
          <div className="chat-shell__mobile-bar">
            <button
              type="button"
              className="chat-shell__icon-btn"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={16} />
            </button>
          </div>
          <div className="chat-shell__crumbs">PatchHouse.CR / Scripts + creatives</div>
          <div className="chat-shell__style-tag">
            Style · Obsidian {theme === 'obsidian-dark' ? 'electric' : 'daylight'} · foundation
          </div>
          <div style={{ display: 'flex', gap: 8, justifySelf: 'end', alignItems: 'center' }}>
            <button
              type="button"
              className="chat-shell__icon-btn chat-shell__rail-toggle"
              aria-label="Open images rail"
              onClick={() => setRailOpen(true)}
            >
              <PanelRight size={16} />
            </button>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
        </header>
        <ChatThread />
      </section>

      <ChatContextRail />
    </div>
  )
}
