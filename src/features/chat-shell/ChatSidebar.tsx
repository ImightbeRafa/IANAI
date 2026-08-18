import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Settings,
  Trash2,
  X,
} from 'lucide-react'
import type { Business, ChatSession } from '../../types'
import { useLanguage } from '../../contexts/LanguageContext'
import { useUsageLimits } from '../../hooks/useUsageLimits'
import { AdvanceWordmark, IconPlus } from './ChatShellIcons'
import { shellT } from './chatShellLabels'
import {
  openBrandDeleteConfirm,
  openSessionActionMenu,
  openSessionDeleteConfirm,
  readBrandOpen,
  resolveBrandOpenMap,
  resolveSessionSidebarTitle,
  sessionActionAnchorFromRect,
  SIDEBAR_SESSION_VISIBLE_CAP,
  uniquifySidebarLabels,
  type BrandActionPanel,
  type SessionActionPanel,
  writeBrandOpen,
} from './chatShellSidebar'

interface ChatSidebarProps {
  displayName: string
  initials: string
  businesses: Business[]
  sessions: ChatSession[]
  sessionsByBrand?: Record<string, ChatSession[]>
  pendingBrandId?: string | null
  loadingByBrand?: Record<string, boolean>
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
  onPrefetchBrandSessions?: (brandId: string) => void
  onSelectSession: (session: ChatSession) => void
  onNewChat: () => void
  onNewSession: () => void
  onNewBrand: () => void
  onDeleteSession: (sessionId: string) => void | Promise<void>
  onDeleteBrand: (brandId: string) => void | Promise<void>
  onOpenSettings: () => void
  onSwitchToClassic?: () => void
}

function isolateMorePointer(e: { stopPropagation(): void }) {
  e.stopPropagation()
}

