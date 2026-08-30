import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, MoreHorizontal, Trash2, X } from 'lucide-react'
import type { Business, ChatSession, ChatSessionOffer, Product, ProductType, Script } from '../../types'
import type { ChatSessionSafeUpdates, PostListItem, ProductImage } from '../../services/database'
import { CHAT_SHELL_MAX_OFFERS, displaySessionOffers, sortOffersByPosition } from './sessionOffer'
import { Link } from 'react-router-dom'
import { LOGO_ARCHETYPES } from '../../data/image-presets'
import type { BrandKit, ScriptGenerationSettings } from '../../types'
import { shellT } from './chatShellLabels'
import ChatScriptPanel from './ChatScriptPanel'
import ChatImageSettingsPanel from './ChatImageSettingsPanel'
import ChatOfferCreateForm from './ChatOfferCreateForm'
import type { ShellImagePreferences } from './chatShellImageIntent'
import { buildImageWorkspaces, latestGeneratedPerWorkspace } from './chatShellImages'
import { IconDoc, IconImage, IconOffer, IconVisual, IconWeb } from './ChatShellIcons'

export type RailTab = 'context' | 'offers' | 'images' | 'scripts' | 'brand' | 'more'
export type RailPane = 'index' | 'detail'

const OPTION_TABS: RailTab[] = ['context', 'offers', 'images', 'scripts', 'brand', 'more']

function optionIcon(tab: RailTab) {
  switch (tab) {
    case 'context':
      return <IconWeb size={14} />
    case 'offers':
      return <IconOffer size={14} />
    case 'images':
      return <IconImage size={14} />
    case 'scripts':
      return <IconDoc size={14} />
    case 'brand':
      return <IconVisual size={14} />
    case 'more':
      return <MoreHorizontal size={14} />
    default: {
      const _never: never = tab
      return _never
    }
  }
}

interface ChatContextRailProps {
  tab: RailTab
  pane?: RailPane
  onTabChange: (tab: RailTab) => void
  onBackToIndex?: () => void
  onClose: () => void
  brand?: Business | null
  session?: ChatSession | null
  offers?: ChatSessionOffer[]
  brandProducts?: Product[]
  unassignedProducts?: Product[]
  onAssignUnassignedProduct?: (productId: string) => void | Promise<void>
  onDeleteUnassignedProduct?: (productId: string) => void | Promise<void>
  onClearUnassignedProducts?: () => void | Promise<void>
  activeProduct?: Product | null
  offerBusy?: boolean
  linkedOfferIds?: Set<string>
  brandKits?: BrandKit[]
  onSelectBrandKit?: (kitId: string) => void
  onPatchSession?: (updates: ChatSessionSafeUpdates) => void
  /** Pin URL/active session after Skip so late create cannot snap A→B. */
  onKeepSessionSelected?: (sessionId: string) => void
  onAddOffer?: (productId: string) => void | Promise<void>
  onCreateOffer?: (name: string, type: ProductType) => void | Promise<boolean | void>
  onRemoveOffer?: (productId: string) => void | Promise<void>
  onMoveOffer?: (productId: string, direction: -1 | 1) => void | Promise<void>
  activeImageOfferId?: string | null
  offerImages?: ProductImage[]
  imageBusy?: boolean
  onSelectImageOffer?: (productId: string) => void
  onUploadOfferImage?: (file: File, kind?: 'product' | 'context' | 'scene' | 'style' | 'logo') => void | Promise<void>
  onRemoveOfferImage?: (imageId: string) => void | Promise<void>
  onGenerateOfferImage?: () => void | Promise<void>
  onOpenOfferImage?: (image: ProductImage) => void
  onRequestImageEdit?: (image: ProductImage) => void
  imagePrefs?: ShellImagePreferences
  onPatchImagePreferences?: (patch: Partial<ShellImagePreferences>) => void
  onStartLogo?: (archetype?: string) => void
  onUploadBrandLogo?: (file: File) => void | Promise<void>
  scriptSettings?: ScriptGenerationSettings
  onScriptSettingsChange?: (settings: ScriptGenerationSettings) => void
  onGenerateScripts?: () => void
  sending?: boolean
  language?: 'en' | 'es'
  onOpenSettings?: () => void
  onImproveSetup?: () => void
  contextEditor?: ReactNode
  onAskChatContext?: () => void
  threadScripts?: { id: string; label: string }[]
  classicScripts?: Script[]
  classicPosts?: PostListItem[]
  classicLibraryLoading?: boolean
}

