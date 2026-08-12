import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addMessage,
  createScriptVersion,
  getBusinessProducts,
  getMessages,
  getProduct,
  getSessionOffers,
  saveScript,
  setSessionPrimaryOffer,
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
import type { Business, ChatSession, ChatSessionOffer, Message, Product } from '../../types'
import {
  addInFlightSession,
  isLiveThread,
  isSessionSending,
  removeInFlightSession,
} from './chatShellAsync'
import { resolveSessionOfferProductId } from './sessionOffer'

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

  const loadRequestRef = useRef(0)
  const offerRequestRef = useRef(0)
  /** Bumped on every session change including null. */
  const sessionGenRef = useRef(0)
  const activeThreadSessionIdRef = useRef<string | null>(null)

  // Keep live session id readable synchronously during event handlers / awaits.
  activeThreadSessionIdRef.current = sessionId

  const sending = isSessionSending(inFlightSessions, sessionId)

  const offerProductId = useMemo(
    () => resolveSessionOfferProductId(session, offers),
    [session, offers]
  )

  const canGenerate = Boolean(sessionId && offerProductId && activeProduct && !sending)

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
    // Invalidate every in-flight load/send commit target, including null clears.
    sessionGenRef.current += 1
    const requestId = ++loadRequestRef.current

    if (!sessionId) {
      setMessages([])
      setOffers([])
      setActiveProduct(null)
      setError(null)
      setNotice(null)
      setComposer('')
      setLoadingMessages(false)
      return
    }

    // Clear stale transcript immediately so highlight and thread stay in lockstep.
    setMessages([])
    setOffers([])
    setActiveProduct(null)
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
  // Only remount thread data when the selected session id changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, refreshOffersAndProduct])

  const setPrimaryOffer = useCallback(async (productId: string) => {
    if (!session || !session.business_id) {
      setNotice('Session needs a brand (business_id) before attaching an offer.')
      return
    }
    const originSessionId = session.id
    const originGen = sessionGenRef.current
    const requestId = ++offerRequestRef.current
    setError(null)
    setNotice(null)
    try {
      const offer = await setSessionPrimaryOffer(
        originSessionId,
        session.business_id,
        productId,
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
      const product = offer.product || (await getProduct(productId))
      if (requestId !== offerRequestRef.current) return
      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }
      setOffers([offer])
      setActiveProduct(product)
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
      setError(err instanceof Error ? err.message : 'Failed to set offer')
    }
  }, [session, userId])

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

  const send = useCallback(async () => {
    const text = composer.trim()
    if (!text || !session) return
    if (inFlightSessions.has(session.id)) return

    if (!offerProductId || !activeProduct) {
      setNotice('Choose an offer (product) in the Context rail before generating scripts.')
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
    setComposer('')
    setMessages((prev) => [...prev, optimisticUser])

    try {
      const historyForApi = [...messages, optimisticUser]
      const businessDetails = buildLegacyProductContext(activeProduct, session.context)
      const bizCtx = brand ? buildApiBusinessContext(brand) : buildApiBusinessContext(activeProduct.business)
      const prodCtx = buildApiProductContext(activeProduct)
      const channel = session.primary_channel || undefined

      const ai = await sendMessageToGrok(
        historyForApi,
        businessDetails,
        'es',
        SHELL_SCRIPT_SETTINGS,
        activeProduct.type,
        undefined,
        'script',
        bizCtx,
        prodCtx,
        undefined,
        channel || undefined,
        offerProductId,
        true,
        undefined,
        undefined,
        originSessionId
      )

      // Persist only after generation succeeds — avoids orphan user rows on failure.
      const savedUser = await addMessage(originSessionId, 'user', text)
      const savedAi = await addMessage(originSessionId, 'assistant', ai.content, ai._debug?.systemPrompt)

      if (!isLiveThread(
        activeThreadSessionIdRef.current,
        sessionGenRef.current,
        originSessionId,
        originGen
      )) {
        return
      }
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticId),
        savedUser,
        savedAi,
      ])
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : 'Failed to send'
      // Roll back optimistic user bubble; restore composer for retry — only on live origin.
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
      setError(msg)
    } finally {
      setInFlightSessions((prev) => removeInFlightSession(prev, originSessionId))
    }
  }, [
    composer,
    session,
    offerProductId,
    activeProduct,
    messages,
    brand,
    inFlightSessions,
  ])

  const handleSaveScript = useCallback(async (
    content: string,
    title: string,
    opts?: { edit_source?: string; message_id?: string; script_index?: number }
  ): Promise<string | null> => {
    if (!session || !offerProductId || savingScript) return null
    const originSessionId = session.id
    const originGen = sessionGenRef.current
    setSavingScript(true)
    try {
      const script = await saveScript(session.id, offerProductId, title, content, undefined, opts)
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
    editLabel?: string
  ): Promise<string | null> => {
    if (!session || !offerProductId) return null
    try {
      const version = await createScriptVersion(
        parentId,
        session.id,
        offerProductId,
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
    editType?: 'script_edit' | 'script_enhance' | 'script_hook' | 'script_consciousness'
  ): Promise<string> => {
    if (!session || !offerProductId || !activeProduct) {
      throw new Error('Choose an offer before editing scripts.')
    }
    const bizCtx = brand
      ? (buildApiBusinessContext(brand) as Record<string, unknown> | undefined)
      : (buildApiBusinessContext(activeProduct.business) as Record<string, unknown> | undefined)
    const prodCtx = buildApiProductContext(activeProduct) as Record<string, unknown>
    return editScript(
      originalContent,
      instruction,
      'es',
      bizCtx,
      prodCtx,
      editType,
      session.id,
      offerProductId
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
    send,
    setPrimaryOffer,
    patchSession,
    handleSaveScript,
    handleSaveVersion,
    handleEditScript,
  }
}
