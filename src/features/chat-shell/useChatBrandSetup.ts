import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BrandKit,
  BrandKitFormData,
  Business,
  ChatSession,
  Product,
  TargetAudienceFormData,
} from '../../types'
import {
  createBrandKit,
  createProduct,
  createProductImage,
  getProduct,
  isMissingRowError,
  updateBrandKit,
  updateBusiness,
  updateProduct,
} from '../../services/database'
import { invalidateDashboardCache } from '../../hooks/useDashboardData'
import {
  BRAND_SETUP_STEPS,
  buildBrandSetupSnapshot,
  formTypeForProductType,
  pickDefinedAutofill,
  productsOwnedByBusiness,
  readBrandSetupSkipped,
  resolveBusinessBrandKitId,
  shouldShowBrandSetup,
  shouldShowSetupTracker,
  stepComplete,
  withSetupSkippedContext,
  writeBrandSetupSkipped,
  type BrandSetupStepId,
} from './chatShellBrandSetup'
import {
  applyQuestionAnswer,
  askedFromFacts,
  buildFolderContext,
  createInitialFlow,
  emptySetupFacts,
  findBrandRuleToRemove,
  hasOfferHypothesis,
  isAffirmative,
  isBrandRuleRemoval,
  isPauseSetup,
  isSkipThis,
  markAsked,
  mergeAutofillIntoFacts,
  mergeSiteAnalysisIntoFacts,
  nextSetupQuestion,
  normalizeBrandRule,
  paletteDraftFromFacts,
  questionForSetupStep,
  questionPrompt,
  seedFactsFromPastedText,
  setupTurn,
  splitSourceAndNotes,
  type PaletteDraft,
  type SetupFacts,
  type SetupFlowState,
  type SetupQuestionId,
} from './chatShellBrandSetupFlow'
import { autoFillFromText, gatherSetupSource } from '../../utils/formAutoFill'
import {
  analyzeSetupSite,
  appendBrandReferenceImages,
  ingestSetupPdf,
  ingestSetupPlainFile,
  uploadSetupBrandAsset,
  type SiteFieldEvidence,
} from './chatShellSetupUploads'

const EMPTY_AUDIENCE: TargetAudienceFormData = {
  sex: 'both',
  age_min: 18,
  age_max: 65,
  geographic_scope: 'country',
  has_specific_profession: false,
}

function sanitizeSetupError(message: string, language: 'en' | 'es'): string | null {
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return language === 'es'
      ? 'No pudimos conectar con el servidor. Pegá el texto directamente o probá más tarde.'
      : 'We could not reach the server. Paste the text directly or try again later.'
  }
  if (/setup failed/i.test(message)) return null
  return message
}

function completeCopy(language: 'en' | 'es'): string {
  return language === 'es'
    ? 'Listo: ya voy a usar este contexto en cada creación. Podés empezar con un guion, convertirlo en post o crear fotos de producto.'
    : 'Ready: I’ll use this context in every creation. You can start with a script, turn it into a post, or create product photos.'
}

function reviewCopy(language: 'en' | 'es'): string {
  return language === 'es'
    ? 'Organicé lo que encontré. Revisá la tarjeta de marca: podés corregir cualquier sección ahí mismo.'
    : 'I organized what I found. Review the brand card—you can correct any section right there.'
}

function nextStepCopy(language: 'en' | 'es'): string {
  return language === 'es'
    ? '¿Qué hacemos primero? En la tarjeta podés crear guiones, un post o una foto de producto.'
    : 'What should we make first? Use the card to create scripts, a post, or a product photo.'
}

function factsFromExisting(
  business: Business | null,
  products: Product[],
  kit: BrandKit | null
): SetupFacts {
  const product = products.find((row) => row.name !== 'Quick Use Image Studio') || null
  const facts = emptySetupFacts(business?.name || kit?.name || '')
  facts.salesChannels = business?.sales_channels || []
  facts.location = business?.location || product?.location || product?.re_location || ''
  facts.doesShipping = Boolean(business?.does_shipping)
  facts.shippingMethod = business?.shipping_method || product?.shipping_info || ''
  facts.icp = business?.icp_description || product?.target_audience || product?.best_customers || kit?.target_audience || ''
  if (product) {
    facts.storageType = product.type
    facts.typeConfidence = 'high'
    facts.customLabel = product.product_category_custom || product.product_category || ''
    facts.offerName = product.name
    facts.product_description = product.product_description || product.description || ''
    facts.utility = product.utility || ''
    facts.result = product.result || ''
    facts.current_alternatives = product.current_alternatives || product.market_alternatives || ''
    facts.key_objection = product.key_objection || product.svc_main_objection || ''
    facts.main_problem = product.main_problem || product.svc_problem || ''
    facts.expected_result = product.expected_result || product.svc_concrete_result || ''
    facts.differentiation = product.differentiation || product.svc_differentiation || product.unique_value || ''
    facts.menu_text = product.menu_text || ''
    facts.schedule = product.schedule || ''
    facts.re_price = product.re_price || ''
    facts.re_location = product.re_location || ''
    facts.re_highlights = product.re_highlights || ''
    facts.re_cta = product.re_cta || product.call_to_action || ''
    facts.ind_article_type = product.ind_article_type || ''
    facts.ind_variations_description = product.ind_variations_description || ''
    facts.ind_main_material = product.ind_main_material || ''
    facts.sourceUrl = product.context_links?.[0] || ''
    facts.sourceText = product.context_links_content || ''
  }
  if (kit) {
    facts.brand_voice = kit.brand_voice || ''
    facts.tone_keywords = kit.tone_keywords || []
    facts.must_use_phrases = kit.must_use_phrases || []
    facts.forbidden_phrases = kit.forbidden_phrases || []
    facts.brand_visual = kit.visual_style_notes || ''
    facts.primary_color = kit.primary_color || ''
    facts.secondary_color = kit.secondary_color || ''
    facts.accent_color = kit.accent_color || ''
    facts.logo_url = kit.logo_url || ''
    facts.reference_images = kit.reference_images || []
    facts.tagline = kit.tagline || ''
    facts.font_primary = kit.font_primary || ''
  }
  return facts
}