export default function ChatContextRail({
  tab,
  pane = 'index',
  onTabChange,
  onBackToIndex,
  onClose,
  brand = null,
  session = null,
  offers = [],
  brandProducts = [],
  unassignedProducts = [],
  onAssignUnassignedProduct,
  onDeleteUnassignedProduct,
  onClearUnassignedProducts,
  activeProduct = null,
  offerBusy = false,
  linkedOfferIds,
  brandKits = [],
  onSelectBrandKit,
  onPatchSession,
  onAddOffer,
  onCreateOffer,
  onRemoveOffer,
  onMoveOffer,
  activeImageOfferId = null,
  offerImages = [],
  imageBusy = false,
  onSelectImageOffer,
  onUploadOfferImage,
  onRemoveOfferImage,
  onGenerateOfferImage,
  onOpenOfferImage,
  onRequestImageEdit,
  imagePrefs,
  onPatchImagePreferences,
  onStartLogo,
  onUploadBrandLogo,
  scriptSettings,
  onScriptSettingsChange,
  onGenerateScripts,
  sending = false,
  language = 'es',
  onOpenSettings,
  onImproveSetup,
  contextEditor,
  onAskChatContext,
  threadScripts = [],
  classicScripts = [],
  classicPosts = [],
  classicLibraryLoading = false,
}: ChatContextRailProps) {
  const t = shellT(language)
  const [title, setTitle] = useState(session?.title || '')
  const [context, setContext] = useState(session?.context || '')

  useEffect(() => {
    setTitle(session?.title || '')
    setContext(session?.context || '')
  }, [session?.id])

  const saveField = (updates: ChatSessionSafeUpdates) => {
    if (!session || !onPatchSession) return
    onPatchSession(updates)
  }

  const orderedOffers = sortOffersByPosition(offers)
  const displayOffers = displaySessionOffers(orderedOffers, activeProduct?.id || session?.product_id)
  const attachedIds = new Set(displayOffers.map((o) => o.product_id))
  const availableProducts = brandProducts.filter((p) => !attachedIds.has(p.id))
  const channelText = (brand?.sales_channels || []).join(', ') || '—'
  const offerCount = displayOffers.length
  const imageCount = offerImages.length + classicPosts.length
  const scriptsCount = threadScripts.length + classicScripts.length
  const optionLabel = (id: RailTab) => {
    switch (id) {
      case 'context':
        return t.context
      case 'offers':
        return t.offers
      case 'images':
        return t.images
      case 'scripts':
        return t.scripts
      case 'brand':
        return t.brand
      case 'more':
        return t.more
      default: {
        const _never: never = id
        return _never
      }
    }
  }
  const optionCount = (id: RailTab) => {
    if (id === 'offers') return offerCount
    if (id === 'images') return imageCount
    if (id === 'scripts') return scriptsCount
    return null
  }

  if (pane === 'index') {
    const threadRows = [
      ...(activeProduct
        ? [{ id: `offer:${activeProduct.id}`, tab: 'offers' as const, icon: <IconOffer size={14} />, label: activeProduct.name }]
        : []),
      ...offerImages.slice(0, 5).map((image, index) => ({
        id: image.id,
        tab: 'images' as const,
        icon: <IconImage size={14} />,
        label: image.label || `${t.images} ${index + 1}`,
      })),
      ...threadScripts.slice(0, 5).map((script) => ({
        id: script.id,
        tab: 'scripts' as const,
        icon: <IconDoc size={14} />,
        label: script.label,
      })),
    ]

    return (
      <aside className="chat-shell__rail" aria-label={t.workspace}>
        <button
          type="button"
          className="chat-shell__icon-btn chat-shell__rail-close chat-shell__rail-close--mobile"
          aria-label={t.closeRail}
          onClick={onClose}
        >
          <X size={15} />
        </button>
        {threadRows.length > 0 ? (
          <div className="chat-shell__widget-list">
            {threadRows.map((row) => (
              <button
                key={row.id}
                type="button"
                className="chat-shell__widget-row"
                onClick={() => onTabChange(row.tab)}
              >
                {row.icon}
                <span>{row.label}</span>
              </button>
            ))}
          </div>
        ) : null}
        <p className="chat-shell__widget-kicker">{t.options}</p>
        <div className="chat-shell__widget-list">
          {OPTION_TABS.map((id) => {
            const count = optionCount(id)
            return (
              <button
                key={id}
                type="button"
                className="chat-shell__widget-row"
                onClick={() => onTabChange(id)}
              >
                {optionIcon(id)}
                <span>{optionLabel(id)}</span>
                {count != null ? <em className="chat-shell__widget-count">{count}</em> : null}
              </button>
            )
          })}
        </div>
      </aside>
    )
  }

  return (
    <aside className="chat-shell__rail" aria-label={t.workspace}>
      <div className="chat-shell__rail-head">
        <div className="chat-shell__rail-head-title">
          {onBackToIndex ? (
            <button
              type="button"
              className="chat-shell__icon-btn"
              aria-label={t.backToWidget}
              onClick={onBackToIndex}
            >
              <ChevronLeft size={15} />
            </button>
          ) : null}
          <strong>{optionLabel(tab)}</strong>
        </div>
      </div>

      {tab === 'context' && (
        <div className="chat-shell__rail-form">
          {!session ? (
            <p className="chat-shell__rail-note">
              {brand
                ? language === 'es'
                  ? `Marca · ${brand.name}. Elegí una sesión para editar el contexto.`
                  : `Brand · ${brand.name}. Select a session to edit context.`
                : language === 'es'
                  ? 'Elegí una marca y una sesión para editar el contexto.'
                  : 'Select a brand and session to edit context.'}
            </p>
          ) : (
            <>
              <p className="chat-shell__inspector-kicker">{brand?.name || t.noBrand}</p>
              <p className="chat-shell__inspector-copy">
                {language === 'es'
                  ? 'Esta es la fuente de verdad que usa la IA. Podés editarla manualmente o pedir el cambio en el chat; ambas opciones guardan el mismo contexto.'
                  : 'This is the source of truth used by AI. Edit it manually or request a change in chat; both save the same context.'}
              </p>
              {onAskChatContext ? (
                <button type="button" className="chat-shell__setup-btn is-primary" onClick={onAskChatContext}>
                  {language === 'es' ? 'Pedir un cambio en el chat' : 'Request a change in chat'}
                </button>
              ) : null}
              {contextEditor || <dl className="chat-shell__inspector-facts">
                <div>
                  <dt>{language === 'es' ? 'Negocio' : 'Business'}</dt>
                  <dd>{brand?.name || '—'}</dd>
                </div>
                <div>
                  <dt>{language === 'es' ? 'Canales' : 'Channels'}</dt>
                  <dd>{channelText}</dd>
                </div>
                <div>
                  <dt>{language === 'es' ? 'Público' : 'Audience'}</dt>
                  <dd>{brand?.icp_description?.trim() || '—'}</dd>
                </div>
                <div>
                  <dt>{language === 'es' ? 'Oferta' : 'Offer'}</dt>
                  <dd>{activeProduct?.name || (language === 'es' ? 'Sin oferta aún' : 'No offer yet')}</dd>
                </div>
              </dl>}
              <p className="chat-shell__inspector-kicker">{language === 'es' ? 'Preferencias de este chat' : 'This chat’s preferences'}</p>
              <label className="chat-shell__field">
                <span>{language === 'es' ? 'Nombre del chat' : 'Chat name'}</span>
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
                <span>{language === 'es' ? 'Lo que usa el chat' : 'What chat uses'}</span>
                <textarea
                  rows={6}
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  onBlur={() => {
                    if ((context || '') !== (session.context || '')) {
                      saveField({ context })
                    }
                  }}
                  placeholder={language === 'es' ? 'Se llena al confirmar el setup…' : 'Filled when you confirm setup…'}
                />
              </label>
              {onImproveSetup && (
                <button
                  type="button"
                  className="chat-shell__setup-btn"
                  onClick={onImproveSetup}
                >
                  {t.improveSetup}
                </button>
              )}
              <p className="chat-shell__rail-hint">
                {activeProduct
                  ? `${language === 'es' ? 'Oferta' : 'Offer'} · ${activeProduct.name}`
                  : language === 'es' ? 'Sin oferta' : 'No offer'}
              </p>
            </>
          )}
        </div>
      )}

      {tab === 'offers' && (
        <div className="chat-shell__stack">
          {!session ? (
            <p className="chat-shell__rail-hint">{t.selectSessionOffers}</p>
          ) : !session.business_id ? (
            <p className="chat-shell__rail-hint">{t.sessionNoBusiness}</p>
          ) : (
            <>
              {onCreateOffer && displayOffers.length < CHAT_SHELL_MAX_OFFERS ? (
                <ChatOfferCreateForm
                  language={language}
                  busy={offerBusy}
                  onCreate={onCreateOffer}
                />
              ) : null}
              {displayOffers.length === 0 && brandProducts.length === 0 && unassignedProducts.length === 0 ? (
                <p className="chat-shell__rail-hint">{t.noBrandProducts}</p>
              ) : null}
              {(displayOffers.length > 0 || brandProducts.length > 0 || unassignedProducts.length > 0) ? (
            <>
              <p className="chat-shell__rail-hint">
                {t.offersAttachHint.replace('{max}', String(CHAT_SHELL_MAX_OFFERS))}
              </p>
              {displayOffers.length > 0 ? (
                <ol className="chat-shell__offer-list">
                  {displayOffers.map((offer, index) => {
                    const product =
                      ('product' in offer ? offer.product : undefined)
                      || brandProducts.find((p) => p.id === offer.product_id)
                      || (activeProduct?.id === offer.product_id ? activeProduct : null)
                    const label = product?.name ?? offer.product_id.slice(0, 8)
                    return (
                      <li key={offer.product_id} className="chat-shell__offer-row">
                        <div className="chat-shell__offer-main">
                          <span className="chat-shell__offer-pos">{offer.position}</span>
                          <span className="chat-shell__offer-name">{label}</span>
                          {offer.position === 1 ? (
                            <span className="chat-shell__offer-primary">{t.offersPrimary}</span>
                          ) : null}
                        </div>
                        <div className="chat-shell__offer-actions">
                          <button
                            type="button"
                            className="chat-shell__offer-btn"
                            disabled={offerBusy || index === 0}
                            onClick={() => void onMoveOffer?.(offer.product_id, -1)}
                            aria-label={`${t.moveImageUp} ${label}`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="chat-shell__offer-btn"
                            disabled={offerBusy || index === displayOffers.length - 1}
                            onClick={() => void onMoveOffer?.(offer.product_id, 1)}
                            aria-label={`${t.moveImageDown} ${label}`}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="chat-shell__offer-btn"
                            disabled={offerBusy || Boolean(linkedOfferIds?.has(offer.product_id))}
                            title={linkedOfferIds?.has(offer.product_id) ? t.linkedOffer : undefined}
                            onClick={() => void onRemoveOffer?.(offer.product_id)}
                            aria-label={`${t.removeImageRef} ${label}`}
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="chat-shell__rail-hint">{t.offersNoneAttached}</p>
              )}

              {displayOffers.length >= CHAT_SHELL_MAX_OFFERS ? (
                <p className="chat-shell__rail-hint">
                  {t.offersMaxReached.replace('{max}', String(CHAT_SHELL_MAX_OFFERS))}
                </p>
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

              {unassignedProducts.length > 0 && (
                <div className="chat-shell__offer-add">
                  <p className="chat-shell__rail-hint">{t.unassignedOffers}</p>
                  {unassignedProducts.map((product) => (
                    <div key={product.id} className="chat-shell__unassigned-row">
                      <div className="chat-shell__unassigned-actions">
                        <button
                          type="button"
                          className="chat-shell__nav-item chat-shell__nav-button"
                          disabled={offerBusy}
                          onClick={() => void onAssignUnassignedProduct?.(product.id)}
                        >
                          {t.assignToBrand} · {product.name}
                        </button>
                        <button
                          type="button"
                          className="chat-shell__session-more is-danger"
                          aria-label={`${t.deleteUnassigned} ${product.name}`}
                          disabled={offerBusy}
                          onClick={() => void onDeleteUnassignedProduct?.(product.id)}
                        >
                          <Trash2 size={13} aria-hidden />
                        </button>
                      </div>
                      <Link to={`/product/${product.id}`} className="chat-shell__rail-hint">
                        {t.openClassicHistory}
                      </Link>
                    </div>
                  ))}
                  {unassignedProducts.length > 1 && (
                    <button
                      type="button"
                      className="chat-shell__nav-item chat-shell__nav-button"
                      disabled={offerBusy}
                      onClick={() => {
                        if (!window.confirm(t.confirmClearUnassigned)) return
                        void onClearUnassignedProducts?.()
                      }}
                    >
                      {t.clearUnassigned}
                    </button>
                  )}
                </div>
              )}
            </>
              ) : null}
            </>
          )}
        </div>
      )}

      {tab === 'images' && (
        <div className="chat-shell__stack">
          {!session ? (
            <p className="chat-shell__rail-hint">Select a session to manage offer images.</p>
          ) : displayOffers.length === 0 ? (
            <p className="chat-shell__rail-hint">
              {language === 'es'
                ? 'Adjuntá al menos una oferta para ver imágenes.'
                : 'Attach at least one offer to view images.'}
            </p>
          ) : (
            <>
              <ChatImageSettingsPanel
                language={language}
                preferences={imagePrefs}
                onChange={onPatchImagePreferences}
                onGenerate={onGenerateOfferImage}
                busy={imageBusy}
                hasOffer={displayOffers.length > 0}
              />
              <p className="chat-shell__rail-hint">{t.imagesHint}</p>
              <div className="chat-shell__image-offer-chips" role="tablist" aria-label={t.imageOfferTablist}>
                {displayOffers.map((offer) => {
                  const product =
                    ('product' in offer ? offer.product : undefined)
                    || brandProducts.find((p) => p.id === offer.product_id)
                    || (activeProduct?.id === offer.product_id ? activeProduct : null)
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

              <div className="chat-shell__image-actions">
                <label className="chat-shell__setup-btn">
                  {language === 'es' ? 'Subir producto' : 'Upload product'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    disabled={imageBusy || !activeImageOfferId}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void onUploadOfferImage?.(file, 'product')
                    }}
                  />
                </label>
                <label className="chat-shell__setup-btn">
                  {language === 'es' ? 'Subir escena' : 'Upload scene'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    disabled={imageBusy || !activeImageOfferId}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void onUploadOfferImage?.(file, 'scene')
                    }}
                  />
                </label>
                <label className="chat-shell__setup-btn">
                  {language === 'es' ? 'Subir estilo' : 'Upload style'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    disabled={imageBusy || !activeImageOfferId}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void onUploadOfferImage?.(file, 'style')
                    }}
                  />
                </label>
                <label className="chat-shell__setup-btn">
                  {language === 'es' ? 'Subir logo' : 'Upload logo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    disabled={imageBusy || !activeImageOfferId}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void onUploadOfferImage?.(file, 'logo')
                    }}
                  />
                </label>
              </div>

              {offerImages.length === 0 ? (
                <p className="chat-shell__rail-hint">{t.noImagesYet}</p>
              ) : (
                <div className="chat-shell__image-library" aria-label={language === 'es' ? 'Imagenes de mas nuevas a mas antiguas' : 'Images newest to oldest'}>
                  {[
                    {
                      key: 'generated',
                      label: language === 'es' ? 'Espacios de imagen' : 'Image workspaces',
                      images: (() => {
                        const latestIds = new Set(
                          latestGeneratedPerWorkspace(buildImageWorkspaces(offerImages)).map((image) => image.id)
                        )
                        return offerImages.filter((image) => image.kind === 'generated' && latestIds.has(image.id))
                      })(),
                    },
                    {
                      key: 'references',
                      label: language === 'es' ? 'Producto y contexto' : 'Product and context',
                      images: offerImages.filter((image) => image.kind !== 'generated'),
                    },
                  ].map((section) => section.images.length ? (
                    <section key={section.key} className="chat-shell__image-library-section">
                      <h4>{section.label}</h4>
                      <div className="chat-shell__image-grid">
                  {[...section.images].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map((img) => (
                    <figure key={img.id} className="chat-shell__image-thumb">
                      <button
                        type="button"
                        className="chat-shell__image-thumb-open"
                        onClick={() => onOpenOfferImage?.(img)}
                        aria-label={t.viewImage}
                      >
                        <img src={img.image_url} alt={img.label || 'Offer image'} />
                      </button>
                      <figcaption>
                        <span>
                          {img.kind === 'generated' ? 'Generated' : img.kind === 'context' ? 'Context' : 'Ref'}
                        </span>
                        <button
                          type="button"
                          className="chat-shell__image-thumb-edit"
                          onClick={() => onRequestImageEdit?.(img)}
                        >
                          {t.requestEdit}
                        </button>
                        <button
                          type="button"
                          className="chat-shell__image-thumb-edit is-danger"
                          disabled={imageBusy}
                          aria-label={language === 'es' ? 'Eliminar imagen' : 'Delete image'}
                          onClick={() => void onRemoveOfferImage?.(img.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                      </div>
                    </section>
                  ) : null)}
                </div>
              )}
            </>
          )}
          {(classicLibraryLoading || classicPosts.length > 0) && (
            <div className="chat-shell__classic-library">
              <p className="chat-shell__rail-hint">
                {language === 'es'
                  ? 'Historial clásico de la oferta (posts guardados)'
                  : 'Classic offer history (saved posts)'}
              </p>
              {classicLibraryLoading ? (
                <p className="chat-shell__rail-note">{language === 'es' ? 'Cargando…' : 'Loading…'}</p>
              ) : (
                <div className="chat-shell__image-grid">
                  {classicPosts.slice(0, 12).map((post) => (
                    post.generated_image_url ? (
                      <figure key={post.id} className="chat-shell__image-card">
                        <img src={post.generated_image_url} alt="" loading="lazy" />
                      </figure>
                    ) : null
                  ))}
                </div>
              )}
              {session?.product_id ? (
                <Link to={`/posts/product/${session.product_id}`} className="chat-shell__setup-btn">
                  {language === 'es' ? 'Abrir Posts clásico' : 'Open classic Posts'}
                </Link>
              ) : null}
            </div>
          )}
        </div>
      )}

      {tab === 'scripts' && scriptSettings && onScriptSettingsChange && onGenerateScripts ? (
        <div className="chat-shell__rail-form">
          <ChatScriptPanel
            language={language}
            settings={scriptSettings}
            onChange={onScriptSettingsChange}
            onGenerate={onGenerateScripts}
            sending={sending}
          />
          {(classicLibraryLoading || classicScripts.length > 0) && (
            <div className="chat-shell__classic-library">
              <p className="chat-shell__rail-hint">
                {language === 'es' ? 'Guardados clásicos (esta sesión)' : 'Classic saved (this session)'}
              </p>
              {classicLibraryLoading ? (
                <p className="chat-shell__rail-note">{language === 'es' ? 'Cargando…' : 'Loading…'}</p>
              ) : (
                <ul className="chat-shell__offer-list">
                  {classicScripts.slice(0, 20).map((script) => (
                    <li key={script.id} className="chat-shell__offer-row">
                      <span>{script.title || (language === 'es' ? 'Guion' : 'Script')}</span>
                      {session?.product_id ? (
                        <Link
                          to={`/product/${session.product_id}/session/${session.id}`}
                          className="chat-shell__row-action"
                        >
                          {language === 'es' ? 'Abrir' : 'Open'}
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : null}

      {tab === 'brand' && (
        <div className="chat-shell__rail-form">
          <p className="chat-shell__rail-hint">
            {language === 'es' ? 'Kit de marca para esta sesión. Colores, voz y logo entran a guiones e imágenes.' : 'Brand kit for this session. Colors, voice, and logo feed scripts and images.'}
          </p>
          {brandKits.length === 0 ? (
            <p className="chat-shell__rail-note">
              {language === 'es' ? 'No hay kits. Creá uno en Configuración.' : 'No kits yet. Create one in Settings.'}
            </p>
          ) : (
            <div className="chat-shell__offer-list">
              {brandKits.map((kit) => {
                const selected = session?.brand_kit_id === kit.id || (!session?.brand_kit_id && kit.is_default)
                return (
                  <button
                    key={kit.id}
                    type="button"
                    className={`chat-shell__offer-row${selected ? ' is-on' : ''}`}
                    onClick={() => onSelectBrandKit?.(kit.id)}
                  >
                    <span>{kit.name}{kit.is_default ? ' · default' : ''}</span>
                    <span className="chat-shell__swatches" aria-hidden>
                      {kit.primary_color ? <span className="chat-shell__swatch" style={{ background: kit.primary_color }} /> : null}
                      {kit.secondary_color ? <span className="chat-shell__swatch" style={{ background: kit.secondary_color }} /> : null}
                      {kit.accent_color ? <span className="chat-shell__swatch" style={{ background: kit.accent_color }} /> : null}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {(() => {
            const selected = brandKits.find((k) => k.id === session?.brand_kit_id) || brandKits.find((k) => k.is_default)
            if (!selected) return null
            return (
              <p className="chat-shell__rail-note">
                {selected.tagline || selected.brand_voice || selected.industry || selected.name}
              </p>
            )
          })()}
          <div className="chat-shell__row-actions">
            {onOpenSettings ? (
              <button type="button" className="chat-shell__setup-btn" onClick={onOpenSettings}>
                {t.settings}
              </button>
            ) : (
              <Link to="/settings" className="chat-shell__setup-btn">
                {t.settings}
              </Link>
            )}
            {onUploadBrandLogo ? (
              <label className="chat-shell__setup-btn">
                {t.logo}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  hidden
                  disabled={imageBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) void onUploadBrandLogo(file)
                  }}
                />
              </label>
            ) : (
              <button
                type="button"
                className="chat-shell__setup-btn"
                onClick={() => onStartLogo?.('auto')}
              >
                {t.logo}
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'more' && (
        <div className="chat-shell__rail-form">
          <p className="chat-shell__rail-hint">
            {language === 'es'
              ? 'Herramientas del panel clásico. Guiones viejos, descripciones y respuestas viven ahí.'
              : 'Classic tools. Older scripts, descriptions, and replies live there.'}
          </p>
          <div className="chat-shell__row-actions">
            <Link to="/scripts" className="chat-shell__row-action">{t.scripts}</Link>
            <Link to="/posts" className="chat-shell__row-action">{t.posts}</Link>
            <Link to="/descriptions" className="chat-shell__row-action">{t.descriptions}</Link>
            <Link to="/respuestas" className="chat-shell__row-action">{t.replies}</Link>
          </div>
          <p className="chat-shell__rail-hint">{t.logo}</p>
          <div className="chat-shell__chip-row">
            {LOGO_ARCHETYPES.slice(0, 6).map((arch) => (
              <button
                key={arch.id}
                type="button"
                className="chat-shell__btn chat-shell__btn--pill"
                onClick={() => onStartLogo?.(arch.id)}
              >
                {language === 'es' ? arch.nameEs : arch.name}
              </button>
            ))}
          </div>
          <p className="chat-shell__rail-note">
            {language === 'es'
              ? 'Pedí “logo wordmark” o usá /logo. Fotos de producto: /producto o modo Producto en Crear.'
              : 'Ask “logo wordmark” or use /logo. Product photos: /producto or Product mode in Create.'}
          </p>
        </div>
      )}
    </aside>
  )
}
