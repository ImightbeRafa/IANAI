import { Link } from 'react-router-dom'
import { Settings, Search } from 'lucide-react'

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
          <Settings size={16} />
        </Link>
      </div>

      <button type="button" className="chat-shell__btn chat-shell__btn--primary" disabled>
        + New chat
      </button>

      <label className="chat-shell__sr-only" htmlFor="chat-shell-search">Search</label>
      <div style={{ position: 'relative' }}>
        <Search
          size={14}
          style={{ position: 'absolute', left: 10, top: 20, color: 'var(--text-faint)', pointerEvents: 'none' }}
        />
        <input
          id="chat-shell-search"
          className="chat-shell__search"
          style={{ paddingLeft: 30 }}
          placeholder="Search"
          disabled
        />
      </div>

      <div className="chat-shell__nav-label">Quick</div>
      <div className="chat-shell__nav-item">
        Quick generate
        <span className="chat-shell__btn chat-shell__btn--pill" style={{ marginLeft: 'auto' }}>no brand</span>
      </div>

      <div className="chat-shell__nav-label">Brands</div>
      <div className="chat-shell__nav-item is-active">PatchHouse.CR</div>
      <div className="chat-shell__nav-sub is-selected">Scripts + creatives</div>
      <div className="chat-shell__nav-sub">Brand onboarding</div>
      <div className="chat-shell__nav-sub">+ New session</div>
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
          <div style={{ color: 'var(--text-faint)', fontSize: '0.78rem' }}>
            Chat shell · preview foundation
          </div>
        </div>
      </div>
    </aside>
  )
}
