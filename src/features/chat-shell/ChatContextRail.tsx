import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Business, ChatSession, ChatSessionOffer, Product } from '../../types'
import type { ChatSessionSafeUpdates } from '../../services/database'
import { CHAT_SHELL_MAX_OFFERS, sortOffersByPosition } from './sessionOffer'
import { isSessionSetupComplete } from './chatContextSetup'
import ChatContextSetupCard from './ChatContextSetupCard'

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
  offerBusy?: boolean
  onPatchSession?: (updates: ChatSessionSafeUpdates) => void
  onAddOffer?: (productId: string) => void | Promise<void>
  onRemoveOffer?: (productId: string) => void | Promise<void>
  onMoveOffer?: (productId: string, direction: -1 | 1) => void | Promise<void>
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
  offerBusy = false,
  onPatchSession,
  onAddOffer,
  onRemoveOffer,
  onMoveOffer,
}: ChatContextRailProps) {
  const [title, setTitle] = useState(session?.title || '')
  const [context, setContext] = useState(session?.context || '')
  const [channel, setChannel] = useState(session?.primary_channel || '')
  const [awareness, setAwareness] = useState(session?.awareness_level || '')
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set())
  const [forceSetup, setForceSetup] = useState(false)

  useEffect(() => {
    setTitle(session?.title || '')
    setContext(session?.context || '')
    setChannel(session?.primary_channel || '')
    setAwareness(session?.awareness_level || '')
  }, [session?.id, session?.title, session?.context, session?.primary_channel, session?.awareness_level])

  useEffect(() => {
    setForceSetup(false)
  }, [session?.id])

  const saveField = (updates: ChatSessionSafeUpdates) => {
    if (!session || !onPatchSession) return
    onPatchSession(updates)
  }

  const orderedOffers = sortOffersByPosition(offers)
  const attachedIds = new Set(orderedOffers.map((o) => o.product_id))
  const availableProducts = brandProducts.filter((p) => !attachedIds.has(p.id))
  const setupComplete = isSessionSetupComplete(session)
  const sessionSkipped = Boolean(session && skippedIds.has(session.id))
  const interviewOpen = Boolean(
    session &&
    (forceSetup || (!setupComplete && !sessionSkipped))
  )

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
              <ChatContextSetupCard
                session={session}
                skipped={sessionSkipped}
                forceOpen={forceSetup}
                onSkipped={() => {
                  setSkippedIds((prev) => new Set(prev).add(session.id))
                  setForceSetup(false)
                }}
                onSaved={async (updates) => {
                  await onPatchSession?.(updates)
                  setSkippedIds((prev) => {
                    const next = new Set(prev)
                    next.delete(session.id)
                    return next
                  })
                  setForceSetup(false)
                  if (typeof updates.title === 'string') setTitle(updates.title)
                  if (typeof updates.context === 'string') setContext(updates.context)
                  if (updates.primary_channel !== undefined) {
                    setChannel(updates.primary_channel || '')
                  }
                  if (updates.awareness_level !== undefined) {
                    setAwareness(updates.awareness_level || '')
                  }
                }}
              />

              {(setupComplete || sessionSkipped) && !forceSetup ? (
                <div className="chat-shell__setup-reopen">
                  <button
                    type="button"
                    className="chat-shell__setup-btn"
                    onClick={() => setForceSetup(true)}
                  >
                    Setup
                  </button>
                  <span className="chat-shell__rail-hint">
                    {setupComplete ? 'Setup saved.' : 'Setup skipped — composer still works.'}
                  </span>
                </div>
              ) : null}

              {!interviewOpen ? (
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
              ) : (
                <p className="chat-shell__rail-hint">
                  Brand · {brand?.name || '—'}. Save setup or Skip to edit fields manually.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'offers' && (
        <div className="chat-shell__stack">
          {!session ? (
            <p className="chat-shell__rail-hint">Select a session to attach product offers.</p>
          ) : !session.business_id ? (
            <p className="chat-shell__rail-hint">This session has no business_id — cannot attach offers.</p>
          ) : brandProducts.length === 0 ? (
            <p className="chat-shell__rail-hint">No products on this brand yet. Create one from Dashboard.</p>
          ) : (
            <>
              <p className="chat-shell__rail-hint">
                Select up to {CHAT_SHELL_MAX_OFFERS} products. Position 1 is primary. Generate walks all offers in order.
              </p>
              {orderedOffers.length > 0 ? (
                <ol className="chat-shell__offer-list">
                  {orderedOffers.map((offer, index) => {
                    const product =
                      offer.product
                      || brandProducts.find((p) => p.id === offer.product_id)
                      || (activeProduct?.id === offer.product_id ? activeProduct : null)
                    const label = product?.name ?? offer.product_id.slice(0, 8)
                    return (
                      <li key={offer.product_id} className="chat-shell__offer-row">
                        <div className="chat-shell__offer-main">
                          <span className="chat-shell__offer-pos">{offer.position}</span>
                          <span className="chat-shell__offer-name">{label}</span>
                          {offer.position === 1 ? (
                            <span className="chat-shell__offer-primary">Primary</span>
                          ) : null}
                        </div>
                        <div className="chat-shell__offer-actions">
                          <button
                            type="button"
                            className="chat-shell__offer-btn"
                            disabled={offerBusy || index === 0}
                            onClick={() => void onMoveOffer?.(offer.product_id, -1)}
                            aria-label={`Move ${label} up`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="chat-shell__offer-btn"
                            disabled={offerBusy || index === orderedOffers.length - 1}
                            onClick={() => void onMoveOffer?.(offer.product_id, 1)}
                            aria-label={`Move ${label} down`}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="chat-shell__offer-btn"
                            disabled={offerBusy}
                            onClick={() => void onRemoveOffer?.(offer.product_id)}
                            aria-label={`Remove ${label}`}
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="chat-shell__rail-hint">No offers attached yet.</p>
              )}

              {orderedOffers.length >= CHAT_SHELL_MAX_OFFERS ? (
                <p className="chat-shell__rail-hint">Maximum {CHAT_SHELL_MAX_OFFERS} offers reached.</p>
              ) : (
                <div className="chat-shell__offer-add">
                  {availableProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="chat-shell__nav-item chat-shell__nav-button"
                      disabled={offerBusy}
                      onClick={() => void onAddOffer?.(product.id)}
                    >
                      + {product.name}
                    </button>
                  ))}
                </div>
              )}
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
