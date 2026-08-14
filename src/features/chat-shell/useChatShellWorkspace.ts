import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  countBusinessChatSessionsBulk,
  createBrandChatSession,
  createBusiness,
  deleteBusinessWithContents,
  deleteChatSession,
  getBusinessChatSessions,
  getBusinesses,
  getChatSession,
  getFirstUserMessagePreviews,
  addMessage,
  insertImageMessageArtifact,
  replaceSessionOffers,
} from '../../services/database'
import type { Business, ChatSession } from '../../types'
import { selectionsEqual } from './chatShellAsync'
import {
  persistSelection,
  readStoredSelection,
  resolveInitialSelection,
  selectionFromSearchParams,
  selectionToSearchParams,
} from './chatShellPersistence'
import { buildMinimalBrandFormData, validateBrandCreateName } from './chatShellBrandCreate'
import { resolveBusinessBrandKitId } from './chatShellBrandSetup'
import { isDefaultSessionTitle } from './chatShellSidebar'
import { resolveNextSessionId, shouldCommitCreatedSession } from './sessionOffer'
import { invalidateDashboardCache } from '../../hooks/useDashboardData'

function defaultSessionTitle(): string {
  return 'New chat'
}

function quickSessionTitle(): string {
  return 'New chat'
}

function readUrlSelection() {
  try {
    return selectionFromSearchParams(new URLSearchParams(window.location.search))
  } catch {
    return { brandId: null, sessionId: null }
  }
}

function readUrlSessionId(): string | null {
  return readUrlSelection().sessionId
}

/** Capture URL/stored selection once at hook boot (before any async hydrate). */
function readBootSelection() {
  return resolveInitialSelection(readUrlSelection(), readStoredSelection())
}