function hydrateMissingFacts(current: SetupFacts, stored: SetupFacts, syncBrandKit = false): SetupFacts {
  const next = { ...current }
  const target = next as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(stored)) {
    const existing = target[key]
    if ((typeof existing === 'string' && !existing.trim()) || (Array.isArray(existing) && existing.length === 0)) {
      target[key] = value
    }
  }
  if (stored.typeConfidence === 'high' && current.typeConfidence === 'low') {
    next.storageType = stored.storageType
    next.customLabel = stored.customLabel
    next.typeConfidence = 'high'
  }
  if (!current.sourceUrl && !current.sourceText) {
    next.doesShipping = stored.doesShipping
  }
  if (syncBrandKit) {
    next.brand_voice = stored.brand_voice
    next.tone_keywords = stored.tone_keywords
    next.must_use_phrases = stored.must_use_phrases
    next.forbidden_phrases = stored.forbidden_phrases
    next.brand_visual = stored.brand_visual
    next.primary_color = stored.primary_color
    next.secondary_color = stored.secondary_color
    next.accent_color = stored.accent_color
    next.logo_url = stored.logo_url
    next.reference_images = stored.reference_images
    next.tagline = stored.tagline
    next.font_primary = stored.font_primary
  }
  next.offerConfirmed = current.offerConfirmed
  return next
}

