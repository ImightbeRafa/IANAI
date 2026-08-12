import { useEffect, useState } from 'react'
import { Menu, PanelRight } from 'lucide-react'
import ChatSidebar from './ChatSidebar'
import ChatThread from './ChatThread'
import ChatContextRail, { type RailTab } from './ChatContextRail'
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
  const [railTab, setRailTab] = useState<RailTab>('images')

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

  const openRailTab = (tab: RailTab) => {
    setRailTab(tab)
    setRailOpen(true)
  }

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
          <div className="chat-shell__topbar-left">
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
            <span className="chat-shell__style-tag">
              Style · C · Obsidian {theme === 'obsidian-dark' ? 'electric' : 'daylight'} · view only
            </span>
          </div>
          <div className="chat-shell__topbar-pills" role="tablist" aria-label="Stage panels">
            <button
              type="button"
              className={`chat-shell__top-pill${railTab === 'context' ? ' is-on' : ''}`}
              onClick={() => openRailTab('context')}
            >
              Context
            </button>
            <button
              type="button"
              className={`chat-shell__top-pill${railTab === 'offers' ? ' is-on' : ''}`}
              onClick={() => openRailTab('offers')}
            >
              Offers <span className="chat-shell__count">2</span>
            </button>
            <button
              type="button"
              className={`chat-shell__top-pill${railTab === 'images' ? ' is-on' : ''}`}
              onClick={() => openRailTab('images')}
            >
              Images <span className="chat-shell__count">3</span>
            </button>
          </div>
          <div className="chat-shell__topbar-actions">
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

      <ChatContextRail tab={railTab} onTabChange={setRailTab} />
    </div>
  )
}
