import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Menu, PanelRight } from 'lucide-react'
import type { BrandKit, ChatSession, ProductType } from '../../types'
import { getBrandKits, createProduct } from '../../services/database'
import { useLanguage } from '../../contexts/LanguageContext'
import ChatSidebar from './ChatSidebar'
import ChatBrandCreateModal from './ChatBrandCreateModal'
import ChatSettingsDialog from './ChatSettingsDialog'
import ChatBrandSetupCard from './ChatBrandSetupCard'
import ChatBrandProfileCard from './ChatBrandProfileCard'
import ChatThread from './ChatThread'
import ChatContextRail, { type RailPane, type RailTab } from './ChatContextRail'
import ChatShellImageLightbox from './ChatShellImageLightbox'
import type { ChatShellTheme } from './chatShellTheme'
import { useChatShellWorkspace } from './useChatShellWorkspace'
import { useChatSessionThread } from './useChatSessionThread'
import { useChatBrandSetup } from './useChatBrandSetup'
import { shellT } from './chatShellLabels'
import { parseShellCommand } from './chatShellCommands'
import { getTextModelPreference } from './textModelPreference'
import { readAiMemoryEnabled, type BrandVisualFallback } from './chatShellGenerationPreferences'
import { isBrandContextEditRequest, isBrandRuleRequest, isExplicitGenerationRequest, SETUP_COMPOSER_PLACEHOLDER } from './chatShellBrandSetupFlow'
import { isScriptContent, parseScripts } from '../../utils/scriptParser'
import type { ProductImage } from '../../services/database'
import { useChatShellRollout } from './ChatShellRolloutContext'

interface ChatShellProps {
  theme: ChatShellTheme
  onThemeChange: (theme: ChatShellTheme) => void
  displayName: string
  initials: string
  userId: string
}

