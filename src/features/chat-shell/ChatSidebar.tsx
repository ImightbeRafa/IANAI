import { Link } from 'react-router-dom'
import { Settings, Search, Plus, Zap } from 'lucide-react'
import type { Business, ChatSession } from '../../types'

interface ChatSidebarProps {
  displayName: string
  initials: string
  businesses: Business[]
  sessions: ChatSession[]
  activeBrandId: string | null
  activeSessionId: string | null
  loadingBusinesses: boolean
  loadingSessions: boolean
  busy: boolean
  error: string | null
  notice: string | null
  onSelectBrand: (brandId: string) => void
  onSelectSession: (session: ChatSession) => void
  onNewChat: () => void
  onQuickGenerate: () => void
  onNewSession: () => void
}

export default function ChatSidebar({
  displayName,
  initials,
  businesses,
  sessions,
  activeBrandId,
  activeSessionId,
  loadingBusinesses,
  loadingSessions,
  busy,
  error,
  notice,
  onSelectBrand,
  onSelectSession,
  onNewChat,
  onQuickGenerate,
  onNewSession,
}: ChatSidebarProps) {
  const canCreate = Boolean(activeBrandId) && !busy

  return (
    <aside className="chat-shell__sidebar" aria-label="Chat navigation">
      <div className="chat-shell__brand">
        <span className="chat-shell__wordmark">Advance AI</span>
      </div>

      <div className="chat-shell__row-actions">
        <button
          type="button"
          className="chat-shell__row-action"
          onClick={onNewChat}
          disabled={!canCreate}
          aria-disabled={!canCreate}
          title={activeBrandId ? 'New chat in active brand' : 'Select a brand first'}
        >
          <Plus size={14} aria-hidden />
          <span className="chat-shell__row-action-label">New chat</span>
        </button>
        <div className="chat-shell__search-wrap">
          <label className="chat-shell__sr-only" htmlFor="chat-shell-search">Search</label>
          <Search size={13} className="chat-shell__search-icon" aria-hidden />
          <input
            id="chat-shell-search"
            className="chat-shell__search"
            placeholder="Search..."
            disabled
            aria-disabled="true"
          />
        </div>
      </div>

      {(error || notice) && (
        <div className={`chat-shell__sidebar-alert${error ? ' is-error' : ''}`} role="status">
          {error || notice}
        </div>
      )}

      <div className="chat-shell__nav-label">Quick</div>
      <button
        type="button"
        className="chat-shell__nav-item chat-shell__nav-button"
        onClick={onQuickGenerate}
        disabled={busy || businesses.length === 0}
        aria-disabled={busy || businesses.length === 0}
        title="Quick session with no product (brand still required)"
      >
        <Zap size={13} aria-hidden />
        <span className="chat-shell__nav-item-label">Quick generate</span>
      </button>

      <div className="chat-shell__nav-label">Brands</div>
      {loadingBusinesses && (
        <div className="chat-shell__nav-item">Loading brands…</div>
      )}
      {!loadingBusinesses && businesses.length === 0 && (
        <div className="chat-shell__nav-item">
          No brands yet
        </div>
      )}
      {businesses.map((brand) => {
        const isActive = brand.id === activeBrandId
        const brandSessions = isActive
          ? sessions.filter((session) => session.business_id === brand.id)
          : []
        return (
          <div key={brand.id}>
            <button
              type="button"
              className={`chat-shell__nav-item chat-shell__nav-button${isActive ? ' is-active' : ''}`}
              onClick={() => onSelectBrand(brand.id)}
            >
              <span className="chat-shell__nav-item-label">{brand.name}</span>
            </button>
            {isActive && (
              <div className="chat-shell__nav-subs">
                {loadingSessions && (
                  <div className="chat-shell__nav-loading" aria-live="polite">
                    Updating sessions…
                  </div>
                )}
                {!loadingSessions && brandSessions.length === 0 && (
                  <div className="chat-shell__nav-sub">No sessions yet</div>
                )}
                {brandSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className={`chat-shell__nav-sub chat-shell__nav-button${session.id === activeSessionId ? ' is-selected' : ''}`}
                    onClick={() => onSelectSession(session)}
                  >
                    <span className="chat-shell__session-title">
                      <span className="chat-shell__session-title-text">
                        {session.title || 'Untitled'}
                      </span>
                      {session.product_id == null ? (
                        <span className="chat-shell__session-tag">Quick</span>
                      ) : null}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="chat-shell__nav-sub chat-shell__nav-button"
                  onClick={onNewSession}
                  disabled={!canCreate}
                  aria-disabled={!canCreate}
                >
                  + New session
                </button>
              </div>
            )}
          </div>
        )
      })}
      <Link to="/dashboard" className="chat-shell__nav-item chat-shell__nav-link">
        + New brand…
      </Link>

      <div className="chat-shell__user">
        <div className="chat-shell__avatar" aria-hidden>{initials}</div>
        <div className="chat-shell__user-copy">
          <div className="chat-shell__user-name">
            <span className="chat-shell__user-name-text">{displayName}</span>
            <span className="chat-shell__badge">Pro</span>
          </div>
          <div className="chat-shell__user-meta">Chat shell · brands live</div>
        </div>
        <Link
          to="/settings"
          className="chat-shell__icon-btn chat-shell__icon-btn--ghost"
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={15} aria-hidden />
        </Link>
      </div>
    </aside>
  )
}
