import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  createBrandChatSession,
  countBusinessChatSessions,
  createBusiness,
  deleteChatSession,
  getBusinessChatSessions,
  getBusinesses,
  getChatSession,
  getFirstUserMessagePreviews,
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
import { resolveNextSessionId } from './sessionOffer'

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

export function useChatShellWorkspace(userId: string | undefined) {
  const [, setSearchParams] = useSearchParams()
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [loadingBusinesses, setLoadingBusinesses] = useState(true)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({})
  const [firstUserPreviews, setFirstUserPreviews] = useState<Record<string, string>>({})

  /** Hydrate / Quick hint — never trusted over a newer user click. */
  const preferredSessionRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const activeBrandIdRef = useRef<string | null>(null)
  /** Bumped on every user-driven selection/create so stale fetches cannot overwrite. */
  const selectionEpochRef = useRef(0)
  const sessionsRequestIdRef = useRef(0)
  const businessesRequestIdRef = useRef(0)
  const createLockRef = useRef(false)
  /** Tombstones for optimistic deletes — prevent stale list fetch from restoring rows. */
  const pendingDeletedRef = useRef<Set<string>>(new Set())
  /** True after initial selection hydrate for the current user (list refresh still works). */
  const didHydrateSelectionRef = useRef(false)
  const hydratedUserIdRef = useRef<string | null>(null)

  const activeBrand = useMemo(
    () => businesses.find((b) => b.id === activeBrandId) ?? null,
    [businesses, activeBrandId]
  )
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  )

  const commitSessionId = useCallback((sessionId: string | null) => {
    activeSessionIdRef.current = sessionId
    setActiveSessionId(sessionId)
  }, [])

  const bumpSelectionEpoch = useCallback(() => {
    selectionEpochRef.current += 1
    return selectionEpochRef.current
  }, [])

  const syncUrlAndStorage = useCallback(
    (brandId: string | null, sessionId: string | null) => {
      persistSelection({ brandId, sessionId })
      const nextSelection = { brandId, sessionId }
      if (selectionsEqual(readUrlSelection(), nextSelection)) return
      setSearchParams(selectionToSearchParams(nextSelection), { replace: true })
    },
    [setSearchParams]
  )

  const selectBrand = useCallback(
    (brandId: string) => {
      if (brandId === activeBrandIdRef.current) return
      bumpSelectionEpoch()
      preferredSessionRef.current = null
      activeBrandIdRef.current = brandId
      setActiveBrandId(brandId)
      commitSessionId(null)
      // Keep prior sessions visible until the new brand list arrives (no layout thrash).
      setNotice(null)
      syncUrlAndStorage(brandId, null)
    },
    [bumpSelectionEpoch, commitSessionId, syncUrlAndStorage]
  )

  const selectSession = useCallback(
    (session: ChatSession) => {
      const brandId = session.business_id || activeBrandIdRef.current
      bumpSelectionEpoch()
      preferredSessionRef.current = session.id
      commitSessionId(session.id)
      setNotice(null)
      if (brandId && brandId !== activeBrandIdRef.current) {
        activeBrandIdRef.current = brandId
        setActiveBrandId(brandId)
      }
      syncUrlAndStorage(brandId, session.id)
    },
    [bumpSelectionEpoch, commitSessionId, syncUrlAndStorage]
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
      setBusinesses(list)

      void Promise.all(
        list.map(async (brand) => {
          try {
            const count = await countBusinessChatSessions(brand.id)
            if (requestId !== businessesRequestIdRef.current) return
            setSessionCounts((prev) => (
              prev[brand.id] === count ? prev : { ...prev, [brand.id]: count }
            ))
          } catch {
            /* counts are best-effort for collapsed labels */
          }
        })
      )

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
      const brandStillValid = Boolean(
        initial.brandId && list.some((b) => b.id === initial.brandId)
      )
      // Brand may be provisional when only ?session= is authoritative; never drop
      // the URL/stored session id just because brand is missing or not in list yet.
      const nextBrandId = brandStillValid
        ? initial.brandId
        : (list[0]?.id ?? null)
      const nextSessionId = initial.sessionId

      if (selectionEpochRef.current !== epochAtStart) {
        didHydrateSelectionRef.current = true
        return
      }

      preferredSessionRef.current = nextSessionId
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
    if (!activeBrandId) {
      setSessions([])
      setLoadingSessions(false)
      return
    }

    const brandId = activeBrandId
    const requestId = ++sessionsRequestIdRef.current
    const epochAtStart = selectionEpochRef.current

    let cancelled = false
    setLoadingSessions(true)
    setError(null)

    void (async () => {
      try {
        const list = (await getBusinessChatSessions(brandId)).filter(
          (s) => !pendingDeletedRef.current.has(s.id)
        )
        if (cancelled || requestId !== sessionsRequestIdRef.current) return
        if (activeBrandIdRef.current !== brandId) return

        const epochStale = selectionEpochRef.current !== epochAtStart
        const currentId = activeSessionIdRef.current

        // Always refresh the list, but never drop an optimistic row for the
        // live selection (create can race ahead of the server list).
        setSessions((prev) => {
          const optimistic =
            currentId &&
            !pendingDeletedRef.current.has(currentId) &&
            !list.some((s) => s.id === currentId)
              ? prev.filter((s) => s.id === currentId)
              : []
          const next = optimistic.length === 0 ? list : [...optimistic, ...list]
          return next.filter((s) => !pendingDeletedRef.current.has(s.id))
        })
        setSessionCounts((prev) => ({ ...prev, [brandId]: list.length }))

        void getFirstUserMessagePreviews(list.map((s) => s.id))
          .then((previews) => {
            if (cancelled || requestId !== sessionsRequestIdRef.current) return
            if (activeBrandIdRef.current !== brandId) return
            setFirstUserPreviews((prev) => ({ ...prev, ...previews }))
          })
          .catch(() => { /* title fallbacks still work */ })

        // A newer click/create happened while this fetch was in flight — keep list only.
        if (epochStale) {
          return
        }

        // Read selection at completion time (never use stale start-of-request preferred).
        // urlId / preferred beat brand-newest — never rewrite deep-link away.
        const urlId = readUrlSessionId()
        const preferredId = preferredSessionRef.current
        const nextSessionId = resolveNextSessionId({
          sessionIds: list.map((s) => s.id),
          currentId:
            currentId && pendingDeletedRef.current.has(currentId) ? null : currentId,
          urlId,
          preferredId,
        })

        if (selectionEpochRef.current !== epochAtStart) return

        // Keep preferred until the row is actually in the list (reload / deep-link race).
        if (
          preferredSessionRef.current &&
          preferredSessionRef.current === nextSessionId &&
          list.some((s) => s.id === nextSessionId)
        ) {
          preferredSessionRef.current = null
        }
        // Avoid redundant URL/storage writes that can thrash downstream effects.
        if (nextSessionId !== activeSessionIdRef.current) {
          commitSessionId(nextSessionId)
        }
        // Never let list hydrate clear an authoritative url/preferred session to null.
        const sessionForUrl =
          nextSessionId
          ?? (urlId || preferredId || activeSessionIdRef.current)
        syncUrlAndStorage(brandId, sessionForUrl)
      } catch (err) {
        if (cancelled || requestId !== sessionsRequestIdRef.current) return
        if (selectionEpochRef.current !== epochAtStart) return
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load sessions')
        // Preserve active session + URL on list fetch failure — do not rewrite to null/newest.
        setSessions((prev) => {
          const keepId = activeSessionIdRef.current
          if (!keepId) return []
          return prev.filter((s) => s.id === keepId)
        })
      } finally {
        if (!cancelled && requestId === sessionsRequestIdRef.current) {
          setLoadingSessions(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBrandId])

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
        title || defaultSessionTitle()
      )
      // Never mutate another brand's list (contamination). Same-brand can surface the row.
      if (activeBrandIdRef.current !== brandId) return
      setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)])
      if (selectionEpochRef.current !== epoch) return
      preferredSessionRef.current = session.id
      commitSessionId(session.id)
      syncUrlAndStorage(brandId, session.id)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      createLockRef.current = false
      setBusy(false)
    }
  }, [userId, busy, bumpSelectionEpoch, syncUrlAndStorage, commitSessionId])

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
      const session = await createBrandChatSession(brandId, userId, quickSessionTitle())
      if (selectionEpochRef.current !== epoch) return

      if (brandId !== activeBrandIdRef.current) {
        // Cross-brand Quick: seed only while this create is still the live action.
        preferredSessionRef.current = session.id
        activeBrandIdRef.current = brandId
        setActiveBrandId(brandId)
        setSessions([session])
        commitSessionId(session.id)
        syncUrlAndStorage(brandId, session.id)
        return
      }

      if (activeBrandIdRef.current !== brandId) return
      setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)])
      preferredSessionRef.current = session.id
      commitSessionId(session.id)
      syncUrlAndStorage(brandId, session.id)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to create Quick session')
    } finally {
      createLockRef.current = false
      setBusy(false)
    }
  }, [userId, businesses, busy, bumpSelectionEpoch, syncUrlAndStorage, commitSessionId])

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
      activeBrandIdRef.current = brand.id
      setActiveBrandId(brand.id)

      const session = await createBrandChatSession(
        brand.id,
        userId,
        defaultSessionTitle()
      )
      if (selectionEpochRef.current !== epoch) return false

      preferredSessionRef.current = session.id
      setSessions([session])
      setSessionCounts((prev) => ({ ...prev, [brand.id]: 1 }))
      commitSessionId(session.id)
      syncUrlAndStorage(brand.id, session.id)
      setNotice(null)
      return true
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to create brand')
      return false
    } finally {
      createLockRef.current = false
      setBusy(false)
    }
  }, [userId, busy, bumpSelectionEpoch, syncUrlAndStorage, commitSessionId])

  const patchActiveSession = useCallback((next: ChatSession) => {
    setSessions((prev) => prev.map((s) => (s.id === next.id ? { ...s, ...next } : s)))
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
    setSessions(siblings)
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
      preferredSessionRef.current = fallback?.id ?? null
      commitSessionId(fallback?.id ?? null)
      syncUrlAndStorage(brandId, fallback?.id ?? null)
    }

    try {
      await deleteChatSession(sessionId)
      setNotice(null)
      pendingDeletedRef.current.delete(sessionId)
    } catch (err) {
      console.error(err)
      pendingDeletedRef.current.delete(sessionId)
      setSessions(sessionsSnapshot)
      if (prevPreview !== undefined) {
        setFirstUserPreviews((prev) => ({ ...prev, [sessionId]: prevPreview }))
      }
      if (brandId != null && prevCount !== undefined) {
        setSessionCounts((prev) => ({ ...prev, [brandId]: prevCount }))
      }
      if (wasActive) {
        preferredSessionRef.current = sessionId
        bumpSelectionEpoch()
        commitSessionId(prevActiveId)
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
    commitSessionId,
    syncUrlAndStorage,
  ])

  /** Touch-load single session meta if missing from list (URL deep link). */
  useEffect(() => {
    if (!activeSessionId || sessions.some((s) => s.id === activeSessionId)) return
    let cancelled = false
    const sid = activeSessionId
    const epoch = selectionEpochRef.current
    const urlIdAtStart = readUrlSessionId()
    const preferredAtStart = preferredSessionRef.current
    /** Authoritative deep-link / preferred — never mint or fall back while set. */
    const authoritative =
      sid === urlIdAtStart || sid === preferredAtStart || Boolean(urlIdAtStart && urlIdAtStart === sid)

    void (async () => {
      const row = await getChatSession(sid)
      if (cancelled) return
      if (activeSessionIdRef.current !== sid) return
      if (selectionEpochRef.current !== epoch) return
      if (!row) {
        // Transient miss or deleted: while URL/preferred still points here, keep the id
        // (do not rewrite to brand-newest and never create a replacement session).
        if (authoritative || readUrlSessionId() === sid || preferredSessionRef.current === sid) {
          preferredSessionRef.current = sid
          return
        }
        preferredSessionRef.current = null
        const brandId = activeBrandIdRef.current
        const fallback =
          sessions.find((s) => s.id !== sid && (!s.business_id || s.business_id === brandId))?.id ??
          null
        commitSessionId(fallback)
        syncUrlAndStorage(brandId, fallback)
        return
      }
      if (row.business_id && row.business_id !== activeBrandIdRef.current) {
        preferredSessionRef.current = row.id
        activeBrandIdRef.current = row.business_id
        setActiveBrandId(row.business_id)
        commitSessionId(row.id)
        syncUrlAndStorage(row.business_id, row.id)
        setSessions((prev) => (prev.some((s) => s.id === row.id) ? prev : [row, ...prev]))
        return
      }
      preferredSessionRef.current = row.id
      setSessions((prev) => (prev.some((s) => s.id === row.id) ? prev : [row, ...prev]))
      syncUrlAndStorage(activeBrandIdRef.current, row.id)
    })()
    return () => {
      cancelled = true
    }
  }, [activeSessionId, sessions, commitSessionId, syncUrlAndStorage])

  return {
    businesses,
    sessions,
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
    selectSession,
    createSession,
    createQuickSession,
    createBrand,
    deleteSession,
    patchActiveSession,
    refreshBusinesses,
  }
}
