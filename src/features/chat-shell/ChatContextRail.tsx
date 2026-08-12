import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Business, ChatSession, ChatSessionOffer, Product } from '../../types'
import type { ChatSessionSafeUpdates } from '../../services/database'

export type RailTab = 'context' | 'offers' | 'images'

interface ChatContextRailProps {
  tab: RailTab
  onTabChange: (tab: RailTab) => void
  onClose: () => void
  brand?: Business | null
  session?: ChatSession | null
  offers?: ChatSessionOffer[]
  brandProducts?: Product[]
  activeProduct?: Product | null
  onPatchSession?: (updates: ChatSessionSafeUpdates) => void
  onSelectOffer?: (productId: string) => void
}

export default function ChatContextRail({
  tab,
  onTabChange,
  onClose,
  brand = null,
  session = null,
  offers = [],
  brandProducts = [],
  activeProduct = null,
  onPatchSession,
  onSelectOffer,
}: ChatContextRailProps) {
  const [title, setTitle] = useState(session?.title || '')
  const [context, setContext] = useState(session?.context || '')
  const [channel, setChannel] = useState(session?.primary_channel || '')
  const [awareness, setAwareness] = useState(session?.awareness_level || '')

  useEffect(() => {
    setTitle(session?.title || '')
    setContext(session?.context || '')
    setChannel(session?.primary_channel || '')
    setAwareness(session?.awareness_level || '')
  }, [session?.id, session?.title, session?.context, session?.primary_channel, session?.awareness_level])

  const saveField = (updates: ChatSessionSafeUpdates) => {
    if (!session || !onPatchSession) return
    onPatchSession(updates)
  }

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
        <div className="chat-shell__rail-form">
          {!session ? (
            <p className="chat-shell__rail-note">
              {brand
                ? `Brand · ${brand.name}. Select a session to edit title and context.`
                : 'Select a brand and session to edit context.'}
            </p>
          ) : (
            <>
              <label className="chat-shell__field">
                <span>Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => {
                    if (title.trim() && title.trim() !== session.title) {
                      saveField({ title: title.trim() })
                    }
                  }}
                />
              </label>
              <label className="chat-shell__field">
                <span>Context</span>
                <textarea
                  rows={4}
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  onBlur={() => {
                    if ((context || '') !== (session.context || '')) {
                      saveField({ context })
                    }
                  }}
                  placeholder="Session notes for generation…"
                />
              </label>
              <label className="chat-shell__field">
                <span>Primary channel</span>
                <select
                  value={channel || ''}
                  onChange={(e) => {
                    const value = e.target.value as '' | 'messages' | 'website' | 'physical'
                    setChannel(value)
                    saveField({ primary_channel: value || null })
                  }}
                >
                  <option value="">—</option>
                  <option value="messages">Messages</option>
                  <option value="website">Website</option>
                  <option value="physical">Physical</option>
                </select>
              </label>
              <label className="chat-shell__field">
                <span>Awareness</span>
                <select
                  value={awareness || ''}
                  onChange={(e) => {
                    const value = e.target.value as '' | 'cold' | 'warm' | 'hot'
                    setAwareness(value)
                    saveField({ awareness_level: value || null })
                  }}
                >
                  <option value="">—</option>
                  <option value="cold">Cold</option>
                  <option value="warm">Warm</option>
                  <option value="hot">Hot</option>
                </select>
              </label>
              <p className="chat-shell__rail-hint">
                Brand · {brand?.name || '—'}
                {activeProduct ? ` · Offer ${activeProduct.name}` : ' · No offer'}
                . Ownership fields are immutable.
              </p>
            </>
          )}
        </div>
      )}

      {tab === 'offers' && (
        <div className="chat-shell__stack">
          {!session ? (
            <p className="chat-shell__rail-hint">Select a session to attach one product offer.</p>
          ) : !session.business_id ? (
            <p className="chat-shell__rail-hint">This session has no business_id — cannot attach offers.</p>
          ) : brandProducts.length === 0 ? (
            <p className="chat-shell__rail-hint">No products on this brand yet. Create one from Dashboard.</p>
          ) : (
            <>
              <p className="chat-shell__rail-hint">Single offer for this phase. Multi-offer sequencing comes later.</p>
              {brandProducts.map((product) => {
                const selected = offers.some((o) => o.product_id === product.id) || activeProduct?.id === product.id
                return (
                  <button
                    key={product.id}
                    type="button"
                    className={`chat-shell__nav-item chat-shell__nav-button${selected ? ' is-active' : ''}`}
                    onClick={() => onSelectOffer?.(product.id)}
                  >
                    {product.name}
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}

      {tab === 'images' && (
        <p className="chat-shell__rail-hint">Image tools stay foundation-only in this phase.</p>
      )}
    </aside>
  )
}
