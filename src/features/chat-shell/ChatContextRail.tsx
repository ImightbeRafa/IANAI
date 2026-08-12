import { X } from 'lucide-react'

export type RailTab = 'context' | 'offers' | 'images'

interface ChatContextRailProps {
  tab: RailTab
  onTabChange: (tab: RailTab) => void
  onClose: () => void
}

export default function ChatContextRail({ tab, onTabChange, onClose }: ChatContextRailProps) {
  return (
    <aside className="chat-shell__rail" aria-label="Context rail">
      <div className="chat-shell__rail-head">
        <div className="chat-shell__rail-head-title">
          <strong>Rail</strong>
          <span className="chat-shell__rail-edit">edit</span>
        </div>
        <button
          type="button"
          className="chat-shell__icon-btn chat-shell__rail-close"
          aria-label="Close rail"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>

      <div className="chat-shell__tabs" role="tablist" aria-label="Rail sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'context'}
          className={`chat-shell__tab${tab === 'context' ? ' is-on' : ''}`}
          onClick={() => onTabChange('context')}
        >
          Context
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'offers'}
          className={`chat-shell__tab${tab === 'offers' ? ' is-on' : ''}`}
          onClick={() => onTabChange('offers')}
        >
          Offers
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'images'}
          className={`chat-shell__tab${tab === 'images' ? ' is-on' : ''}`}
          onClick={() => onTabChange('images')}
        >
          Images
        </button>
      </div>

      {tab === 'context' && (
        <div>
          <strong>Session context</strong>
          <p className="chat-shell__rail-note">
            Funnel and brand context will appear here in a later phase. Foundation layout only.
          </p>
        </div>
      )}

      {tab === 'offers' && (
        <div className="chat-shell__stack">
          <div className="chat-shell__nav-item is-active">1 · Sleep patch</div>
          <div className="chat-shell__nav-item">2 · Melatonin 5mg</div>
          <p className="chat-shell__rail-hint">Max 5 offers · sequential generation (later)</p>
        </div>
      )}

      {tab === 'images' && (
        <>
          <div className="chat-shell__rail-head">
            <strong>Selected creative</strong>
            <span className="chat-shell__rail-edit">edit</span>
          </div>
          <div className="chat-shell__preview">Sleep patch preview</div>
          <div className="chat-shell__stack">
            <button type="button" className="chat-shell__btn" disabled aria-disabled="true">Editar imagen</button>
            <button type="button" className="chat-shell__btn" disabled aria-disabled="true">Restyle</button>
            <button type="button" className="chat-shell__btn" disabled aria-disabled="true">Variaciones</button>
            <button type="button" className="chat-shell__btn" disabled aria-disabled="true">Change product photo</button>
          </div>
          <div className="chat-shell__nav-label">Thread images</div>
          <div className="chat-shell__thumbs">
            <div className="chat-shell__thumb is-sel">#1</div>
            <div className="chat-shell__thumb">#2</div>
            <div className="chat-shell__thumb">var</div>
            <div className="chat-shell__thumb">+</div>
          </div>
        </>
      )}
    </aside>
  )
}
