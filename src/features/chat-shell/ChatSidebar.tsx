import { Link } from 'react-router-dom'
import { Settings, Search, Plus, Zap } from 'lucide-react'

interface ChatSidebarProps {
  displayName: string
  initials: string
}

export default function ChatSidebar({ displayName, initials }: ChatSidebarProps) {
  return (
    <aside className="chat-shell__sidebar" aria-label="Chat navigation">
      <div className="chat-shell__brand">
        <span>Advance AI</span>
        <Link to="/settings" className="chat-shell__icon-btn" aria-label="Settings" title="Settings">
          <Settings size={15} />
        </Link>
      </div>

      <div className="chat-shell__row-actions">
        <button type="button" className="chat-shell__row-action" disabled aria-disabled="true">
          <Plus size={15} aria-hidden />
          New chat
          <span className="chat-shell__kbd">N</span>
        </button>
        <div className="chat-shell__search-wrap">
          <label className="chat-shell__sr-only" htmlFor="chat-shell-search">Search</label>
          <Search size={14} className="chat-shell__search-icon" aria-hidden />
          <input
            id="chat-shell-search"
            className="chat-shell__search"
            placeholder="Search"
            disabled
            aria-disabled="true"
          />
        </div>
      </div>

      <div className="chat-shell__nav-label">Quick</div>
      <div className="chat-shell__nav-item">
        <Zap size={14} aria-hidden />
        Quick generate
        <span className="chat-shell__btn chat-shell__btn--pill chat-shell__pill-trail">no brand</span>
      </div>

      <div className="chat-shell__nav-label">Brands</div>
      <div className="chat-shell__nav-item is-active">PatchHouse.CR</div>
      <div className="chat-shell__nav-subs">
        <div className="chat-shell__nav-sub is-selected">
          <span className="chat-shell__status-dot" aria-hidden />
          Scripts + creatives
        </div>
        <div className="chat-shell__nav-sub">Brand onboarding</div>
        <div className="chat-shell__nav-sub">+ New session</div>
      </div>
      <div className="chat-shell__nav-item">Pura Sonrisa CR</div>
      <div className="chat-shell__nav-item">DeepClean</div>
      <div className="chat-shell__nav-item">+ New brand...</div>

      <div className="chat-shell__user">
        <div className="chat-shell__avatar" aria-hidden>{initials}</div>
        <div>
          <div>
            {displayName}
            <span className="chat-shell__badge">Pro</span>
          </div>
          <div className="chat-shell__user-meta">Pro · usage in preview</div>
        </div>
      </div>
    </aside>
  )
}