export function useChatShellWorkspace(userId: string | undefined) {
  const [, setSearchParams] = useSearchParams()
  const bootRef = useRef<ReturnType<typeof readBootSelection> | null>(null)
  if (bootRef.current === null) {
    bootRef.current = readBootSelection()
  }
  const boot = bootRef.current

  const [businesses, setBusinesses] = useState<Business[]>([])
  const [sessionsByBrand, setSessionsByBrand] = useState<Record<string, ChatSession[]>>({})
  const [activeBrandId, setActiveBrandId] = useState<string | null>(() => boot.brandId)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => boot.sessionId)
  const [pendingBrandId, setPendingBrandId] = useState<string | null>(null)
  const [loadingBusinesses, setLoadingBusinesses] = useState(true)
  const [loadingByBrand, setLoadingByBrand] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({})
  const [firstUserPreviews, setFirstUserPreviews] = useState<Record<string, string>>({})

  /**
   * Authoritative session intent from boot URL / Skip pin / user select|create.
   * List hydrate and syncUrl must not replace this with brand-newest.
   */
  const authoritativeSessionRef = useRef<string | null>(boot.sessionId)
  /** Hydrate / Quick hint — never trusted over a newer user click. */
  const preferredSessionRef = useRef<string | null>(boot.sessionId)
  const activeSessionIdRef = useRef<string | null>(boot.sessionId)
  const activeBrandIdRef = useRef<string | null>(boot.brandId)
  /** Bumped on every user-driven selection/create so stale fetches cannot overwrite. */
  const selectionEpochRef = useRef(0)
  const sessionsRequestByBrandRef = useRef<Record<string, number>>({})
  const businessesRequestIdRef = useRef(0)
  const createLockRef = useRef(false)
  /** Tombstones for optimistic deletes — prevent stale list fetch from restoring rows. */
  const pendingDeletedRef = useRef<Set<string>>(new Set())
  const pendingDeletedBrandRef = useRef<Set<string>>(new Set())
  /** True after initial selection hydrate for the current user (list refresh still works). */
  const didHydrateSelectionRef = useRef(false)
  const hydratedUserIdRef = useRef<string | null>(null)

  const sessionsByBrandRef = useRef(sessionsByBrand)
  sessionsByBrandRef.current = sessionsByBrand

  const sessions = useMemo(
    () => (activeBrandId ? sessionsByBrand[activeBrandId] || [] : []),
    [sessionsByBrand, activeBrandId]
  )
  const loadingSessions = Boolean(activeBrandId && loadingByBrand[activeBrandId] && sessionsByBrand[activeBrandId] === undefined)

  const activeBrand = useMemo(
    () => businesses.find((b) => b.id === activeBrandId) ?? null,
    [businesses, activeBrandId]
  )
  const activeSession = useMemo(
    () => {
      if (!activeSessionId) return null
      for (const list of Object.values(sessionsByBrand)) {
        const found = list.find((s) => s.id === activeSessionId)
        if (found) return found
      }
      return null
    },
    [sessionsByBrand, activeSessionId]
  )

  const commitSessionId = useCallback((sessionId: string | null) => {
    activeSessionIdRef.current = sessionId
    setActiveSessionId(sessionId)
  }, [])

  const syncUrlAndStorage = useCallback(
    (brandId: string | null, sessionId: string | null) => {
      const auth = authoritativeSessionRef.current
      let nextSessionId = sessionId
      if (auth) {
        if (!nextSessionId || nextSessionId !== auth) {
          nextSessionId = auth
        }
      }
      persistSelection({ brandId, sessionId: nextSessionId })
      const nextSelection = { brandId, sessionId: nextSessionId }
      if (selectionsEqual(readUrlSelection(), nextSelection)) return
      setSearchParams(selectionToSearchParams(nextSelection), { replace: true })
    },
    [setSearchParams]
  )

  const bumpSelectionEpoch = useCallback(() => {
    selectionEpochRef.current += 1
    return selectionEpochRef.current
  }, [])

  const writeBrandSessions = useCallback((brandId: string, list: ChatSession[]) => {
    setSessionsByBrand((prev) => ({ ...prev, [brandId]: list }))
  }, [])

  const patchBrandSessions = useCallback((
    brandId: string,
    updater: (prev: ChatSession[]) => ChatSession[]
  ) => {
    setSessionsByBrand((prev) => ({
      ...prev,
      [brandId]: updater(prev[brandId] || []),
    }))
  }, [])

  const mapCachedSessions = useCallback((updater: (session: ChatSession) => ChatSession) => {
    setSessionsByBrand((prev) => {
      const next: Record<string, ChatSession[]> = {}
      for (const [id, list] of Object.entries(prev)) {
        next[id] = list.map(updater)
      }
      return next
    })
  }, [])

  const loadBrandSessions = useCallback(async (
    brandId: string,
    mode: 'hydrate' | 'prefetch'
  ) => {
    const requestId = (sessionsRequestByBrandRef.current[brandId] || 0) + 1
    sessionsRequestByBrandRef.current[brandId] = requestId
    const epochAtStart = selectionEpochRef.current
    const cached = sessionsByBrandRef.current[brandId]
    const silent = cached !== undefined

    if (!silent) {
      setLoadingByBrand((prev) => ({ ...prev, [brandId]: true }))
    }
    if (mode === 'hydrate') setError(null)

    try {
      const list = (await getBusinessChatSessions(brandId)).filter(
        (s) => !pendingDeletedRef.current.has(s.id)
      )
      if (sessionsRequestByBrandRef.current[brandId] !== requestId) return list
      if (pendingDeletedBrandRef.current.has(brandId)) return list

      const currentId = activeSessionIdRef.current
      const optimistic =
        currentId &&
        !pendingDeletedRef.current.has(currentId) &&
        !list.some((s) => s.id === currentId)
          ? (sessionsByBrandRef.current[brandId] || []).filter((s) => s.id === currentId)
          : []
      const next = optimistic.length === 0 ? list : [...optimistic, ...list]
      writeBrandSessions(brandId, next.filter((s) => !pendingDeletedRef.current.has(s.id)))
      setSessionCounts((prev) => ({ ...prev, [brandId]: list.length }))

      const previewIds = list.filter((s) => isDefaultSessionTitle(s.title)).map((s) => s.id)
      if (previewIds.length > 0) {
        void getFirstUserMessagePreviews(previewIds)
          .then((previews) => {
            if (sessionsRequestByBrandRef.current[brandId] !== requestId) return
            setFirstUserPreviews((prev) => ({ ...prev, ...previews }))
          })
          .catch(() => { /* title fallbacks still work */ })
      }

      if (mode !== 'hydrate') return list
      if (activeBrandIdRef.current !== brandId) return list
      if (selectionEpochRef.current !== epochAtStart) return list

      const liveSessionId = activeSessionIdRef.current
      const authId = authoritativeSessionRef.current
      const urlId = readUrlSessionId() || authId
      const preferredId = preferredSessionRef.current || authId
      const nextSessionId = resolveNextSessionId({
        sessionIds: list.map((s) => s.id),
        currentId:
          liveSessionId && pendingDeletedRef.current.has(liveSessionId) ? null : liveSessionId,
        urlId,
        preferredId,
      })

      if (selectionEpochRef.current !== epochAtStart) return list

      const pinned =
        authId
        || urlId
        || preferredId
        || (liveSessionId && !pendingDeletedRef.current.has(liveSessionId) ? liveSessionId : null)
      const stickId =
        pinned && nextSessionId && nextSessionId !== pinned && !pendingDeletedRef.current.has(pinned)
          ? pinned
          : nextSessionId

      if (stickId !== activeSessionIdRef.current) {
        commitSessionId(stickId)
      }
      if (stickId) {
        preferredSessionRef.current = preferredSessionRef.current || stickId
      }
      syncUrlAndStorage(brandId, stickId ?? pinned)
      return list
    } catch (err) {
      if (sessionsRequestByBrandRef.current[brandId] !== requestId) return []
      if (mode === 'hydrate' && selectionEpochRef.current === epochAtStart) {
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load sessions')
      }
      return sessionsByBrandRef.current[brandId] || []
    } finally {
      if (sessionsRequestByBrandRef.current[brandId] === requestId) {
        setLoadingByBrand((prev) => ({ ...prev, [brandId]: false }))
      }
    }
  }, [commitSessionId, syncUrlAndStorage, writeBrandSessions])

  const setAuthoritativeSession = useCallback(
    (sessionId: string | null) => {
      authoritativeSessionRef.current = sessionId
      preferredSessionRef.current = sessionId
      commitSessionId(sessionId)
    },
    [commitSessionId]
  )

  const selectBrand = useCallback(
    (brandId: string) => {
      if (brandId === activeBrandIdRef.current) {
        setPendingBrandId(null)
        return
      }
      const epoch = bumpSelectionEpoch()
      setPendingBrandId(brandId)
      setNotice(null)
      void (async () => {
        const list = await loadBrandSessions(brandId, 'prefetch')
        if (selectionEpochRef.current !== epoch) return
        const nextSessionId = list[0]?.id ?? null
        activeBrandIdRef.current = brandId
        setActiveBrandId(brandId)
        setPendingBrandId(null)
        if (nextSessionId) {
          setAuthoritativeSession(nextSessionId)
        } else {
          authoritativeSessionRef.current = null
          preferredSessionRef.current = null
          commitSessionId(null)
        }
        syncUrlAndStorage(brandId, nextSessionId)
      })()
    },
    [bumpSelectionEpoch, commitSessionId, loadBrandSessions, setAuthoritativeSession, syncUrlAndStorage]
  )

  const prefetchBrandSessions = useCallback((brandId: string) => {
    if (!brandId) return
    void loadBrandSessions(brandId, 'prefetch')
  }, [loadBrandSessions])

  const selectSession = useCallback(
    (session: ChatSession) => {
      const brandId = session.business_id || activeBrandIdRef.current
      bumpSelectionEpoch()
      setAuthoritativeSession(session.id)
      setNotice(null)
      if (brandId && brandId !== activeBrandIdRef.current) {
        activeBrandIdRef.current = brandId
        setActiveBrandId(brandId)
      }
      syncUrlAndStorage(brandId, session.id)
    },
    [bumpSelectionEpoch, setAuthoritativeSession, syncUrlAndStorage]
  )

  /**
   * Pin the active session after Skip (or similar).
   * Bumps selection epoch so a late createSession/Quick cannot steal ?session=
   * to a newer incomplete row (A→B snap).
   */
  const keepSessionSelected = useCallback(
    (sessionId: string) => {
      if (!sessionId) return
      bumpSelectionEpoch()
      setAuthoritativeSession(sessionId)
      const brandId = activeBrandIdRef.current
      syncUrlAndStorage(brandId, sessionId)
    },
    [bumpSelectionEpoch, setAuthoritativeSession, syncUrlAndStorage]
  )

  const refreshBusinesses = useCallback(async () => {
    if (!userId) {
      setBusinesses([])
      setLoadingBusinesses(false)
      hydratedUserIdRef.current = null
      didHydrateSelectionRef.current = false
      return
    }

    // Reset hydrate bookkeeping when the signed-in user changes.
    if (hydratedUserIdRef.current !== userId) {
      hydratedUserIdRef.current = userId
      didHydrateSelectionRef.current = false
    }

    const requestId = ++businessesRequestIdRef.current
    const epochAtStart = selectionEpochRef.current
    const needsSelectionHydrate = !didHydrateSelectionRef.current

    setLoadingBusinesses(true)
    setError(null)
    try {
      const list = await getBusinesses(userId)
      if (requestId !== businessesRequestIdRef.current) return
      setBusinesses(list.filter((b) => !pendingDeletedBrandRef.current.has(b.id)))

      void countBusinessChatSessionsBulk(list.map((b) => b.id))
        .then((counts) => {
          if (requestId !== businessesRequestIdRef.current) return
          setSessionCounts((prev) => ({ ...prev, ...counts }))
        })
        .catch(() => { /* counts are best-effort */ })

      // Always refresh the brand list; only apply selection hydrate once, and
      // never overwrite a newer user click that happened while this awaited.
      if (!needsSelectionHydrate) return
      if (selectionEpochRef.current !== epochAtStart) {
        didHydrateSelectionRef.current = true
        return
      }

      const initial = resolveInitialSelection(
        readUrlSelection(),
        readStoredSelection()
      )
      const deepLinkSession =
        authoritativeSessionRef.current || initial.sessionId || null
      const brandStillValid = Boolean(
        initial.brandId && list.some((b) => b.id === initial.brandId)
      )
      // With an explicit ?session=, never invent list[0] brand — touch-load
      // resolves the session's real brand. Falling to list[0] caused A→newest snaps.
      const nextBrandId = brandStillValid
        ? initial.brandId
        : deepLinkSession
          ? (initial.brandId || activeBrandIdRef.current)
          : (list[0]?.id ?? null)
      const nextSessionId = deepLinkSession

      if (selectionEpochRef.current !== epochAtStart) {
        didHydrateSelectionRef.current = true
        return
      }

      if (nextSessionId) {
        authoritativeSessionRef.current = nextSessionId
        preferredSessionRef.current = nextSessionId
      }
      activeBrandIdRef.current = nextBrandId
      setActiveBrandId(nextBrandId)
      commitSessionId(nextSessionId)
      // Preserve deep-link session even when brand is provisional.
      syncUrlAndStorage(nextBrandId, nextSessionId)
      didHydrateSelectionRef.current = true
    } catch (err) {
      if (requestId !== businessesRequestIdRef.current) return
      console.error(err)
      if (needsSelectionHydrate) {
        didHydrateSelectionRef.current = false
        hydratedUserIdRef.current = null
      }
      setError(err instanceof Error ? err.message : 'Failed to load brands')
    } finally {
      if (requestId === businessesRequestIdRef.current) {
        setLoadingBusinesses(false)
      }
    }
  }, [userId, commitSessionId, syncUrlAndStorage])

  useEffect(() => {
    void refreshBusinesses()
  }, [refreshBusinesses])

  useEffect(() => {
    if (!activeBrandId) return
    void loadBrandSessions(activeBrandId, 'hydrate')
  }, [activeBrandId, loadBrandSessions])

  const createSession = useCallback(async (title?: string) => {
    if (!userId) return
    const brandId = activeBrandIdRef.current
    if (!brandId) {
      setNotice('Pick a brand first to create a session (Quick has no product, but needs a brand).')
      return
    }
    if (createLockRef.current || busy) return
    createLockRef.current = true
    const epoch = bumpSelectionEpoch()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const session = await createBrandChatSession(
        brandId,
        userId,
        title || defaultSessionTitle(),
        undefined,
        resolveBusinessBrandKitId(sessions)
      )
      // Never mutate another brand's list (contamination). Same-brand can surface the row.
      if (activeBrandIdRef.current !== brandId) return
      // Always surface the created row in the list…
      patchBrandSessions(brandId, (prev) => [session, ...prev.filter((s) => s.id !== session.id)])
      // …but only select it if this create is still the live user action.
      // Skip/pin bumps epoch so a deferred create cannot rewrite ?session= A→B.
      if (!shouldCommitCreatedSession(epoch, selectionEpochRef.current)) return
      setAuthoritativeSession(session.id)
      syncUrlAndStorage(brandId, session.id)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      createLockRef.current = false
      setBusy(false)
    }
  }, [userId, busy, sessions, bumpSelectionEpoch, syncUrlAndStorage, setAuthoritativeSession])

  const createQuickSession = useCallback(async () => {
    if (!userId) return
    const brandId = activeBrandIdRef.current || businesses[0]?.id || null
    if (!brandId) {
      setNotice(
        'Create or select a brand before Quick generate. “No brand” means no product — business_id is still required.'
      )
      return
    }
    if (createLockRef.current || busy) return
    createLockRef.current = true
    const epoch = bumpSelectionEpoch()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const session = await createBrandChatSession(
        brandId,
        userId,
        quickSessionTitle(),
        undefined,
        resolveBusinessBrandKitId(
          brandId === activeBrandIdRef.current ? sessions : []
        )
      )
      const epochLive = shouldCommitCreatedSession(epoch, selectionEpochRef.current)

      if (brandId !== activeBrandIdRef.current) {
        // Cross-brand Quick: only select while this create is still the live action.
        if (!epochLive) return
        activeBrandIdRef.current = brandId
        setActiveBrandId(brandId)
        writeBrandSessions(brandId, [session])
        setAuthoritativeSession(session.id)
        syncUrlAndStorage(brandId, session.id)
        return
      }

      if (activeBrandIdRef.current !== brandId) return
      // Surface row even if Skip/pin made this create stale — never steal ?session=.
      patchBrandSessions(brandId, (prev) => [session, ...prev.filter((s) => s.id !== session.id)])
      if (!epochLive) return
      setAuthoritativeSession(session.id)
      syncUrlAndStorage(brandId, session.id)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to create Quick session')
    } finally {
      createLockRef.current = false
      setBusy(false)
    }
  }, [userId, businesses, busy, sessions, bumpSelectionEpoch, syncUrlAndStorage, setAuthoritativeSession])

  /**
   * O3: in-shell New brand — createBusiness + first session, stay on /chat.
   * Never navigates to /dashboard. Returns true on success.
   */
  const createBrand = useCallback(async (name: string): Promise<boolean> => {
    if (!userId) return false
    const validation = validateBrandCreateName(name)
    if (validation) {
      setError(validation)
      return false
    }
    if (createLockRef.current || busy) return false
    createLockRef.current = true
    const epoch = bumpSelectionEpoch()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const brand = await createBusiness(userId, buildMinimalBrandFormData(name))
      if (selectionEpochRef.current !== epoch) return false

      setBusinesses((prev) => [brand, ...prev.filter((b) => b.id !== brand.id)])
      setSessionCounts((prev) => ({ ...prev, [brand.id]: 0 }))

      preferredSessionRef.current = null
      authoritativeSessionRef.current = null
      activeBrandIdRef.current = brand.id
      setActiveBrandId(brand.id)

      const session = await createBrandChatSession(
        brand.id,
        userId,
        defaultSessionTitle()
      )
      if (selectionEpochRef.current !== epoch) return false

      writeBrandSessions(brand.id, [session])
      setSessionCounts((prev) => ({ ...prev, [brand.id]: 1 }))
      setAuthoritativeSession(session.id)
      syncUrlAndStorage(brand.id, session.id)
      setNotice(null)
      invalidateDashboardCache()
      return true
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to create brand')
      return false
    } finally {
      createLockRef.current = false
      setBusy(false)
    }
  }, [userId, busy, bumpSelectionEpoch, syncUrlAndStorage, setAuthoritativeSession])

  const patchActiveSession = useCallback((next: ChatSession) => {
    mapCachedSessions((s) => (s.id === next.id ? { ...s, ...next } : s))
  }, [mapCachedSessions])

  const patchBrand = useCallback((next: Business) => {
    setBusinesses((prev) => prev.map((row) => (row.id === next.id ? { ...row, ...next } : row)))
    invalidateDashboardCache()
  }, [])

  /**
   * Sidebar Delete (O1): hard deleteChatSession via 062 RLS.
   * Soft-archive is not used. deleteSessionMessages is not used as hygiene.
   * Optimistic list removal with rollback; fail-closed server delete unchanged.
   */
  const deleteSession = useCallback(async (sessionId: string) => {
    if (!sessionId || busy) return
    if (pendingDeletedRef.current.has(sessionId)) return

    const brandId = activeBrandIdRef.current
    const wasActive = activeSessionIdRef.current === sessionId
    const sessionsSnapshot = sessions
    const siblings = sessions.filter((s) => s.id !== sessionId)
    const prevCount = brandId != null ? sessionCounts[brandId] : undefined
    const prevPreview = firstUserPreviews[sessionId]
    const prevActiveId = activeSessionIdRef.current

    pendingDeletedRef.current.add(sessionId)
    bumpSelectionEpoch()
    setBusy(true)
    setError(null)

    // Optimistic remove — non-active deletes must not touch active session / URL.
    if (brandId) writeBrandSessions(brandId, siblings)
    setFirstUserPreviews((prev) => {
      if (!(sessionId in prev)) return prev
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
    if (brandId) {
      setSessionCounts((prev) => ({
        ...prev,
        [brandId]: Math.max(0, (prev[brandId] ?? siblings.length + 1) - 1),
      }))
    }
    if (wasActive) {
      // Switch main cleanly to a sibling (or null) — avoid blank crash on deleted active.
      const fallback = siblings[0] ?? null
      setAuthoritativeSession(fallback?.id ?? null)
      syncUrlAndStorage(brandId, fallback?.id ?? null)
    }

    try {
      await deleteChatSession(sessionId)
      setNotice(null)
      pendingDeletedRef.current.delete(sessionId)
    } catch (err) {
      console.error(err)
      pendingDeletedRef.current.delete(sessionId)
      if (brandId) writeBrandSessions(brandId, sessionsSnapshot)
      if (prevPreview !== undefined) {
        setFirstUserPreviews((prev) => ({ ...prev, [sessionId]: prevPreview }))
      }
      if (brandId != null && prevCount !== undefined) {
        setSessionCounts((prev) => ({ ...prev, [brandId]: prevCount }))
      }
      if (wasActive) {
        bumpSelectionEpoch()
        setAuthoritativeSession(prevActiveId)
        syncUrlAndStorage(brandId, prevActiveId)
      }
      setError(err instanceof Error ? err.message : 'Failed to delete session')
    } finally {
      setBusy(false)
    }
  }, [
    busy,
    sessions,
    sessionCounts,
    firstUserPreviews,
    bumpSelectionEpoch,
    setAuthoritativeSession,
    syncUrlAndStorage,
  ])

  const deleteBrand = useCallback(async (brandId: string) => {
    if (!brandId || busy) return
    if (pendingDeletedBrandRef.current.has(brandId)) return

    const businessesSnapshot = businesses
    const sessionsSnapshot = sessionsByBrand
    const countsSnapshot = sessionCounts
    const wasActive = activeBrandIdRef.current === brandId
    const remaining = businesses.filter((b) => b.id !== brandId)
    const fallback = remaining[0] ?? null
    const prevBrandId = activeBrandIdRef.current
    const prevSessionId = activeSessionIdRef.current

    pendingDeletedBrandRef.current.add(brandId)
    bumpSelectionEpoch()
    setBusy(true)
    setError(null)
    setBusinesses(remaining)
    setSessionCounts((prev) => {
      const next = { ...prev }
      delete next[brandId]
      return next
    })
    if (wasActive) {
      setSessionsByBrand((prev) => {
        const next = { ...prev }
        delete next[brandId]
        return next
      })
      activeBrandIdRef.current = fallback?.id ?? null
      setActiveBrandId(fallback?.id ?? null)
      setAuthoritativeSession(null)
      syncUrlAndStorage(fallback?.id ?? null, null)
    }

    try {
      await deleteBusinessWithContents(brandId)
      pendingDeletedBrandRef.current.delete(brandId)
      invalidateDashboardCache()
      setNotice(null)
    } catch (err) {
      console.error(err)
      pendingDeletedBrandRef.current.delete(brandId)
      try {
        await refreshBusinesses()
      } catch {
        setBusinesses(businessesSnapshot)
        setSessionsByBrand(sessionsSnapshot)
        setSessionCounts(countsSnapshot)
      }
      if (wasActive) {
        bumpSelectionEpoch()
        activeBrandIdRef.current = prevBrandId
        setActiveBrandId(prevBrandId)
        setAuthoritativeSession(prevSessionId)
        syncUrlAndStorage(prevBrandId, prevSessionId)
      }
      setError(err instanceof Error ? err.message : 'Failed to delete folder')
    } finally {
      setBusy(false)
    }
  }, [
    busy,
    businesses,
    sessions,
    sessionCounts,
    bumpSelectionEpoch,
    setAuthoritativeSession,
    syncUrlAndStorage,
    refreshBusinesses,
  ])

  const createImageEditSession = useCallback(async (options: {
    title: string
    productId: string
    productImageId: string
    userText: string
    assistantText: string
  }) => {
    if (!userId) return null
    const brandId = activeBrandIdRef.current
    if (!brandId) {
      setNotice('Pick a brand first to edit an image.')
      return null
    }
    if (createLockRef.current || busy) return null
    createLockRef.current = true
    const epoch = bumpSelectionEpoch()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const session = await createBrandChatSession(
        brandId,
        userId,
        options.title,
        undefined,
        resolveBusinessBrandKitId(sessions)
      )
      await replaceSessionOffers(session.id, brandId, [options.productId], userId)
      await addMessage(session.id, 'user', options.userText)
      const assistant = await addMessage(session.id, 'assistant', options.assistantText)
      await insertImageMessageArtifact({
        sessionId: session.id,
        messageId: assistant.id,
        productId: options.productId,
        productImageId: options.productImageId,
        ordinal: 1,
        userId,
        actionType: 'edit',
        metadata: { source: 'request_edit' },
      })
      if (activeBrandIdRef.current !== brandId) return session
      patchBrandSessions(brandId, (prev) => [session, ...prev.filter((s) => s.id !== session.id)])
      if (!shouldCommitCreatedSession(epoch, selectionEpochRef.current)) return session
      setAuthoritativeSession(session.id)
      syncUrlAndStorage(brandId, session.id)
      return session
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to open image edit chat')
      return null
    } finally {
      createLockRef.current = false
      setBusy(false)
    }
  }, [userId, busy, sessions, bumpSelectionEpoch, syncUrlAndStorage, setAuthoritativeSession])

  /** Touch-load single session meta if missing from list (URL deep link). */
  useEffect(() => {
    const cached = Object.values(sessionsByBrand).flat()
    if (!activeSessionId || cached.some((s) => s.id === activeSessionId)) return
    let cancelled = false
    const sid = activeSessionId
    const epoch = selectionEpochRef.current

    void (async () => {
      const row = await getChatSession(sid)
      if (cancelled) return
      if (activeSessionIdRef.current !== sid) return
      if (selectionEpochRef.current !== epoch) return
      if (!row) {
        preferredSessionRef.current = sid
        return
      }
      const rowBrandId = row.business_id
      if (rowBrandId && rowBrandId !== activeBrandIdRef.current) {
        authoritativeSessionRef.current = row.id
        preferredSessionRef.current = row.id
        activeBrandIdRef.current = rowBrandId
        setActiveBrandId(rowBrandId)
        commitSessionId(row.id)
        syncUrlAndStorage(rowBrandId, row.id)
        patchBrandSessions(rowBrandId, (prev) => (prev.some((s) => s.id === row.id) ? prev : [row, ...prev]))
        return
      }
      authoritativeSessionRef.current = row.id
      preferredSessionRef.current = row.id
      const brandId = rowBrandId || activeBrandIdRef.current
      if (brandId) {
        patchBrandSessions(brandId, (prev) => (prev.some((s) => s.id === row.id) ? prev : [row, ...prev]))
      }
      syncUrlAndStorage(activeBrandIdRef.current, row.id)
    })()
    return () => {
      cancelled = true
    }
  }, [activeSessionId, sessionsByBrand, commitSessionId, syncUrlAndStorage, patchBrandSessions])

  return {
    businesses,
    sessions,
    sessionsByBrand,
    pendingBrandId,
    loadingByBrand,
    sessionCounts,
    firstUserPreviews,
    activeBrand,
    activeBrandId,
    activeSession,
    activeSessionId,
    loadingBusinesses,
    loadingSessions,
    busy,
    error,
    notice,
    selectBrand,
    prefetchBrandSessions,
    selectSession,
    keepSessionSelected,
    createSession,
    createQuickSession,
    createBrand,
    deleteSession,
    deleteBrand,
    createImageEditSession,
    patchActiveSession,
    patchBrand,
    refreshBusinesses,
  }
}
