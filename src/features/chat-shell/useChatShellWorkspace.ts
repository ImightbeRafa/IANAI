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
import { resolveNextSessionId, shouldCommitCreatedSession } from './sessionOffer'

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
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeBrandId, setActiveBrandId] = useState<string | null>(() => boot.brandId)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => boot.sessionId)
  const [loadingBusinesses, setLoadingBusinesses] = useState(true)
  const [loadingSessions, setLoadingSessions] = useState(false)
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
      // Never let hydrate/sync rewrite away from authoritative deep-link / Skip pin.
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
      if (brandId === activeBrandIdRef.current) return
      bumpSelectionEpoch()
      preferredSessionRef.current = null
      authoritativeSessionRef.current = null
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

        // Read selection at completion time — authoritative deep-link / Skip pin
        // beats mutable window.location (which syncUrl may have raced).
        const authId = authoritativeSessionRef.current
        const urlId = readUrlSessionId() || authId
        const preferredId = preferredSessionRef.current || authId
        const nextSessionId = resolveNextSessionId({
          sessionIds: list.map((s) => s.id),
          currentId:
            currentId && pendingDeletedRef.current.has(currentId) ? null : currentId,
          urlId,
          preferredId,
        })

        if (selectionEpochRef.current !== epochAtStart) return

        // Stick to authoritative / url / preferred — never brand-newest rewrite.
        const pinned =
          authId
          || urlId
          || preferredId
          || (currentId && !pendingDeletedRef.current.has(currentId) ? currentId : null)
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
      // Always surface the created row in the list…
      setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)])
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
  }, [userId, busy, bumpSelectionEpoch, syncUrlAndStorage, setAuthoritativeSession])

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
      const epochLive = shouldCommitCreatedSession(epoch, selectionEpochRef.current)

      if (brandId !== activeBrandIdRef.current) {
        // Cross-brand Quick: only select while this create is still the live action.
        if (!epochLive) return
        activeBrandIdRef.current = brandId
        setActiveBrandId(brandId)
        setSessions([session])
        setAuthoritativeSession(session.id)
        syncUrlAndStorage(brandId, session.id)
        return
      }

      if (activeBrandIdRef.current !== brandId) return
      // Surface row even if Skip/pin made this create stale — never steal ?session=.
      setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)])
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
  }, [userId, businesses, busy, bumpSelectionEpoch, syncUrlAndStorage, setAuthoritativeSession])

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

      setSessions([session])
      setSessionCounts((prev) => ({ ...prev, [brand.id]: 1 }))
      setAuthoritativeSession(session.id)
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
  }, [userId, busy, bumpSelectionEpoch, syncUrlAndStorage, setAuthoritativeSession])

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
      setSessions(sessionsSnapshot)
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

  /** Touch-load single session meta if missing from list (URL deep link). */
  useEffect(() => {
    if (!activeSessionId || sessions.some((s) => s.id === activeSessionId)) return
    let cancelled = false
    const sid = activeSessionId
    const epoch = selectionEpochRef.current

    void (async () => {
      const row = await getChatSession(sid)
      if (cancelled) return
      if (activeSessionIdRef.current !== sid) return
      if (selectionEpochRef.current !== epoch) return
      if (!row) {
        // Transient miss or deleted: keep the id — never rewrite to a sibling
        // (A→B snap). Explicit deleteSession owns fallback selection.
        preferredSessionRef.current = sid
        return
      }
      if (row.business_id && row.business_id !== activeBrandIdRef.current) {
        authoritativeSessionRef.current = row.id
        preferredSessionRef.current = row.id
        activeBrandIdRef.current = row.business_id
        setActiveBrandId(row.business_id)
        commitSessionId(row.id)
        syncUrlAndStorage(row.business_id, row.id)
        setSessions((prev) => (prev.some((s) => s.id === row.id) ? prev : [row, ...prev]))
        return
      }
      authoritativeSessionRef.current = row.id
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
    keepSessionSelected,
    createSession,
    createQuickSession,
    createBrand,
    deleteSession,
    patchActiveSession,
    refreshBusinesses,
  }
}
