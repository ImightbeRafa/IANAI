import { useEffect, useState } from 'react'
import { Menu, PanelRight } from 'lucide-react'
import ChatSidebar from './ChatSidebar'
import ChatThread from './ChatThread'
import ChatContextRail, { type RailTab } from './ChatContextRail'
import ThemeToggle from './ThemeToggle'
import type { ChatShellTheme } from './chatShellTheme'
import { useChatShellWorkspace } from './useChatShellWorkspace'

interface ChatShellProps {
  theme: ChatShellTheme
  onToggleTheme: () => void
  displayName: string
  initials: string
  userId: string
}

export default function ChatShell({
  theme,
  onToggleTheme,
  displayName,
  initials,
  userId,
}: ChatShellProps) {
  const [navOpen, setNavOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(true)
  const [railTab, setRailTab] = useState<RailTab>('context')
  const workspace = useChatShellWorkspace(userId)

  const createSession = workspace.createSession

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavOpen(false)
        setRailOpen(false)
      }
      if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        void createSession()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createSession])

  const selectRailTab = (tab: RailTab) => {
    if (railOpen && railTab === tab) {
      setRailOpen(false)
      return
    }
    setRailTab(tab)
    setRailOpen(true)
  }

  const shellClass = [
    'chat-shell',
    navOpen ? 'is-nav-open' : '',
    railOpen ? 'is-rail-open' : '',
  ].filter(Boolean).join(' ')

  const crumbs = [
    workspace.activeBrand?.name || 'No brand',
    workspace.activeSession?.title || 'No session',
  ].join(' / ')

  return (
    <div className={shellClass} data-theme={theme}>
      {navOpen && (
        <button
          type="button"
          className="chat-shell__drawer-backdrop"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}

      <ChatSidebar
        displayName={displayName}
        initials={initials}
        businesses={workspace.businesses}
        sessions={workspace.sessions}
        activeBrandId={workspace.activeBrandId}
        activeSessionId={workspace.activeSessionId}
        loadingBusinesses={workspace.loadingBusinesses}
        loadingSessions={workspace.loadingSessions}
        busy={workspace.busy}
        error={workspace.error}
        notice={workspace.notice}
        onSelectBrand={workspace.selectBrand}
        onSelectSession={workspace.selectSession}
        onNewChat={() => void workspace.createSession()}
        onQuickGenerate={() => void workspace.createQuickSession()}
        onNewSession={() => void workspace.createSession()}
      />

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
            <div className="chat-shell__crumbs">{crumbs}</div>
            <span className="chat-shell__style-tag">
              Style · C · Obsidian {theme === 'obsidian-dark' ? 'electric' : 'daylight'}
            </span>
          </div>
          <div className="chat-shell__topbar-pills" role="tablist" aria-label="Stage panels">
            <button
              type="button"
              className={`chat-shell__top-pill${railOpen && railTab === 'context' ? ' is-on' : ''}`}
              aria-pressed={railOpen && railTab === 'context'}
              onClick={() => selectRailTab('context')}
            >
              Context
            </button>
            <button
              type="button"
              className={`chat-shell__top-pill${railOpen && railTab === 'offers' ? ' is-on' : ''}`}
              aria-pressed={railOpen && railTab === 'offers'}
              onClick={() => selectRailTab('offers')}
            >
              Offers <span className="chat-shell__count">0</span>
            </button>
            <button
              type="button"
              className={`chat-shell__top-pill${railOpen && railTab === 'images' ? ' is-on' : ''}`}
              aria-pressed={railOpen && railTab === 'images'}
              onClick={() => selectRailTab('images')}
            >
              Images <span className="chat-shell__count">0</span>
            </button>
          </div>
          <div className="chat-shell__topbar-actions">
            <button
              type="button"
              className="chat-shell__icon-btn chat-shell__rail-toggle"
              aria-label={railOpen ? 'Close context rail' : 'Open context rail'}
              aria-pressed={railOpen}
              onClick={() => setRailOpen((open) => !open)}
            >
              <PanelRight size={16} />
            </button>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
        </header>
        <ChatThread brand={workspace.activeBrand} session={workspace.activeSession} />
      </section>

      <ChatContextRail
        tab={railTab}
        onTabChange={setRailTab}
        onClose={() => setRailOpen(false)}
        brand={workspace.activeBrand}
        session={workspace.activeSession}
      />
    </div>
  )
}