export default function ChatShell({
  theme,
  onThemeChange,
  displayName,
  initials,
  userId,
}: ChatShellProps) {
  const navigate = useNavigate()
  const rollout = useChatShellRollout()
  const [navOpen, setNavOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
  const [railTab, setRailTab] = useState<RailTab>('context')
  const [railPane, setRailPane] = useState<RailPane>('index')
  const [brandCreateOpen, setBrandCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [lightbox, setLightbox] = useState<{
    url: string
    alt: string
    productName?: string | null
    productId: string
    productImageId: string
  } | null>(null)
  const { language } = useLanguage()
  const t = shellT(language)
  const [brandKits, setBrandKits] = useState<BrandKit[]>([])
  const brandVisualRef = useRef<BrandVisualFallback>({})
  const lastActionRef = useRef<{ text: string; at: number }>({ text: '', at: 0 })
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
    brandVisualRef,
  })

  const brandSetup = useChatBrandSetup({
    userId,
    language,
    business: workspace.activeBrand,
    session: workspace.activeSession,
    brandSessions: workspace.sessions,
    products: thread.brandProducts,
    brandKits,
    loaded: !workspace.loadingBusinesses && !workspace.loadingSessions,
    onBusinessPatched: workspace.patchBrand,
    onProductsChanged: () => thread.refreshBrandProducts(),
    onKitCreated: (kit) => setBrandKits((prev) => [kit, ...prev.filter((row) => row.id !== kit.id)]),
    onLinkKit: (kitId) => thread.patchSession({ brand_kit_id: kitId }),
    onAttachOffer: (productId) => thread.addOffer(productId),
    onPatchSession: (updates) => thread.patchSession(updates),
    onPersistTurn: async (role, content) => {
      await thread.persistTurn(role, content)
    },
    messageCount: thread.messages.length,
    messagesLoading: thread.loadingMessages,
  })

  brandVisualRef.current = {
    primary_color: brandSetup.facts.primary_color,
    secondary_color: brandSetup.facts.secondary_color,
    accent_color: brandSetup.facts.accent_color,
    logo_url: brandSetup.facts.logo_url,
  }

  const activeCreateAction = thread.scriptClarify
    ? 'scripts' as const
    : thread.imageClarify?.mode === 'product' || thread.imageClarify?.preferences?.style?.kind === 'product'
      ? 'product' as const
      : thread.imageClarify
        ? 'post' as const
        : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (lightbox) {
        setLightbox(null)
        return
      }
      if (brandCreateOpen || settingsOpen) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (railPane === 'detail') {
        setRailPane('index')
        return
      }
      setNavOpen(false)
      setRailOpen(false)
      setRailPane('index')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [brandCreateOpen, settingsOpen, lightbox, railPane])

  const selectRailTab = useCallback((tab: RailTab) => {
    setRailTab(tab)
    setRailPane('detail')
    setRailOpen(true)
  }, [])

  const send = thread.send
  const patchImagePreferences = thread.patchImagePreferences
  const generateScripts = thread.generateScripts

  const handleSend = useCallback(async (text: string) => {
    const fingerprint = text.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
    const now = Date.now()
    if (fingerprint && lastActionRef.current.text === fingerprint && now - lastActionRef.current.at < 900) {
      return { ignored: true }
    }
    lastActionRef.current = { text: fingerprint, at: now }
    const command = parseShellCommand(text)
    if (command?.href) {
      navigate(command.href)
      return
    }
    if (command?.id === 'brand') {
      selectRailTab('brand')
      return
    }
    if (command?.id === 'script') {
      if (command.rest) return send(command.rest)
      return send(language === 'es' ? 'Quiero crear guiones' : 'I want to create scripts')
    }
    if (command?.id === 'post') {
      return send(command.rest ? `post ${command.rest}` : 'post')
    }
    if (command?.id === 'product') {
      return send(command.rest ? `foto de producto ${command.rest}` : 'foto de producto')
    }
    if (command?.id === 'logo') {
      return send(command.rest ? `logo ${command.rest}` : 'logo')
    }
    if (isBrandRuleRequest(text)) {
      return brandSetup.addRule(text)
    }
    if (isBrandContextEditRequest(text)) {
      return brandSetup.changeContext(text)
    }
    if (brandSetup.visible && brandSetup.phase !== 'complete' && brandSetup.phase !== 'paused' && !isExplicitGenerationRequest(text)) {
      return brandSetup.reply(text)
    }
    return send(text)
  }, [navigate, send, brandSetup, language, selectRailTab])

  const startLogo = useCallback((archetype?: string) => {
    patchImagePreferences({
      style: { kind: 'logo', archetype: archetype || 'auto' },
      aspectRatio: '1:1',
      logoMode: 'generate',
    })
    setRailPane('index')
    void handleSend(language === 'es' ? 'Quiero crear un logo' : 'I want to create a logo')
  }, [handleSend, language, patchImagePreferences])

  const openOffersRail = useCallback(() => {
    setRailTab('offers')
    setRailPane('detail')
    setRailOpen(true)
  }, [])

  const openLightbox = useCallback((image: {
    url: string
    alt: string
    productName?: string | null
    productId: string
    productImageId: string
  }) => {
    setLightbox(image)
  }, [])

  const openOfferImage = useCallback((image: ProductImage) => {
    const product = thread.brandProducts.find((p) => p.id === image.product_id)
    openLightbox({
      url: image.image_url,
      alt: image.label || product?.name || 'Image',
      productName: product?.name,
      productId: image.product_id,
      productImageId: image.id,
    })
  }, [openLightbox, thread.brandProducts])

  const requestImageEdit = useCallback(async (reason: string) => {
    if (!lightbox) return
    await thread.editOfferImage(lightbox.productImageId, lightbox.url, reason, lightbox.productId)
    setLightbox(null)
    return
    if (!lightbox) return
    const offerName = lightbox?.productName || 'Image'
    const title = language === 'es' ? `Edición · ${offerName}` : `Edit · ${offerName}`
    const userText = language === 'es'
      ? `Editar esta imagen: ${reason}`
      : `Edit this image: ${reason}`
    const assistantText = t.editSessionSeed
    const created = await workspace.createImageEditSession({
      title,
      productId: lightbox?.productId || '',
      productImageId: lightbox?.productImageId || '',
      userText,
      assistantText,
    })
    if (created) setLightbox(null)
  }, [language, lightbox, t.editSessionSeed, thread, workspace])

  const quickEnhanceImage = useCallback(async (mode: 'magic' | 'rebuild') => {
    if (!lightbox) return
    const instruction = mode === 'rebuild'
      ? (language === 'es'
        ? 'Reconstruye el diseño con una composición premium y jerarquía más clara. Conserva exactamente el producto, la marca, el logo, los colores, el texto correcto y todas las reglas guardadas.'
        : 'Rebuild the design with a premium composition and clearer hierarchy. Preserve the exact product, brand, logo, correct copy, colors, and every saved rule.')
      : (language === 'es'
        ? 'Mejora la composición, iluminación, tipografía y acabado profesional sin cambiar el producto, la marca, el mensaje ni las reglas guardadas.'
        : 'Improve composition, lighting, typography, and professional finish without changing the product, brand, message, or saved rules.')
    await thread.editOfferImage(lightbox.productImageId, lightbox.url, instruction, lightbox.productId, 'enhance')
    setLightbox(null)
  }, [language, lightbox, thread])

  const openBrandCreate = useCallback(() => {
    setBrandCreateOpen(true)
  }, [])

  const closeBrandCreate = useCallback(() => {
    if (workspace.busy) return
    setBrandCreateOpen(false)
  }, [workspace.busy])

  const submitBrandCreate = useCallback(async (name: string) => {
    const ok = await workspace.createBrand(name)
    if (ok) setBrandCreateOpen(false)
  }, [workspace])

  const handleCreateOffer = useCallback(async (name: string, type: ProductType) => {
    const brand = workspace.activeBrand
    if (!brand || thread.offerMutating) return false
    try {
      const product = await createProduct(
        { name, type, business_id: brand.id },
        userId
      )
      await thread.refreshBrandProducts()
      await thread.addOffer(product.id)
      setRailTab('offers')
      setRailPane('detail')
      setRailOpen(true)
      return true
    } catch (err) {
      console.error(err)
      return false
    }
  }, [thread, userId, workspace.activeBrand])

  const handleSwitchToClassic = useCallback(() => {
    if (!rollout.showSwitch) return
    if (!window.confirm(t.classicConfirm)) return
    void rollout.setPreferredUi('classic').then((ok) => {
      if (ok) navigate('/dashboard')
    })
  }, [navigate, rollout, t.classicConfirm])

  const shellClass = [
    'chat-shell',
    navOpen ? 'is-nav-open' : '',
    railOpen ? 'is-rail-open' : '',
    railPane === 'detail' ? 'is-rail-detail' : '',
    workspace.pendingBrandId ? 'is-switching' : '',
  ].filter(Boolean).join(' ')

  const crumbs = [
    workspace.activeBrand?.name,
    workspace.activeSession?.title,
    thread.activeProduct?.name,
  ].filter(Boolean).join(' / ')

  const offerCount =
    thread.offers.length > 0
      ? thread.offers.length
      : thread.activeProduct
        ? 1
        : 0

  const threadScripts = useMemo(() => {
    const items: { id: string; label: string }[] = []
    for (const message of thread.messages) {
      if (message.role !== 'assistant') continue
      const artifacts = message.artifacts || []
      for (const artifact of artifacts) {
        if (artifact.artifact_type !== 'script') continue
        items.push({
          id: artifact.id,
          label: artifact.script?.title || artifact.product?.name || (language === 'es' ? 'Guion' : 'Script'),
        })
      }
      if (artifacts.length === 0 && isScriptContent(message.content)) {
        for (const script of parseScripts(message.content)) {
          items.push({
            id: `${message.id}:${script.index}`,
            label: script.title || `#${script.index}`,
          })
        }
      }
    }
    return items.slice(-8).reverse()
  }, [language, thread.messages])

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
        sessionsByBrand={workspace.sessionsByBrand}
        pendingBrandId={workspace.pendingBrandId}
        loadingByBrand={workspace.loadingByBrand}
        sessionCounts={workspace.sessionCounts}
        firstUserPreviews={workspace.firstUserPreviews}
        activeBrandId={workspace.activeBrandId}
        activeSessionId={workspace.activeSessionId}
        loadingBusinesses={workspace.loadingBusinesses}
        loadingSessions={workspace.loadingSessions}
        busy={thread.imageBusy}
        error={workspace.error}
        notice={workspace.notice}
        onSelectBrand={workspace.selectBrand}
        onPrefetchBrandSessions={workspace.prefetchBrandSessions}
        onSelectSession={workspace.selectSession}
        onNewChat={() => void workspace.createSession()}
        onNewSession={() => void workspace.createSession()}
        onNewBrand={openBrandCreate}
        onDeleteSession={(sessionId) => void workspace.deleteSession(sessionId)}
        onDeleteBrand={(brandId) => void workspace.deleteBrand(brandId)}
        onOpenSettings={() => setSettingsOpen(true)}
        onSwitchToClassic={rollout.showSwitch ? handleSwitchToClassic : undefined}
      />

      <ChatSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onThemeChange={onThemeChange}
      />

      <ChatBrandCreateModal
        open={brandCreateOpen}
        busy={workspace.busy}
        error={brandCreateOpen ? workspace.error : null}
        language={language}
        onClose={closeBrandCreate}
        onSubmit={submitBrandCreate}
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
            <div className="chat-shell__crumbs">{crumbs || t.chat}</div>
            <span className="chat-shell__model-tag">
              {getTextModelPreference() === 'efficient' ? t.efficientModel : t.bestModel}
            </span>
          </div>
          <div className="chat-shell__topbar-actions">
            <button
              type="button"
              className="chat-shell__icon-btn chat-shell__rail-toggle"
              aria-label={railOpen ? t.closeRail : t.openRail}
              aria-pressed={railOpen}
              onClick={() => setRailOpen((open) => !open)}
            >
              <PanelRight size={16} />
            </button>
          </div>
        </header>
        <ChatThread
          key={workspace.activeSession?.id || workspace.activeBrand?.id || 'empty'}
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
          offerImages={thread.offerImages}
          imageBusy={thread.imageBusy}
          setupBusy={brandSetup.busy}
          imageModel={thread.imagePrefs.model}
          imageAspect={thread.imagePrefs.aspectRatio}
          scriptType={thread.scriptSettings.framework}
          walkProgress={thread.walkProgress}
          onSend={handleSend}
          onNeedOffers={openOffersRail}
          error={thread.error || brandSetup.error}
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
          scriptClarify={thread.scriptClarify}
          onSelectImageOffer={thread.selectImageOffer}
          onLatestVersionChange={thread.registerScriptSnapshot}
          onAnswerScriptClarify={(answer) => void thread.answerScriptClarify(answer)}
          onCancelScriptClarify={() => thread.cancelScriptClarify()}
          onOpenImagesRail={() => selectRailTab('images')}
          onUploadOfferReference={(file, kind) => thread.uploadOfferImage(file, undefined, kind)}
          onRemoveOfferReference={(imageId) => thread.removeOfferImage(imageId)}
          onPreparePostFromScript={(scriptText, density) => thread.prepareScriptForPost(scriptText, density)}
          onGenerateImageFromScript={(scriptText, productId, scriptTitle, options) =>
            void thread.generateImageFromScript(scriptText, productId, scriptTitle, options)
          }
          onOpenOfferImage={openLightbox}
          onEditOfferImage={(productImageId, imageUrl, instruction, productId) =>
            thread.editOfferImage(productImageId, imageUrl, instruction, productId)
          }
          setupCard={brandSetup.trackerVisible ? (
            <ChatBrandSetupCard
              key={workspace.activeSession?.id || 'no-session'}
              language={language}
              setup={brandSetup}
            />
          ) : null}
          inlineSetupCard={
            brandSetup.profileVisible
            && (brandSetup.visible || brandSetup.phase === 'confirm_offer' || brandSetup.phase === 'complete')
            && (brandSetup.facts.businessName || brandSetup.facts.offerName)
              ? (
            <ChatBrandProfileCard
              key={workspace.activeSession?.id || 'no-session'}
              language={language}
              facts={brandSetup.facts}
              busy={brandSetup.busy}
              confirmed={brandSetup.facts.offerConfirmed || brandSetup.phase === 'complete'}
              evidence={brandSetup.siteEvidence}
              pages={brandSetup.sitePages}
              activeCreateAction={activeCreateAction}
              onSave={brandSetup.saveProfile}
              onUpload={brandSetup.uploadBrandAsset}
              onCreateScripts={() => {
                thread.cancelImageClarify()
                void handleSend(language === 'es' ? 'Quiero crear guiones' : 'I want to create scripts')
              }}
              onCreatePost={() => {
                thread.cancelScriptClarify()
                void handleSend(language === 'es' ? 'Quiero crear un post' : 'I want to create a post')
              }}
              onCreateProductPhoto={() => {
                thread.cancelScriptClarify()
                patchImagePreferences({ style: { kind: 'product', productSubStyle: 'studio-hero' } })
                void handleSend(language === 'es' ? 'Quiero crear una foto de producto' : 'I want to create a product photo')
              }}
              onCreateOther={() => void thread.persistTurn(
                'assistant',
                language === 'es'
                  ? '¿Qué querés crear? Podés pedirme un guion, post, foto de producto, logo u otra pieza y te voy guiando.'
                  : 'What would you like to create? Ask for a script, post, product photo, logo, or another asset and I’ll guide you.'
              )}
            />
          ) : null}
          onUploadBrandAsset={(file, kind) => void brandSetup.uploadBrandAsset(file, kind)}
          onUploadSetupDocument={(file) => void brandSetup.uploadSetupDocument(file)}
          setupTurns={[]}
          setupPlaceholder={
            brandSetup.visible && brandSetup.phase !== 'complete' && brandSetup.phase !== 'paused'
              ? SETUP_COMPOSER_PLACEHOLDER[language]
              : undefined
          }
        />
      </section>

      <ChatContextRail
        tab={railTab}
        pane={railPane}
        onTabChange={selectRailTab}
        onBackToIndex={() => setRailPane('index')}
        onClose={() => {
          setRailPane('index')
          setRailOpen(false)
        }}
        brand={workspace.activeBrand}
        session={workspace.activeSession}
        offers={thread.offers}
        brandProducts={thread.brandProducts}
        unassignedProducts={thread.unassignedProducts}
        onAssignUnassignedProduct={(productId) => void thread.assignUnassignedProduct(productId)}
        onDeleteUnassignedProduct={(productId) => void thread.deleteUnassignedProduct(productId)}
        onClearUnassignedProducts={() => void thread.clearUnassignedProducts()}
        activeProduct={thread.activeProduct}
        offerBusy={thread.offerMutating}
        linkedOfferIds={thread.linkedOfferIds}
        brandKits={brandKits}
        onSelectBrandKit={(kitId) => void thread.patchSession({ brand_kit_id: kitId })}
        onPatchSession={(updates) => void thread.patchSession(updates)}
        onKeepSessionSelected={workspace.keepSessionSelected}
        onAddOffer={(productId) => void thread.addOffer(productId)}
        onCreateOffer={handleCreateOffer}
        onRemoveOffer={(productId) => void thread.removeOffer(productId)}
        onMoveOffer={(productId, direction) => void thread.moveOffer(productId, direction)}
        activeImageOfferId={thread.activeImageOfferId}
        offerImages={thread.filteredOfferImages}
        imageBusy={thread.imageBusy}
        onSelectImageOffer={thread.selectImageOffer}
        onUploadOfferImage={(file, kind) => void thread.uploadOfferImage(file, undefined, kind)}
        onRemoveOfferImage={(imageId) => void thread.removeOfferImage(imageId)}
        onGenerateOfferImage={() => void thread.generateOfferImage()}
        onOpenOfferImage={openOfferImage}
        onRequestImageEdit={openOfferImage}
        imagePrefs={thread.imagePrefs}
        onPatchImagePreferences={thread.patchImagePreferences}
        onStartLogo={startLogo}
        scriptSettings={thread.scriptSettings}
        onScriptSettingsChange={thread.setScriptSettings}
        onGenerateScripts={() => void generateScripts()}
        sending={thread.sending}
        language={language}
        threadScripts={threadScripts}
        onOpenSettings={() => setSettingsOpen(true)}
        onImproveSetup={brandSetup.reopen}
        onAskChatContext={() => {
          setRailPane('index')
          void brandSetup.requestContextEdit()
        }}
        contextEditor={workspace.activeSession ? (
          <ChatBrandProfileCard
            key={`rail-${workspace.activeSession.id}`}
            language={language}
            facts={brandSetup.facts}
            busy={brandSetup.busy}
            evidence={brandSetup.siteEvidence}
            pages={brandSetup.sitePages}
            defaultExpanded
            showCreateActions={false}
            onSave={brandSetup.saveProfile}
            onUpload={brandSetup.uploadBrandAsset}
            onCreateScripts={() => {}}
            onCreatePost={() => {}}
            onCreateProductPhoto={() => {}}
            onCreateOther={() => {}}
          />
        ) : null}
      />

      <ChatShellImageLightbox
        open={Boolean(lightbox)}
        url={lightbox?.url || ''}
        alt={lightbox?.alt}
        productName={lightbox?.productName}
        language={language}
        busy={workspace.busy}
        onClose={() => setLightbox(null)}
        onRequestEdit={(reason) => void requestImageEdit(reason)}
        onQuickEnhance={(mode) => void quickEnhanceImage(mode)}
      />
    </div>
  )
}
