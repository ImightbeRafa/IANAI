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
import {
  collectBrandGenerateVisual,
  looksLikeCondensedPostCopy,
  resolveBrandKitIdForSession,
  stripUnresolvedPlaceholders,
  type BrandVisualFallback,
} from './chatShellGenerationPreferences'
import {
  parseChatShellScriptIntent,
  type ChatShellLanguage,
} from './chatShellScriptIntent'
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
} from './chatShellAsync'
import {
  planOfferGenerationWalk,
  planRetryOfferWalk,
  type PlannedOfferStep,
} from './chatShellGeneration'
import {
  emptyThreadSnapshot,
  mergeFetchedMessages,
  readThreadCache,
  replaceOptimisticMessage,
  upsertMessage,
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
  filterImagesForOffer,
  latestImageByProductId,
  resolveActiveImageOfferId,
  selectProductReferenceImageIds,
} from './chatShellImages'
import {
  formatImageAssumptions,
  looksLikeOrganicScript,
  looksLikeSalesScript,
  parseChatShellImageIntent,
  planImageClarifications,
  readImagePreferences,
  requiresProductReferences,
  resolveImagePreferences,
  sanitizePartialPreferences,
  writeImagePreferences,
  type ImageClarifyMode,
  type ImageClarifyStep,
  type ShellImageAspect,
  type ShellImagePreferences,
  type ShellImageStyle,
} from './chatShellImageIntent'
import {
  editShellOfferImage,
  generateShellOfferImage,
  getSessionOfferImages,
  optimizeShellOfferImage,
  uploadShellOfferImage,
} from './chatShellImageApi'

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
    referenceImages?: Array<{
    id: string
    url: string
    kind: 'product' | 'context'
    label?: string | null
    selected?: boolean
  }>
  askStyleRef?: boolean
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
  const [imagePrefs, setImagePrefs] = useState<ShellImagePreferences>(() =>
    resolveImagePreferences({}, {})
  )
  const [imageClarify, setImageClarify] = useState<ImageClarifyState | null>(null)
  const [scriptClarify, setScriptClarify] = useState<ScriptClarifyState | null>(null)
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
  }) => Promise<void>>(async () => {})

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
  }) => Promise<void>>(async () => {})

  const loadRequestRef = useRef(0)
  const offerRequestRef = useRef(0)
  const offerMutatingRef = useRef(false)
  /** Bumped on every session change including null. */
  const sessionGenRef = useRef(0)
  const activeThreadSessionIdRef = useRef<string | null>(null)
  const threadCacheRef = useRef<Map<string, CachedThread>>(new Map())

  activeThreadSessionIdRef.current = sessionId

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
    const list = await getSessionOfferImages(productId, sid)
    if (requestId !== loadRequestRef.current) return list
    if (activeThreadSessionIdRef.current !== sid) return list
    setOfferImages(list)
    return list
  }, [])

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
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [products, unassigned] = await Promise.all([
          getBusinessProducts(brand.id),
          getUnassignedProducts(userId),
        ])
        if (!cancelled) {
          setBrandProducts(products)
          setUnassignedProducts(unassigned.filter((product) => !isQuickPostSentinel(product)))
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setBrandProducts([])
          setUnassignedProducts([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [brand?.id, userId])

  const refreshBrandProducts = useCallback(async () => {
    if (!brand?.id) {
      setBrandProducts([])
      setUnassignedProducts([])
      return
    }
    try {
      const [products, unassigned] = await Promise.all([
        getBusinessProducts(brand.id),
        getUnassignedProducts(userId),
      ])
      setBrandProducts(products)
      setUnassignedProducts(unassigned.filter((product) => !isQuickPostSentinel(product)))
    } catch (err) {
      console.error(err)
    }
  }, [brand?.id, userId])

  const assignUnassignedProduct = useCallback(async (productId: string) => {
    if (!brand?.id) return
    const assigned = await assignUnassignedProductToBusiness(userId, productId, brand.id)
    setUnassignedProducts((prev) => prev.filter((p) => p.id !== productId))
    setBrandProducts((prev) => [assigned, ...prev.filter((p) => p.id !== assigned.id)])
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

  useEffect(() => {
    sessionGenRef.current += 1
    const requestId = ++loadRequestRef.current
    const previousId = prevSessionIdRef.current
    if (previousId && previousId !== sessionId) {
      writeThreadCache(threadCacheRef.current, previousId, snapshotRef.current)
    }
    prevSessionIdRef.current = sessionId

    if (!sessionId) {
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
      setMessages(cached.messages)
      setOffers(cached.offers)
      setActiveProduct(cached.activeProduct)
      setOfferImages(cached.offerImages)
      setLoadingMessages(false)
    } else {
      setMessages([])
      setOffers([])
      setActiveProduct(null)
      setOfferImages([])
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
        setMessages((prev) => mergeFetchedMessages(prev, msgs))
        writeThreadCache(threadCacheRef.current, sessionId, {
          ...snapshotRef.current,
          messages: mergeFetchedMessages(snapshotRef.current.messages, msgs),
        })
      } catch (err) {
        if (requestId !== loadRequestRef.current) return
        if (activeThreadSessionIdRef.current !== sessionId) return
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load messages')
        if (!cached) setMessages([])
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
    if (!options?.forceSettings && !options?.bypassScriptClarify && parsedScriptIntent.matched) {
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
        setNotice(language === 'es'
          ? 'Todavía no hay una oferta en esta marca. Confirmá el setup en el chat.'
          : 'This brand has no offer yet. Confirm setup in chat first.')
        return
      }
    }

    if (walk.length === 0) {
      setNotice(language === 'es'
        ? 'Todavía no hay una oferta en esta marca. Confirmá el setup en el chat.'
        : 'This brand has no offer yet. Confirm setup in chat first.')
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
  ])

  const answerScriptClarify = useCallback(async (answer: {
    type?: ScriptFramework | 'mixed'
    count?: number
    ctaChannel?: ScriptCtaChannel
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
      setScriptClarify({ ...scriptClarify, step: next, remaining, settings, ctaChannel })
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
      await advance(settings, channel)
    }
  }, [scriptClarify, session, send])

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
    kind: 'product' | 'context' = 'product'
  ) => {
    const targetProductId = productIdOverride || activeImageOfferId
    if (!session || !targetProductId || imageBusyRef.current) return
    const pendingRefs =
      imageClarify
      && imageClarify.sessionId === session.id
      && (imageClarify.step === 'refs' || imageClarify.step === 'styleRef')
      && imageClarify.preferences
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
      await refreshOfferImages(originSessionId, targetProductId, loadRequestRef.current)
      if (pendingRefs) {
        setImageClarify((current) => {
          if (
            !current
            || current.sessionId !== originSessionId
            || (current.step !== 'refs' && current.step !== 'styleRef')
          ) return current
          const referenceImages = [
            ...(current.referenceImages || []).filter((item) => item.id !== uploaded.id),
            {
              id: uploaded.id,
              url: uploaded.image_url,
              kind,
              label: uploaded.label,
              selected: true,
            },
          ]
          return {
            ...current,
            step: 'refs',
            referenceImages,
            availableReferenceCount: referenceImages.length,
          }
        })
      }
      setNotice(
        language === 'es'
          ? 'Foto de referencia lista.'
          : 'Reference photo ready.'
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
    askStyleRef?: boolean
    skipStyleRef?: boolean
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
      const images = await getSessionOfferImages(options.productId, originSessionId)
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }
      setOfferImages(images)
      const productPhotoIds = selectProductReferenceImageIds(images, 4, { includeContext: false })
      const thisTurnRefIds = options.referenceImageIds || []
      const availableProductImageIds = thisTurnRefIds.length > 0
        ? [...new Set([...thisTurnRefIds, ...productPhotoIds])]
        : productPhotoIds
      const referenceImages = availableProductImageIds.flatMap((id) => {
        const image = images.find((item) => item.id === id)
        if (!image?.image_url || image.kind === 'generated') return []
        return [{
          id: image.id,
          url: image.image_url,
          kind: image.kind === 'context' ? 'context' as const : 'product' as const,
          label: image.label,
          selected: true,
        }]
      })
      const referencesRequired = requiresProductReferences(prefs.style)
      const hasContextRef = images.some((item) => item.kind === 'context')
      const shouldAskStyleRef =
        Boolean(options.askStyleRef)
        && !options.skipStyleRef
        && !options.referenceMode
        && !hasContextRef
        && prefs.style.kind !== 'logo'
      if (
        shouldAskStyleRef
        && productPhotoIds.length === 0
        && !referencesRequired
      ) {
        setImageOfferId(options.productId)
        setImageClarify({
          sessionId: originSessionId,
          step: 'styleRef',
          mode: prefs.style.kind === 'product' ? 'product' : prefs.style.kind === 'organic' ? 'organic' : 'anuncio',
          originText: options.userText,
          productId: options.productId,
          scriptText: options.scriptText,
          scriptTitle: options.scriptTitle,
          source: clarifySource,
          partial: { style: prefs.style, aspectRatio: prefs.aspectRatio },
          preferences: prefs,
          prompt: options.prompt,
          userText: options.userText,
          availableReferenceCount: 0,
          referencesRequired: false,
          askStyleRef: true,
        })
        setNotice(language === 'es'
          ? '¿Tenés un post de referencia? Subilo para copiar el tipo de diseño. El producto y el texto salen de tu marca y guion.'
          : 'Have a post for style? Upload it so we copy the layout. Product and copy still come from your brand and script.')
        return
      }
      if (referencesRequired && availableProductImageIds.length > 0 && !options.referenceMode && !options.referenceImageIds) {
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
          availableReferenceCount: availableProductImageIds.length,
          referencesRequired,
          referenceImages,
        })
        setNotice(language === 'es'
          ? `Encontré ${availableProductImageIds.length} referencia${availableProductImageIds.length === 1 ? '' : 's'}. Confirma si querés usarlas.`
          : `I found ${availableProductImageIds.length} reference${availableProductImageIds.length === 1 ? '' : 's'}. Confirm whether to use them.`)
        return
      }
      const productImageIds = options.referenceMode === 'none'
        ? []
        : (options.referenceImageIds?.length
          ? [...new Set([...options.referenceImageIds, ...productPhotoIds])]
          : productPhotoIds)
      if (referencesRequired && productImageIds.length === 0) {
        // S3: calm sticky ask once — keep Script→post pending instead of hard-fail.
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
          availableReferenceCount: 0,
          referencesRequired: true,
        })
        setNotice(
          language === 'es'
            ? 'Sube una Ref en Imágenes (o elige Anuncio).'
            : 'Upload a Ref in Images (or switch to Ad).'
        )
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
      let prompt = options.prompt
      let scriptText = options.scriptText
      if (scriptText && !looksLikeCondensedPostCopy(scriptText)) {
        try {
          scriptText = stripUnresolvedPlaceholders(await streamlineScriptForPost({
            script: scriptText,
            language,
            textDensity: prefs.density || 'hard',
            postStyle: prefs.style.kind === 'preset' ? prefs.style.presetId : 'venta-directa',
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
        brandLogoUrl: brandVisual.brandLogoUrl,
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
    } catch (err) {
      console.error(err)
      if (isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        setError(err instanceof Error ? err.message : 'Image generate failed')
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
  ])

  runImageGenerateRef.current = runImageGenerate

  const beginImageFlow = useCallback(async (options: {
    productId?: string | null
    prompt?: string
    userText?: string
    scriptText?: string
    scriptTitle?: string | null
    source: 'composer' | 'rail' | 'script_card'
    explicit?: Partial<ShellImagePreferences>
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
      })
      setNotice(language === 'es'
        ? 'Elegí el guion exacto que querés convertir en post.'
        : 'Choose the exact script you want to turn into a post.')
      return
    }

    const sticky = readImagePreferences(storage, session.id)
    const stickyMerged = resolveImagePreferences(sticky, imagePrefs)
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
    const aspectUnset = !sanitizePartialPreferences(options.explicit).aspectRatio
    const densityUnset =
      options.source !== 'script_card'
      && (Boolean(options.scriptText) || resolved.style?.kind === 'preset' || resolved.style?.kind === 'organic')
      && !sanitizePartialPreferences(options.explicit).density
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
      })
      setNotice(
        preferOrganic
          ? (language === 'es' ? 'Elige subtipo orgánico:' : 'Pick an organic subtype:')
          : (language === 'es'
            ? '¿Anuncio, producto u orgánico?'
            : 'Ad, product, or organic?')
      )
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
      })
      setNotice(language === 'es'
        ? '¿Qué tamaño? Reel, post cuadrado o vertical.'
        : 'What size? Reel, square, or vertical post.')
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
      })
      setNotice(language === 'es'
        ? '¿Cuánto texto en el post? Poco texto mantiene gancho, 1 prueba y CTA.'
        : 'How much copy on the post? Short keeps hook, one proof, and a CTA.')
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
      useReferences?: boolean
      toggleReferenceId?: string
      /** From refs sticky: switch Producto → Anuncio without requiring a Ref. */
      switchToAnuncio?: boolean
    }
  ) => {
    if (!imageClarify || !session || imageClarify.sessionId !== session.id) return

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
      })
      setNotice(preferOrganic
        ? (language === 'es' ? `Guion seleccionado: ${choice.title}. Elegí el estilo orgánico.` : `Selected script: ${choice.title}. Pick the organic style.`)
        : (language === 'es' ? `Guion seleccionado: ${choice.title}. Ahora elegí el tipo de post.` : `Selected script: ${choice.title}. Now choose the post type.`))
      return
    }

    if (imageClarify.step === 'refs') {
      if (answer.toggleReferenceId) {
        setImageClarify({
          ...imageClarify,
          referenceImages: (imageClarify.referenceImages || []).map((reference) => (
            reference.id === answer.toggleReferenceId
              ? { ...reference, selected: reference.selected === false }
              : reference
          )),
        })
        return
      }
      if (typeof answer.useReferences === 'boolean' && imageClarify.preferences) {
        if (!answer.useReferences && imageClarify.referencesRequired) return
        const selectedReferenceIds = (imageClarify.referenceImages || [])
          .filter((reference) => reference.selected !== false)
          .map((reference) => reference.id)
        if (answer.useReferences && imageClarify.referencesRequired && selectedReferenceIds.length === 0) return
        await runImageGenerate({
          productId: imageClarify.productId,
          preferences: imageClarify.preferences,
          prompt: imageClarify.prompt || imageClarify.scriptText || imageClarify.originText || session.context || 'Ad image',
          userText: imageClarify.userText || imageClarify.originText,
          scriptText: imageClarify.scriptText,
          scriptTitle: imageClarify.scriptTitle,
          source: imageClarify.source,
          referenceMode: answer.useReferences ? 'use' : 'none',
          referenceImageIds: answer.useReferences ? selectedReferenceIds : [],
        })
        return
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
          referenceMode: 'none',
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
        })
        setNotice(language === 'es'
          ? '¿Cuánto texto en el post? Poco texto mantiene gancho, 1 prueba y CTA.'
          : 'How much copy on the post? Short keeps hook, one proof, and a CTA.')
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
      })
      return
    }

    if (imageClarify.step === 'mode' && answer.mode) {
      setImageClarify({
        ...imageClarify,
        step: 'style',
        mode: answer.mode,
      })
      setNotice(
        answer.mode === 'product'
          ? (language === 'es' ? 'Elige estilo de producto:' : 'Pick a product style:')
          : answer.mode === 'organic'
            ? (language === 'es' ? 'Elige subtipo orgánico:' : 'Pick an organic subtype:')
            : (language === 'es' ? 'Elige estilo de anuncio:' : 'Pick an ad style:')
      )
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
        })
        setNotice(language === 'es'
          ? '¿Qué tamaño? Reel, post cuadrado o vertical.'
          : 'What size? Reel, square, or vertical post.')
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
        })
        setNotice(language === 'es'
          ? '¿Cuánto texto en el post? Poco texto mantiene gancho, 1 prueba y CTA.'
          : 'How much copy on the post? Short keeps hook, one proof, and a CTA.')
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
      })
    }
  }, [imageClarify, session, language, storage, imagePrefs, runImageGenerate])

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
    if (explicit.style) {
      patchImagePreferences(explicit)
    }
    await beginImageFlow({
      productId: activeImageOfferId || offerProductId,
      prompt: prompt || session?.context || 'Ad image',
      userText: prompt || (language === 'es' ? 'Generar post' : 'Generate post'),
      source: 'rail',
      explicit,
    })
  }, [beginImageFlow, activeImageOfferId, offerProductId, session, language, patchImagePreferences])

  const generateOfferImage = useCallback(async () => {
    await beginImageFlow({
      productId: activeImageOfferId,
      prompt: session?.context || 'Product hero image for ad',
      userText: language === 'es' ? 'Generar post' : 'Generate post',
      source: 'rail',
      explicit: imagePrefs.style ? { style: imagePrefs.style } : undefined,
    })
  }, [beginImageFlow, activeImageOfferId, session, imagePrefs.style, language])

  const prepareScriptForPost = useCallback(async (
    scriptText: string,
    density: 'hard' | 'medium' = 'hard'
  ): Promise<string> => {
    const product = activeProduct
    try {
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
      }).then(stripUnresolvedPlaceholders)
    } catch (err) {
      console.error(err)
      throw new Error(language === 'es'
        ? 'No pude optimizar el guión para el post. Reintentá.'
        : 'Could not optimize the script for the post. Try again.')
    }
  }, [language, activeProduct])

  const generateImageFromScript = useCallback(async (
    scriptText: string,
    productId?: string | null,
    scriptTitle?: string | null,
    options?: { density?: 'hard' | 'medium' }
  ) => {
    await beginImageFlow({
      productId: productId || activeImageOfferId || offerProductId,
      prompt: scriptText,
      userText: language === 'es' ? 'Crear post desde guión' : 'Create post from script',
      scriptText,
      scriptTitle,
      source: 'script_card',
      explicit: options?.density ? { density: options.density } : { density: 'hard' },
    })
  }, [beginImageFlow, activeImageOfferId, offerProductId, language])

  const editOfferImage = useCallback(async (
    productImageId: string,
    imageUrl: string,
    instruction: string,
    productId?: string,
    actionType: 'edit' | 'enhance' = 'edit'
  ) => {
    if (!session || imageBusy) return
    const pid = productId || activeImageOfferId
    if (!pid) return
    const originSessionId = session.id
    const originGen = sessionGenRef.current
    setImageBusy(true)
    setError(null)
    try {
      const result = await editShellOfferImage({
        userId,
        sessionId: originSessionId,
        productId: pid,
        productImageId,
        imageUrl,
        editPrompt: instruction,
        actionType,
        userText: `${actionType === 'enhance' ? 'Enhance' : 'Edit'} image: ${instruction}`,
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
      setMessages((prev) => [...prev, result.userMessage, result.assistantMessage])
      await refreshOfferImages(originSessionId, pid, loadRequestRef.current)
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
  }, [session, imageBusy, activeImageOfferId, userId, refreshOfferImages, brandKits, storage])

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
      setMessages((prev) => [...prev, result.userMessage, result.assistantMessage])
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
  }, [session, imageBusy, activeImageOfferId, userId, refreshOfferImages, brandKits, storage])

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
    cancelImageClarify: () => {
      setImageClarify(null)
      setNotice(null)
    },
    scriptClarify,
    answerScriptClarify,
    cancelScriptClarify: () => {
      setScriptClarify(null)
      setNotice(null)
    },
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
