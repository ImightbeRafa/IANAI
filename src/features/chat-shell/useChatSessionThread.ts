import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addMessage,
  createScriptVersion,
  getBusinessProducts,
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
import {
  buildApiBusinessContext,
  buildApiProductContext,
  DEFAULT_SCRIPT_SETTINGS,
  editScript,
  sendMessageToGrok,
} from '../../services/grokApi'
import type {
  BrandKit,
  Business,
  ChatSession,
  ChatSessionOffer,
  Message,
  MessageArtifact,
  Product,
  ScriptGenerationSettings,
} from '../../types'
import {
  resolveBrandKitIdForProduct,
} from './chatShellGenerationPreferences'
import {
  parseChatShellScriptIntent,
  type ChatShellLanguage,
} from './chatShellScriptIntent'
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
  canAddSessionOffer,
  CHAT_SHELL_MAX_OFFERS,
  resolveSessionOfferProductId,
  sortOffersByPosition,
} from './sessionOffer'
import {
  filterImagesForOffer,
  latestImageByProductId,
  resolveActiveImageOfferId,
  selectProductReferenceImageIds,
} from './chatShellImages'
import {
  formatImageAssumptions,
  looksLikeSalesScript,
  parseChatShellImageIntent,
  planImageClarifications,
  readImagePreferences,
  requiresProductReferences,
  resolveImagePreferences,
  resolveScriptPostPreferences,
  writeImagePreferences,
  type ImageClarifyStep,
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
  mode?: 'anuncio' | 'product'
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

export function useChatSessionThread(options: {
  userId: string
  brand: Business | null
  session: ChatSession | null
  onSessionPatched?: (session: ChatSession) => void
  language?: ChatShellLanguage
  aiMemoryEnabled?: boolean
  brandKits?: BrandKit[]
}) {
  const {
    userId,
    brand,
    session,
    onSessionPatched,
    language = 'es',
    aiMemoryEnabled = true,
    brandKits = [],
  } = options
  const sessionId = session?.id ?? null
  const storage = typeof localStorage !== 'undefined' ? localStorage : null

  const [messages, setMessages] = useState<Message[]>([])
  const [offers, setOffers] = useState<ChatSessionOffer[]>([])
  const [brandProducts, setBrandProducts] = useState<Product[]>([])
  const [activeProduct, setActiveProduct] = useState<Product | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [inFlightSessions, setInFlightSessions] = useState<Set<string>>(() => new Set())
  const [savingScript, setSavingScript] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [composer, setComposer] = useState('')
  const [failedBatch, setFailedBatch] = useState<FailedOfferBatch | null>(null)
  const [offerImages, setOfferImages] = useState<ProductImage[]>([])
  const [imageOfferId, setImageOfferId] = useState<string | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const imageBusyRef = useRef(false)
  const [imagePrefs, setImagePrefs] = useState<ShellImagePreferences>(() =>
    resolveImagePreferences({}, {})
  )
  const [imageClarify, setImageClarify] = useState<ImageClarifyState | null>(null)

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
  }) => Promise<void>>(async () => {})

  const loadRequestRef = useRef(0)
  const offerRequestRef = useRef(0)
  /** Bumped on every session change including null. */
  const sessionGenRef = useRef(0)
  const activeThreadSessionIdRef = useRef<string | null>(null)

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
    const list = await getSessionOffers(sid)
    if (requestId !== loadRequestRef.current) return list
    if (activeThreadSessionIdRef.current !== sid) return list
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
  }, [])

  useEffect(() => {
    if (!brand?.id) {
      setBrandProducts([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const products = await getBusinessProducts(brand.id)
        if (!cancelled) setBrandProducts(products)
      } catch (err) {
        console.error(err)
        if (!cancelled) setBrandProducts([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [brand?.id])

  useEffect(() => {
    sessionGenRef.current += 1
    const requestId = ++loadRequestRef.current

    if (!sessionId) {
      setMessages([])
      setOffers([])
      setActiveProduct(null)
      setError(null)
      setNotice(null)
      setComposer('')
      setFailedBatch(null)
      setOfferImages([])
      setImageOfferId(null)
      setImageClarify(null)
      setImagePrefs(resolveImagePreferences({}, {}))
      setLoadingMessages(false)
      return
    }

    setMessages([])
    setOffers([])
    setActiveProduct(null)
    setFailedBatch(null)
    setOfferImages([])
    setImageOfferId(null)
    setImageClarify(null)
    setImagePrefs(resolveImagePreferences({}, readImagePreferences(storage, sessionId)))
    setLoadingMessages(true)
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
        setMessages(msgs)
      } catch (err) {
        if (requestId !== loadRequestRef.current) return
        if (activeThreadSessionIdRef.current !== sessionId) return
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load messages')
        setMessages([])
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

  const persistOffers = useCallback(async (productIds: string[]) => {
    if (!session?.business_id) {
      setNotice('Session needs a brand (business_id) before attaching an offer.')
      return
    }
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
      if (requestId !== offerRequestRef.current) return
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
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

  const runOfferWalk = useCallback(async (
    _userText: string,
    steps: PlannedOfferStep[],
    originSessionId: string,
    originGen: number,
    historyForApi: Message[],
    scriptSettings: ScriptGenerationSettings
  ) => {
    type OfferResult =
      | { ok: true; step: PlannedOfferStep; content: string; product: Product }
      | { ok: false; step: PlannedOfferStep; error: string }

    const results: OfferResult[] = []

    for (const step of steps) {
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return { aborted: true as const, results }
      }

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
        const channel = session?.primary_channel || undefined
        const brandKitId = resolveBrandKitIdForProduct(step.productId, brandKits, storage)

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

        results.push({ ok: true, step, content: ai.content, product })
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
  }, [offers, brandProducts, brand, session, language, aiMemoryEnabled, brandKits, storage])

  const persistSuccessfulBatch = useCallback(async (options: {
    originSessionId: string
    originGen: number
    userText: string
    successes: Array<{ step: PlannedOfferStep; content: string; product: Product }>
  }) => {
    const { originSessionId, originGen, userText, successes } = options
    if (successes.length === 0) return null

    const assistantParts = successes.map((s) => {
      const label = s.step.name || s.product.name || s.step.productId
      return `### ${s.step.ordinal}. ${label}\n\n${s.content}`
    })
    const assistantContent = assistantParts.join('\n\n---\n\n')

    const savedUser = await addMessage(originSessionId, 'user', userText)
    const savedAi = await addMessage(originSessionId, 'assistant', assistantContent)

    if (!isLiveThread(
      activeThreadSessionIdRef.current,
      sessionGenRef.current,
      originSessionId,
      originGen
    )) {
      return null
    }

    const offerScriptBundles = successes.map((success) => {
      const offerName = success.step.name || success.product.name || `Script ${success.step.ordinal}`
      return {
        success,
        offerName,
        scripts: splitOfferScriptContent(success.content, offerName),
      }
    })
    const ranked = assignGlobalScriptOrdinals(offerScriptBundles)

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

    if (!isLiveThread(
      activeThreadSessionIdRef.current,
      sessionGenRef.current,
      originSessionId,
      originGen
    )) {
      return null
    }

    const assistantWithArtifacts: Message = { ...savedAi, artifacts }
    return { savedUser, savedAi: assistantWithArtifacts }
  }, [userId])

  const send = useCallback(async () => {
    const text = composer.trim()
    if (!text || !session) return
    if (inFlightSessions.has(session.id)) return

    const imageIntent = parseChatShellImageIntent(text, language)
    if (imageIntent.matched && imageIntent.wantsImage) {
      setComposer('')
      setError(null)
      setFailedBatch(null)
      // Deferred: beginImageFlow is declared below; call via ref assigned after definition.
      await beginImageFlowRef.current({
        productId: activeImageOfferId || offerProductId,
        prompt: text,
        userText: text,
        source: 'composer',
        explicit: imageIntent.preferences,
      })
      return
    }

    let liveOffers = offers
    let walk = planOfferGenerationWalk(liveOffers)

    // Legacy: empty offers + session.product_id — materialize as position-1 offer when possible
    // so message_artifacts FK to chat_session_offers can succeed.
    if (walk.length === 0 && session.product_id) {
      if (!session.business_id) {
        setNotice('Session needs a brand (business_id) before generating.')
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
      setNotice('Choose at least one offer in the Context rail before generating scripts.')
      return
    }

    const emptyContext = !(session.context || '').trim()

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
    setNotice(
      emptyContext
        ? 'Generating without session context — results may be generic. Add context in Setup anytime.'
        : null
    )
    setFailedBatch(null)
    setComposer('')
    setMessages((prev) => [...prev, optimisticUser])

    const intent = parseChatShellScriptIntent(text, language, DEFAULT_SCRIPT_SETTINGS)
    const scriptSettings = intent.settings

    try {
      const historyForApi = [...messages, optimisticUser]
      const { aborted, results } = await runOfferWalk(
        text,
        walk,
        originSessionId,
        originGen,
        historyForApi,
        scriptSettings
      )

      if (aborted) return

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
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
        setComposer(text)
        setError(failures[0]?.error || 'Failed to generate scripts')
        return
      }

      const persisted = await persistSuccessfulBatch({
        originSessionId,
        originGen,
        userText: text,
        successes: successes.map((s) => ({
          step: s.step,
          content: s.content,
          product: s.product,
        })),
      })

      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }

      if (!persisted) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
        return
      }

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticId),
        persisted.savedUser,
        persisted.savedAi,
      ])

      if (failures.length > 0) {
        setFailedBatch({
          productIds: failures.map((f) => f.step.productId),
          names: failures.map((f) => f.step.name || f.step.productId),
          userText: text,
          scriptSettings,
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
      setComposer(text)
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setInFlightSessions((prev) => removeInFlightSession(prev, originSessionId))
    }
  }, [
    composer,
    session,
    offers,
    messages,
    inFlightSessions,
    userId,
    language,
    activeImageOfferId,
    offerProductId,
    runOfferWalk,
    persistSuccessfulBatch,
  ])

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
      const historyForApi = [...messages, optimisticUser]
      const scriptSettings = failedBatch.scriptSettings
      const { aborted, results } = await runOfferWalk(
        retryText,
        walk,
        originSessionId,
        originGen,
        historyForApi,
        scriptSettings
      )
      if (aborted) return

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
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
        setError(failures[0]?.error || 'Retry failed')
        return
      }

      const persisted = await persistSuccessfulBatch({
        originSessionId,
        originGen,
        userText: retryText,
        successes: successes.map((s) => ({
          step: s.step,
          content: s.content,
          product: s.product,
        })),
      })

      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }

      if (!persisted) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
        return
      }

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticId),
        persisted.savedUser,
        persisted.savedAi,
      ])

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
      setInFlightSessions((prev) => removeInFlightSession(prev, originSessionId))
    }
  }, [
    session,
    failedBatch,
    sending,
    offers,
    messages,
    runOfferWalk,
    persistSuccessfulBatch,
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
    productIdOverride?: string | null
  ) => {
    const targetProductId = productIdOverride || activeImageOfferId
    if (!session || !targetProductId || imageBusyRef.current) return
    const pendingRefs =
      imageClarify
      && imageClarify.sessionId === session.id
      && imageClarify.step === 'refs'
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
      await uploadShellOfferImage({
        userId,
        sessionId: originSessionId,
        productId: targetProductId,
        dataUrl,
        filename: file.name,
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
    if (
      pendingRefs?.preferences
      && isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )
    ) {
      await runImageGenerateRef.current({
        productId: targetProductId,
        preferences: pendingRefs.preferences,
        prompt: pendingRefs.prompt || pendingRefs.scriptText || pendingRefs.originText || 'Ad image',
        userText: pendingRefs.userText || pendingRefs.originText,
        scriptText: pendingRefs.scriptText,
        scriptTitle: pendingRefs.scriptTitle,
        source: pendingRefs.source,
      })
    }
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

    imageBusyRef.current = true
    setImageBusy(true)
    setError(null)
    setNotice(formatImageAssumptions(prefs, language))
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
      const productImageIds = selectProductReferenceImageIds(images)
      if (requiresProductReferences(prefs.style) && productImageIds.length === 0) {
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
        })
        setNotice(
          language === 'es'
            ? 'Sube una Ref en Imágenes (o elige Anuncio).'
            : 'Upload a Ref in Images (or switch to Ad).'
        )
        return
      }

      const brandKitId = resolveBrandKitIdForProduct(options.productId, brandKits, storage)
      const result = await generateShellOfferImage({
        userId,
        sessionId: originSessionId,
        productId: options.productId,
        prompt: options.prompt,
        preferences: prefs,
        productImageIds,
        brandKitId,
        language,
        scriptText: options.scriptText,
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
      imageBusyRef.current = false
      setImageBusy(false)
    }
  }, [
    session,
    language,
    brandKits,
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

    const sticky = readImagePreferences(storage, session.id)
    const stickyMerged = resolveImagePreferences(sticky, imagePrefs)
    const resolved =
      options.source === 'script_card'
        ? resolveScriptPostPreferences({
            explicit: options.explicit,
            sticky: stickyMerged,
            scriptText: options.scriptText,
            scriptTitle: options.scriptTitle,
          })
        : resolveImagePreferences(
            { ...options.explicit },
            stickyMerged
          )
    const plan = planImageClarifications(resolved)
    if (plan.needed && plan.step === 'mode') {
      setImagePrefs(resolved)
      setImageClarify({
        sessionId: session.id,
        step: 'mode',
        originText: options.userText || options.prompt || 'Generate image',
        productId,
        scriptText: options.scriptText,
        scriptTitle: options.scriptTitle,
        source: options.source,
        partial: options.explicit || {},
      })
      setNotice(
        language === 'es'
          ? '¿Anuncio con texto o foto de producto?'
          : 'Ad with text, or product photo?'
      )
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
    })
  }, [
    session,
    activeImageOfferId,
    offerProductId,
    offers,
    language,
    storage,
    imagePrefs,
    runImageGenerate,
  ])

  beginImageFlowRef.current = beginImageFlow

  const answerImageClarify = useCallback(async (
    answer: {
      mode?: 'anuncio' | 'product'
      styleId?: string
      /** From refs sticky: switch Producto → Anuncio without requiring a Ref. */
      switchToAnuncio?: boolean
    }
  ) => {
    if (!imageClarify || !session || imageClarify.sessionId !== session.id) return

    if (imageClarify.step === 'refs') {
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
        })
      }
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
          : (language === 'es' ? 'Elige estilo de anuncio:' : 'Pick an ad style:')
      )
      return
    }

    if (imageClarify.step === 'style' && answer.styleId) {
      const style: ShellImageStyle =
        imageClarify.mode === 'product'
          ? { kind: 'product', productSubStyle: answer.styleId }
          : { kind: 'preset', presetId: answer.styleId }
      const resolved = resolveImagePreferences(
        { ...imageClarify.partial, style },
        resolveImagePreferences(readImagePreferences(storage, session.id), imagePrefs)
      )
      await runImageGenerate({
        productId: imageClarify.productId,
        preferences: resolved,
        prompt: imageClarify.scriptText || imageClarify.originText || session.context || 'Ad image',
        userText: imageClarify.originText,
        scriptText: imageClarify.scriptText,
        scriptTitle: imageClarify.scriptTitle,
        source: imageClarify.source,
      })
    }
  }, [imageClarify, session, language, storage, imagePrefs, runImageGenerate])

  const generateOfferImage = useCallback(async () => {
    await beginImageFlow({
      productId: activeImageOfferId,
      prompt: session?.context || 'Product hero image for ad',
      userText: 'Generate image for offer',
      source: 'rail',
      explicit: imagePrefs.style ? { style: imagePrefs.style } : undefined,
    })
  }, [beginImageFlow, activeImageOfferId, session, imagePrefs.style])

  const generateImageFromScript = useCallback(async (
    scriptText: string,
    productId?: string | null,
    scriptTitle?: string | null
  ) => {
    await beginImageFlow({
      productId: productId || activeImageOfferId || offerProductId,
      prompt: scriptText,
      userText: language === 'es' ? 'Crear post desde guión' : 'Create post from script',
      scriptText,
      scriptTitle,
      source: 'script_card',
    })
  }, [beginImageFlow, activeImageOfferId, offerProductId, language])

  const editOfferImage = useCallback(async (
    productImageId: string,
    imageUrl: string,
    instruction: string,
    productId?: string
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
        actionType: 'edit',
        userText: `Edit image: ${instruction}`,
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
  }, [session, imageBusy, activeImageOfferId, userId, refreshOfferImages])

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
  }, [session, imageBusy, activeImageOfferId, userId, refreshOfferImages])

  return {
    messages,
    offers,
    brandProducts,
    activeProduct,
    offerProductId,
    loadingMessages,
    sending,
    savingScript,
    error,
    notice,
    composer,
    setComposer,
    canGenerate,
    failedBatch,
    send,
    retryFailedOffers,
    setPrimaryOffer,
    addOffer,
    removeOffer,
    moveOffer,
    patchSession,
    handleSaveScript,
    handleSaveVersion,
    handleEditScript,
    activeImageOfferId,
    filteredOfferImages,
    latestImagesByOffer,
    imageBusy,
    selectImageOffer,
    uploadOfferImage,
    generateOfferImage,
    generateImageFromScript,
    editOfferImage,
    optimizeOfferImage,
    imagePrefs,
    patchImagePreferences,
    imageClarify,
    answerImageClarify,
    cancelImageClarify: () => setImageClarify(null),
  }
}
