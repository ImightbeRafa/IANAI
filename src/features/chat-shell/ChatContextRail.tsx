import { X } from 'lucide-react'
import type { Business, ChatSession } from '../../types'

export type RailTab = 'context' | 'offers' | 'images'

interface ChatContextRailProps {
  tab: RailTab
  onTabChange: (tab: RailTab) => void
  onClose: () => void
  brand?: Business | null
  session?: ChatSession | null
}

export default function ChatContextRail({
  tab,
  onTabChange,
  onClose,
  brand = null,
  session = null,
}: ChatContextRailProps) {
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
            {brand ? (
              <>
                Brand · {brand.name}
                {session ? (
                  <>
                    <br />
                    Session · {session.title || 'Untitled'}
                    {session.product_id == null ? ' · Quick (no product)' : ''}
                  </>
                ) : (
                  <>
                    <br />
                    No session selected
                  </>
                )}
              </>
            ) : (
              'Select a brand to see session context. Funnel details arrive in a later phase.'
            )}
          </p>
        </div>
      )}

      {tab === 'offers' && (
        <div className="chat-shell__stack">
          <p className="chat-shell__rail-hint">
            Multi-offer generation comes later. Max 5 offers · sequential.
          </p>
        </div>
      )}

      {tab === 'images' && (
        <>
          <div className="chat-shell__rail-head">
            <strong>Selected creative</strong>
            <span className="chat-shell__rail-edit">edit</span>
          </div>
          <p className="chat-shell__rail-hint">Image tools are foundation-only for now.</p>
        </>
      )}
    </aside>
  )
}