export function useChatBrandSetup(options: {
  userId: string
  language: 'en' | 'es'
  business: Business | null
  session: ChatSession | null
  brandSessions: ChatSession[]
  products: Product[]
  brandKits: BrandKit[]
  loaded: boolean
  onBusinessPatched: (business: Business) => void
  onProductsChanged: () => void | Promise<void>
  onKitCreated: (kit: BrandKit) => void
  onLinkKit: (kitId: string) => void | Promise<void>
  onAttachOffer: (productId: string) => void | Promise<void>
  onPatchSession: (updates: { context?: string; primary_channel?: 'messages' | 'website' | 'physical' | null; title?: string }) => void | Promise<void>
  onPersistTurn: (role: 'user' | 'assistant', content: string) => void | Promise<void>
  messageCount?: number
  messagesLoading?: boolean
}) {
  const {
    userId,
    language,
    business,
    session,
    brandSessions,
    products,
    brandKits,
    loaded,
    onBusinessPatched,
    onProductsChanged,
    onKitCreated,
    onLinkKit,
    onAttachOffer,
    onPatchSession,
    onPersistTurn,
    messageCount = 0,
    messagesLoading = false,
  } = options

  const storage = typeof localStorage !== 'undefined' ? localStorage : null
  const [skipTick, setSkipTick] = useState(0)
  const [forceOpen, setForceOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [offerId, setOfferId] = useState<string | null>(null)
  const welcomedSessionsRef = useRef(new Set<string>())
  const lastSetupPromptRef = useRef<{ sessionId: string; prompt: string } | null>(null)
  const kitWriteRef = useRef(Promise.resolve())
  const linkedKitRef = useRef<BrandKit | null>(null)
  const activeSessionIdRef = useRef<string | null>(session?.id || null)
  const [paletteDraft, setPaletteDraft] = useState<PaletteDraft | null>(null)
  const [siteEvidence, setSiteEvidence] = useState<Record<string, SiteFieldEvidence>>({})
  const [sitePages, setSitePages] = useState<Array<{ url: string; title: string; ok: boolean }>>([])
  const [setupScope, setSetupScope] = useState({
    businessId: business?.id ?? null,
    sessionId: session?.id ?? null,
    language,
  })
  const [flow, setFlow] = useState<SetupFlowState>(() =>
    createInitialFlow(language, business?.name || '')
  )

  const linkedKitId = resolveBusinessBrandKitId(brandSessions)
  const linkedKit = brandKits.find((kit) => kit.id === (session?.brand_kit_id || linkedKitId)) || null
  linkedKitRef.current = linkedKit || linkedKitRef.current
  activeSessionIdRef.current = session?.id || null

  const brandOwnedProducts = useMemo(
    () => productsOwnedByBusiness(products, business?.id),
    [products, business?.id]
  )

  const nextScope = {
    businessId: business?.id ?? null,
    sessionId: session?.id ?? null,
    language,
  }
  if (
    nextScope.businessId !== setupScope.businessId
    || nextScope.sessionId !== setupScope.sessionId
    || nextScope.language !== setupScope.language
  ) {
    const stored = factsFromExisting(business, brandOwnedProducts, linkedKit)
    const initial = createInitialFlow(language, business?.name || '')
    const facts = hydrateMissingFacts(initial.facts, stored, Boolean(linkedKit))
    setSetupScope(nextScope)
    setForceOpen(false)
    setBusy(false)
    busyRef.current = false
    setOfferId(brandOwnedProducts.find((p) => p.name !== 'Quick Use Image Studio')?.id || null)
    setFlow({
      ...initial,
      facts,
      asked: [...new Set([...initial.asked, ...askedFromFacts(facts)])],
    })
    setPaletteDraft(null)
    setSiteEvidence({})
    setSitePages([])
    setError(null)
    lastSetupPromptRef.current = null
    linkedKitRef.current = linkedKit
  }

  const skipped = useMemo(
    () => readBrandSetupSkipped(storage, userId, business?.id, session?.context),
    [storage, userId, business?.id, session?.context, skipTick]
  )

  const snapshot = useMemo(
    () => buildBrandSetupSnapshot({ business, products: brandOwnedProducts, linkedKit }),
    [business, brandOwnedProducts, linkedKit]
  )

  const visible = shouldShowBrandSetup({
    loaded,
    business,
    session,
    brandSessions,
    snapshot,
    skipped,
    forceOpen,
  })

  const trackerVisible = !skipped && shouldShowSetupTracker({
    loaded,
    business,
    session,
    snapshot,
  })

  useEffect(() => {
    setOfferId(brandOwnedProducts.find((p) => p.name !== 'Quick Use Image Studio')?.id || null)
  }, [brandOwnedProducts])

  useEffect(() => {
    const stored = factsFromExisting(business, brandOwnedProducts, linkedKit)
    setFlow((prev) => {
      const facts = hydrateMissingFacts(prev.facts, stored, Boolean(linkedKit))
      return {
        ...prev,
        facts,
        asked: [...new Set([...prev.asked, ...askedFromFacts(facts)])],
      }
    })
  }, [
    business?.id,
    business?.updated_at,
    brandOwnedProducts,
    linkedKit?.id,
    linkedKit?.updated_at,
  ])

  // First-run chrome: empty CTA replaces the long Hola welcome when kit is incomplete.
  // (Welcome text stays available for createInitialFlow / conversational setup.)
  useEffect(() => {
    if (!visible || !session?.id) return
    if (messagesLoading) return
    if (messageCount > 0) {
      welcomedSessionsRef.current.add(session.id)
      return
    }
    // Do not auto-persist ¡Hola! — ChatThread shows “Empezá por tu marca” instead.
    welcomedSessionsRef.current.add(session.id)
    try {
      sessionStorage.setItem(`ianai.chat-welcome.${session.id}`, '1')
    } catch { /* private mode */ }
  }, [visible, session?.id, messageCount, messagesLoading])

  const skip = useCallback(() => {
    if (!business) return
    writeBrandSetupSkipped(storage, userId, business.id, true)
    if (session) {
      void onPatchSession({ context: withSetupSkippedContext(session.context, true) })
    }
    setForceOpen(false)
    setFlow((prev) => ({ ...prev, phase: 'paused' }))
    setSkipTick((n) => n + 1)
  }, [business, onPatchSession, session, storage, userId])

  const reopen = useCallback(() => {
    if (!business) return
    writeBrandSetupSkipped(storage, userId, business.id, false)
    if (session) {
      void onPatchSession({ context: withSetupSkippedContext(session.context, false) })
    }
    setForceOpen(true)
    setSkipTick((n) => n + 1)
    setFlow((prev) => {
      if (prev.turns.length > 0 && prev.phase !== 'paused' && prev.phase !== 'complete') return { ...prev, phase: 'asking' }
      return createInitialFlow(language, business.name)
    })
  }, [business, language, onPatchSession, session, storage, userId])

  const persistBusiness = useCallback(async (facts: SetupFlowState['facts']) => {
    if (!business) return
    const hasAudience = Boolean(facts.icp.trim())
    const updated = await updateBusiness(business.id, {
      name: facts.businessName.trim() || business.name,
      sales_channels: facts.salesChannels,
      location: facts.location.trim(),
      does_shipping: facts.doesShipping,
      shipping_method: facts.shippingMethod.trim(),
      icp_description: facts.icp.trim(),
      target_audiences: hasAudience ? [{ ...EMPTY_AUDIENCE }] : [],
    })
    onBusinessPatched(updated)
  }, [business, onBusinessPatched])

  const persistOffer = useCallback(async (facts: SetupFlowState['facts']): Promise<Product | null> => {
    if (!business) return null
    const payload: Record<string, unknown> = {
      name: facts.offerName.trim() || facts.businessName || business.name,
      type: facts.storageType,
      business_id: business.id,
      product_description: facts.product_description,
      utility: facts.utility,
      result: facts.result,
      current_alternatives: facts.current_alternatives,
      key_objection: facts.key_objection,
      main_problem: facts.main_problem,
      expected_result: facts.expected_result,
      differentiation: facts.differentiation,
      menu_text: facts.menu_text,
      location: facts.location,
      schedule: facts.schedule,
      re_price: facts.re_price,
      re_location: facts.re_location,
      re_highlights: facts.re_highlights,
      re_cta: facts.re_cta,
      ind_article_type: facts.ind_article_type,
      ind_variations_description: facts.ind_variations_description,
      ind_main_material: facts.ind_main_material,
      product_category_custom: facts.customLabel,
      context_links: facts.sourceUrl ? [facts.sourceUrl] : [],
      context_links_content: facts.sourceText,
    }
    let saved: Product | null = null
    if (offerId) {
      await updateProduct(offerId, payload)
      saved = await getProduct(offerId)
    } else {
      saved = await createProduct(
        payload as Record<string, unknown> & { name: string; type: string; business_id?: string },
        userId
      )
      setOfferId(saved.id)
    }
    await onProductsChanged()
    invalidateDashboardCache()
    return saved
  }, [business, offerId, onProductsChanged, userId])

  const commitConfirmedSetup = useCallback(async (facts: SetupFlowState['facts']) => {
    await persistBusiness(facts)
    const product = await persistOffer(facts)
    if (product?.id) await onAttachOffer(product.id)
    const primary = facts.salesChannels[0]
    await onPatchSession({
      context: buildFolderContext(facts, language),
      ...(primary ? { primary_channel: primary } : {}),
      ...(facts.offerName.trim() ? { title: facts.offerName.trim().slice(0, 80) } : {}),
    })
  }, [language, onAttachOffer, onPatchSession, persistBusiness, persistOffer])

  /** After URL extract: create/link offer + product photos so Ofertas is not empty before confirm. */
  const materializeExtractedOffer = useCallback(async (facts: SetupFlowState['facts']) => {
    if (!business || !hasOfferHypothesis(facts)) return null
    const product = await persistOffer(facts)
    if (!product?.id) return null
    await onAttachOffer(product.id)

    const refs = (facts.reference_images || [])
      .map((url) => url.trim())
      .filter((url) => /^https?:\/\//i.test(url))
      .filter((url) => /\.(jpe?g|png)(\?|#|$)/i.test(url))
    const unique = [...new Set(refs)].slice(0, 8)
    for (let i = 0; i < unique.length; i += 1) {
      try {
        await createProductImage(
          product.id,
          userId,
          unique[i],
          `Web ${i + 1}`,
          'product',
          session?.id ? { sessionId: session.id } : undefined
        )
      } catch (err) {
        console.warn('ingest product image skipped', err)
      }
    }
    await onProductsChanged()
    return { product, photoCount: unique.length }
  }, [
    business,
    onAttachOffer,
    onProductsChanged,
    persistOffer,
    session?.id,
    userId,
  ])

  const persistBrandKit = useCallback(async (
    facts: SetupFlowState['facts'],
    extras?: {
      primary_color?: string | null
      secondary_color?: string | null
      accent_color?: string | null
      logo_url?: string | null
      reference_images?: string[]
    },
    options?: { throwOnError?: boolean }
  ) => {
    const throwOnError = options?.throwOnError === true
    if (!business) {
      if (throwOnError) {
        throw new Error(language === 'es'
          ? 'Selecciona o crea una marca antes de guardar el logo.'
          : 'Select or create a brand before saving the logo.')
      }
      return null
    }
    const voice = facts.brand_voice.trim()
    const visual = facts.brand_visual.trim()
    const primary = (extras?.primary_color ?? facts.primary_color.trim()) || null
    const secondary = (extras?.secondary_color ?? facts.secondary_color.trim()) || null
    const accent = (extras?.accent_color ?? facts.accent_color.trim()) || null
    const logo = (extras?.logo_url ?? facts.logo_url.trim()) || null
    const refs = extras?.reference_images ?? facts.reference_images
    if (
      !voice
      && !visual
      && !primary
      && !logo
      && !refs?.length
      && !facts.icp
      && !facts.tone_keywords.length
      && !facts.must_use_phrases.length
      && !facts.forbidden_phrases.length
    ) return

    const run = kitWriteRef.current.then(async (): Promise<BrandKit | null> => {
      const form: BrandKitFormData = {
        name: facts.businessName || business.name,
        ...(voice ? { brand_voice: voice } : {}),
        ...(facts.icp ? { target_audience: facts.icp } : {}),
        industry: facts.customLabel || facts.storageType,
        ...(facts.tone_keywords.length ? { tone_keywords: facts.tone_keywords } : {}),
        ...(facts.must_use_phrases.length ? { must_use_phrases: facts.must_use_phrases } : {}),
        ...(facts.forbidden_phrases.length ? { forbidden_phrases: facts.forbidden_phrases } : {}),
        ...(visual ? { visual_style_notes: visual } : {}),
        ...(facts.tagline ? { tagline: facts.tagline } : {}),
        ...(facts.font_primary ? { font_primary: facts.font_primary } : {}),
        ...(primary ? { primary_color: primary } : {}),
        ...(secondary ? { secondary_color: secondary } : {}),
        ...(accent ? { accent_color: accent } : {}),
        ...(logo ? { logo_url: logo } : {}),
        ...(refs ? { reference_images: refs } : {}),
        is_active: true,
        business_id: business.id,
      }
      const currentKit = linkedKitRef.current
      try {
        const kit = currentKit
          ? await updateBrandKit(currentKit.id, {
              name: form.name,
              brand_voice: voice || null,
              target_audience: facts.icp || null,
              tone_keywords: facts.tone_keywords,
              must_use_phrases: facts.must_use_phrases,
              forbidden_phrases: facts.forbidden_phrases,
              visual_style_notes: visual || null,
              tagline: facts.tagline || null,
              industry: facts.customLabel || facts.storageType,
              font_primary: facts.font_primary || null,
              primary_color: primary,
              secondary_color: secondary,
              accent_color: accent,
              logo_url: logo,
              reference_images: refs,
              is_active: true,
              is_default: currentKit.is_default,
              business_id: business.id,
            })
          : await createBrandKit(userId, form)
        linkedKitRef.current = kit
        onKitCreated(kit)
        await onLinkKit(kit.id)
        return kit
      } catch (err) {
        const asErr = err as { code?: string; message?: string; details?: string }
        if (currentKit && isMissingRowError(asErr)) {
          linkedKitRef.current = null
          try {
            const created = await createBrandKit(userId, form)
            linkedKitRef.current = created
            onKitCreated(created)
            await onLinkKit(created.id)
            return created
          } catch (createErr) {
            console.warn('Brand kit persist skipped:', createErr)
            if (throwOnError) throw createErr
            return null
          }
        }
        console.warn('Brand kit persist skipped:', err)
        if (throwOnError) throw err
        return null
      }
    })
    kitWriteRef.current = run.then(() => undefined, () => undefined)
    return run
  }, [business, language, linkedKit, onKitCreated, onLinkKit, userId])

  const askNext = useCallback((current: SetupFlowState): SetupFlowState => {
    const question = nextSetupQuestion(current)
    if (!question) {
      if (!current.facts.offerConfirmed) {
        if (!current.confirmOffered && hasOfferHypothesis(current.facts)) {
          return {
            ...current,
            phase: 'confirm_offer',
            confirmOffered: true,
            pendingQuestion: null,
            turns: [...current.turns, setupTurn('assistant', reviewCopy(language))],
          }
        }
        if (current.confirmOffered) {
          return { ...current, phase: 'confirm_offer', pendingQuestion: null }
        }
      }
      return {
        ...current,
        phase: 'complete',
        pendingQuestion: null,
        turns: [...current.turns, setupTurn('assistant', completeCopy(language))],
      }
    }
    return {
      ...current,
      phase: 'asking',
      pendingQuestion: question,
      asked: markAsked(current.asked, question),
      turns: [...current.turns, setupTurn('assistant', questionPrompt(question, language, current.facts))],
    }
  }, [language])

  const reply = useCallback(async (
    raw: string,
    options?: { contextEdit?: boolean }
  ): Promise<{ ignored?: boolean } | void> => {
    const text = raw.trim()
    if (!text || !business) return
    if (busyRef.current) return { ignored: true }
    busyRef.current = true
    const originSessionId = session?.id || null
    setBusy(true)
    setError(null)
    try {
      await onPersistTurn('user', text)
      if (activeSessionIdRef.current !== originSessionId) return { ignored: true }
      lastSetupPromptRef.current = null
      let current: SetupFlowState = {
        ...flow,
        turns: [...flow.turns, setupTurn('user', text)],
      }
      if (options?.contextEdit) {
        current = {
          ...current,
          phase: 'confirm_offer',
          pendingQuestion: null,
          confirmOffered: true,
        }
      }

      if (isPauseSetup(text)) {
        skip()
        const done = completeCopy(language)
        await onPersistTurn('assistant', done)
        setFlow({ ...current, phase: 'paused', turns: [...current.turns, setupTurn('assistant', done)] })
        return
      }

      if (isSkipThis(text) && (current.pendingQuestion || current.phase === 'confirm_offer')) {
        if (current.phase === 'confirm_offer') {
          const facts = { ...current.facts, offerConfirmed: true }
          await commitConfirmedSetup(facts)
          current = askNext({ ...current, facts, pendingQuestion: null })
          const skippedLast = current.turns[current.turns.length - 1]
          if (skippedLast?.role === 'assistant') await onPersistTurn('assistant', skippedLast.content)
          setFlow(current)
          return
        }
        current = {
          ...current,
          asked: current.pendingQuestion ? markAsked(current.asked, current.pendingQuestion) : current.asked,
          pendingQuestion: null,
          confirmOffered: true,
        }
        current = askNext(current)
        const skippedLast = current.turns[current.turns.length - 1]
        if (skippedLast?.role === 'assistant') await onPersistTurn('assistant', skippedLast.content)
        setFlow(current)
        return
      }

      const { url, notes } = splitSourceAndNotes(text)
      const shouldIngest =
        current.phase !== 'confirm_offer'
        && current.phase !== 'complete'
        && current.phase !== 'paused'
        && (
          current.phase === 'intro'
          || current.pendingQuestion === 'source'
          || Boolean(url)
        )

      if (shouldIngest && (url || notes.length > 0)) {
        current = {
          ...current,
          phase: 'analyzing',
          facts: seedFactsFromPastedText(current.facts, text),
        }
        setFlow(current)

        let facts = current.facts
        let ingestError: string | undefined
        let analyzedEvidence: Record<string, SiteFieldEvidence> = {}
        let analyzedPages: Array<{ url: string; title: string; ok: boolean }> = []

        if (url) {
          const analyzed = await analyzeSetupSite(url, notes, language)
          if (activeSessionIdRef.current !== originSessionId) return { ignored: true }
          if (analyzed.analysis) {
            facts = mergeSiteAnalysisIntoFacts(facts, analyzed.analysis.facts, url)
            if (notes) facts.sourceText = [facts.sourceText, notes].filter(Boolean).join('\n')
            analyzedEvidence = analyzed.analysis.evidence
            analyzedPages = analyzed.analysis.pages
            setSiteEvidence(analyzedEvidence)
            setSitePages(analyzedPages)
          } else {
            // Graceful fallback for hosts or deployments where the coordinated analyzer cannot finish.
            const gathered = await gatherSetupSource(url, notes, language)
            ingestError = gathered.error || analyzed.error
            if (gathered.content) {
              const businessFill = await autoFillFromText(gathered.content, 'business', language, { strictUnknowns: true })
              facts = mergeAutofillIntoFacts(facts, pickDefinedAutofill(businessFill.data))
              const typedFill = await autoFillFromText(
                gathered.content,
                formTypeForProductType(facts.storageType),
                language,
                { strictUnknowns: true }
              )
              facts = mergeAutofillIntoFacts(facts, pickDefinedAutofill(typedFill.data))
              facts.sourceUrl = url
            } else {
              const fail = sanitizeSetupError(ingestError || '', language)
                || (language === 'es'
                  ? 'No pude leer ese sitio. Probá con otra URL o pegá el contenido.'
                  : 'I could not read that website. Try another URL or paste the content.')
              const lastTurn = current.turns[current.turns.length - 1]
              if (lastTurn?.role !== 'assistant' || lastTurn.content !== fail) {
                await onPersistTurn('assistant', fail)
              }
              setFlow({
                ...current,
                phase: facts.sourceText?.trim() ? 'confirm_offer' : 'intro',
                pendingQuestion: facts.sourceText?.trim() ? null : 'source',
                confirmOffered: Boolean(facts.sourceText?.trim()),
                turns: lastTurn?.content === fail ? current.turns : [...current.turns, setupTurn('assistant', fail)],
              })
              return
            }
          }
        } else {
          const gathered = await gatherSetupSource(null, notes, language)
          if (!gathered.content) {
            const fail = gathered.error || (language === 'es'
              ? 'No pude leer ese texto. Pegá un poco más de contexto.'
              : 'I could not read that text. Paste a little more context.')
            await onPersistTurn('assistant', fail)
            setFlow({
              ...current,
              phase: 'intro',
              pendingQuestion: 'source',
              turns: [...current.turns, setupTurn('assistant', fail)],
            })
            return
          }
          const businessFill = await autoFillFromText(gathered.content, 'business', language)
          facts = mergeAutofillIntoFacts(facts, pickDefinedAutofill(businessFill.data))
          if (!businessFill.error) {
            const typedFill = await autoFillFromText(gathered.content, formTypeForProductType(facts.storageType), language)
            facts = mergeAutofillIntoFacts(facts, pickDefinedAutofill(typedFill.data))
          }
        }
        if (hasOfferHypothesis(facts) && facts.typeConfidence === 'low') {
          facts = { ...facts, typeConfidence: 'high' }
        }
        const asked = [...new Set([...current.asked, ...askedFromFacts(facts)])]
        await persistBusiness(facts)
        if (
          facts.logo_url
          || facts.brand_voice
          || facts.brand_visual
          || facts.primary_color
          || (facts.reference_images && facts.reference_images.length > 0)
        ) {
          await persistBrandKit(facts)
        }
        let photoCount = 0
        if (hasOfferHypothesis(facts)) {
          const materialized = await materializeExtractedOffer(facts)
          photoCount = materialized?.photoCount ?? 0
        }
        const missingBits: string[] = []
        if (!facts.re_price?.trim() && !/\d/.test(facts.menu_text || '')) {
          missingBits.push(language === 'es' ? 'el precio' : 'the price')
        }
        if (photoCount === 0) {
          missingBits.push(language === 'es' ? 'fotos del producto' : 'product photos')
        }
        const summary = url
          ? (language === 'es'
              ? `Analicé el sitio${analyzedPages.filter((page) => page.ok).length > 1 ? ` y ${analyzedPages.filter((page) => page.ok).length - 1} páginas relevantes` : ''}. Organicé lo encontrado, las inferencias y lo que todavía necesita confirmación en la tarjeta.`
              : `I analyzed the site${analyzedPages.filter((page) => page.ok).length > 1 ? ` plus ${analyzedPages.filter((page) => page.ok).length - 1} relevant pages` : ''}. I organized web facts, inferences, and items that still need confirmation in the card.`)
          : reviewCopy(language)
        const missingAsk = missingBits.length > 0
          ? (language === 'es'
              ? `\n\nTodavía falta ${missingBits.join(' y ')}. Si los tenés, pegá el precio o subí fotos del producto acá.`
              : `\n\nStill missing ${missingBits.join(' and ')}. If you have them, paste the price or upload product photos here.`)
          : ''
        const reply = `${summary}\n\n${nextStepCopy(language)}${missingAsk}`
        await onPersistTurn('assistant', reply)
        if (activeSessionIdRef.current !== originSessionId) return { ignored: true }
        current = {
          ...current,
          facts,
          asked,
          pendingQuestion: null,
          phase: 'confirm_offer',
          confirmOffered: true,
          turns: [...current.turns, setupTurn('assistant', reply)],
        }
        setFlow(current)
        setPaletteDraft(paletteDraftFromFacts(facts))
        return
      }

      if (current.phase === 'confirm_offer') {
        if (isAffirmative(text)) {
          const facts = { ...current.facts, offerConfirmed: true }
          await commitConfirmedSetup(facts)
          current = askNext({ ...current, facts, pendingQuestion: null })
          const last = current.turns[current.turns.length - 1]
          if (last?.role === 'assistant') await onPersistTurn('assistant', last.content)
          setFlow(current)
          return
        }
        const patch = await autoFillFromText(
          `${buildFolderContext(current.facts, language)}\n\n${language === 'es' ? 'Cambio solicitado por el usuario' : 'Change requested by the user'}:\n${text}`,
          'brand_context',
          language,
          { strictUnknowns: true }
        )
        const facts = mergeSiteAnalysisIntoFacts(
          { ...current.facts, product_description: current.facts.product_description },
          pickDefinedAutofill(patch.data),
          current.facts.sourceUrl
        )
        if (text.length < 80 && !isAffirmative(text) && !facts.offerName) {
          facts.offerName = text.slice(0, 80)
        }
        await commitConfirmedSetup(facts)
        await persistBrandKit(facts)
        const summary = language === 'es'
          ? 'Listo, actualicé y guardé ese cambio en el contexto de la marca. Podés revisarlo en Contexto cuando quieras.'
          : 'Done. I updated and saved that change in the brand context. You can review it under Context anytime.'
        await onPersistTurn('assistant', summary)
        current = {
          ...current,
          facts,
          confirmOffered: true,
          turns: [...current.turns, setupTurn('assistant', summary)],
        }
        setFlow(current)
        return
      }

      if (current.pendingQuestion) {
        const question: SetupQuestionId = current.pendingQuestion
        const facts = applyQuestionAnswer(current.facts, question, text)
        current = { ...current, facts, pendingQuestion: null, asked: markAsked(current.asked, question) }
        await persistBusiness(facts)
        if (facts.offerConfirmed) await commitConfirmedSetup(facts)
        if (question === 'brand_voice' || question === 'brand_visual') await persistBrandKit(facts)
        current = askNext(current)
        const last = current.turns[current.turns.length - 1]
        if (last?.role === 'assistant') await onPersistTurn('assistant', last.content)
        setFlow(current)
        return
      }

      current = askNext(current)
      const last = current.turns[current.turns.length - 1]
      if (last?.role === 'assistant') await onPersistTurn('assistant', last.content)
      setFlow(current)
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : 'Setup failed'
      const friendly = sanitizeSetupError(rawMessage, language)
      setError(friendly)
      if (flow.phase !== 'analyzing') return
      const fail = language === 'es'
        ? 'No pude terminar de leer eso. Usé lo que pegaste — revisá la tarjeta y confirmá.'
        : 'I could not finish reading that. I kept what you pasted — review the card and confirm.'
      const hasPasted = Boolean(flow.facts.sourceText?.trim() || flow.facts.sourceUrl?.trim())
      const lastTurn = flow.turns[flow.turns.length - 1]
      if (lastTurn?.role !== 'assistant' || !(lastTurn.content.includes('No pude') || lastTurn.content.includes('could not'))) {
        void onPersistTurn('assistant', fail)
      }
      setFlow((prev) => ({
        ...prev,
        phase: hasPasted ? 'confirm_offer' : 'intro',
        pendingQuestion: hasPasted ? null : 'source',
        confirmOffered: hasPasted,
        turns: lastTurn?.content === fail
          ? prev.turns
          : [...prev.turns, setupTurn('assistant', fail)],
      }))
    } finally {
      if (activeSessionIdRef.current === originSessionId) {
        setBusy(false)
        busyRef.current = false
      }
    }
  }, [askNext, business, commitConfirmedSetup, flow, language, materializeExtractedOffer, onPersistTurn, persistBrandKit, persistBusiness, session?.id, skip])

  const addRule = useCallback(async (raw: string) => {
    const rule = normalizeBrandRule(raw)
    if (!rule || !business || !session || busyRef.current) return
    busyRef.current = true
    const originSessionId = session.id
    setBusy(true)
    setError(null)
    try {
      await onPersistTurn('user', raw.trim())
      if (activeSessionIdRef.current !== originSessionId) return
      const removing = isBrandRuleRemoval(raw)
      const matchedRule = removing ? findBrandRuleToRemove(raw, flow.facts.forbidden_phrases) : null
      const exists = flow.facts.forbidden_phrases.some(
        (item) => item.localeCompare(rule, undefined, { sensitivity: 'accent' }) === 0
      )
      const facts = removing
        ? (matchedRule
          ? { ...flow.facts, forbidden_phrases: flow.facts.forbidden_phrases.filter((item) => item !== matchedRule) }
          : flow.facts)
        : (exists ? flow.facts : { ...flow.facts, forbidden_phrases: [...flow.facts.forbidden_phrases, rule] })
      if ((removing && matchedRule) || (!removing && !exists)) {
        const kit = await persistBrandKit(facts)
        if (!kit) throw new Error(language === 'es' ? 'No pude guardar la regla.' : 'Could not save the rule.')
        await onPatchSession({ context: buildFolderContext(facts, language) })
      }
      const response = removing
        ? (matchedRule
          ? (language === 'es' ? `Regla eliminada: "${matchedRule}". El cambio aplica desde ahora.` : `Rule removed: "${matchedRule}". The change applies now.`)
          : (language === 'es' ? 'No encontre una regla activa que coincida con eso.' : 'I could not find a matching active rule.'))
        : exists
        ? (language === 'es' ? `Esa regla ya estaba activa: “${rule}”.` : `That rule was already active: “${rule}”.`)
        : (language === 'es'
          ? `Regla guardada: “${rule}”. La aplicaré a los próximos guiones, posts e imágenes.`
          : `Rule saved: “${rule}”. I’ll apply it to future scripts, posts, and images.`)
      await onPersistTurn('assistant', response)
      setFlow((prev) => ({
        ...prev,
        facts,
        turns: [...prev.turns, setupTurn('user', raw.trim()), setupTurn('assistant', response)],
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save brand rule')
    } finally {
      if (activeSessionIdRef.current === originSessionId) {
        setBusy(false)
        busyRef.current = false
      }
    }
  }, [business, flow.facts, language, onPatchSession, onPersistTurn, persistBrandKit, session])

  const requestContextEdit = useCallback(async () => {
    if (!business || !session) return
    writeBrandSetupSkipped(storage, userId, business.id, false)
    setForceOpen(true)
    setSkipTick((n) => n + 1)
    const prompt = language === 'es'
      ? 'Decime qué querés cambiar del contexto: negocio, oferta, público, voz, colores o cualquier otro dato. Lo actualizo y lo guardo por vos.'
      : 'Tell me what you want to change in the context: business, offer, audience, voice, colors, or any other detail. I’ll update and save it for you.'
    await onPersistTurn('assistant', prompt)
    setFlow((prev) => ({
      ...prev,
      phase: 'confirm_offer',
      pendingQuestion: null,
      confirmOffered: true,
      turns: [...prev.turns, setupTurn('assistant', prompt)],
    }))
  }, [business, language, onPersistTurn, session, storage, userId])

  const changeContext = useCallback(
    (text: string) => reply(text, { contextEdit: true }),
    [reply]
  )

  const askStep = useCallback(async (step: BrandSetupStepId) => {
    if (!business || !session) return
    writeBrandSetupSkipped(storage, userId, business.id, false)
    setForceOpen(true)
    setSkipTick((n) => n + 1)
    const question = questionForSetupStep(step, flow.facts)
    const prompt = questionPrompt(question, language, flow.facts)
    if (
      flow.pendingQuestion === question
      || (lastSetupPromptRef.current?.sessionId === session.id && lastSetupPromptRef.current.prompt === prompt)
    ) {
      return
    }
    lastSetupPromptRef.current = { sessionId: session.id, prompt }
    await onPersistTurn('assistant', prompt)
    setFlow((prev) => ({
      ...prev,
      phase: 'asking',
      pendingQuestion: question,
      asked: markAsked(prev.asked, question),
      turns: [...prev.turns, setupTurn('assistant', prompt)],
    }))
  }, [business, flow.facts, language, onPersistTurn, session, storage, userId])

  const savePalette = useCallback(async (draft: PaletteDraft) => {
    if (!business) return
    const facts = {
      ...flow.facts,
      primary_color: draft.primary,
      secondary_color: draft.secondary,
      accent_color: draft.accent,
    }
    const kit = await persistBrandKit(facts, {
      primary_color: draft.primary || null,
      secondary_color: draft.secondary || null,
      accent_color: draft.accent || null,
    })
    if (!kit) {
      setError(language === 'es'
        ? 'No pude guardar la paleta todavía. El resumen del negocio sí quedó.'
        : 'Could not save the palette yet. The business summary was still saved.')
      return
    }
    const note = language === 'es'
      ? 'Paleta guardada. La uso en las imágenes.'
      : 'Palette saved. I’ll use it on images.'
    await onPersistTurn('assistant', note)
    setFlow((prev) => ({ ...prev, facts }))
    setPaletteDraft(null)
  }, [business, flow.facts, language, onPersistTurn, persistBrandKit])

  const skipPalette = useCallback(() => {
    setPaletteDraft(null)
  }, [])

  const uploadBrandAsset = useCallback(async (file: File, kind: 'logo' | 'reference') => {
    if (busyRef.current) return
    busyRef.current = true
    const originSessionId = session?.id || null
    setBusy(true)
    setError(null)
    try {
      const url = await uploadSetupBrandAsset(file, kind)
      if (activeSessionIdRef.current !== originSessionId) return
      if (kind === 'logo') {
        const facts = { ...flow.facts, logo_url: url }
        setFlow((prev) => ({ ...prev, facts }))
        const kit = await persistBrandKit(facts, { logo_url: url }, { throwOnError: Boolean(business) })
        if (business && !kit) {
          throw new Error(language === 'es' ? 'No pude guardar el logo.' : 'Could not save the logo.')
        }
        await onPersistTurn('user', language === 'es' ? 'Subí el logo' : 'Uploaded the logo')
        await onPersistTurn(
          'assistant',
          language === 'es'
            ? (kit ? 'Logo guardado. Lo uso en los posts.' : 'Logo listo en el chat. Se guarda en el Brand Kit al confirmar la marca.')
            : (kit ? 'Logo saved. I’ll use it on posts.' : 'Logo is ready in chat. It saves to the Brand Kit when the brand is confirmed.')
        )
        return
      }
      const refs = appendBrandReferenceImages(linkedKitRef.current?.reference_images, url)
      const referenceFacts = { ...flow.facts, reference_images: refs }
      setFlow((prev) => ({ ...prev, facts: { ...prev.facts, reference_images: refs } }))
      const kit = await persistBrandKit(referenceFacts, { reference_images: refs }, { throwOnError: Boolean(business) })
      if (business && !kit) {
        throw new Error(language === 'es' ? 'No pude guardar la referencia.' : 'Could not save the reference.')
      }
      await onPersistTurn('user', language === 'es' ? 'Subí una referencia visual' : 'Uploaded a visual reference')
      await onPersistTurn(
        'assistant',
        language === 'es'
          ? 'Referencia guardada. La uso como guía visual en las imágenes.'
          : 'Reference saved. I’ll use it as visual guidance on images.'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      if (activeSessionIdRef.current === originSessionId) {
        setBusy(false)
        busyRef.current = false
      }
    }
  }, [business, flow.facts, language, onPersistTurn, persistBrandKit, session?.id])

  const uploadSetupDocument = useCallback(async (file: File) => {
    if (!business || busyRef.current) return
    busyRef.current = true
    const originSessionId = session?.id || null
    setBusy(true)
    setError(null)
    try {
      const formType = formTypeForProductType(flow.facts.storageType)
      const result = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
        ? await ingestSetupPdf(file, formType, language)
        : await ingestSetupPlainFile(file, formType, language)
      if (activeSessionIdRef.current !== originSessionId) return
      if (!result.text) {
        throw new Error(result.error || (language === 'es' ? 'No pude leer el documento.' : 'I could not read the document.'))
      }

      let facts = mergeAutofillIntoFacts(flow.facts, pickDefinedAutofill(result.data))
      const businessFill = await autoFillFromText(result.text, 'business', language, { strictUnknowns: true })
      if (activeSessionIdRef.current !== originSessionId) return
      facts = mergeAutofillIntoFacts(facts, pickDefinedAutofill(businessFill.data))
      const typedFill = await autoFillFromText(
        result.text,
        formTypeForProductType(facts.storageType),
        language,
        { strictUnknowns: true }
      )
      if (activeSessionIdRef.current !== originSessionId) return
      facts = mergeAutofillIntoFacts(facts, pickDefinedAutofill(typedFill.data))
      facts.sourceText = [
        flow.facts.sourceText,
        `[${file.name}]\n${result.text.slice(0, 20_000)}`,
      ].filter(Boolean).join('\n\n')
      if (hasOfferHypothesis(facts) && facts.typeConfidence === 'low') facts.typeConfidence = 'high'

      await persistBusiness(facts)
      if (facts.logo_url || facts.brand_voice || facts.brand_visual || facts.primary_color) {
        await persistBrandKit(facts)
      }
      if (activeSessionIdRef.current !== originSessionId) return
      const summary = language === 'es'
        ? `Leí ${file.name} y sumé lo relevante al contexto de la marca. Abrí la ficha compacta para que revises solo lo que falta.`
        : `I read ${file.name} and added the relevant details to the brand context. I opened the compact profile so you can review only what is missing.`
      const reply = `${summary}\n\n${nextStepCopy(language)}`
      await onPersistTurn('assistant', reply)
      setFlow((prev) => ({
        ...prev,
        facts,
        asked: [...new Set([...prev.asked, ...askedFromFacts(facts)])],
        phase: 'confirm_offer',
        pendingQuestion: null,
        confirmOffered: true,
        turns: [...prev.turns, setupTurn('assistant', reply)],
      }))
      setPaletteDraft(paletteDraftFromFacts(facts))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Document upload failed')
    } finally {
      if (activeSessionIdRef.current === originSessionId) {
        setBusy(false)
        busyRef.current = false
      }
    }
  }, [business, flow.facts, language, onPersistTurn, persistBrandKit, persistBusiness, session?.id])

  const saveProfile = useCallback(async (draft: SetupFacts, confirm = false) => {
    if (!business || busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const facts = { ...draft, offerConfirmed: confirm || draft.offerConfirmed }
      await commitConfirmedSetup(facts)
      await persistBrandKit(facts)
      if (confirm && !flow.facts.offerConfirmed) {
        await onPersistTurn('assistant', completeCopy(language))
      }
      setFlow((prev) => ({
        ...prev,
        facts,
        phase: confirm ? 'complete' : prev.phase,
        pendingQuestion: confirm ? null : prev.pendingQuestion,
        confirmOffered: prev.confirmOffered || confirm,
      }))
      setPaletteDraft(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save brand profile')
      return false
    } finally {
      setBusy(false)
      busyRef.current = false
    }
  }, [business, commitConfirmedSetup, flow.facts.offerConfirmed, language, onPersistTurn, persistBrandKit])

  return {
    visible,
    trackerVisible,
    skipped,
    snapshot,
    steps: BRAND_SETUP_STEPS,
    stepComplete,
    busy,
    error,
    turns: [],
    phase: flow.phase,
    facts: flow.facts,
    linkedKit,
    siteEvidence,
    sitePages,
    paletteDraft,
    skip,
    reopen,
    reply,
    requestContextEdit,
    changeContext,
    addRule,
    askStep,
    savePalette,
    skipPalette,
    uploadBrandAsset,
    uploadSetupDocument,
    saveProfile,
  }
}
