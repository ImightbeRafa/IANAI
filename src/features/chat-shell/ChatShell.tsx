import { useCallback, useEffect, useState } from 'react'
import { Menu, PanelRight } from 'lucide-react'
import type { BrandKit, ChatSession } from '../../types'
import { getBrandKits } from '../../services/database'
import { useLanguage } from '../../contexts/LanguageContext'
import ChatSidebar from './ChatSidebar'
import ChatThread from './ChatThread'
import ChatContextRail, { type RailTab } from './ChatContextRail'
import ThemeToggle from './ThemeToggle'
import type { ChatShellTheme } from './chatShellTheme'
import { useChatShellWorkspace } from './useChatShellWorkspace'
import { useChatSessionThread } from './useChatSessionThread'
import { readAiMemoryEnabled } from './chatShellGenerationPreferences'

interface ChatShellProps {
  theme: ChatShellTheme
  onToggleTheme: () => void
  displayName: string
  initials: string
  userId: string
}

export default function ChatShell({
  theme,
  onToggleTheme,
  displayName,
  initials,
  userId,
}: ChatShellProps) {
  const [navOpen, setNavOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(true)
  const [railTab, setRailTab] = useState<RailTab>('context')
  const { language } = useLanguage()
  const [brandKits, setBrandKits] = useState<BrandKit[]>([])
  const [aiMemoryEnabled] = useState(() => readAiMemoryEnabled(
    typeof localStorage !== 'undefined' ? localStorage : null
  ))
  const workspace = useChatShellWorkspace(userId)
  const patchActiveSession = workspace.patchActiveSession

  const onSessionPatched = useCallback((session: ChatSession) => {
    patchActiveSession(session)
  }, [patchActiveSession])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const kits = await getBrandKits(userId)
        if (!cancelled) setBrandKits(kits.filter((k) => k.is_active !== false))
      } catch {
        if (!cancelled) setBrandKits([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId])

  const thread = useChatSessionThread({
    userId,
    brand: workspace.activeBrand,
    session: workspace.activeSession,
    onSessionPatched,
    language,
    aiMemoryEnabled,
    brandKits,
  })

  // S3 refs pause: surface Images rail so user can upload offer Ref (no inline uploader).
  useEffect(() => {
    if (thread.imageClarify?.step === 'refs') {
      setRailOpen(true)
      setRailTab('images')
    }
  }, [thread.imageClarify?.step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavOpen(false)
        setRailOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // New / empty session → open Context so the setup interview is visible.
  useEffect(() => {
    const session = workspace.activeSession
    if (!session) return
    const empty = !(session.context || '').trim() || !session.primary_channel
    if (empty) {
      setRailTab('context')
      setRailOpen(true)
    }
  }, [workspace.activeSession?.id])

  const selectRailTab = (tab: RailTab) => {
    if (railOpen && railTab === tab) {
      setRailOpen(false)
      return
    }
    setRailTab(tab)
    setRailOpen(true)
  }

  const shellClass = [
    'chat-shell',
    navOpen ? 'is-nav-open' : '',
    railOpen ? 'is-rail-open' : '',
  ].filter(Boolean).join(' ')

  const crumbs = [
    workspace.activeBrand?.name || 'No brand',
    workspace.activeSession?.title || 'No session',
    thread.activeProduct?.name || (workspace.activeSession ? 'No offer' : null),
  ].filter(Boolean).join(' / ')

  const offerCount =
    thread.offers.length > 0
      ? thread.offers.length
      : thread.activeProduct
        ? 1
        : 0

  return (
    <div className={shellClass} data-theme={theme}>
      {navOpen && (
        <button
          type="button"
          className="chat-shell__drawer-backdrop"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}

      <ChatSidebar
        displayName={displayName}
        initials={initials}
        businesses={workspace.businesses}
        sessions={workspace.sessions}
        sessionCounts={workspace.sessionCounts}
        firstUserPreviews={workspace.firstUserPreviews}
        activeBrandId={workspace.activeBrandId}
        activeSessionId={workspace.activeSessionId}
        loadingBusinesses={workspace.loadingBusinesses}
        loadingSessions={workspace.loadingSessions}
        busy={workspace.busy}
        error={workspace.error}
        notice={workspace.notice}
        onSelectBrand={workspace.selectBrand}
        onSelectSession={workspace.selectSession}
        onNewChat={() => void workspace.createSession()}
        onQuickGenerate={() => void workspace.createQuickSession()}
        onNewSession={() => void workspace.createSession()}
        onDeleteSession={(sessionId) => void workspace.deleteSession(sessionId)}
      />

      <section className="chat-shell__main">
        <header className="chat-shell__topbar">
          <div className="chat-shell__topbar-left">
            <div className="chat-shell__mobile-bar">
              <button
                type="button"
                className="chat-shell__icon-btn"
                aria-label="Open navigation"
                onClick={() => setNavOpen(true)}
              >
                <Menu size={16} />
              </button>
            </div>
            <div className="chat-shell__crumbs">{crumbs}</div>
            <span className="chat-shell__style-tag">
              Style · C · Obsidian {theme === 'obsidian-dark' ? 'electric' : 'daylight'}
            </span>
          </div>
          <div className="chat-shell__topbar-pills" role="tablist" aria-label="Stage panels">
            <button
              type="button"
              className={`chat-shell__top-pill${railOpen && railTab === 'context' ? ' is-on' : ''}`}
              aria-pressed={railOpen && railTab === 'context'}
              onClick={() => selectRailTab('context')}
            >
              Context
            </button>
            <button
              type="button"
              className={`chat-shell__top-pill${railOpen && railTab === 'offers' ? ' is-on' : ''}`}
              aria-pressed={railOpen && railTab === 'offers'}
              onClick={() => selectRailTab('offers')}
            >
              Offers <span className="chat-shell__count">{offerCount}</span>
            </button>
            <button
              type="button"
              className={`chat-shell__top-pill${railOpen && railTab === 'images' ? ' is-on' : ''}`}
              aria-pressed={railOpen && railTab === 'images'}
              onClick={() => selectRailTab('images')}
            >
              Images <span className="chat-shell__count">{thread.filteredOfferImages.length}</span>
            </button>
          </div>
          <div className="chat-shell__topbar-actions">
            <button
              type="button"
              className="chat-shell__icon-btn chat-shell__rail-toggle"
              aria-label={railOpen ? 'Close context rail' : 'Open context rail'}
              aria-pressed={railOpen}
              onClick={() => setRailOpen((open) => !open)}
            >
              <PanelRight size={16} />
            </button>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
        </header>
        <ChatThread
          brand={workspace.activeBrand}
          session={workspace.activeSession}
          messages={thread.messages}
          loadingMessages={thread.loadingMessages}
          sending={thread.sending}
          savingScript={thread.savingScript}
          activeProduct={thread.activeProduct}
          offerProductId={thread.offerProductId}
          offerCount={offerCount}
          latestImagesByOffer={thread.latestImagesByOffer}
          imageBusy={thread.imageBusy}
          composer={thread.composer}
          onComposerChange={thread.setComposer}
          onSend={() => void thread.send()}
          error={thread.error}
          notice={thread.notice}
          failedBatch={thread.failedBatch}
          onRetryFailedOffers={() => void thread.retryFailedOffers()}
          onSaveScript={thread.handleSaveScript}
          onEditScript={thread.handleEditScript}
          onSaveVersion={thread.handleSaveVersion}
          language={language}
          imageClarify={thread.imageClarify}
          onAnswerImageClarify={(answer) => void thread.answerImageClarify(answer)}
          onCancelImageClarify={() => thread.cancelImageClarify()}
          onOpenImagesRail={() => {
            setRailOpen(true)
            setRailTab('images')
          }}
          onGenerateImageFromScript={(scriptText, productId, scriptTitle) =>
            void thread.generateImageFromScript(scriptText, productId, scriptTitle)
          }
          onEditOfferImage={(productImageId, imageUrl, instruction, productId) =>
            thread.editOfferImage(productImageId, imageUrl, instruction, productId)
          }
          onOptimizeOfferImage={(productImageId, imageUrl, productId, scriptText) =>
            thread.optimizeOfferImage(productImageId, imageUrl, productId, scriptText)
          }
        />
      </section>

      <ChatContextRail
        tab={railTab}
        onTabChange={setRailTab}
        onClose={() => setRailOpen(false)}
        brand={workspace.activeBrand}
        session={workspace.activeSession}
        offers={thread.offers}
        brandProducts={thread.brandProducts}
        activeProduct={thread.activeProduct}
        offerBusy={thread.sending}
        onPatchSession={(updates) => void thread.patchSession(updates)}
        onAddOffer={(productId) => void thread.addOffer(productId)}
        onRemoveOffer={(productId) => void thread.removeOffer(productId)}
        onMoveOffer={(productId, direction) => void thread.moveOffer(productId, direction)}
        activeImageOfferId={thread.activeImageOfferId}
        offerImages={thread.filteredOfferImages}
        imageBusy={thread.imageBusy}
        onSelectImageOffer={thread.selectImageOffer}
        onUploadOfferImage={(file) => void thread.uploadOfferImage(file)}
        onGenerateOfferImage={() => void thread.generateOfferImage()}
        imagePrefs={thread.imagePrefs}
        onPatchImagePreferences={thread.patchImagePreferences}
        language={language}
      />
    </div>
  )
}
