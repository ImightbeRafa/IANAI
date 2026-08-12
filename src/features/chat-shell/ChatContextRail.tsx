import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Business, ChatSession, ChatSessionOffer, Product } from '../../types'
import type { ChatSessionSafeUpdates, ProductImage } from '../../services/database'
import { CHAT_SHELL_MAX_OFFERS, sortOffersByPosition } from './sessionOffer'
import {
  isSessionSetupComplete,
  isSessionSetupSkipped,
  writeSetupSkipped,
} from './chatContextSetup'
import { CHAT_SHELL_ACTIVE_SESSION_KEY } from './chatShellPersistence'
import ChatContextSetupCard from './ChatContextSetupCard'
import {
  formatImageAssumptions,
  type ShellImageAspect,
  type ShellImageDensity,
  type ShellImagePreferences,
} from './chatShellImageIntent'
import type { ImageModel } from '../../types'

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
  activeImageOfferId?: string | null
  offerImages?: ProductImage[]
  imageBusy?: boolean
  onSelectImageOffer?: (productId: string) => void
  onUploadOfferImage?: (file: File) => void | Promise<void>
  onGenerateOfferImage?: () => void | Promise<void>
  imagePrefs?: ShellImagePreferences
  onPatchImagePreferences?: (patch: Partial<ShellImagePreferences>) => void
  language?: 'en' | 'es'
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
  activeImageOfferId = null,
  offerImages = [],
  imageBusy = false,
  onSelectImageOffer,
  onUploadOfferImage,
  onGenerateOfferImage,
  imagePrefs,
  onPatchImagePreferences,
  language = 'es',
}: ChatContextRailProps) {
  const storage = typeof localStorage !== 'undefined' ? localStorage : null
  const [title, setTitle] = useState(session?.title || '')
  const [context, setContext] = useState(session?.context || '')
  const [channel, setChannel] = useState(session?.primary_channel || '')
  const [awareness, setAwareness] = useState(session?.awareness_level || '')
  /** Bumps so Skip/clear re-reads LS (source of truth) without a drifting Set. */
  const [skipTick, setSkipTick] = useState(0)
  const [forceSetup, setForceSetup] = useState(false)
  const [skipPersistError, setSkipPersistError] = useState<string | null>(null)

  useEffect(() => {
    setTitle(session?.title || '')
    setContext(session?.context || '')
    setChannel(session?.primary_channel || '')
    setAwareness(session?.awareness_level || '')
  }, [session?.id, session?.title, session?.context, session?.primary_channel, session?.awareness_level])

  useEffect(() => {
    setForceSetup(false)
    setSkipPersistError(null)
  }, [session?.id])

  const markSkipped = (sessionId: string) => {
    // sessionId must be captured at Skip click — do not re-read session?.id here.
    if (!sessionId) return

    // If URL / stored active id disagrees with the click-captured id (selection drift),
    // write Skip for both so hard-reload cannot reopen against either identity.
    // Escape / backdrop / hydrate must never call this.
    const siblingIds = new Set<string>([sessionId])
    try {
      const urlId =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('session')
          : null
      if (urlId) siblingIds.add(urlId)
      const storedId = storage?.getItem?.(CHAT_SHELL_ACTIVE_SESSION_KEY) ?? null
      if (storedId) siblingIds.add(storedId)
    } catch {
      /* ignore */
    }

    let anyOk = false
    let lastFailure: string | null = null
    for (const id of siblingIds) {
      const result = writeSetupSkipped(storage, id, true)
      if (result.ok) anyOk = true
      else lastFailure = result.reason
    }
    setSkipTick((n) => n + 1)
    if (!anyOk) {
      setSkipPersistError(
        lastFailure === 'missing_storage' || lastFailure === 'storage_threw'
          ? 'Could not save Skip (storage unavailable). Try again.'
          : 'Could not save Skip for this session. Try again.'
      )
      return
    }
    setSkipPersistError(null)
    setForceSetup(false)
  }

  const clearSkipped = (sessionId: string, clearReason: 'save' | 'reopen') => {
    // Only Save / explicit Setup reopen may clear — never hydrate/remount/Escape.
    if (!sessionId) return
    const result = writeSetupSkipped(storage, sessionId, false, { clearReason })
    setSkipTick((n) => n + 1)
    if (!result.ok) {
      setSkipPersistError('Could not clear Skip for this session.')
      return
    }
    setSkipPersistError(null)
  }

  const reopenSetup = () => {
    if (!session?.id) return
    clearSkipped(session.id, 'reopen')
    setForceSetup(true)
  }

  const saveField = (updates: ChatSessionSafeUpdates) => {
    if (!session || !onPatchSession) return
    onPatchSession(updates)
  }

  const orderedOffers = sortOffersByPosition(offers)
  const attachedIds = new Set(orderedOffers.map((o) => o.product_id))
  const availableProducts = brandProducts.filter((p) => !attachedIds.has(p.id))
  const setupComplete = isSessionSetupComplete(session)
  // LS is authoritative for the current session id (skipTick forces re-read after write).
  void skipTick
  const sessionSkipped = Boolean(
    session?.id && isSessionSetupSkipped(storage, session.id)
  )
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
                language={language}
                onSkipped={markSkipped}
                onSaved={async (updates, savedSessionId) => {
                  await onPatchSession?.(updates)
                  // Clear only the session that was Saved — never a snap-back id.
                  clearSkipped(savedSessionId, 'save')
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

              {skipPersistError ? (
                <p className="chat-shell__setup-status is-error" role="alert">
                  {skipPersistError}
                </p>
              ) : null}

              {(setupComplete || sessionSkipped) && !forceSetup ? (
                <div className="chat-shell__setup-reopen">
                  <button
                    type="button"
                    className="chat-shell__setup-btn"
                    data-action="setup-reopen"
                    onClick={reopenSetup}
                  >
                    Resume setup
                  </button>
                  <span className="chat-shell__rail-hint">
                    {setupComplete
                      ? 'Setup saved.'
                      : 'Setup incomplete — add context and a primary channel for stronger generations. Composer still works.'}
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
        <div className="chat-shell__stack">
          {!session ? (
            <p className="chat-shell__rail-hint">Select a session to manage offer images.</p>
          ) : orderedOffers.length === 0 ? (
            <p className="chat-shell__rail-hint">
              Attach at least one offer before uploading or generating images.
            </p>
          ) : (
            <>
              <p className="chat-shell__rail-hint">
                Images are scoped to the selected offer. No carousel or video in shell.
              </p>
              <div className="chat-shell__image-offer-chips" role="tablist" aria-label="Image offer">
                {orderedOffers.map((offer) => {
                  const product =
                    offer.product
                    || brandProducts.find((p) => p.id === offer.product_id)
                  const label = product?.name ?? offer.product_id.slice(0, 8)
                  const selected = activeImageOfferId === offer.product_id
                  return (
                    <button
                      key={offer.product_id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={`chat-shell__image-chip${selected ? ' is-on' : ''}`}
                      disabled={imageBusy}
                      onClick={() => onSelectImageOffer?.(offer.product_id)}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              <div className="chat-shell__image-knobs" aria-label="Image settings">
                <p className="chat-shell__rail-hint">
                  {imagePrefs
                    ? formatImageAssumptions(imagePrefs, language)
                    : '9:16 · Nano Banana Pro · Medium'}
                </p>
                <div className="chat-shell__clarify-chips">
                  {(['9:16', '3:4', '1:1'] as ShellImageAspect[]).map((ar) => (
                    <button
                      key={ar}
                      type="button"
                      className={`chat-shell__btn chat-shell__btn--pill${imagePrefs?.aspectRatio === ar ? ' is-on' : ''}`}
                      disabled={imageBusy}
                      onClick={() => onPatchImagePreferences?.({ aspectRatio: ar })}
                    >
                      {ar}
                    </button>
                  ))}
                </div>
                <div className="chat-shell__clarify-chips">
                  {([
                    { id: 'nano-banana-pro' as ImageModel, label: 'Pro' },
                    { id: 'nano-banana' as ImageModel, label: 'Fast' },
                    { id: 'grok-imagine' as ImageModel, label: 'Grok' },
                  ]).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`chat-shell__btn chat-shell__btn--pill${imagePrefs?.model === m.id ? ' is-on' : ''}`}
                      disabled={imageBusy}
                      onClick={() => onPatchImagePreferences?.({ model: m.id })}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="chat-shell__clarify-chips">
                  {([
                    { id: 'hard' as ShellImageDensity, label: 'Hard' },
                    { id: 'medium' as ShellImageDensity, label: 'Medium' },
                    { id: 'standard' as ShellImageDensity, label: 'Standard' },
                  ]).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`chat-shell__btn chat-shell__btn--pill${imagePrefs?.density === d.id ? ' is-on' : ''}`}
                      disabled={imageBusy}
                      onClick={() => onPatchImagePreferences?.({ density: d.id })}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="chat-shell__image-actions">
                <label className="chat-shell__setup-btn">
                  Upload
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    disabled={imageBusy || !activeImageOfferId}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void onUploadOfferImage?.(file)
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="chat-shell__setup-btn is-primary"
                  disabled={imageBusy || !activeImageOfferId}
                  onClick={() => void onGenerateOfferImage?.()}
                >
                  {imageBusy ? 'Working…' : 'Generate'}
                </button>
              </div>

              {offerImages.length === 0 ? (
                <p className="chat-shell__rail-hint">No images for this offer yet.</p>
              ) : (
                <div className="chat-shell__image-grid">
                  {offerImages.map((img) => (
                    <figure key={img.id} className="chat-shell__image-thumb">
                      <img src={img.image_url} alt={img.label || 'Offer image'} />
                      <figcaption>
                        {img.kind === 'generated' ? 'Generated' : img.kind === 'context' ? 'Context' : 'Ref'}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  )
}
