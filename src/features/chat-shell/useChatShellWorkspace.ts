import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  createBrandChatSession,
  getBusinessChatSessions,
  getBusinesses,
  getChatSession,
} from '../../services/database'
import type { Business, ChatSession } from '../../types'
import {
  persistSelection,
  readStoredSelection,
  resolveInitialSelection,
  selectionFromSearchParams,
  selectionToSearchParams,
} from './chatShellPersistence'
import { resolveNextSessionId } from './sessionOffer'

function defaultSessionTitle(): string {
  return `Session · ${new Date().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

function quickSessionTitle(): string {
  return `Quick · ${new Date().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

function readUrlSessionId(): string | null {
  try {
    return selectionFromSearchParams(new URLSearchParams(window.location.search)).sessionId
  } catch {
    return null
  }
}

export function useChatShellWorkspace(userId: string | undefined) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [loadingBusinesses, setLoadingBusinesses] = useState(true)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** Hydrate / Quick hint — never trusted over a newer user click. */
  const preferredSessionRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const activeBrandIdRef = useRef<string | null>(null)
  /** Bumped on every user-driven selection/create so stale fetches cannot overwrite. */
  const selectionEpochRef = useRef(0)
  const sessionsRequestIdRef = useRef(0)
  const createLockRef = useRef(false)
  const hydratedUserRef = useRef<string | null>(null)

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
      const next = selectionToSearchParams({ brandId, sessionId })
      setSearchParams(next, { replace: true })
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
      return
    }
    if (hydratedUserRef.current === userId) return
    hydratedUserRef.current = userId

    setLoadingBusinesses(true)
    setError(null)
    try {
      const list = await getBusinesses(userId)
      setBusinesses(list)

      const initial = resolveInitialSelection(
        selectionFromSearchParams(searchParams),
        readStoredSelection()
      )
      const brandStillValid = Boolean(
        initial.brandId && list.some((b) => b.id === initial.brandId)
      )
      const nextBrandId = brandStillValid
        ? initial.brandId
        : (list[0]?.id ?? null)
      const nextSessionId = brandStillValid ? initial.sessionId : null

      preferredSessionRef.current = nextSessionId
      activeBrandIdRef.current = nextBrandId
      setActiveBrandId(nextBrandId)
      // Commit hydrate session immediately — do not clear to null (race window).
      commitSessionId(nextSessionId)
      syncUrlAndStorage(nextBrandId, nextSessionId)
    } catch (err) {
      console.error(err)
      hydratedUserRef.current = null
      setError(err instanceof Error ? err.message : 'Failed to load brands')
    } finally {
      setLoadingBusinesses(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once per user
  }, [userId])

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
        const list = await getBusinessChatSessions(brandId)
        if (cancelled || requestId !== sessionsRequestIdRef.current) return
        if (activeBrandIdRef.current !== brandId) return

        const epochStale = selectionEpochRef.current !== epochAtStart
        const currentId = activeSessionIdRef.current

        // Always refresh the list, but never drop an optimistic row for the
        // live selection (create can race ahead of the server list).
        setSessions((prev) => {
          const optimistic =
            currentId && !list.some((s) => s.id === currentId)
              ? prev.filter((s) => s.id === currentId)
              : []
          return optimistic.length === 0 ? list : [...optimistic, ...list]
        })

        // A newer click/create happened while this fetch was in flight — keep list only.
        if (epochStale) {
          return
        }

        // Read selection at completion time (never use stale start-of-request preferred).
        const nextSessionId = resolveNextSessionId({
          sessionIds: list.map((s) => s.id),
          currentId,
          urlId: readUrlSessionId(),
          preferredId: preferredSessionRef.current,
        })

        if (selectionEpochRef.current !== epochAtStart) return

        if (preferredSessionRef.current && preferredSessionRef.current === nextSessionId) {
          preferredSessionRef.current = null
        }
        // Avoid redundant URL/storage writes that can thrash downstream effects.
        if (nextSessionId !== activeSessionIdRef.current) {
          commitSessionId(nextSessionId)
        }
        syncUrlAndStorage(brandId, nextSessionId)
      } catch (err) {
        if (cancelled || requestId !== sessionsRequestIdRef.current) return
        if (selectionEpochRef.current !== epochAtStart) return
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load sessions')
        setSessions([])
        commitSessionId(null)
        syncUrlAndStorage(brandId, null)
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
      // Always surface the created row; only skip selecting it if the user moved on.
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
      if (brandId === activeBrandIdRef.current) {
        setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)])
      }
      if (selectionEpochRef.current !== epoch) return
      preferredSessionRef.current = session.id
      if (brandId !== activeBrandIdRef.current) {
        activeBrandIdRef.current = brandId
        setActiveBrandId(brandId)
        // Brand effect will load list; preferred + epoch keep this session.
        commitSessionId(session.id)
        syncUrlAndStorage(brandId, session.id)
      } else {
        commitSessionId(session.id)
        syncUrlAndStorage(brandId, session.id)
      }
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to create Quick session')
    } finally {
      createLockRef.current = false
      setBusy(false)
    }
  }, [userId, businesses, busy, bumpSelectionEpoch, syncUrlAndStorage, commitSessionId])

  const patchActiveSession = useCallback((next: ChatSession) => {
    setSessions((prev) => prev.map((s) => (s.id === next.id ? { ...s, ...next } : s)))
  }, [])

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
        // Invalid deep link / deleted session — fall back to another row on this brand.
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
        return
      }
      setSessions((prev) => (prev.some((s) => s.id === row.id) ? prev : [row, ...prev]))
    })()
    return () => {
      cancelled = true
    }
  }, [activeSessionId, sessions, commitSessionId, syncUrlAndStorage])

  return {
    businesses,
    sessions,
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
    patchActiveSession,
    refreshBusinesses,
  }
}
