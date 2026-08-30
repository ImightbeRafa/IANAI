import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  addMessage,
  createScriptVersion,
  deleteProductImage,
  getBusinessProducts,
  getUnassignedProducts,
  assignUnassignedProductToBusiness,
  deleteProduct,
  isQuickPostSentinel,
  getMessages,
  getProduct,
  getSessionOffers,
  insertScriptMessageArtifact,
  replaceSessionOffers,
  saveScript,
  updateChatSession,
  type ChatSessionSafeUpdates,
  type ProductImage,
} from '../../services/database'
import { invalidateDashboardCache } from '../../hooks/useDashboardData'
import {
  buildApiBusinessContext,
  buildApiProductContext,
  DEFAULT_SCRIPT_SETTINGS,
  editScript,
  sendMessageToGrok,
  streamlineScriptForPost,
} from '../../services/grokApi'
import type {
  BrandKit,
  Business,
  ChatSession,
  ChatSessionOffer,
  Message,
  MessageArtifact,
  OrganicSingleSubtype,
  Product,
  ScriptFramework,
  ScriptGenerationSettings,
} from '../../types'
import { isScriptContent, parseScripts } from '../../utils/scriptParser'
import { useUsageLimits, invalidateUsageLimitsCache } from '../../hooks/useUsageLimits'
import {
  buildCreditQuote,
  quoteEditEnhanceCredits,
  quoteImageCredits,
  type CreditQuote,
} from './chatShellCreditQuote'
import { friendlyImageError } from './chatShellImageErrors'
import {
  collectBrandGenerateVisual,
  resolveBrandKitIdForSession,
  shouldSkipPostCondense,
  stripUnresolvedPlaceholders,
  type BrandVisualFallback,
} from './chatShellGenerationPreferences'
import {
  parseChatShellScriptIntent,
  type ChatShellLanguage,
} from './chatShellScriptIntent'
import {
  brandHasRealOffer,
  buildChatShellConversationalReply,
} from './chatShellConversationalReply'
import { getTextModelPreference } from './textModelPreference'
import {
  assignGlobalScriptOrdinals,
  splitOfferScriptContent,
} from './chatShellScriptSplit'
import {
  addInFlightSession,
  isLiveThread,
  isSessionSending,
  removeInFlightSession,
  shouldApplyBrandProductRefresh,
} from './chatShellAsync'
import {
  planOfferGenerationWalk,
  planRetryOfferWalk,
  type PlannedOfferStep,
} from './chatShellGeneration'
import {
  emptyThreadSnapshot,
  mergeFetchedMessagesForOwner,
  readBrandProductCache,
  readThreadCache,
  replaceOptimisticMessage,
  upsertMessage,
  writeBrandProductCache,
  writeThreadCache,
  type CachedThread,
} from './chatShellThreadCache'
import { isDefaultSessionTitle } from './chatShellSidebar'
import {
  canAddSessionOffer,
  CHAT_SHELL_MAX_OFFERS,
  resolveSessionOfferProductId,
  sortOffersByPosition,
} from './sessionOffer'
import {
  decodeOfferPick,
  encodeOfferPick,
  matchOfferFromText,
  offerPickQuestion,
  realBrandOffers,
  resolveSendOffer,
} from './chatShellOfferResolve'
import {
  buildImageWorkspaces,
  filterImagesForOffer,
  latestImageByProductId,
  resolveActiveImageOfferId,
  workspaceForImage,
} from './chatShellImages'
import {
  formatImageAssumptions,
  looksLikeOrganicScript,
  looksLikeSalesScript,
  parseChatShellImageIntent,
  planImageClarifications,
  productStyleAllowsZeroReferences,
  readImagePreferences,
  requiresProductReferences,
  resolveImagePreferences,
  sanitizePartialPreferences,
  shellImageFlowCopy,
  writeImagePreferences,
  type ImageClarifyMode,
  type ImageClarifyStep,
  type ShellImageAspect,
  type ShellImagePreferences,
  type ShellImageStyle,
} from './chatShellImageIntent'
import {
  copyShellOfferImageToProduct,
  editShellOfferImage,
  generateShellOfferImage,
  getSessionOffersImages,
  optimizeShellOfferImage,
  uploadShellOfferImage,
} from './chatShellImageApi'
import {
  catalogOfferReferences,
  confirmedReferenceImageIds,
  hasSelectedProductReference,
  partitionReferenceCopies,
  selectedBrandLogoUrl,
  shouldPromptImageReferences,
  toggleReferenceSelection,
  withPreselectedReferences,
  type OfferReferenceImage,
} from './chatShellReferenceSelection'
import { collectOfferEnhanceReferences, type ShellEnhanceTier } from './chatShellImageEnhance'
import {
  detectMissingIngredients,
  ingredientsPromptCopy,
  ingredientsSkippedAfterRefsConfirm,
  remainingIngredients,
  shouldCheckImageIngredients,
  type IngredientKind,
} from './chatShellIngredientsCheck'

export type ImageClarifyState = {
  sessionId: string
  step: ImageClarifyStep
  mode?: ImageClarifyMode
  originText: string
  productId: string
  scriptText?: string
  scriptTitle?: string | null
  source: 'composer' | 'rail' | 'script_card'
  partial: Partial<ShellImagePreferences>
  /** Full resolved prefs when waiting on refs (Producto without offer Ref). */
  preferences?: ShellImagePreferences
  prompt?: string
  userText?: string
  scriptChoices?: ImageScriptChoice[]
  availableReferenceCount?: number
  referencesRequired?: boolean
  referenceImages?: OfferReferenceImage[]
  preferredReferenceIds?: string[]
  alreadyOptimized?: boolean
  askStyleRef?: boolean
  /** Prior sheet steps for Pack-family Back (no transcript). */
  history?: ImageClarifyState[]
  missingIngredients?: IngredientKind[]
  skippedIngredients?: IngredientKind[]
  pendingGenerate?: {
    productId: string
    preferences: ShellImagePreferences
    prompt: string
    userText: string
    scriptText?: string
    scriptTitle?: string | null
    source: string
    referenceMode?: 'use' | 'none'
    referenceImageIds?: string[]
    alreadyOptimized?: boolean
    askStyleRef?: boolean
    skipStyleRef?: boolean
  }
}

export type ImageScriptChoice = {
  id: string
  title: string
  preview: string
  scriptText: string
  productId: string
  productName?: string | null
}

function latestScriptText(
  key: string,
  fallback: string,
  latestByKey?: Map<string, string>
): string {
  const latest = latestByKey?.get(key)?.trim()
  return latest || fallback
}

export function collectImageScriptChoices(
  messages: Message[],
  fallbackProductId?: string | null,
  latestByKey?: Map<string, string>
): ImageScriptChoice[] {
  const choices: ImageScriptChoice[] = []
  const seen = new Set<string>()
  for (const message of [...messages].reverse()) {
    for (const artifact of [...(message.artifacts || [])].reverse()) {
      const original = artifact.script?.content?.trim()
      const scriptText = original ? latestScriptText(artifact.id, original, latestByKey) : ''
      if (artifact.artifact_type !== 'script' || !scriptText || seen.has(artifact.id)) continue
      seen.add(artifact.id)
      const metadataTitle = typeof artifact.action_metadata?.script_title === 'string'
        ? artifact.action_metadata.script_title.trim()
        : ''
      choices.push({
        id: artifact.id,
        title: metadataTitle || artifact.script?.title || artifact.product?.name || `Guion #${artifact.ordinal}`,
        preview: scriptText.replace(/\s+/g, ' ').slice(0, 150),
        scriptText,
        productId: artifact.product_id,
        productName: artifact.product?.name,
      })
      if (choices.length >= 8) return choices
    }
    if (!message.artifacts?.length && fallbackProductId && message.role === 'assistant' && isScriptContent(message.content)) {
      for (const script of parseScripts(message.content).reverse()) {
        const key = `${message.id}:${script.index}`
        const original = script.content.trim()
        if (!original || seen.has(key)) continue
        seen.add(key)
        const scriptText = latestScriptText(key, original, latestByKey)
        choices.push({
          id: key,
          title: script.title || `Guion #${script.index}`,
          preview: scriptText.replace(/\s+/g, ' ').slice(0, 150),
          scriptText,
          productId: fallbackProductId,
        })
        if (choices.length >= 8) return choices
      }
    }
  }
  return choices
}

export function shouldReviewChosenScript(originText?: string | null, source?: string | null): boolean {
  if (source === 'script_card') return false
  return /\b(post|posts|publicaci[oó]n|publication)\b/i.test(originText || '')
}

export type ScriptCtaChannel = 'website' | 'messages' | 'none'

export type ScriptClarifyState = {
  sessionId: string
  step: 'type' | 'count' | 'cta'
  originText: string
  settings: ScriptGenerationSettings
  ctaChannel?: ScriptCtaChannel
  remaining: Array<'type' | 'count' | 'cta'>
  /** Prior sheet steps for Pack-family Back (no transcript). */
  history?: ScriptClarifyState[]
}

function pushScriptHistory(current: ScriptClarifyState): ScriptClarifyState[] {
  const { history: _drop, ...snapshot } = current
  return [...(current.history || []), snapshot]
}

function pushImageHistory(current: ImageClarifyState): ImageClarifyState[] {
  const { history: _drop, ...snapshot } = current
  return [...(current.history || []), snapshot]
}

function explicitCtaChannel(text: string): ScriptCtaChannel | null {
  const normalized = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (/\b(?:sin cta|no cta|without cta)\b/.test(normalized)) return 'none'
  if (/\b(?:whatsapp|mensaje|mensajes|dm|inbox|direct message)\b/.test(normalized)) return 'messages'
  if (/\b(?:web|website|sitio|landing|checkout|comprar en linea)\b/.test(normalized)) return 'website'
  return null
}

function settingsForScriptType(
  settings: ScriptGenerationSettings,
  type: ScriptFramework | 'mixed'
): ScriptGenerationSettings {
  if (type === 'mixed') {
    return { ...settings, generationMode: 'mixed', variations: Math.max(1, settings.variations) }
  }
  const scriptTypeConfig = { ...settings.scriptTypeConfig }
  for (const key of Object.keys(scriptTypeConfig) as ScriptFramework[]) {
    scriptTypeConfig[key] = key === type ? 1 : 0
  }
  const organic = ['educativo', 'storytelling', 'tendencia', 'engagement'].includes(type)
  return {
    ...settings,
    framework: type,
    generationMode: 'by_type',
    variations: 1,
    scriptTypeConfig,
    ctaStrength: organic ? 'soft' : 'sales',
  }
}

function settingsForScriptCount(
  settings: ScriptGenerationSettings,
  count: number
): ScriptGenerationSettings {
  const safe = Math.max(1, Math.min(10, count))
  if (settings.generationMode !== 'by_type') return { ...settings, variations: safe }
  const selected = Object.entries(settings.scriptTypeConfig).find(([, value]) => value > 0)?.[0]
  if (!selected) return { ...settings, generationMode: 'mixed', variations: safe }
  return {
    ...settings,
    variations: safe,
    scriptTypeConfig: { ...settings.scriptTypeConfig, [selected]: safe },
  }
}

function buildLegacyProductContext(product: Product, additionalContext?: string) {
  return {
    product_name: product.name,
    product_type: product.type,
    product_description: product.product_description,
    main_problem: product.main_problem,
    best_customers: product.best_customers,
    failed_attempts: product.failed_attempts,
    attention_grabber: product.attention_grabber,
    real_pain: product.real_pain,
    pain_consequences: product.pain_consequences,
    expected_result: product.expected_result,
    differentiation: product.differentiation,
    key_objection: product.key_objection,
    shipping_info: product.shipping_info,
    awareness_level: product.awareness_level,
    offer: product.offer,
    market_alternatives: product.market_alternatives,
    customer_values: product.customer_values,
    purchase_reason: product.purchase_reason,
    target_audience: product.target_audience,
    call_to_action: product.call_to_action,
    additional_context: additionalContext || '',
  }
}

export interface FailedOfferBatch {
  productIds: string[]
  names: string[]
  userText: string
  /** Snapshot from the original request — retries must not re-parse synthetic retry text. */
  scriptSettings: ScriptGenerationSettings
}

export interface OfferWalkProgress {
  sessionId: string
  current: number
  total: number
  offerName: string
}

