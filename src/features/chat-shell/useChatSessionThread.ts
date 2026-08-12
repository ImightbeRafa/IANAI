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
} from '../../services/database'
import {
  buildApiBusinessContext,
  buildApiProductContext,
  DEFAULT_SCRIPT_SETTINGS,
  editScript,
  sendMessageToGrok,
} from '../../services/grokApi'
import type {
  Business,
  ChatSession,
  ChatSessionOffer,
  Message,
  MessageArtifact,
  Product,
} from '../../types'
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

const SHELL_SCRIPT_SETTINGS = {
  ...DEFAULT_SCRIPT_SETTINGS,
  variations: 1,
  generationMode: 'mixed' as const,
  scriptTypeConfig: {
    ...DEFAULT_SCRIPT_SETTINGS.scriptTypeConfig,
    venta_directa: 1,
    desvalidar_alternativas: 0,
    mostrar_servicio: 0,
  },
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
}

export function useChatSessionThread(options: {
  userId: string
  brand: Business | null
  session: ChatSession | null
  onSessionPatched?: (session: ChatSession) => void
}) {
  const { userId, brand, session, onSessionPatched } = options
  const sessionId = session?.id ?? null

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

  const canGenerate = Boolean(
    sessionId
    && !sending
    && (offers.length > 0 || Boolean(session?.product_id))
  )

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
      setLoadingMessages(false)
      return
    }

    setMessages([])
    setOffers([])
    setActiveProduct(null)
    setFailedBatch(null)
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
    historyForApi: Message[]
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

        const ai = await sendMessageToGrok(
          historyForApi,
          businessDetails,
          'es',
          SHELL_SCRIPT_SETTINGS,
          product.type,
          undefined,
          'script',
          bizCtx,
          prodCtx,
          undefined,
          channel || undefined,
          step.productId,
          true,
          undefined,
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
  }, [offers, brandProducts, brand, session])

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

    const artifacts: MessageArtifact[] = []
    for (const success of successes) {
      const title = success.step.name || success.product.name || `Script ${success.step.ordinal}`
      const script = await saveScript(
        originSessionId,
        success.step.productId,
        title,
        success.content,
        undefined,
        {
          edit_source: 'generate',
          message_id: savedAi.id,
          script_index: success.step.ordinal,
        }
      )
      const artifact = await insertScriptMessageArtifact({
        sessionId: originSessionId,
        messageId: savedAi.id,
        productId: success.step.productId,
        scriptId: script.id,
        ordinal: success.step.ordinal,
        userId,
        metadata: {
          offer_name: title,
          position: success.step.position,
        },
      })
      artifacts.push(artifact)
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
    setComposer('')
    setMessages((prev) => [...prev, optimisticUser])

    try {
      const historyForApi = [...messages, optimisticUser]
      const { aborted, results } = await runOfferWalk(
        text,
        walk,
        originSessionId,
        originGen,
        historyForApi
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
      const { aborted, results } = await runOfferWalk(
        retryText,
        walk,
        originSessionId,
        originGen,
        historyForApi
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
      'es',
      bizCtx,
      prodCtx,
      editType,
      session.id,
      productId
    )
  }, [session, offerProductId, activeProduct, brand])

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
  }
}
