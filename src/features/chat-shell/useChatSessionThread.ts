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
  const [sending, setSending] = useState(false)
  const [savingScript, setSavingScript] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [composer, setComposer] = useState('')

  const loadRequestRef = useRef(0)
  const sendLockRef = useRef(false)

  const offerProductId = useMemo(
    () => resolveSessionOfferProductId(session, offers),
    [session, offers]
  )

  const canGenerate = Boolean(sessionId && offerProductId && activeProduct && !sending)

  const refreshOffersAndProduct = useCallback(async (sid: string, sessionRow: ChatSession | null) => {
    const list = await getSessionOffers(sid)
    setOffers(list)
    const pid = resolveSessionOfferProductId(sessionRow, list)
    if (!pid) {
      setActiveProduct(null)
      return list
    }
    const product = list.find((o) => o.product_id === pid)?.product || (await getProduct(pid))
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
    if (!sessionId) {
      setMessages([])
      setOffers([])
      setActiveProduct(null)
      setError(null)
      setNotice(null)
      setComposer('')
      return
    }

    const requestId = ++loadRequestRef.current
    setLoadingMessages(true)
    setError(null)
    setNotice(null)

    void (async () => {
      try {
        const [msgs] = await Promise.all([
          getMessages(sessionId),
          refreshOffersAndProduct(sessionId, session),
        ])
        if (requestId !== loadRequestRef.current) return
        setMessages(msgs)
      } catch (err) {
        if (requestId !== loadRequestRef.current) return
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load messages')
        setMessages([])
      } finally {
        if (requestId === loadRequestRef.current) setLoadingMessages(false)
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
    setError(null)
    setNotice(null)
    try {
      const offer = await setSessionPrimaryOffer(session.id, session.business_id, productId, userId)
      setOffers([offer])
      const product = offer.product || (await getProduct(productId))
      setActiveProduct(product)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to set offer')
    }
  }, [session, userId])

  const patchSession = useCallback(async (updates: ChatSessionSafeUpdates) => {
    if (!session) return
    try {
      const next = await updateChatSession(session.id, updates)
      onSessionPatched?.(next)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to update session')
    }
  }, [session, onSessionPatched])

  const send = useCallback(async () => {
    const text = composer.trim()
    if (!text || !session || sendLockRef.current) return

    if (!offerProductId || !activeProduct) {
      setNotice('Choose an offer (product) in the Context rail before generating scripts.')
      return
    }

    const originSessionId = session.id
    sendLockRef.current = true
    setSending(true)
    setError(null)
    setNotice(null)
    setComposer('')

    try {
      const savedUser = await addMessage(originSessionId, 'user', text)
      if (loadRequestRef.current && originSessionId === sessionId) {
        setMessages((prev) => [...prev, savedUser])
      }

      const historyForApi = [...messages, savedUser]
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

      // Stale session guard: still persist to origin, but only append UI if still selected
      const savedAi = await addMessage(originSessionId, 'assistant', ai.content, ai._debug?.systemPrompt)
      if (originSessionId === sessionId) {
        setMessages((prev) => [...prev, savedAi])
      }
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : 'Failed to send'
      setError(msg)
      // Transient error bubble — not persisted
      if (originSessionId === sessionId) {
        setMessages((prev) => [
          ...prev,
          {
            id: `local-error-${Date.now()}`,
            session_id: originSessionId,
            role: 'assistant',
            content: `Error: ${msg}`,
            created_at: new Date().toISOString(),
          },
        ])
      }
    } finally {
      sendLockRef.current = false
      setSending(false)
    }
  }, [
    composer,
    session,
    offerProductId,
    activeProduct,
    messages,
    brand,
    sessionId,
  ])

  const handleSaveScript = useCallback(async (
    content: string,
    title: string,
    opts?: { edit_source?: string; message_id?: string; script_index?: number }
  ): Promise<string | null> => {
    if (!session || !offerProductId || savingScript) return null
    setSavingScript(true)
    try {
      const script = await saveScript(session.id, offerProductId, title, content, undefined, opts)
      return script.id
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to save script')
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
