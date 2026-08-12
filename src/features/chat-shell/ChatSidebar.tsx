import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Zap,
} from 'lucide-react'
import type { Business, ChatSession } from '../../types'
import {
  openSessionActionMenu,
  openSessionDeleteConfirm,
  readBrandOpen,
  resolveBrandOpenMap,
  resolveSessionSidebarTitle,
  sessionActionAnchorFromRect,
  SIDEBAR_SESSION_VISIBLE_CAP,
  type SessionActionPanel,
  writeBrandOpen,
} from './chatShellSidebar'

interface ChatSidebarProps {
  displayName: string
  initials: string
  businesses: Business[]
  sessions: ChatSession[]
  sessionCounts: Record<string, number>
  firstUserPreviews: Record<string, string>
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
  onNewBrand: () => void
  onDeleteSession: (sessionId: string) => void | Promise<void>
}

function isolateMorePointer(e: { preventDefault(): void; stopPropagation(): void }) {
  e.preventDefault()
  e.stopPropagation()
}

export default function ChatSidebar({
  displayName,
  initials,
  businesses,
  sessions,
  sessionCounts,
  firstUserPreviews,
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
  onNewBrand,
  onDeleteSession,
}: ChatSidebarProps) {
  const canCreate = Boolean(activeBrandId) && !busy
  const storage = typeof localStorage !== 'undefined' ? localStorage : null
  const [openByBrand, setOpenByBrand] = useState<Record<string, boolean>>({})
  const [showAllByBrand, setShowAllByBrand] = useState<Record<string, boolean>>({})
  const [sessionAction, setSessionAction] = useState<SessionActionPanel | null>(null)

  // Hydrate from localStorage first. Honor explicit `0`. Never writeBrandOpen from this effect.
  useEffect(() => {
    setOpenByBrand((prev) =>
      resolveBrandOpenMap({
        businessIds: businesses.map((b) => b.id),
        activeBrandId,
        readStored: (id) => readBrandOpen(storage, id),
        previous: prev,
      })
    )
  }, [businesses, activeBrandId, storage])

  useEffect(() => {
    if (!sessionAction) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-session-menu]')) return
      setSessionAction(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setSessionAction(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [sessionAction])

  const sessionsByBrand = useMemo(() => {
    const map = new Map<string, ChatSession[]>()
    for (const session of sessions) {
      const bid = session.business_id
      if (!bid) continue
      const list = map.get(bid) || []
      list.push(session)
      map.set(bid, list)
    }
    return map
  }, [sessions])

  const toggleBrandOpen = (brandId: string) => {
    setOpenByBrand((prev) => {
      const nextOpen = !(prev[brandId] ?? false)
      writeBrandOpen(storage, brandId, nextOpen)
      return { ...prev, [brandId]: nextOpen }
    })
    if (!openByBrand[brandId] && brandId !== activeBrandId) {
      onSelectBrand(brandId)
    }
  }

  // Name click selects brand only — never writeBrandOpen(true) / force-open (chevron is the only LS writer).
  const selectBrand = (brandId: string) => {
    onSelectBrand(brandId)
  }

  const openMoreMenu = (sessionId: string, button: HTMLElement) => {
    const anchor = sessionActionAnchorFromRect(
      button.getBoundingClientRect(),
      window.innerWidth
    )
    setSessionAction((prev) => openSessionActionMenu(prev, sessionId, anchor))
  }

  const requestDeleteConfirm = (sessionId: string, anchor: SessionActionPanel['anchor']) => {
    const capturedSessionId = sessionId
    setSessionAction(openSessionDeleteConfirm(capturedSessionId, anchor))
  }

  const confirmDelete = () => {
    if (!sessionAction || sessionAction.kind !== 'confirm' || busy) return
    const capturedSessionId = sessionAction.sessionId
    setSessionAction(null)
    void onDeleteSession(capturedSessionId)
  }

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
            placeholder="Search — soon"
            disabled
            aria-disabled="true"
            title="Search coming soon"
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
      <div className="chat-shell__brands-scroll">
        {loadingBusinesses && (
          <div className="chat-shell__nav-item">Loading brands…</div>
        )}
        {!loadingBusinesses && businesses.length === 0 && (
          <div className="chat-shell__nav-empty chat-shell__nav-empty--brands">
            <div className="chat-shell__nav-empty-copy">No brands yet</div>
            <p className="chat-shell__nav-empty-detail">
              Create your first brand to start chatting.
            </p>
            <button
              type="button"
              className="chat-shell__nav-item chat-shell__nav-button chat-shell__nav-empty-cta"
              onClick={onNewBrand}
              disabled={busy || loadingBusinesses}
              aria-disabled={busy || loadingBusinesses}
            >
              New brand
            </button>
          </div>
        )}
        {businesses.map((brand) => {
          const isActive = brand.id === activeBrandId
          const isOpen = openByBrand[brand.id] ?? false
          const brandSessions = isActive
            ? (sessionsByBrand.get(brand.id) || sessions.filter((s) => s.business_id === brand.id))
            : []
          const count = isActive
            ? brandSessions.length
            : (sessionCounts[brand.id] ?? brandSessions.length)
          const showAll = showAllByBrand[brand.id] ?? false
          const visibleSessions = showAll
            ? brandSessions
            : brandSessions.slice(0, SIDEBAR_SESSION_VISIBLE_CAP)
          const olderCount = Math.max(0, brandSessions.length - SIDEBAR_SESSION_VISIBLE_CAP)

          return (
            <div key={brand.id} className="chat-shell__brand-block">
              <div className="chat-shell__brand-header">
                <button
                  type="button"
                  className="chat-shell__brand-chevron"
                  aria-label={isOpen ? `Collapse ${brand.name}` : `Expand ${brand.name}`}
                  aria-expanded={isOpen}
                  onClick={() => toggleBrandOpen(brand.id)}
                >
                  {isOpen
                    ? <ChevronDown size={14} aria-hidden />
                    : <ChevronRight size={14} aria-hidden />}
                </button>
                <button
                  type="button"
                  className={`chat-shell__nav-item chat-shell__nav-button chat-shell__brand-name${isActive ? ' is-active' : ''}`}
                  onClick={() => selectBrand(brand.id)}
                >
                  <span className="chat-shell__nav-item-label">{brand.name}</span>
                  {!isOpen && (
                    <span className="chat-shell__brand-count" aria-label={`${count} chats`}>
                      {count}
                    </span>
                  )}
                </button>
              </div>

              {isOpen && isActive && (
                <div className="chat-shell__nav-subs">
                  {loadingSessions && (
                    <div className="chat-shell__nav-loading" aria-live="polite">
                      Updating sessions…
                    </div>
                  )}
                  {!loadingSessions && brandSessions.length === 0 && (
                    <div className="chat-shell__nav-empty">
                      <div className="chat-shell__nav-empty-copy">No chats yet</div>
                      <p className="chat-shell__nav-empty-detail">
                        Start a chat for this brand.
                      </p>
                      <button
                        type="button"
                        className="chat-shell__nav-sub chat-shell__nav-button chat-shell__nav-empty-cta"
                        onClick={onNewSession}
                        disabled={!canCreate}
                        aria-disabled={!canCreate}
                      >
                        New chat
                      </button>
                    </div>
                  )}
                  {visibleSessions.map((session) => {
                    const { label, fullTitle } = resolveSessionSidebarTitle({
                      session,
                      firstUserMessage: firstUserPreviews[session.id],
                    })
                    const isQuick = session.product_id == null
                    const selected = session.id === activeSessionId
                    const moreExpanded = sessionAction?.sessionId === session.id

                    return (
                      <div
                        key={session.id}
                        className={`chat-shell__session-row${selected ? ' is-selected' : ''}`}
                      >
                        <button
                          type="button"
                          className={`chat-shell__nav-sub chat-shell__nav-button chat-shell__session-main${selected ? ' is-selected' : ''}`}
                          onClick={() => onSelectSession(session)}
                          title={fullTitle}
                        >
                          <span className="chat-shell__session-title">
                            <span className="chat-shell__session-title-text">{label}</span>
                            {isQuick ? (
                              <span className="chat-shell__session-tag" aria-label="Quick session">
                                QUICK
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <div className="chat-shell__session-trail">
                          <button
                            type="button"
                            className="chat-shell__session-more"
                            aria-label={`Session actions for ${label}`}
                            aria-haspopup="menu"
                            aria-expanded={moreExpanded}
                            disabled={busy}
                            data-session-menu={moreExpanded ? '1' : undefined}
                            onPointerDown={isolateMorePointer}
                            onClick={(e) => {
                              isolateMorePointer(e)
                              openMoreMenu(session.id, e.currentTarget)
                            }}
                          >
                            <MoreHorizontal size={14} aria-hidden />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {!showAll && olderCount > 0 && (
                    <button
                      type="button"
                      className="chat-shell__nav-sub chat-shell__nav-button chat-shell__show-older"
                      onClick={() =>
                        setShowAllByBrand((prev) => ({ ...prev, [brand.id]: true }))
                      }
                    >
                      {`Show ${olderCount} older`}
                    </button>
                  )}
                  {showAll && brandSessions.length > SIDEBAR_SESSION_VISIBLE_CAP && (
                    <button
                      type="button"
                      className="chat-shell__nav-sub chat-shell__nav-button chat-shell__show-older"
                      onClick={() =>
                        setShowAllByBrand((prev) => ({ ...prev, [brand.id]: false }))
                      }
                    >
                      Show less
                    </button>
                  )}
                  {brandSessions.length > 0 && (
                    <button
                      type="button"
                      className="chat-shell__nav-sub chat-shell__nav-button"
                      onClick={onNewSession}
                      disabled={!canCreate}
                      aria-disabled={!canCreate}
                    >
                      + New session
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <button
          type="button"
          className="chat-shell__nav-item chat-shell__nav-button chat-shell__nav-new-brand"
          onClick={onNewBrand}
          disabled={busy || loadingBusinesses}
          aria-disabled={busy || loadingBusinesses}
        >
          + New brand…
        </button>
      </div>

      {sessionAction?.kind === 'menu' && (
        <div
          className="chat-shell__session-menu"
          role="menu"
          data-session-menu="1"
          style={{ top: sessionAction.anchor.top, right: sessionAction.anchor.right }}
        >
          <button
            type="button"
            role="menuitem"
            className="chat-shell__session-menu-item is-danger"
            onPointerDown={isolateMorePointer}
            onClick={(e) => {
              isolateMorePointer(e)
              requestDeleteConfirm(sessionAction.sessionId, sessionAction.anchor)
            }}
          >
            Delete
          </button>
        </div>
      )}

      {sessionAction?.kind === 'confirm' && (
        <div
          className="chat-shell__session-confirm"
          role="group"
          aria-label="Confirm delete"
          data-session-menu="1"
          style={{ top: sessionAction.anchor.top, right: sessionAction.anchor.right }}
        >
          <button
            type="button"
            className="chat-shell__session-confirm-btn"
            disabled={busy}
            onPointerDown={isolateMorePointer}
            onClick={(e) => {
              isolateMorePointer(e)
              setSessionAction(null)
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="chat-shell__session-confirm-btn is-danger"
            disabled={busy}
            onPointerDown={isolateMorePointer}
            onClick={(e) => {
              isolateMorePointer(e)
              confirmDelete()
            }}
          >
            Delete
          </button>
        </div>
      )}

      <div className="chat-shell__user">
        <div className="chat-shell__avatar" aria-hidden>{initials}</div>
        <div className="chat-shell__user-copy">
          <div className="chat-shell__user-name">
            <span className="chat-shell__user-name-text">{displayName}</span>
            <span className="chat-shell__badge" title="Chat shell Preview">Preview</span>
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