export function useChatSessionThread(options: {
  userId: string
  brand: Business | null
  session: ChatSession | null
  onSessionPatched?: (session: ChatSession) => void
  language?: ChatShellLanguage
  aiMemoryEnabled?: boolean
  brandKits?: BrandKit[]
  brandVisualRef?: MutableRefObject<BrandVisualFallback>
}) {
  const {
    userId,
    brand,
    session,
    onSessionPatched,
    language = 'es',
    aiMemoryEnabled = true,
    brandKits = [],
    brandVisualRef,
  } = options
  const sessionId = session?.id ?? null
  const storage = typeof localStorage !== 'undefined' ? localStorage : null

  const [messages, setMessages] = useState<Message[]>([])
  const [offers, setOffers] = useState<ChatSessionOffer[]>([])
  const [brandProducts, setBrandProducts] = useState<Product[]>([])
  const [brandProductsReady, setBrandProductsReady] = useState(!brand?.id)
  const [productsBrandId, setProductsBrandId] = useState<string | null>(brand?.id ?? null)
  const brandProductCacheRef = useRef<Map<string, Product[]>>(new Map())
  const [unassignedProducts, setUnassignedProducts] = useState<Product[]>([])
  const [activeProduct, setActiveProduct] = useState<Product | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(true)
  const [inFlightSessions, setInFlightSessions] = useState<Set<string>>(() => new Set())
  const [savingScript, setSavingScript] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failedBatch, setFailedBatch] = useState<FailedOfferBatch | null>(null)
  const [offerMutating, setOfferMutating] = useState(false)
  const [walkProgress, setWalkProgress] = useState<OfferWalkProgress | null>(null)
  const [offerImages, setOfferImages] = useState<ProductImage[]>([])
  const [imageOfferId, setImageOfferId] = useState<string | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const imageBusyRef = useRef(false)
  const imageGenerateSubmitLockRef = useRef(false)
  const [imagePrefs, setImagePrefs] = useState<ShellImagePreferences>(() =>
    resolveImagePreferences({}, {})
  )
  const [imageClarify, setImageClarify] = useState<ImageClarifyState | null>(null)
  const [scriptClarify, setScriptClarify] = useState<ScriptClarifyState | null>(null)
  const [creditQuote, setCreditQuote] = useState<CreditQuote | null>(null)
  const creditPendingRef = useRef<null | {
    kind: 'scripts' | 'image' | 'edit'
    text?: string
    sendOptions?: {
      forceSettings?: ScriptGenerationSettings
      skipImage?: boolean
      bypassScriptClarify?: boolean
      channelOverride?: 'website' | 'messages'
      creditConfirmed?: boolean
    }
    imageOptions?: Record<string, unknown>
    editOptions?: {
      productImageId: string
      imageUrl: string
      instruction: string
      productId?: string
      actionType: 'edit' | 'enhance'
      attachments?: Array<{ dataUrl: string; role: 'product' | 'context' }>
      enhanceTier?: ShellEnhanceTier
    }
  }>(null)
  const usage = useUsageLimits()
  const runImageGenerateRef = useRef<(options: {
    productId: string
    preferences: ShellImagePreferences
    prompt: string
    userText: string
    scriptText?: string
    scriptTitle?: string | null
    source: string
    referenceMode?: 'use' | 'none'
    referenceImageIds?: string[]
    alreadyOptimized?: boolean
    askStyleRef?: boolean
    skipStyleRef?: boolean
    creditConfirmed?: boolean
    skippedIngredients?: IngredientKind[]
  }) => Promise<void>>(async () => {})
  const latestScriptByKeyRef = useRef<Map<string, string>>(new Map())
  const [scriptSettings, setScriptSettings] = useState<ScriptGenerationSettings>(() => ({
    ...DEFAULT_SCRIPT_SETTINGS,
    model: getTextModelPreference(),
  }))

  const beginImageFlowRef = useRef<(options: {
    productId?: string | null
    prompt?: string
    userText?: string
    scriptText?: string
    scriptTitle?: string | null
    source: 'composer' | 'rail' | 'script_card'
    explicit?: Partial<ShellImagePreferences>
    alreadyOptimized?: boolean
    referenceImageIds?: string[]
  }) => Promise<void>>(async () => {})

  const loadRequestRef = useRef(0)
  const offerRequestRef = useRef(0)
  const offerMutatingRef = useRef(false)
  /** Bumped on every session change including null. */
  const sessionGenRef = useRef(0)
  const activeThreadSessionIdRef = useRef<string | null>(null)
  const liveBrandIdRef = useRef<string | null>(brand?.id ?? null)
  const brandProductRequestRef = useRef(0)
  const threadCacheRef = useRef<Map<string, CachedThread>>(new Map())

  activeThreadSessionIdRef.current = sessionId

  const liveBrandId = brand?.id ?? null
  liveBrandIdRef.current = liveBrandId
  if (liveBrandId !== productsBrandId) {
    brandProductRequestRef.current += 1
    setProductsBrandId(liveBrandId)
    const cached = readBrandProductCache(brandProductCacheRef.current, liveBrandId)
    setBrandProducts(cached ?? [])
    setBrandProductsReady(Boolean(cached) || !liveBrandId)
  }

  const sending = isSessionSending(inFlightSessions, sessionId)

  const offerProductId = useMemo(
    () => resolveSessionOfferProductId(session, offers),
    [session, offers]
  )

  const activeImageOfferId = useMemo(
    () =>
      resolveActiveImageOfferId({
        offerProductIds: sortOffersByPosition(offers).map((o) => o.product_id),
        preferredId: imageOfferId,
        primaryProductId: offerProductId,
      }),
    [offers, imageOfferId, offerProductId]
  )

  const filteredOfferImages = useMemo(
    () =>
      filterImagesForOffer(offerImages, activeImageOfferId, {
        sessionId: sessionId,
      }),
    [offerImages, activeImageOfferId, sessionId]
  )

  const latestImagesByOffer = useMemo(
    () => latestImageByProductId(offerImages),
    [offerImages]
  )

  const canGenerate = Boolean(
    sessionId
    && !sending
    && (offers.length > 0 || Boolean(session?.product_id))
  )

  const refreshOfferImages = useCallback(async (
    sid: string,
    productId: string,
    requestId: number
  ) => {
    const ids = [...new Set([
      productId,
      ...offers.map((offer) => offer.product_id),
      ...brandProducts.map((product) => product.id),
    ].filter(Boolean))]
    const list = await getSessionOffersImages(ids, sid)
    if (requestId !== loadRequestRef.current) return list
    if (activeThreadSessionIdRef.current !== sid) return list
    setOfferImages(list)
    return list
  }, [brandProducts, offers])

  const refreshOffersAndProduct = useCallback(async (
    sid: string,
    sessionRow: ChatSession | null,
    requestId: number
  ) => {
    let list = await getSessionOffers(sid)
    if (requestId !== loadRequestRef.current) return list
    if (activeThreadSessionIdRef.current !== sid) return list
    if (list.length === 0 && sessionRow?.product_id && sessionRow.business_id) {
      try {
        list = await replaceSessionOffers(
          sid,
          sessionRow.business_id,
          [sessionRow.product_id],
          userId
        )
      } catch (err) {
        console.error(err)
      }
      if (requestId !== loadRequestRef.current) return list
      if (activeThreadSessionIdRef.current !== sid) return list
    }
    setOffers(list)
    const pid = resolveSessionOfferProductId(sessionRow, list)
    if (!pid) {
      setActiveProduct(null)
      return list
    }
    const product = list.find((o) => o.product_id === pid)?.product || (await getProduct(pid))
    if (requestId !== loadRequestRef.current) return list
    if (activeThreadSessionIdRef.current !== sid) return list
    setActiveProduct(product)
    return list
  }, [userId])

  useEffect(() => {
    if (!brand?.id) {
      setBrandProducts([])
      setUnassignedProducts([])
      setBrandProductsReady(true)
      return
    }
    const cached = readBrandProductCache(brandProductCacheRef.current, brand.id)
    if (cached) {
      setBrandProducts(cached)
      setBrandProductsReady(true)
    } else {
      setBrandProductsReady(false)
    }
    let cancelled = false
    void (async () => {
      try {
        const [products, unassigned] = await Promise.all([
          getBusinessProducts(brand.id),
          getUnassignedProducts(userId),
        ])
        if (!cancelled) {
          writeBrandProductCache(brandProductCacheRef.current, brand.id, products)
          setBrandProducts(products)
          setUnassignedProducts(unassigned.filter((product) => !isQuickPostSentinel(product)))
          setBrandProductsReady(true)
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setBrandProducts([])
          setUnassignedProducts([])
          setBrandProductsReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
      brandProductRequestRef.current += 1
    }
  }, [brand?.id, userId])

  const refreshBrandProducts = useCallback(async () => {
    const requestedBrandId = brand?.id
    if (!requestedBrandId) {
      setBrandProducts([])
      setUnassignedProducts([])
      return
    }
    const requestId = ++brandProductRequestRef.current
    try {
      const [products, unassigned] = await Promise.all([
        getBusinessProducts(requestedBrandId),
        getUnassignedProducts(userId),
      ])
      const cancelled = requestId !== brandProductRequestRef.current
      if (!shouldApplyBrandProductRefresh({
        requestedBrandId,
        liveBrandId: liveBrandIdRef.current,
        cancelled,
      })) return
      setBrandProducts(products)
      writeBrandProductCache(brandProductCacheRef.current, requestedBrandId, products)
      setUnassignedProducts(unassigned.filter((product) => !isQuickPostSentinel(product)))
    } catch (err) {
      console.error(err)
    }
  }, [brand?.id, userId])

  const assignUnassignedProduct = useCallback(async (productId: string) => {
    if (!brand?.id) return
    const assigned = await assignUnassignedProductToBusiness(userId, productId, brand.id)
    setUnassignedProducts((prev) => prev.filter((p) => p.id !== productId))
    setBrandProducts((prev) => {
      const next = [assigned, ...prev.filter((p) => p.id !== assigned.id)]
      writeBrandProductCache(brandProductCacheRef.current, brand.id, next)
      return next
    })
    invalidateDashboardCache()
  }, [brand?.id, userId])

  const deleteUnassignedProduct = useCallback(async (productId: string) => {
    await deleteProduct(productId)
    setUnassignedProducts((prev) => prev.filter((p) => p.id !== productId))
    invalidateDashboardCache()
  }, [])

  const clearUnassignedProducts = useCallback(async () => {
    const leftover = unassignedProducts.filter((product) => !isQuickPostSentinel(product))
    for (const product of leftover) {
      await deleteProduct(product.id)
    }
    setUnassignedProducts([])
    invalidateDashboardCache()
  }, [unassignedProducts])

  const snapshotRef = useRef<CachedThread>(emptyThreadSnapshot())
  snapshotRef.current = {
    messages,
    offers,
    activeProduct,
    offerImages,
  }
  const prevSessionIdRef = useRef<string | null>(null)
  const messagesOwnerRef = useRef<string | null>(null)

  useEffect(() => {
    sessionGenRef.current += 1
    const requestId = ++loadRequestRef.current
    const previousId = prevSessionIdRef.current
    if (previousId && previousId !== sessionId) {
      writeThreadCache(threadCacheRef.current, previousId, snapshotRef.current)
    }
    prevSessionIdRef.current = sessionId

    if (!sessionId) {
      messagesOwnerRef.current = null
      setMessages([])
      setOffers([])
      setActiveProduct(null)
      setError(null)
      setNotice(null)
      setFailedBatch(null)
      setOfferImages([])
      setImageOfferId(null)
      setImageClarify(null)
      setScriptClarify(null)
      latestScriptByKeyRef.current = new Map()
      setWalkProgress(null)
      setImagePrefs(resolveImagePreferences({}, {}))
      setLoadingMessages(false)
      return
    }

    const cached = readThreadCache(threadCacheRef.current, sessionId)
    if (cached) {
      messagesOwnerRef.current = sessionId
      setMessages(cached.messages)
      setOffers(cached.offers)
      setActiveProduct(cached.activeProduct)
      setOfferImages(cached.offerImages)
      setLoadingMessages(false)
    } else {
      setLoadingMessages(true)
    }
    setFailedBatch(null)
    setImageOfferId(null)
    setImageClarify(null)
    setScriptClarify(null)
    latestScriptByKeyRef.current = new Map()
    setWalkProgress(null)
    setImagePrefs(resolveImagePreferences({}, readImagePreferences(storage, sessionId)))
    setError(null)
    setNotice(null)

    void (async () => {
      try {
        const [msgs] = await Promise.all([
          getMessages(sessionId),
          refreshOffersAndProduct(sessionId, session, requestId),
        ])
        if (requestId !== loadRequestRef.current) return
        if (activeThreadSessionIdRef.current !== sessionId) return
        const nextMessages = mergeFetchedMessagesForOwner(
          snapshotRef.current.messages,
          msgs,
          messagesOwnerRef.current,
          sessionId
        )
        messagesOwnerRef.current = sessionId
        setMessages(nextMessages)
        writeThreadCache(threadCacheRef.current, sessionId, {
          ...snapshotRef.current,
          messages: nextMessages,
        })
      } catch (err) {
        if (requestId !== loadRequestRef.current) return
        if (activeThreadSessionIdRef.current !== sessionId) return
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load messages')
        if (!cached) {
          messagesOwnerRef.current = sessionId
          setMessages([])
        }
      } finally {
        if (
          requestId === loadRequestRef.current &&
          activeThreadSessionIdRef.current === sessionId
        ) {
          setLoadingMessages(false)
        }
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, refreshOffersAndProduct])

  useEffect(() => {
    if (!sessionId || !activeImageOfferId) {
      setOfferImages([])
      return
    }
    const requestId = loadRequestRef.current
    void (async () => {
      try {
        await refreshOfferImages(sessionId, activeImageOfferId, requestId)
      } catch (err) {
        console.error(err)
      }
    })()
  }, [sessionId, activeImageOfferId, refreshOfferImages])

  const persistOffers = useCallback(async (productIds: string[]): Promise<ChatSessionOffer[] | undefined> => {
    if (!session?.business_id) {
      setNotice('Session needs a brand (business_id) before attaching an offer.')
      return
    }
    if (offerMutatingRef.current) {
      return getSessionOffers(session.id)
    }
    offerMutatingRef.current = true
    setOfferMutating(true)
    const originSessionId = session.id
    const originGen = sessionGenRef.current
    const requestId = ++offerRequestRef.current
    setError(null)
    setNotice(null)
    try {
      const list = await replaceSessionOffers(
        originSessionId,
        session.business_id,
        productIds,
        userId
      )
      if (requestId !== offerRequestRef.current) return list
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return list
      }
      setOffers(list)
      const primaryId = resolveSessionOfferProductId(session, list)
      setActiveProduct(
        primaryId
          ? (list.find((o) => o.product_id === primaryId)?.product
            || brandProducts.find((p) => p.id === primaryId)
            || null)
          : null
      )
      return list
    } catch (err) {
      if (requestId !== offerRequestRef.current) return
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to update offers')
      try {
        const fresh = await getSessionOffers(originSessionId)
        if (
          isLiveThread(
            activeThreadSessionIdRef.current,
            sessionGenRef.current,
            originSessionId,
            originGen
          )
        ) {
          setOffers(fresh)
        }
      } catch {
        /* ignore reload failure */
      }
    } finally {
      offerMutatingRef.current = false
      setOfferMutating(false)
    }
  }, [session, userId, brandProducts])

  const addOffer = useCallback(async (productId: string) => {
    if (!canAddSessionOffer(offers.length)) {
      setNotice(`At most ${CHAT_SHELL_MAX_OFFERS} offers per session.`)
      return
    }
    if (offers.some((o) => o.product_id === productId)) return
    const ordered = [
      ...sortOffersByPosition(offers).map((o) => o.product_id),
      productId,
    ]
    await persistOffers(ordered)
  }, [offers, persistOffers])

  const removeOffer = useCallback(async (productId: string) => {
    const ordered = sortOffersByPosition(offers)
      .map((o) => o.product_id)
      .filter((id) => id !== productId)
    await persistOffers(ordered)
  }, [offers, persistOffers])

  const moveOffer = useCallback(async (productId: string, direction: -1 | 1) => {
    const ordered = sortOffersByPosition(offers).map((o) => o.product_id)
    const index = ordered.indexOf(productId)
    if (index < 0) return
    const next = index + direction
    if (next < 0 || next >= ordered.length) return
    const swapped = [...ordered]
    const tmp = swapped[index]
    swapped[index] = swapped[next]
    swapped[next] = tmp
    await persistOffers(swapped)
  }, [offers, persistOffers])

  /** @deprecated Prefer addOffer — kept for single-click toggle from older wiring. */
  const setPrimaryOffer = useCallback(async (productId: string) => {
    if (offers.some((o) => o.product_id === productId)) {
      await removeOffer(productId)
      return
    }
    await addOffer(productId)
  }, [offers, addOffer, removeOffer])

  const patchSession = useCallback(async (updates: ChatSessionSafeUpdates) => {
    if (!session) return
    const originSessionId = session.id
    const originGen = sessionGenRef.current
    try {
      const next = await updateChatSession(originSessionId, updates)
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }
      onSessionPatched?.(next)
    } catch (err) {
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to update session')
    }
  }, [session, onSessionPatched])

  const persistTurn = useCallback(async (
    role: 'user' | 'assistant',
    content: string,
    systemPrompt?: string
  ) => {
    if (!session) return
    const originSessionId = session.id
    const originGen = sessionGenRef.current
    const saved = await addMessage(originSessionId, role, content, systemPrompt)
    if (isLiveThread(
      activeThreadSessionIdRef.current,
      sessionGenRef.current,
      originSessionId,
      originGen
    )) {
      setMessages((prev) => upsertMessage(prev, saved))
    }
    return saved
  }, [session])

  const persistOfferSuccess = useCallback(async (options: {
    originSessionId: string
    savedUserId: string
    success: { step: PlannedOfferStep; content: string; product: Product }
  }) => {
    const { originSessionId, success } = options
    const offerName = success.step.name || success.product.name || `Script ${success.step.ordinal}`
    const assistantContent = `### ${success.step.ordinal}. ${offerName}\n\n${success.content}`
    const savedAi = await addMessage(originSessionId, 'assistant', assistantContent)
    const scripts = splitOfferScriptContent(success.content, offerName)
    const ranked = assignGlobalScriptOrdinals([{
      success,
      offerName,
      scripts,
    }])
    const artifacts: MessageArtifact[] = []
    for (const bundle of ranked) {
      for (const scriptPart of bundle.scripts) {
        const title =
          scriptPart.title
          && scriptPart.title !== bundle.offerName
            ? `${bundle.offerName} · ${scriptPart.title}`
            : bundle.offerName
        const script = await saveScript(
          originSessionId,
          bundle.success.step.productId,
          title,
          scriptPart.content,
          undefined,
          {
            edit_source: 'generate',
            message_id: savedAi.id,
            script_index: scriptPart.ordinal,
          }
        )
        const artifact = await insertScriptMessageArtifact({
          sessionId: originSessionId,
          messageId: savedAi.id,
          productId: bundle.success.step.productId,
          scriptId: script.id,
          ordinal: scriptPart.ordinal,
          userId,
          metadata: {
            offer_name: bundle.offerName,
            script_title: scriptPart.title,
            position: bundle.success.step.position,
            variant_index: scriptPart.index,
          },
        })
        artifacts.push(artifact)
      }
    }
    return { ...savedAi, artifacts } as Message
  }, [userId])

  const runOfferWalk = useCallback(async (
    steps: PlannedOfferStep[],
    originSessionId: string,
    originGen: number,
    historyForApi: Message[],
    scriptSettings: ScriptGenerationSettings,
    savedUserId: string,
    channelOverride?: 'website' | 'messages' | 'physical'
  ) => {
    type OfferResult =
      | { ok: true; step: PlannedOfferStep; content: string; product: Product; savedAi: Message }
      | { ok: false; step: PlannedOfferStep; error: string }

    const results: OfferResult[] = []

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return { aborted: true as const, results }
      }

      setWalkProgress({
        sessionId: originSessionId,
        current: i + 1,
        total: steps.length,
        offerName: step.name || step.productId,
      })

      try {
        const product =
          offers.find((o) => o.product_id === step.productId)?.product
          || brandProducts.find((p) => p.id === step.productId)
          || (await getProduct(step.productId))
        if (!product) {
          results.push({ ok: false, step, error: 'Product not found' })
          continue
        }

        const businessDetails = buildLegacyProductContext(product, session?.context || undefined)
        const bizCtx = brand
          ? buildApiBusinessContext(brand)
          : buildApiBusinessContext(product.business)
        const prodCtx = buildApiProductContext(product)
        const channel = channelOverride || session?.primary_channel || undefined
        const brandKitId = resolveBrandKitIdForSession(
          session?.brand_kit_id,
          step.productId,
          brandKits,
          storage
        )

        const ai = await sendMessageToGrok(
          historyForApi,
          businessDetails,
          language,
          scriptSettings,
          product.type,
          undefined,
          'script',
          bizCtx,
          prodCtx,
          undefined,
          channel || undefined,
          step.productId,
          aiMemoryEnabled,
          brandKitId,
          undefined,
          originSessionId
        )

        const savedAi = await persistOfferSuccess({
          originSessionId,
          savedUserId,
          success: { step, content: ai.content, product },
        })
        results.push({ ok: true, step, content: ai.content, product, savedAi })
        if (isLiveThread(
          activeThreadSessionIdRef.current,
          sessionGenRef.current,
          originSessionId,
          originGen
        )) {
          setMessages((prev) => [...prev, savedAi])
        }
      } catch (err) {
        console.error(err)
        results.push({
          ok: false,
          step,
          error: err instanceof Error ? err.message : 'Failed to generate',
        })
      }
    }

    return { aborted: false as const, results }
  }, [
    offers,
    brandProducts,
    brand,
    session,
    language,
    aiMemoryEnabled,
    brandKits,
    storage,
    persistOfferSuccess,
  ])

  const send = useCallback(async (
    rawText: string,
    options?: {
      forceSettings?: ScriptGenerationSettings
      skipImage?: boolean
      bypassScriptClarify?: boolean
      channelOverride?: 'website' | 'messages'
      creditConfirmed?: boolean
    }
  ): Promise<{ needOffers?: boolean } | void> => {
    const text = rawText.trim()
    if (!text || !session) return
    if (inFlightSessions.has(session.id)) return

    if (!options?.skipImage) {
      const imageIntent = parseChatShellImageIntent(text, language)
      if (imageIntent.matched && imageIntent.wantsImage) {
        setError(null)
        setFailedBatch(null)
        setScriptClarify(null)
        await beginImageFlowRef.current({
          productId: activeImageOfferId || offerProductId,
          prompt: text,
          userText: text,
          source: 'composer',
          explicit: imageIntent.preferences,
        })
        return
      }
    }

    const parsedScriptIntent = parseChatShellScriptIntent(text, language, {
      ...DEFAULT_SCRIPT_SETTINGS,
      model: getTextModelPreference(),
    })

    const hasOffer =
      planOfferGenerationWalk(offers).length > 0
      || Boolean(session.product_id)
      || brandHasRealOffer(brandProducts)

    // Greetings / chitchat — reply in-thread, never auto-generate scripts.
    if (!options?.forceSettings && !parsedScriptIntent.matched) {
      const reply = buildChatShellConversationalReply({
        text,
        language,
        hasOffer,
      })
      await persistTurn('user', text)
      await persistTurn('assistant', reply)
      setNotice(null)
      setError(null)
      setScriptClarify(null)
      setImageClarify(null)
      return hasOffer ? undefined : { needOffers: true }
    }

    if (!options?.forceSettings && !options?.bypassScriptClarify && parsedScriptIntent.matched) {
      if (!hasOffer) {
        setScriptClarify(null)
        setImageClarify(null)
        const reply = language === 'es'
          ? 'Primero necesitás una oferta. Creala en el panel Ofertas (a la derecha) o confirmá el setup en el chat — sin oferta no puedo generar guiones.'
          : 'You need an offer first. Create one in the Offers panel (right) or confirm setup in chat — I can’t generate scripts without an offer.'
        await persistTurn('user', text)
        await persistTurn('assistant', reply)
        setNotice(reply)
        return { needOffers: true }
      }
      const ctaChannel = explicitCtaChannel(text)
      const missing: Array<'type' | 'count' | 'cta'> = []
      if (!parsedScriptIntent.hasExplicitType) missing.push('type')
      if (!parsedScriptIntent.hasExplicitCount) missing.push('count')
      if (!ctaChannel) missing.push('cta')
      const step = missing[0]
      if (step) {
        setImageClarify(null)
        setScriptClarify({
          sessionId: session.id,
          step,
          originText: text,
          settings: parsedScriptIntent.settings,
          ctaChannel: ctaChannel || undefined,
          remaining: missing.slice(1),
          history: [],
        })
        setError(null)
        setNotice(null)
        return
      }
    }

    let liveOffers = offers
    let walk = planOfferGenerationWalk(liveOffers)
    let generationText = text

    const lastAssistant = [...messages].reverse().find((row) => row.role === 'assistant')
    const pendingPick = decodeOfferPick(lastAssistant?.system_prompt)
    if (pendingPick && walk.length === 0) {
      const candidates = realBrandOffers(brandProducts).filter((product) =>
        pendingPick.productIds.includes(product.id)
      )
      const picked = matchOfferFromText(text, candidates)
      if (!picked) {
        const question = offerPickQuestion(candidates, language)
        await persistTurn('user', text)
        await persistTurn('assistant', question, encodeOfferPick(pendingPick))
        return
      }
      const attached = await persistOffers([picked.id])
      if (attached) liveOffers = attached
      walk = planOfferGenerationWalk(liveOffers)
      generationText = pendingPick.originalText
    }

    if (walk.length === 0 && session.product_id) {
      if (!session.business_id) {
        setNotice(language === 'es'
          ? 'Esta sesión no tiene marca. Elegí una marca para generar.'
          : 'This session has no brand. Choose a brand before generating.')
        return
      }
      try {
        liveOffers = await replaceSessionOffers(
          session.id,
          session.business_id,
          [session.product_id],
          userId
        )
        setOffers(liveOffers)
        walk = planOfferGenerationWalk(liveOffers)
      } catch (err) {
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to attach legacy offer')
        return
      }
    }

    if (walk.length === 0) {
      const resolved = resolveSendOffer({
        attachedCount: liveOffers.length,
        products: brandProducts,
        text: generationText,
      })
      if (resolved.action === 'attach') {
        const attached = await persistOffers([resolved.productId])
        if (attached) liveOffers = attached
        walk = planOfferGenerationWalk(liveOffers)
      } else if (resolved.action === 'ask') {
        await persistTurn('user', text)
        await persistTurn(
          'assistant',
          offerPickQuestion(resolved.products, language),
          encodeOfferPick({
            originalText: generationText,
            productIds: resolved.products.map((product) => product.id),
          })
        )
        return
      } else if (resolved.action === 'none') {
        const reply = language === 'es'
          ? 'Todavía no hay una oferta en esta marca. Abrí Ofertas a la derecha o confirmá el setup en el chat.'
          : 'This brand has no offer yet. Open Offers on the right or confirm setup in chat.'
        await persistTurn('user', text)
        await persistTurn('assistant', reply)
        setNotice(reply)
        return { needOffers: true }
      }
    }

    if (walk.length === 0) {
      const reply = language === 'es'
        ? 'Todavía no hay una oferta en esta marca. Abrí Ofertas a la derecha o confirmá el setup en el chat.'
        : 'This brand has no offer yet. Open Offers on the right or confirm setup in chat.'
      await persistTurn('user', text)
      await persistTurn('assistant', reply)
      setNotice(reply)
      return { needOffers: true }
    }

    if (
      (usage.creditsEnabled || import.meta.env.VITE_CREDITS_V1 === 'true')
      && !options?.creditConfirmed
    ) {
      const quote = buildCreditQuote({
        kind: 'scripts',
        units: walk.length,
        remaining: usage.creditsRemaining,
      })
      creditPendingRef.current = { kind: 'scripts', text, sendOptions: options }
      setCreditQuote(quote)
      setError(null)
      setNotice(null)
      return
    }

    const originSessionId = session.id
    const originGen = sessionGenRef.current
    const optimisticId = `optimistic-user-${Date.now()}`
    const optimisticUser: Message = {
      id: optimisticId,
      session_id: originSessionId,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }

    setInFlightSessions((prev) => addInFlightSession(prev, originSessionId))
    setError(null)
    setNotice(null)
    setFailedBatch(null)
    setMessages((prev) => [...prev, optimisticUser])

    const scriptSettingsForWalk = options?.forceSettings || parseChatShellScriptIntent(generationText, language, {
      ...DEFAULT_SCRIPT_SETTINGS,
      model: getTextModelPreference(),
    }).settings
    setScriptSettings(scriptSettingsForWalk)

    try {
      const savedUser = await addMessage(originSessionId, 'user', text)
      if (isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        setMessages((prev) => replaceOptimisticMessage(prev, optimisticId, savedUser))
      }
      if (isDefaultSessionTitle(session.title) && generationText === text) {
        void updateChatSession(originSessionId, {
          title: text.slice(0, 80),
        }).then((next) => {
          if (isLiveThread(
            activeThreadSessionIdRef.current,
            sessionGenRef.current,
            originSessionId,
            originGen
          )) {
            onSessionPatched?.(next)
          }
        }).catch(() => { /* title is best-effort */ })
      }

      const promptUser = generationText === text ? savedUser : { ...savedUser, content: generationText }
      const historyForApi = [...messages.filter((m) => m.id !== optimisticId), promptUser]
      const { results } = await runOfferWalk(
        walk,
        originSessionId,
        originGen,
        historyForApi,
        scriptSettingsForWalk,
        savedUser.id,
        options?.channelOverride
      )

      const successes = results.filter(
        (r): r is Extract<typeof r, { ok: true }> => r.ok
      )
      const failures = results.filter(
        (r): r is Extract<typeof r, { ok: false }> => !r.ok
      )

      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }

      if (successes.length === 0) {
        setError(failures[0]?.error || 'Failed to generate scripts')
        return
      }

      invalidateUsageLimitsCache()

      if (failures.length > 0) {
        setFailedBatch({
          productIds: failures.map((f) => f.step.productId),
          names: failures.map((f) => f.step.name || f.step.productId),
          userText: text,
          scriptSettings: scriptSettingsForWalk,
        })
        setNotice(
          `Generated ${successes.length}/${walk.length} offers. Failed: ${failures
            .map((f) => f.step.name || f.step.productId)
            .join(', ')}. Retry those offers below.`
        )
      }
    } catch (err) {
      console.error(err)
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setWalkProgress(null)
      setInFlightSessions((prev) => removeInFlightSession(prev, originSessionId))
    }
  }, [
    session,
    offers,
    messages,
    inFlightSessions,
    userId,
    language,
    activeImageOfferId,
    offerProductId,
    runOfferWalk,
    onSessionPatched,
    brandProducts,
    persistOffers,
    persistTurn,
    usage.creditsEnabled,
    usage.creditsRemaining,
  ])

  const confirmCreditQuote = useCallback(async () => {
    const pending = creditPendingRef.current
    setCreditQuote(null)
    creditPendingRef.current = null
    if (!pending) return
    if (pending.kind === 'scripts' && pending.text) {
      await send(pending.text, { ...pending.sendOptions, creditConfirmed: true })
      return
    }
    if (pending.kind === 'image' && pending.imageOptions) {
      await runImageGenerateRef.current({
        ...(pending.imageOptions as {
          productId: string
          preferences: ShellImagePreferences
          prompt: string
          userText: string
          scriptText?: string
          scriptTitle?: string | null
          source: string
          referenceMode?: 'use' | 'none'
          referenceImageIds?: string[]
          alreadyOptimized?: boolean
          askStyleRef?: boolean
          skipStyleRef?: boolean
          skippedIngredients?: IngredientKind[]
        }),
        creditConfirmed: true,
      })
      return
    }
    if (pending.kind === 'edit' && pending.editOptions) {
      const o = pending.editOptions
      await editOfferImageRef.current(
        o.productImageId,
        o.imageUrl,
        o.instruction,
        o.productId,
        o.actionType,
        o.attachments,
        o.enhanceTier,
        true
      )
    }
  }, [send])

  const cancelCreditQuote = useCallback(() => {
    creditPendingRef.current = null
    setCreditQuote(null)
    setNotice(null)
  }, [])

  const answerScriptClarify = useCallback(async (answer: {
    type?: ScriptFramework | 'mixed'
    count?: number
    ctaChannel?: ScriptCtaChannel
    confirm?: boolean
  }) => {
    if (!scriptClarify || !session || scriptClarify.sessionId !== session.id) return
    const finish = async (settings: ScriptGenerationSettings, ctaChannel?: ScriptCtaChannel) => {
      const channel = ctaChannel || scriptClarify.ctaChannel
      setScriptClarify(null)
      await send(scriptClarify.originText, {
        forceSettings: settings,
        skipImage: true,
        bypassScriptClarify: true,
        channelOverride: !channel || channel === 'none' ? undefined : channel,
      })
    }
    const advance = async (settings: ScriptGenerationSettings, ctaChannel?: ScriptCtaChannel) => {
      const [next, ...remaining] = scriptClarify.remaining
      if (!next) {
        await finish(settings, ctaChannel)
        return
      }
      setScriptClarify({
        ...scriptClarify,
        step: next,
        remaining,
        settings,
        ctaChannel,
        history: pushScriptHistory(scriptClarify),
      })
    }
    if (answer.confirm && scriptClarify.step === 'cta' && scriptClarify.ctaChannel) {
      const channel = scriptClarify.ctaChannel
      const settings = {
        ...scriptClarify.settings,
        ctaStrength: channel === 'none' ? 'none' as const : scriptClarify.settings.ctaStrength || 'sales' as const,
      }
      await finish(settings, channel)
      return
    }
    if (scriptClarify.step === 'type' && answer.type) {
      await advance(settingsForScriptType(scriptClarify.settings, answer.type), scriptClarify.ctaChannel)
      return
    }
    if (scriptClarify.step === 'count' && answer.count) {
      await advance(settingsForScriptCount(scriptClarify.settings, answer.count), scriptClarify.ctaChannel)
      return
    }
    if (scriptClarify.step === 'cta' && answer.ctaChannel) {
      const channel = answer.ctaChannel
      const settings = {
        ...scriptClarify.settings,
        ctaStrength: channel === 'none' ? 'none' as const : scriptClarify.settings.ctaStrength || 'sales' as const,
      }
      // Last step: select CTA only; primary Generar confirms (credits line visible).
      if (scriptClarify.remaining.length === 0) {
        setScriptClarify({
          ...scriptClarify,
          settings,
          ctaChannel: channel,
        })
        return
      }
      await advance(settings, channel)
    }
  }, [scriptClarify, session, send])

  const backScriptClarify = useCallback(() => {
    if (!scriptClarify?.history?.length) return
    const prev = scriptClarify.history[scriptClarify.history.length - 1]
    const history = scriptClarify.history.slice(0, -1)
    setScriptClarify({ ...prev, history })
    setNotice(null)
  }, [scriptClarify])

  const startScriptsFlow = useCallback(() => {
    if (!session) return
    const hasOffer =
      planOfferGenerationWalk(offers).length > 0
      || Boolean(session.product_id)
      || brandProducts.some((product) => product.name !== 'Quick Use Image Studio')
    if (!hasOffer) {
      setScriptClarify(null)
      setImageClarify(null)
      setNotice(language === 'es'
        ? 'Primero necesitás una oferta. Creala en el panel Ofertas o confirmá el setup.'
        : 'You need an offer first. Create one in Offers or confirm setup.')
      return
    }
    setImageClarify(null)
    setNotice(null)
    setError(null)
    setScriptClarify({
      sessionId: session.id,
      step: 'type',
      originText: language === 'es' ? 'Quiero crear guiones' : 'I want to create scripts',
      settings: {
        ...DEFAULT_SCRIPT_SETTINGS,
        model: getTextModelPreference(),
      },
      remaining: ['count', 'cta'],
      history: [],
    })
  }, [session, offers, brandProducts, language])

  const retryFailedOffers = useCallback(async () => {
    if (!session || !failedBatch || sending) return
    const walk = planRetryOfferWalk(failedBatch.productIds, offers)
    if (walk.length === 0) {
      setFailedBatch(null)
      return
    }

    const originSessionId = session.id
    const originGen = sessionGenRef.current
    const retryText = `Retry failed offers: ${failedBatch.names.join(', ')}`
    const optimisticId = `optimistic-retry-${Date.now()}`
    const optimisticUser: Message = {
      id: optimisticId,
      session_id: originSessionId,
      role: 'user',
      content: retryText,
      created_at: new Date().toISOString(),
    }

    setInFlightSessions((prev) => addInFlightSession(prev, originSessionId))
    setError(null)
    setNotice(null)
    setMessages((prev) => [...prev, optimisticUser])

    try {
      const savedUser = await addMessage(originSessionId, 'user', retryText)
      if (isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        setMessages((prev) => prev.map((m) => (m.id === optimisticId ? savedUser : m)))
      }
      const historyForApi = [...messages.filter((m) => m.id !== optimisticId), savedUser]
      const scriptSettings = failedBatch.scriptSettings
      const { results } = await runOfferWalk(
        walk,
        originSessionId,
        originGen,
        historyForApi,
        scriptSettings,
        savedUser.id
      )

      const successes = results.filter(
        (r): r is Extract<typeof r, { ok: true }> => r.ok
      )
      const failures = results.filter(
        (r): r is Extract<typeof r, { ok: false }> => !r.ok
      )

      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }

      if (successes.length === 0) {
        setError(failures[0]?.error || 'Retry failed')
        return
      }

      if (failures.length > 0) {
        setFailedBatch({
          productIds: failures.map((f) => f.step.productId),
          names: failures.map((f) => f.step.name || f.step.productId),
          userText: failedBatch.userText,
          scriptSettings,
        })
        setNotice(`Retry partial: ${failures.length} offer(s) still failed.`)
      } else {
        setFailedBatch(null)
      }
    } catch (err) {
      console.error(err)
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
      setError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setWalkProgress(null)
      setInFlightSessions((prev) => removeInFlightSession(prev, originSessionId))
    }
  }, [
    session,
    failedBatch,
    sending,
    offers,
    messages,
    runOfferWalk,
  ])


  const handleSaveScript = useCallback(async (
    content: string,
    title: string,
    opts?: { edit_source?: string; message_id?: string; script_index?: number; product_id?: string }
  ): Promise<string | null> => {
    const productId = opts?.product_id || offerProductId
    if (!session || !productId || savingScript) return null
    const originSessionId = session.id
    const originGen = sessionGenRef.current
    setSavingScript(true)
    try {
      const script = await saveScript(session.id, productId, title, content, undefined, opts)
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return script.id
      }
      return script.id
    } catch (err) {
      console.error(err)
      if (isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        setError(err instanceof Error ? err.message : 'Failed to save script')
      }
      return null
    } finally {
      setSavingScript(false)
    }
  }, [session, offerProductId, savingScript])

  const handleSaveVersion = useCallback(async (
    parentId: string,
    content: string,
    editSource: string,
    editLabel?: string,
    productIdOverride?: string
  ): Promise<string | null> => {
    const productId = productIdOverride || offerProductId
    if (!session || !productId) return null
    try {
      const version = await createScriptVersion(
        parentId,
        session.id,
        productId,
        'Script',
        content,
        editSource,
        editLabel
      )
      return version.id
    } catch (err) {
      console.error(err)
      return null
    }
  }, [session, offerProductId])

  const handleEditScript = useCallback(async (
    originalContent: string,
    instruction: string,
    editType?: 'script_edit' | 'script_enhance' | 'script_hook' | 'script_consciousness',
    productOverride?: Product | null
  ): Promise<string> => {
    const product = productOverride || activeProduct
    const productId = product?.id || offerProductId
    if (!session || !productId || !product) {
      throw new Error('Choose an offer before editing scripts.')
    }
    const bizCtx = brand
      ? (buildApiBusinessContext(brand) as Record<string, unknown> | undefined)
      : (buildApiBusinessContext(product.business) as Record<string, unknown> | undefined)
    const prodCtx = buildApiProductContext(product) as Record<string, unknown>
    return editScript(
      originalContent,
      instruction,
      language,
      bizCtx,
      prodCtx,
      editType,
      session.id,
      productId
    )
  }, [session, offerProductId, activeProduct, brand, language])

  const selectImageOffer = useCallback((productId: string) => {
    setImageOfferId(productId)
  }, [])

  const uploadOfferImage = useCallback(async (
    file: File,
    productIdOverride?: string | null,
    kind: 'product' | 'context' | 'scene' | 'style' | 'logo' = 'product'
  ) => {
    const targetProductId = productIdOverride || activeImageOfferId
    if (!session || !targetProductId || imageBusyRef.current) return
    const pendingRefs =
      imageClarify
      && imageClarify.sessionId === session.id
      && (imageClarify.step === 'refs' || imageClarify.step === 'styleRef' || imageClarify.step === 'ingredients')
      && (imageClarify.preferences || imageClarify.pendingGenerate)
        ? imageClarify
        : null
    const originSessionId = session.id
    const originGen = sessionGenRef.current
    imageBusyRef.current = true
    setImageBusy(true)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })
      const uploaded = await uploadShellOfferImage({
        userId,
        sessionId: originSessionId,
        productId: targetProductId,
        dataUrl,
        filename: file.name,
        kind,
      })
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }
      setOfferImages((prev) => [uploaded, ...prev.filter((item) => item.id !== uploaded.id)])
      await refreshOfferImages(originSessionId, targetProductId, loadRequestRef.current)
      const roleKind = (kind === 'logo'
        ? 'logo'
        : kind === 'style'
          ? 'style'
          : kind === 'scene' || kind === 'context'
            ? 'scene'
            : 'product') as 'product' | 'scene' | 'style' | 'logo'
      if (kind === 'logo' && brandVisualRef) {
        brandVisualRef.current = {
          ...brandVisualRef.current,
          logo_url: uploaded.image_url,
        }
      }
      if (
        pendingRefs
        && (pendingRefs.step === 'refs' || pendingRefs.step === 'styleRef')
      ) {
        setImageClarify((current) => {
          if (
            !current
            || current.sessionId !== originSessionId
            || (current.step !== 'refs' && current.step !== 'styleRef')
          ) return current
          const withoutDup = (current.referenceImages || []).filter((item) => item.id !== uploaded.id)
          // Logo: keep at most one selected logo so generate uses this upload as brandLogoUrl.
          const clearedLogos = roleKind === 'logo'
            ? withoutDup.map((item) => (
              item.kind === 'logo' ? { ...item, selected: false } : item
            ))
            : withoutDup
          const referenceImages = [
            ...clearedLogos,
            {
              id: uploaded.id,
              url: uploaded.image_url,
              kind: roleKind,
              dbKind: (kind === 'product' ? 'product' : 'context') as 'product' | 'context',
              label: uploaded.label,
              selected: true,
              productId: targetProductId,
            },
          ]
          return {
            ...current,
            step: 'refs',
            referenceImages,
            availableReferenceCount: referenceImages.length,
          }
        })
      } else if (
        pendingRefs?.step === 'ingredients'
        && pendingRefs.pendingGenerate
        && pendingRefs.sessionId === originSessionId
      ) {
        const skipped = pendingRefs.skippedIngredients || []
        await runImageGenerateRef.current?.({
          ...pendingRefs.pendingGenerate,
          skippedIngredients: skipped,
        })
      }
      setNotice(
        language === 'es'
          ? (kind === 'logo' ? 'Logo listo para este generate.' : 'Foto de referencia lista.')
          : (kind === 'logo' ? 'Logo ready for this generate.' : 'Reference photo ready.')
      )
    } catch (err) {
      console.error(err)
      if (isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      }
      return
    } finally {
      imageBusyRef.current = false
      setImageBusy(false)
    }

    // S3: resume Script→post / Producto generate after calm refs upload.
  }, [
    session,
    activeImageOfferId,
    imageClarify,
    userId,
    refreshOfferImages,
    language,
    brandVisualRef,
  ])

  const patchImagePreferences = useCallback((patch: Partial<ShellImagePreferences>) => {
    setImagePrefs((prev) => {
      const next = resolveImagePreferences(patch, prev)
      if (sessionId) writeImagePreferences(storage, sessionId, next)
      return next
    })
  }, [sessionId, storage])

  const runImageGenerate = useCallback(async (options: {
    productId: string
    preferences: ShellImagePreferences
    prompt: string
    userText: string
    scriptText?: string
    scriptTitle?: string | null
    source: string
    referenceMode?: 'use' | 'none'
    referenceImageIds?: string[]
    /** Selected Subir logo on Confirmá referencias — overrides kit logo for this generate. */
    brandLogoUrlOverride?: string
    alreadyOptimized?: boolean
    askStyleRef?: boolean
    skipStyleRef?: boolean
    priorClarify?: ImageClarifyState | null
    creditConfirmed?: boolean
    skippedIngredients?: IngredientKind[]
  }) => {
    if (!session || imageBusyRef.current) return
    const originSessionId = session.id
    const originGen = sessionGenRef.current
    const prefs = options.preferences
    if (!prefs.style) {
      setError(language === 'es' ? 'Elige un estilo de imagen.' : 'Choose an image style.')
      return
    }

    const clarifySource: ImageClarifyState['source'] =
      options.source === 'script_card' || options.source === 'rail' || options.source === 'composer'
        ? options.source
        : 'composer'

    setError(null)
    setNotice(formatImageAssumptions(prefs, language))
    let generating = false
    try {
      const libraryIds = [...new Set([
        options.productId,
        ...offers.map((offer) => offer.product_id),
        ...brandProducts.map((product) => product.id),
      ].filter(Boolean))]
      const images = await getSessionOffersImages(libraryIds, originSessionId)
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }
      setOfferImages(images)
      const productNames = new Map(brandProducts.map((product) => [product.id, product.name]))
      const catalog = withPreselectedReferences(
        catalogOfferReferences(images, productNames),
        options.productId,
        options.referenceImageIds
      )
      const referencesRequired = requiresProductReferences(prefs.style)
      let referenceMode = options.referenceMode
      if (
        !referenceMode
        && productStyleAllowsZeroReferences(prefs.style)
        && (options.source === 'rail' || options.source === 'composer')
      ) {
        referenceMode = 'none'
      }
      if (shouldPromptImageReferences({
        styleKind: prefs.style.kind,
        referenceMode,
      })) {
        setImageOfferId(options.productId)
        setImageClarify({
          sessionId: originSessionId,
          step: 'refs',
          mode: prefs.style.kind === 'product' ? 'product' : prefs.style.kind === 'organic' ? 'organic' : 'anuncio',
          originText: options.userText,
          productId: options.productId,
          scriptText: options.scriptText,
          scriptTitle: options.scriptTitle,
          source: clarifySource,
          partial: { style: prefs.style },
          preferences: prefs,
          prompt: options.prompt,
          userText: options.userText,
          availableReferenceCount: catalog.length,
          referencesRequired,
          referenceImages: catalog,
          preferredReferenceIds: options.referenceImageIds,
          alreadyOptimized: options.alreadyOptimized,
          history: options.priorClarify ? pushImageHistory(options.priorClarify) : [],
        })
        setNotice(null)
        return
      }
      const productImageIds = referenceMode === 'none'
        ? []
        : (options.referenceImageIds || [])
      if (referencesRequired && productImageIds.length === 0) {
        setImageOfferId(options.productId)
        setImageClarify({
          sessionId: originSessionId,
          step: 'refs',
          mode: 'product',
          originText: options.userText,
          productId: options.productId,
          scriptText: options.scriptText,
          scriptTitle: options.scriptTitle,
          source: clarifySource,
          partial: { style: prefs.style },
          preferences: prefs,
          prompt: options.prompt,
          userText: options.userText,
          availableReferenceCount: catalog.length,
          referencesRequired: true,
          referenceImages: catalog,
          alreadyOptimized: options.alreadyOptimized,
          history: options.priorClarify ? pushImageHistory(options.priorClarify) : [],
        })
        setNotice(null)
        return
      }

      const brandKitId = resolveBrandKitIdForSession(
        session?.brand_kit_id,
        options.productId,
        brandKits,
        storage
      )
      const linkedKit = brandKits.find((kit) => kit.id === brandKitId)
      const brandVisual = collectBrandGenerateVisual(linkedKit, brandVisualRef?.current)
      const brandLogoUrl = options.brandLogoUrlOverride || brandVisual.brandLogoUrl
      let prompt = options.prompt
      let scriptText = options.scriptText
      if (scriptText && !shouldSkipPostCondense({
        scriptText,
        alreadyOptimized: options.alreadyOptimized,
      })) {
        try {
          scriptText = stripUnresolvedPlaceholders(await streamlineScriptForPost({
            script: scriptText,
            language,
            textDensity: prefs.density || 'hard',
            postStyle: prefs.style.kind === 'preset' ? prefs.style.presetId : 'venta-directa',
            sessionId: originSessionId,
            productId: options.productId,
          }))
          prompt = scriptText
        } catch (err) {
          console.warn('Post copy condense skipped:', err)
          scriptText = stripUnresolvedPlaceholders(scriptText)
          if (prompt === options.scriptText) prompt = scriptText
        }
      } else if (scriptText) {
        scriptText = stripUnresolvedPlaceholders(scriptText)
        if (prompt === options.scriptText) prompt = scriptText
      }

      const skippedSet = new Set(options.skippedIngredients || [])
      // Confirmá referencias already decided soft skips (style/logo). Never gate after spinner.
      if (options.priorClarify?.step === 'refs') {
        const mode = options.referenceMode === 'none' ? 'none' : 'use'
        for (const kind of ingredientsSkippedAfterRefsConfirm(mode)) {
          skippedSet.add(kind)
        }
      }
      if (shouldCheckImageIngredients(prefs.style.kind)) {
        const missing = detectMissingIngredients({
          offerImages: images,
          productId: options.productId,
          brandLogoUrl: options.brandLogoUrlOverride || brandVisual.brandLogoUrl,
          referenceMode: referenceMode === 'use' || referenceMode === 'none' ? referenceMode : undefined,
          selectedReferenceImageIds: productImageIds,
        })
        const stillMissing = remainingIngredients(missing, skippedSet)
        if (stillMissing.length > 0) {
          setImageOfferId(options.productId)
          setImageClarify({
            sessionId: originSessionId,
            step: 'ingredients',
            mode: prefs.style.kind === 'product' ? 'product' : prefs.style.kind === 'organic' ? 'organic' : 'anuncio',
            originText: options.userText,
            productId: options.productId,
            scriptText: options.scriptText,
            scriptTitle: options.scriptTitle,
            source: clarifySource,
            partial: { style: prefs.style },
            preferences: prefs,
            prompt,
            userText: options.userText,
            missingIngredients: stillMissing,
            skippedIngredients: [...skippedSet],
            pendingGenerate: {
              productId: options.productId,
              preferences: prefs,
              prompt,
              userText: options.userText,
              scriptText,
              scriptTitle: options.scriptTitle,
              source: options.source,
              referenceMode: options.referenceMode,
              referenceImageIds: productImageIds,
              alreadyOptimized: options.alreadyOptimized,
              askStyleRef: options.askStyleRef,
              skipStyleRef: options.skipStyleRef,
            },
          })
          setNotice(ingredientsPromptCopy(stillMissing, language))
          return
        }
      }

      if (
        (usage.creditsEnabled || import.meta.env.VITE_CREDITS_V1 === 'true')
        && !options.creditConfirmed
      ) {
        const cost = quoteImageCredits(prefs.model)
        const quote = buildCreditQuote({
          kind: cost >= 24 ? 'image_pro' : 'image_standard',
          remaining: usage.creditsRemaining,
        })
        creditPendingRef.current = { kind: 'image', imageOptions: { ...options, prompt, scriptText } }
        setCreditQuote(quote)
        setError(null)
        return
      }

      generating = true
      imageBusyRef.current = true
      setImageBusy(true)
      setImageClarify(null)
      const result = await generateShellOfferImage({
        userId,
        sessionId: originSessionId,
        productId: options.productId,
        prompt,
        preferences: prefs,
        productImageIds,
        brandKitId,
        customColors: brandVisual.customColors,
        brandLogoUrl,
        language,
        scriptText,
        businessContext: session.context || undefined,
        userText: options.userText,
        source: options.source,
        originSessionId,
        originGen,
        activeThreadSessionId: activeThreadSessionIdRef.current,
        sessionGen: sessionGenRef.current,
      })
      if (!result) return
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }
      writeImagePreferences(storage, originSessionId, prefs)
      setImagePrefs(prefs)
      setImageClarify(null)
      setMessages((prev) => [...prev, result.userMessage, result.assistantMessage])
      await refreshOfferImages(originSessionId, options.productId, loadRequestRef.current)
      invalidateUsageLimitsCache()
    } catch (err) {
      console.error(err)
      if (isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        setError(friendlyImageError(
          err instanceof Error ? err.message : 'Image generate failed',
          language
        ))
      }
    } finally {
      if (generating) {
        imageBusyRef.current = false
        setImageBusy(false)
      }
    }
  }, [
    session,
    language,
    brandKits,
    brandVisualRef,
    storage,
    userId,
    refreshOfferImages,
    offers,
    brandProducts,
    usage.creditsEnabled,
    usage.creditsRemaining,
  ])

  runImageGenerateRef.current = runImageGenerate

  const editOfferImageRef = useRef<(
    productImageId: string,
    imageUrl: string,
    instruction: string,
    productId?: string,
    actionType?: 'edit' | 'enhance',
    attachments?: Array<{ dataUrl: string; role: 'product' | 'context' }>,
    enhanceTier?: ShellEnhanceTier,
    creditConfirmed?: boolean
  ) => Promise<void>>(async () => {})

  const editOfferImage = useCallback(async (
    productImageId: string,
    imageUrl: string,
    instruction: string,
    productId?: string,
    actionType: 'edit' | 'enhance' = 'edit',
    attachments?: Array<{ dataUrl: string; role: 'product' | 'context' }>,
    enhanceTier?: ShellEnhanceTier,
    creditConfirmed = false
  ) => {
    if (!session || imageBusy) return
    const pid = productId || activeImageOfferId
    if (!pid) return

    if ((usage.creditsEnabled || import.meta.env.VITE_CREDITS_V1 === 'true') && !creditConfirmed) {
      const quote = buildCreditQuote({
        kind: actionType === 'enhance' ? 'image_enhance' : 'image_edit',
        remaining: usage.creditsRemaining,
      })
      // Guard: UI quote must equal catalog charge (18 for edit/enhance).
      if (quote.cost !== quoteEditEnhanceCredits(actionType)) {
        console.error('credit quote mismatch', { quote, actionType })
      }
      creditPendingRef.current = {
        kind: 'edit',
        editOptions: {
          productImageId,
          imageUrl,
          instruction,
          productId: pid,
          actionType,
          attachments,
          enhanceTier,
        },
      }
      setCreditQuote(quote)
      setError(null)
      return
    }

    const originSessionId = session.id
    const originGen = sessionGenRef.current
    setImageBusy(true)
    setError(null)
    try {
      const roleNotes = (attachments || [])
        .map((item, index) => `${index + 1}. ${item.role === 'context' ? 'context/style' : 'product'} reference`)
        .join('; ')
      const onBrandPrefix = language === 'es'
        ? 'Mejorá iluminación, composición, fidelidad del logo y exactitud del producto según referencias si las hay. Mantené la marca y el producto; no inventes escenas nuevas.\n\n'
        : 'Improve lighting, composition, logo fidelity, and product accuracy from refs if present. Stay on-brand; do not invent unrelated scenes.\n\n'
      const editPrompt = roleNotes
        ? `${onBrandPrefix}${instruction.trim()}\n\nAttached references: ${roleNotes}. Use product refs as visual truth and context refs for scene or style.`
        : `${onBrandPrefix}${instruction.trim()}`
      const brandKitId = resolveBrandKitIdForSession(
        session.brand_kit_id,
        pid,
        brandKits,
        storage
      )
      const linkedKit = brandKits.find((kit) => kit.id === brandKitId)
      const brandVisual = collectBrandGenerateVisual(linkedKit, brandVisualRef?.current)
      const offerRefs = actionType === 'enhance'
        ? collectOfferEnhanceReferences(offerImages, pid, productImageId)
        : { productUrls: [], contextUrls: [] }
      const result = await editShellOfferImage({
        userId,
        sessionId: originSessionId,
        productId: pid,
        productImageId,
        imageUrl,
        editPrompt,
        actionType,
        userText: actionType === 'enhance'
          ? (language === 'es' ? `Mejorar imagen: ${instruction}` : `Enhance image: ${instruction}`)
          : (language === 'es' ? `Editar imagen: ${instruction}` : `Edit image: ${instruction}`),
        language,
        enhanceTier: actionType === 'enhance' ? (enhanceTier || 'modernize') : undefined,
        editReferenceImages: actionType === 'edit'
          ? (attachments || []).map((item) => item.dataUrl)
          : undefined,
        productReferenceUrls: offerRefs.productUrls,
        contextReferenceUrls: offerRefs.contextUrls,
        brandKitId,
        brandLogoUrl: brandVisual.brandLogoUrl,
        customColors: brandVisual.customColors,
        originSessionId,
        originGen,
        activeThreadSessionId: activeThreadSessionIdRef.current,
        sessionGen: sessionGenRef.current,
      })
      if (!result) return
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }
      if (result.userMessage && result.assistantMessage) {
        setMessages((prev) => [...prev, result.userMessage!, result.assistantMessage!])
      } else if (result.attachedToExisting && result.workspaceMessageId) {
        setMessages((prev) => prev.map((message) => (
          message.id === result.workspaceMessageId
            ? { ...message, artifacts: [...(message.artifacts || []), result.artifact] }
            : message
        )))
      }
      await refreshOfferImages(originSessionId, pid, loadRequestRef.current)
      invalidateUsageLimitsCache()
    } catch (err) {
      console.error(err)
      if (isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        setError(err instanceof Error ? err.message : 'Image edit failed')
      }
      throw err
    } finally {
      setImageBusy(false)
    }
  }, [session, imageBusy, activeImageOfferId, userId, refreshOfferImages, brandKits, storage, brandVisualRef, offerImages, language, usage.creditsEnabled, usage.creditsRemaining])

  editOfferImageRef.current = editOfferImage

  const beginImageFlow = useCallback(async (options: {
    productId?: string | null
    prompt?: string
    userText?: string
    scriptText?: string
    scriptTitle?: string | null
    source: 'composer' | 'rail' | 'script_card'
    explicit?: Partial<ShellImagePreferences>
    alreadyOptimized?: boolean
    referenceImageIds?: string[]
  }) => {
    if (!session) return
    const productId = options.productId || activeImageOfferId || offerProductId
    setScriptClarify(null)
    if (!productId) {
      setNotice(
        language === 'es'
          ? 'Elige una oferta en el rail antes de generar imagen.'
          : 'Choose an offer in the rail before generating an image.'
      )
      return
    }
    if (!offers.some((o) => o.product_id === productId) && session.product_id !== productId) {
      setError(
        language === 'es'
          ? 'Esa oferta ya no está en la sesión.'
          : 'That offer is no longer on this session.'
      )
      return
    }

    const isPostRequest = /\b(post|posts|publicaci[oó]n|publication)\b/i.test(
      options.userText || options.prompt || ''
    )
    const needsScriptSelection =
      !options.scriptText
      && options.source !== 'script_card'
      && isPostRequest
      && options.explicit?.style?.kind !== 'product'
      && options.explicit?.style?.kind !== 'logo'
    if (needsScriptSelection) {
      const allowedProductIds = new Set([
        ...offers.map((offer) => offer.product_id),
        ...(session.product_id ? [session.product_id] : []),
      ])
      const scriptChoices = collectImageScriptChoices(messages, productId, latestScriptByKeyRef.current)
        .filter((choice) => allowedProductIds.has(choice.productId))
      if (!scriptChoices.length) {
        setImageClarify(null)
        setNotice(language === 'es'
          ? 'Primero crea un guion. Después elegís cuál usar y revisás el texto antes de generar el post.'
          : 'Create a script first. Then choose which one to use and review it before generating the post.')
        return
      }
      setImageClarify({
        sessionId: session.id,
        step: 'script',
        originText: options.userText || options.prompt || 'Generate post',
        productId,
        source: options.source,
        partial: options.explicit || {},
        scriptChoices,
        history: [],
      })
      setNotice(null)
      return
    }

    const sticky = readImagePreferences(storage, session.id)
    const stickyMerged = resolveImagePreferences(sticky, imagePrefs)
    const stickyPartial = sanitizePartialPreferences(sticky)
    const explicitPartial = sanitizePartialPreferences(options.explicit)
    const resolved =
      options.source === 'script_card'
        // A script can become an ad, organic post, or product-led visual.
        // Keep non-style preferences, but ask for the post type every time.
        ? resolveImagePreferences(
            { ...options.explicit, style: undefined },
            { ...stickyMerged, style: undefined }
          )
        : resolveImagePreferences(
            { ...options.explicit },
            stickyMerged
          )
    const aspectUnset = !explicitPartial.aspectRatio && !stickyPartial.aspectRatio
    const densityUnset =
      options.source !== 'script_card'
      && resolved.style?.kind !== 'product'
      && resolved.style?.kind !== 'logo'
      && (Boolean(options.scriptText) || resolved.style?.kind === 'preset' || resolved.style?.kind === 'organic')
      && !explicitPartial.density
      && !stickyPartial.density
    const askStyleRef = !messages.some((message) =>
      message.artifacts?.some((artifact) => artifact.artifact_type === 'image')
    )
    const plan = planImageClarifications(resolved, { aspectUnset, densityUnset })
    if (plan.needed && plan.step === 'mode') {
      // S4: organic scripts skip Anuncio/Producto fork → ask organic subtype only (≤1 ask).
      const preferOrganic =
        options.source === 'script_card'
        && looksLikeOrganicScript(options.scriptText, options.scriptTitle)
      setImagePrefs(resolved)
      setImageClarify({
        sessionId: session.id,
        step: preferOrganic ? 'style' : 'mode',
        mode: preferOrganic ? 'organic' : undefined,
        originText: options.userText || options.prompt || 'Generate image',
        productId,
        scriptText: options.scriptText,
        scriptTitle: options.scriptTitle,
        source: options.source,
        partial: options.explicit || {},
        askStyleRef,
        alreadyOptimized: options.alreadyOptimized,
        preferredReferenceIds: options.referenceImageIds,
        history: [],
      })
      setNotice(null)
      return
    }

    if (plan.needed && plan.step === 'aspect') {
      setImagePrefs(resolved)
      setImageClarify({
        sessionId: session.id,
        step: 'aspect',
        originText: options.userText || options.prompt || 'Generate image',
        productId,
        scriptText: options.scriptText,
        scriptTitle: options.scriptTitle,
        source: options.source,
        partial: { ...options.explicit, style: resolved.style },
        preferences: resolved,
        askStyleRef,
        alreadyOptimized: options.alreadyOptimized,
        preferredReferenceIds: options.referenceImageIds,
        history: [],
      })
      setNotice(null)
      return
    }

    if (plan.needed && plan.step === 'density') {
      setImagePrefs(resolved)
      setImageClarify({
        sessionId: session.id,
        step: 'density',
        originText: options.userText || options.prompt || 'Generate image',
        productId,
        scriptText: options.scriptText,
        scriptTitle: options.scriptTitle,
        source: options.source,
        partial: { ...options.explicit, style: resolved.style, aspectRatio: resolved.aspectRatio },
        preferences: resolved,
        askStyleRef,
        alreadyOptimized: options.alreadyOptimized,
        preferredReferenceIds: options.referenceImageIds,
        history: [],
      })
      setNotice(null)
      return
    }

    await runImageGenerate({
      productId,
      preferences: resolved,
      prompt: options.prompt || options.scriptText || session.context || 'Ad image',
      userText: options.userText || options.prompt || 'Generate image for offer',
      scriptText: options.scriptText,
      scriptTitle: options.scriptTitle,
      source: options.source,
      askStyleRef,
      alreadyOptimized: options.alreadyOptimized,
      referenceImageIds: options.referenceImageIds,
    })
  }, [
    session,
    activeImageOfferId,
    offerProductId,
    offers,
    language,
    storage,
    imagePrefs,
    messages,
    runImageGenerate,
  ])

  beginImageFlowRef.current = beginImageFlow

  const answerImageClarify = useCallback(async (
    answer: {
      scriptChoiceId?: string
      mode?: ImageClarifyMode
      styleId?: string
      aspectRatio?: ShellImageAspect
      density?: ShellImagePreferences['density']
      skipStyleRef?: boolean
      skipIngredient?: IngredientKind
      useReferences?: boolean
      toggleReferenceId?: string
      /** From refs sticky: switch Producto → Anuncio without requiring a Ref. */
      switchToAnuncio?: boolean
    }
  ) => {
    if (!imageClarify || !session || imageClarify.sessionId !== session.id) return

    if (imageClarify.step === 'ingredients' && answer.skipIngredient && imageClarify.pendingGenerate) {
      const skipped = [...(imageClarify.skippedIngredients || []), answer.skipIngredient]
      await runImageGenerate({
        ...imageClarify.pendingGenerate,
        skippedIngredients: skipped,
      })
      return
    }

    if (imageClarify.step === 'script' && answer.scriptChoiceId) {
      const choice = imageClarify.scriptChoices?.find((item) => item.id === answer.scriptChoiceId)
      if (!choice) return
      const preferOrganic = looksLikeOrganicScript(choice.scriptText, choice.title)
      setImageOfferId(choice.productId)
      setImageClarify({
        ...imageClarify,
        step: preferOrganic ? 'style' : 'mode',
        mode: preferOrganic ? 'organic' : undefined,
        productId: choice.productId,
        scriptText: choice.scriptText,
        scriptTitle: choice.title,
        scriptChoices: undefined,
        history: pushImageHistory(imageClarify),
      })
      setNotice(null)
      return
    }

    if (imageClarify.step === 'refs') {
      if (answer.toggleReferenceId) {
        setImageClarify({
          ...imageClarify,
          referenceImages: toggleReferenceSelection(
            imageClarify.referenceImages || [],
            answer.toggleReferenceId
          ),
        })
        return
      }
      if (typeof answer.useReferences === 'boolean' && imageClarify.preferences) {
        if (!answer.useReferences && imageClarify.referencesRequired) return
        // One Generar = one in-flight request. Ignore double-clicks before busy settles.
        if (imageGenerateSubmitLockRef.current || imageBusyRef.current) return
        imageGenerateSubmitLockRef.current = true
        setImageBusy(true)
        setError(null)
        try {
          const selected = (imageClarify.referenceImages || []).filter((reference) => reference.selected === true)
          if (answer.useReferences && imageClarify.referencesRequired && !hasSelectedProductReference(selected)) {
            setNotice(language === 'es'
              ? 'Elegí al menos una foto de producto.'
              : 'Pick at least one product photo.')
            return
          }
          let referenceImageIds = confirmedReferenceImageIds(imageClarify.referenceImages || [])
          const logoUrl = answer.useReferences
            ? selectedBrandLogoUrl(imageClarify.referenceImages || [])
            : undefined
          if (answer.useReferences && selected.length) {
            const nonLogoSelected = selected.filter((item) => item.kind !== 'logo')
            const { keepIds, copyIds } = partitionReferenceCopies(nonLogoSelected, imageClarify.productId)
            const copiedIds: string[] = []
            for (const id of copyIds) {
              const source = selected.find((item) => item.id === id)
              if (!source) continue
              const copied = await copyShellOfferImageToProduct({
                userId,
                source: {
                  id: source.id,
                  image_url: source.url,
                  label: source.label,
                  kind: source.kind,
                },
                targetProductId: imageClarify.productId,
              })
              copiedIds.push(copied.id)
            }
            referenceImageIds = [...keepIds, ...copiedIds]
            if (copiedIds.length) {
              await refreshOfferImages(session.id, imageClarify.productId, loadRequestRef.current)
            }
          }
          if (logoUrl && brandVisualRef) {
            brandVisualRef.current = {
              ...brandVisualRef.current,
              logo_url: logoUrl,
            }
          }
          await runImageGenerate({
            productId: imageClarify.productId,
            preferences: imageClarify.preferences,
            prompt: imageClarify.prompt || imageClarify.scriptText || imageClarify.originText || session.context || 'Ad image',
            userText: imageClarify.userText || imageClarify.originText,
            scriptText: imageClarify.scriptText,
            scriptTitle: imageClarify.scriptTitle,
            source: imageClarify.source,
            referenceMode: answer.useReferences ? 'use' : 'none',
            referenceImageIds: answer.useReferences ? referenceImageIds : [],
            brandLogoUrlOverride: logoUrl,
            alreadyOptimized: imageClarify.alreadyOptimized,
            priorClarify: imageClarify,
            // Generar / Crear sin referencias on Confirmá referencias = soft-skip style/logo (never post-spinner gate).
            skippedIngredients: ingredientsSkippedAfterRefsConfirm(
              answer.useReferences ? 'use' : 'none'
            ),
          })
          return
        } catch (err) {
          console.error(err)
          setError(err instanceof Error ? err.message : 'Image generation failed')
          return
        } finally {
          imageGenerateSubmitLockRef.current = false
          if (!imageBusyRef.current) {
            setImageBusy(false)
          }
        }
      }
      if (answer.switchToAnuncio) {
        const anuncioStyle: ShellImageStyle = looksLikeSalesScript(
          imageClarify.scriptText,
          imageClarify.scriptTitle
        )
          ? { kind: 'preset', presetId: 'venta-directa' }
          : { kind: 'preset', presetId: 'anuncio-conversion' }
        const base = imageClarify.preferences
          || resolveImagePreferences(
            imageClarify.partial,
            resolveImagePreferences(readImagePreferences(storage, session.id), imagePrefs)
          )
        const resolved = resolveImagePreferences(
          { style: anuncioStyle },
          base
        )
        await runImageGenerate({
          productId: imageClarify.productId,
          preferences: resolved,
          prompt: imageClarify.prompt || imageClarify.scriptText || imageClarify.originText || session.context || 'Ad image',
          userText: imageClarify.userText || imageClarify.originText,
          scriptText: imageClarify.scriptText,
          scriptTitle: imageClarify.scriptTitle,
          source: imageClarify.source,
          referenceMode: 'none',
          priorClarify: imageClarify,
        })
      }
      return
    }

    if (imageClarify.step === 'styleRef') {
      if (answer.skipStyleRef && imageClarify.preferences) {
        await runImageGenerate({
          productId: imageClarify.productId,
          preferences: imageClarify.preferences,
          prompt: imageClarify.prompt || imageClarify.scriptText || imageClarify.originText || session.context || 'Ad image',
          userText: imageClarify.userText || imageClarify.originText,
          scriptText: imageClarify.scriptText,
          scriptTitle: imageClarify.scriptTitle,
          source: imageClarify.source,
          skipStyleRef: true,
          alreadyOptimized: imageClarify.alreadyOptimized,
          referenceImageIds: imageClarify.preferredReferenceIds,
          priorClarify: imageClarify,
        })
      }
      return
    }

    if (imageClarify.step === 'aspect' && answer.aspectRatio) {
      const resolved = resolveImagePreferences(
        { ...imageClarify.partial, aspectRatio: answer.aspectRatio },
        resolveImagePreferences(readImagePreferences(storage, session.id), imagePrefs)
      )
      const densityUnset =
        imageClarify.source !== 'script_card'
        && (Boolean(imageClarify.scriptText)
          || imageClarify.preferences?.style?.kind === 'preset'
          || imageClarify.preferences?.style?.kind === 'organic')
        && !sanitizePartialPreferences(imageClarify.partial).density
      if (densityUnset) {
        setImageClarify({
          ...imageClarify,
          step: 'density',
          partial: { ...imageClarify.partial, aspectRatio: answer.aspectRatio },
          preferences: resolved,
          history: pushImageHistory(imageClarify),
        })
        setNotice(null)
        return
      }
      await runImageGenerate({
        productId: imageClarify.productId,
        preferences: resolved,
        prompt: imageClarify.scriptText || imageClarify.prompt || imageClarify.originText || session.context || 'Ad image',
        userText: imageClarify.userText || imageClarify.originText,
        scriptText: imageClarify.scriptText,
        scriptTitle: imageClarify.scriptTitle,
        source: imageClarify.source,
        askStyleRef: imageClarify.askStyleRef,
        alreadyOptimized: imageClarify.alreadyOptimized,
        referenceImageIds: imageClarify.preferredReferenceIds,
        priorClarify: imageClarify,
      })
      return
    }

    if (imageClarify.step === 'density' && answer.density) {
      const resolved = resolveImagePreferences(
        { ...imageClarify.partial, density: answer.density },
        resolveImagePreferences(readImagePreferences(storage, session.id), imagePrefs)
      )
      await runImageGenerate({
        productId: imageClarify.productId,
        preferences: resolved,
        prompt: imageClarify.scriptText || imageClarify.prompt || imageClarify.originText || session.context || 'Ad image',
        userText: imageClarify.userText || imageClarify.originText,
        scriptText: imageClarify.scriptText,
        scriptTitle: imageClarify.scriptTitle,
        source: imageClarify.source,
        askStyleRef: imageClarify.askStyleRef,
        alreadyOptimized: imageClarify.alreadyOptimized,
        referenceImageIds: imageClarify.preferredReferenceIds,
        priorClarify: imageClarify,
      })
      return
    }

    if (imageClarify.step === 'mode' && answer.mode) {
      setImageClarify({
        ...imageClarify,
        step: 'style',
        mode: answer.mode,
        history: pushImageHistory(imageClarify),
      })
      setNotice(null)
      return
    }

    if (imageClarify.step === 'style' && answer.styleId) {
      let style: ShellImageStyle
      if (imageClarify.mode === 'product') {
        style = { kind: 'product', productSubStyle: answer.styleId }
      } else if (imageClarify.mode === 'organic') {
        style = { kind: 'organic', organicSubtype: answer.styleId as OrganicSingleSubtype }
      } else {
        style = { kind: 'preset', presetId: answer.styleId }
      }
      const resolved = resolveImagePreferences(
        { ...imageClarify.partial, style },
        resolveImagePreferences(readImagePreferences(storage, session.id), imagePrefs)
      )
      const aspectUnset = !sanitizePartialPreferences(imageClarify.partial).aspectRatio
      if (aspectUnset) {
        setImageClarify({
          ...imageClarify,
          step: 'aspect',
          partial: { ...imageClarify.partial, style },
          preferences: resolved,
          history: pushImageHistory(imageClarify),
        })
        setNotice(null)
        return
      }
      const densityUnset =
        imageClarify.source !== 'script_card'
        && (Boolean(imageClarify.scriptText) || style.kind === 'preset' || style.kind === 'organic')
        && !sanitizePartialPreferences(imageClarify.partial).density
      if (densityUnset) {
        setImageClarify({
          ...imageClarify,
          step: 'density',
          partial: { ...imageClarify.partial, style },
          preferences: resolved,
          history: pushImageHistory(imageClarify),
        })
        setNotice(null)
        return
      }
      await runImageGenerate({
        productId: imageClarify.productId,
        preferences: resolved,
        prompt: imageClarify.scriptText || imageClarify.originText || session.context || 'Ad image',
        userText: imageClarify.originText,
        scriptText: imageClarify.scriptText,
        scriptTitle: imageClarify.scriptTitle,
        source: imageClarify.source,
        askStyleRef: imageClarify.askStyleRef,
        alreadyOptimized: imageClarify.alreadyOptimized,
        referenceImageIds: imageClarify.preferredReferenceIds,
        priorClarify: imageClarify,
      })
    }
  }, [imageClarify, session, language, storage, imagePrefs, runImageGenerate, userId, refreshOfferImages, brandVisualRef])

  const backImageClarify = useCallback(() => {
    if (!imageClarify?.history?.length) return
    const prev = imageClarify.history[imageClarify.history.length - 1]
    const history = imageClarify.history.slice(0, -1)
    setImageClarify({ ...prev, history })
    setNotice(null)
  }, [imageClarify])

  const startPostFlow = useCallback(() => {
    setScriptClarify(null)
    setNotice(null)
    void beginImageFlowRef.current({
      productId: activeImageOfferId || offerProductId,
      prompt: language === 'es' ? 'Quiero crear un post' : 'I want to create a post',
      userText: language === 'es' ? 'Quiero crear un post' : 'I want to create a post',
      source: 'composer',
    })
  }, [activeImageOfferId, offerProductId, language])

  const startProductFotoFlow = useCallback(() => {
    if (!session) return
    const productId = activeImageOfferId || offerProductId
    setScriptClarify(null)
    setNotice(null)
    if (!productId) {
      setNotice(
        language === 'es'
          ? 'Elige una oferta en el rail antes de generar imagen.'
          : 'Choose an offer in the rail before generating an image.'
      )
      return
    }
    // Open Pack-family sheet on product style (Paso 1) so aspect/refs get Back on step 2+.
    setImageClarify({
      sessionId: session.id,
      step: 'style',
      mode: 'product',
      originText: language === 'es' ? 'Quiero crear una foto de producto' : 'I want to create a product photo',
      productId,
      source: 'composer',
      partial: {},
      history: [],
    })
  }, [session, activeImageOfferId, offerProductId, language])

  const removeOfferImage = useCallback(async (imageId: string) => {
    if (!session || !activeImageOfferId || imageBusyRef.current) return
    imageBusyRef.current = true
    setImageBusy(true)
    setError(null)
    try {
      await deleteProductImage(imageId)
      await refreshOfferImages(session.id, activeImageOfferId, loadRequestRef.current)
      setImageClarify((current) => {
        if (!current?.referenceImages?.some((reference) => reference.id === imageId)) return current
        const referenceImages = current.referenceImages.filter((reference) => reference.id !== imageId)
        return { ...current, referenceImages, availableReferenceCount: referenceImages.length }
      })
      setNotice(language === 'es' ? 'Imagen eliminada.' : 'Image removed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove image')
    } finally {
      imageBusyRef.current = false
      setImageBusy(false)
    }
  }, [activeImageOfferId, language, refreshOfferImages, session])

  const generateScripts = useCallback(async () => {
    const label = language === 'es' ? 'Generar guiones' : 'Generate scripts'
    if (!session) return
    setImageClarify(null)
    setNotice(null)
    setScriptClarify({
      sessionId: session.id,
      step: 'cta',
      originText: label,
      settings: scriptSettings,
      remaining: [],
    })
  }, [scriptSettings, language, session])

  const generateTypedImage = useCallback(async (
    explicit: Partial<ShellImagePreferences>,
    prompt?: string
  ) => {
    const merged = resolveImagePreferences(explicit, imagePrefs)
    if (explicit.style || merged.style) {
      patchImagePreferences({ ...explicit, style: explicit.style ?? merged.style })
    }
    const flow = shellImageFlowCopy(merged, language, session?.context)
    await beginImageFlow({
      productId: activeImageOfferId || offerProductId,
      prompt: prompt || flow.prompt,
      userText: flow.userText,
      source: 'rail',
      explicit: merged,
    })
  }, [beginImageFlow, activeImageOfferId, offerProductId, session, language, patchImagePreferences, imagePrefs])

  const generateOfferImage = useCallback(async () => {
    const merged = imagePrefs
    const flow = shellImageFlowCopy(merged, language, session?.context)
    await beginImageFlow({
      productId: activeImageOfferId || offerProductId,
      prompt: flow.prompt,
      userText: flow.userText,
      source: 'rail',
      explicit: merged,
    })
  }, [beginImageFlow, activeImageOfferId, offerProductId, session, imagePrefs, language])

  const prepareScriptForPost = useCallback(async (
    scriptText: string,
    density: 'hard' | 'medium' = 'hard'
  ): Promise<string> => {
    const product = activeProduct
    try {
      if (shouldSkipPostCondense({ scriptText })) {
        return stripUnresolvedPlaceholders(scriptText)
      }
      return await streamlineScriptForPost({
        script: scriptText,
        language,
        textDensity: density,
        postStyle: 'venta-directa',
        productContext: product ? {
          name: product.name || undefined,
          description: product.product_description || product.description || undefined,
          niche: product.product_category_custom || product.product_category || undefined,
          differentiation: product.differentiation || product.unique_value || undefined,
        } : undefined,
        sessionId: sessionId || undefined,
        productId: product?.id,
      }).then(stripUnresolvedPlaceholders)
    } catch (err) {
      console.error(err)
      throw new Error(language === 'es'
        ? 'No pude optimizar el guión para el post. Reintentá.'
        : 'Could not optimize the script for the post. Try again.')
    }
  }, [language, activeProduct, sessionId])

  const generateImageFromScript = useCallback(async (
    scriptText: string,
    productId?: string | null,
    scriptTitle?: string | null,
    options?: {
      density?: 'hard' | 'medium'
      aspectRatio?: ShellImageAspect
      referenceImageIds?: string[]
      alreadyOptimized?: boolean
    }
  ) => {
    await beginImageFlow({
      productId: productId || activeImageOfferId || offerProductId,
      prompt: scriptText,
      userText: language === 'es' ? 'Crear post desde guión' : 'Create post from script',
      scriptText,
      scriptTitle,
      source: 'script_card',
      explicit: {
        ...(options?.density ? { density: options.density } : { density: 'hard' }),
        ...(options?.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
      },
      alreadyOptimized: options?.alreadyOptimized,
      referenceImageIds: options?.referenceImageIds,
    })
  }, [beginImageFlow, activeImageOfferId, offerProductId, language])

  const optimizeOfferImage = useCallback(async (
    productImageId: string,
    imageUrl: string,
    productId?: string,
    scriptText?: string
  ) => {
    if (!session || imageBusy) return
    const pid = productId || activeImageOfferId
    if (!pid) return
    const originSessionId = session.id
    const originGen = sessionGenRef.current
    setImageBusy(true)
    setError(null)
    try {
      const workspaces = buildImageWorkspaces(
        offerImages,
        messages.flatMap((message) => (message.artifacts || []).map((artifact) => ({
          ...artifact,
          message_id: message.id,
        })))
      )
      const workspaceMessageId = workspaceForImage(workspaces, productImageId)?.messageId
        || offerImages.find((image) => image.id === productImageId)?.message_id
        || undefined
      const result = await optimizeShellOfferImage({
        userId,
        sessionId: originSessionId,
        productId: pid,
        productImageId,
        imageUrl,
        scriptText: scriptText || session.context || undefined,
        density: 'medium',
        brandKitId: resolveBrandKitIdForSession(
          session.brand_kit_id,
          pid,
          brandKits,
          storage
        ),
        originSessionId,
        originGen,
        activeThreadSessionId: activeThreadSessionIdRef.current,
        sessionGen: sessionGenRef.current,
        workspaceMessageId,
      })
      if (!result) return
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }
      if (result.attachedToExisting && result.workspaceMessageId) {
        setMessages((prev) => prev.map((message) => (
          message.id === result.workspaceMessageId
            ? { ...message, artifacts: [...(message.artifacts || []), result.artifact] }
            : message
        )))
      } else if (result.userMessage && result.assistantMessage) {
        const userMessage = result.userMessage
        const assistantMessage = result.assistantMessage
        setMessages((prev) => [...prev, userMessage, assistantMessage])
      }
      await refreshOfferImages(originSessionId, pid, loadRequestRef.current)
    } catch (err) {
      console.error(err)
      if (isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        setError(err instanceof Error ? err.message : 'Optimize failed')
      }
      throw err
    } finally {
      setImageBusy(false)
    }
  }, [session, imageBusy, activeImageOfferId, userId, refreshOfferImages, brandKits, storage, offerImages, messages])

  const linkedOfferIds = useMemo(() => {
    const ids = new Set<string>()
    for (const message of messages) {
      for (const artifact of message.artifacts || []) {
        if (artifact.product_id) ids.add(artifact.product_id)
      }
    }
    return ids
  }, [messages])

  return {
    messages,
    offers,
    brandProducts,
    brandProductsReady,
    unassignedProducts,
    assignUnassignedProduct,
    deleteUnassignedProduct,
    clearUnassignedProducts,
    activeProduct,
    offerProductId,
    loadingMessages,
    sending,
    savingScript,
    error,
    notice,
    canGenerate,
    failedBatch,
    send,
    retryFailedOffers,
    setPrimaryOffer,
    addOffer,
    removeOffer,
    moveOffer,
    patchSession,
    persistTurn,
    handleSaveScript,
    handleSaveVersion,
    handleEditScript,
    activeImageOfferId,
    filteredOfferImages,
    offerImages,
    latestImagesByOffer,
    imageBusy,
    selectImageOffer,
    uploadOfferImage,
    removeOfferImage,
    generateOfferImage,
    generateTypedImage,
    generateScripts,
    scriptSettings,
    setScriptSettings,
    prepareScriptForPost,
    generateImageFromScript,
    editOfferImage,
    optimizeOfferImage,
    imagePrefs,
    patchImagePreferences,
    imageClarify,
    answerImageClarify,
    backImageClarify,
    cancelImageClarify: () => {
      setImageClarify(null)
      setNotice(null)
    },
    scriptClarify,
    answerScriptClarify,
    backScriptClarify,
    startScriptsFlow,
    startPostFlow,
    startProductFotoFlow,
    cancelScriptClarify: () => {
      setScriptClarify(null)
      setNotice(null)
    },
    creditQuote,
    confirmCreditQuote,
    cancelCreditQuote,
    registerScriptSnapshot: (key: string, content: string) => {
      if (!key || !content.trim()) return
      latestScriptByKeyRef.current.set(key, content)
    },
    offerMutating,
    walkProgress,
    linkedOfferIds,
    refreshBrandProducts,
  }
}