export default function ChatSidebar({
  displayName,
  initials,
  businesses,
  sessions,
  sessionsByBrand,
  pendingBrandId = null,
  loadingByBrand = {},
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
  onPrefetchBrandSessions,
  onSelectSession,
  onNewChat,
  onNewSession,
  onNewBrand,
  onDeleteSession,
  onDeleteBrand,
  onOpenSettings,
  onSwitchToClassic,
}: ChatSidebarProps) {
  const { language } = useLanguage()
  const t = shellT(language)
  const usage = useUsageLimits()
  const canCreate = Boolean(activeBrandId) && !busy
  const storage = typeof localStorage !== 'undefined' ? localStorage : null
  const [openByBrand, setOpenByBrand] = useState<Record<string, boolean>>({})
  const [showAllByBrand, setShowAllByBrand] = useState<Record<string, boolean>>({})
  const [sessionAction, setSessionAction] = useState<SessionActionPanel | null>(null)
  const [brandAction, setBrandAction] = useState<BrandActionPanel | null>(null)

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
    if (!sessionAction && !brandAction) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-session-menu]')) return
      setSessionAction(null)
      setBrandAction(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setSessionAction(null)
        setBrandAction(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [sessionAction, brandAction])

  const toggleBrandOpen = (brandId: string) => {
    setOpenByBrand((prev) => {
      const nextOpen = !(prev[brandId] ?? false)
      writeBrandOpen(storage, brandId, nextOpen)
      return { ...prev, [brandId]: nextOpen }
    })
    if (!openByBrand[brandId]) {
      onPrefetchBrandSessions?.(brandId)
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
    setBrandAction(null)
    setSessionAction((prev) => openSessionActionMenu(prev, sessionId, anchor))
  }

  const requestDeleteConfirm = (sessionId: string, anchor: SessionActionPanel['anchor']) => {
    const capturedSessionId = sessionId
    setSessionAction(openSessionDeleteConfirm(capturedSessionId, anchor))
  }

  const requestBrandDeleteConfirm = (brandId: string, brandName: string) => {
    setSessionAction(null)
    setBrandAction(openBrandDeleteConfirm(brandId, brandName, { top: 0, right: 0 }))
  }

  const confirmDelete = () => {
    if (!sessionAction || sessionAction.kind !== 'confirm' || busy) return
    const capturedSessionId = sessionAction.sessionId
    setSessionAction(null)
    void onDeleteSession(capturedSessionId)
  }

  const confirmBrandDelete = () => {
    if (!brandAction || brandAction.kind !== 'confirm' || busy) return
    const capturedBrandId = brandAction.brandId
    setBrandAction(null)
    void onDeleteBrand(capturedBrandId)
  }

  return (
    <aside className="chat-shell__sidebar" aria-label="Chat navigation">
      <div className="chat-shell__brand">
        <AdvanceWordmark size={22} />
      </div>

      <div className="chat-shell__row-actions">
        <button
          type="button"
          className="chat-shell__row-action chat-shell__row-action--primary"
          onClick={onNewChat}
          disabled={!canCreate}
          aria-disabled={!canCreate}
          title={activeBrandId ? t.newChat : t.noBrand}
        >
          <IconPlus size={14} />
          <span className="chat-shell__row-action-label">{t.newChat}</span>
        </button>
      </div>

      {(error || notice) && (
        <div className={`chat-shell__sidebar-alert${error ? ' is-error' : ''}`} role="status">
          {error || notice}
        </div>
      )}

      <div className="chat-shell__brands">
        <div className="chat-shell__nav-label">{t.brands}</div>
        {(loadingBusinesses || businesses.length > 0) && (
          <button
            type="button"
            className="chat-shell__nav-item chat-shell__nav-button chat-shell__nav-new-brand"
            onClick={onNewBrand}
            disabled={busy || loadingBusinesses}
            aria-disabled={busy || loadingBusinesses}
          >
            + {t.newBrand}…
          </button>
        )}
        <div className="chat-shell__brands-scroll">
        {loadingBusinesses && (
          <div className="chat-shell__skeleton-stack" aria-busy="true" aria-label={t.loadingBrands}>
            <div className="chat-shell__skeleton" />
            <div className="chat-shell__skeleton" />
            <div className="chat-shell__skeleton" />
          </div>
        )}
        {!loadingBusinesses && businesses.length === 0 && (
          <div className="chat-shell__nav-empty chat-shell__nav-empty--brands">
            <div className="chat-shell__nav-empty-copy">{t.noBrands}</div>
            <p className="chat-shell__nav-empty-detail">
              {t.noBrandsDetail}
            </p>
            <button
              type="button"
              className="chat-shell__nav-item chat-shell__nav-button chat-shell__nav-empty-cta"
              onClick={onNewBrand}
              disabled={busy || loadingBusinesses}
              aria-disabled={busy || loadingBusinesses}
            >
              {t.newBrandCta}
            </button>
          </div>
        )}
        {businesses.map((brand) => {
          const isActive = brand.id === activeBrandId
          const isPending = brand.id === pendingBrandId
          const isOpen = openByBrand[brand.id] ?? false
          const cached = sessionsByBrand?.[brand.id]
          const brandSessions = cached
            ?? (isActive ? sessions.filter((s) => s.business_id === brand.id) : [])
          const count = sessionCounts[brand.id] ?? brandSessions.length
          const brandLoading = Boolean(loadingByBrand[brand.id] && cached === undefined)
            || (isActive && loadingSessions && cached === undefined)
          const showAll = showAllByBrand[brand.id] ?? false
          const visibleSessions = showAll
            ? brandSessions
            : brandSessions.slice(0, SIDEBAR_SESSION_VISIBLE_CAP)
          const olderCount = Math.max(0, brandSessions.length - SIDEBAR_SESSION_VISIBLE_CAP)
          const titledSessions = visibleSessions.map((session) => {
            const resolved = resolveSessionSidebarTitle({
              session,
              firstUserMessage: firstUserPreviews[session.id],
              language,
            })
            return { session, ...resolved }
          })
          const uniqueLabels = uniquifySidebarLabels(
            titledSessions.map((row) => ({ id: row.session.id, label: row.label }))
          )

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
                  className={`chat-shell__nav-item chat-shell__nav-button chat-shell__brand-name${isActive ? ' is-active' : ''}${isPending ? ' is-pending' : ''}`}
                  onClick={() => selectBrand(brand.id)}
                >
                  <span className="chat-shell__nav-item-label">{brand.name}</span>
                  {!isOpen && (
                    <span className="chat-shell__brand-count" aria-label={`${count} chats`}>
                      {count}
                    </span>
                  )}
                </button>
                {brandAction?.kind === 'confirm' && brandAction.brandId === brand.id ? (
                  <div className="chat-shell__brand-trail" data-session-menu="1">
                    <button
                      type="button"
                      className="chat-shell__session-more chat-shell__brand-more"
                      aria-label={t.cancel}
                      disabled={busy}
                      onPointerDown={isolateMorePointer}
                      onClick={(e) => {
                        isolateMorePointer(e)
                        setBrandAction(null)
                      }}
                    >
                      <X size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="chat-shell__session-more chat-shell__brand-more is-danger"
                      aria-label={`${t.confirmDeleteFolder} ${brand.name}`}
                      title={t.confirmDeleteFolder}
                      disabled={busy}
                      onPointerDown={isolateMorePointer}
                      onClick={(e) => {
                        isolateMorePointer(e)
                        confirmBrandDelete()
                      }}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="chat-shell__session-more chat-shell__brand-more"
                    aria-label={`${t.deleteFolder} ${brand.name}`}
                    disabled={busy}
                    data-session-menu="1"
                    onPointerDown={isolateMorePointer}
                    onClick={(e) => {
                      isolateMorePointer(e)
                      requestBrandDeleteConfirm(brand.id, brand.name)
                    }}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="chat-shell__nav-subs">
                  {brandLoading && (
                    <div className="chat-shell__nav-loading" aria-live="polite">
                      {t.loadingSessions}
                    </div>
                  )}
                  {!brandLoading && brandSessions.length === 0 && (
                    <div className="chat-shell__nav-empty">
                      <div className="chat-shell__nav-empty-copy">{t.noChats}</div>
                      <p className="chat-shell__nav-empty-detail">
                        {t.noChatsDetail}
                      </p>
                      <button
                        type="button"
                        className="chat-shell__nav-sub chat-shell__nav-button chat-shell__nav-empty-cta"
                        onClick={() => {
                          if (!isActive) {
                            selectBrand(brand.id)
                            return
                          }
                          onNewSession()
                        }}
                        disabled={busy || loadingBusinesses}
                        aria-disabled={busy || loadingBusinesses}
                      >
                        {t.newChat}
                      </button>
                    </div>
                  )}
                  {titledSessions.map(({ session, fullTitle }) => {
                    const label = uniqueLabels[session.id] || fullTitle
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
                              <span className="chat-shell__session-tag" aria-label={t.quickSessionTag}>
                                {t.quickSessionTag}
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
                      {t.showOlder.replace('{count}', String(olderCount))}
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
                      {t.showLess}
                    </button>
                  )}
                  {brandSessions.length > 0 && (
                    <button
                      type="button"
                      className="chat-shell__nav-sub chat-shell__nav-button"
                      onClick={() => {
                        if (!isActive) selectBrand(brand.id)
                        onNewSession()
                      }}
                      disabled={!canCreate}
                      aria-disabled={!canCreate}
                    >
                      + {t.newSession}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        </div>
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
            {t.delete}
          </button>
        </div>
      )}

      {sessionAction?.kind === 'confirm' && (
        <div
          className="chat-shell__session-confirm"
          role="group"
          aria-label={t.delete}
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
            {t.cancel}
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
            {t.delete}
          </button>
        </div>
      )}

      <div className="chat-shell__user">
        <div className="chat-shell__avatar" aria-hidden>{initials}</div>
        <div className="chat-shell__user-copy">
          <div className="chat-shell__user-name">
            <span className="chat-shell__user-name-text">{displayName}</span>
          </div>
          <div className="chat-shell__user-meta">
            {usage.loading
              ? ''
              : `${t.scriptsUsed} ${usage.scriptsUsed}/${usage.scriptsLimit === -1 ? '∞' : usage.scriptsLimit} · ${t.imagesUsed} ${usage.imagesUsed}/${usage.imagesLimit === -1 ? '∞' : usage.imagesLimit}`}
          </div>
        </div>
        {onSwitchToClassic && (
          <button
            type="button"
            className="chat-shell__classic-btn"
            aria-label={t.useClassic}
            title={t.useClassic}
            onClick={onSwitchToClassic}
          >
            {t.classicShort}
          </button>
        )}
        <button
          type="button"
          className="chat-shell__icon-btn chat-shell__icon-btn--ghost"
          aria-label={t.settings}
          title={t.settings}
          onClick={onOpenSettings}
        >
          <Settings size={15} aria-hidden />
        </button>
      </div>
    </aside>
  )
}
