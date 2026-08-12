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

  /** One-shot preferred session for the next brand sessions load (hydrate / deep link / Quick). */
  const preferredSessionRef = useRef<string | null>(null)
  /** Latest committed selection — brand load must not clobber an explicit session click. */
  const activeSessionIdRef = useRef<string | null>(null)
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
      // Same brand: do not clear sessions / selection (avoids thrash + empty list stuck state).
      if (brandId === activeBrandId) return
      preferredSessionRef.current = null
      activeSessionIdRef.current = null
      setActiveBrandId(brandId)
      setActiveSessionId(null)
      setSessions([])
      setNotice(null)
      syncUrlAndStorage(brandId, null)
    },
    [activeBrandId, syncUrlAndStorage]
  )

  const selectSession = useCallback(
    (session: ChatSession) => {
      const brandId = session.business_id || activeBrandId
      // Explicit user selection — brand session loader must preserve this id.
      preferredSessionRef.current = session.id
      activeSessionIdRef.current = session.id
      setActiveSessionId(session.id)
      setNotice(null)
      // Only change brand when the session belongs to a different brand (no same-brand reload).
      if (brandId && brandId !== activeBrandId) {
        setActiveBrandId(brandId)
      }
      syncUrlAndStorage(brandId, session.id)
    },
    [activeBrandId, syncUrlAndStorage]
  )

  const refreshBusinesses = useCallback(async () => {
    if (!userId) {
      setBusinesses([])
      setLoadingBusinesses(false)
      return
    }
    // Hydrate once per user — avoid re-running selection resets on incidental deps.
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

      preferredSessionRef.current = brandStillValid ? initial.sessionId : null
      setActiveBrandId(nextBrandId)
      commitSessionId(null)
      if (nextBrandId) {
        syncUrlAndStorage(nextBrandId, brandStillValid ? initial.sessionId : null)
      } else {
        syncUrlAndStorage(null, null)
      }
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
    const preferred = preferredSessionRef.current
    // Do not clear preferred here if it matches an in-flight user click for this brand —
    // consume after successful resolve so rapid clicks still win.
    const requestId = ++sessionsRequestIdRef.current

    let cancelled = false
    setLoadingSessions(true)
    setError(null)

    void (async () => {
      try {
        const list = await getBusinessChatSessions(brandId)
        if (cancelled || requestId !== sessionsRequestIdRef.current) return
        setSessions(list)

        const nextSessionId = resolveNextSessionId({
          sessionIds: list.map((s) => s.id),
          preferredId: preferred,
          currentId: activeSessionIdRef.current,
        })

        if (preferred && preferred === nextSessionId) {
          preferredSessionRef.current = null
        }
        commitSessionId(nextSessionId)
        syncUrlAndStorage(brandId, nextSessionId)
      } catch (err) {
        if (cancelled || requestId !== sessionsRequestIdRef.current) return
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
  // Intentionally only brandId — syncUrlAndStorage identity must not re-fetch / clobber selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBrandId])

  const createSession = useCallback(async (title?: string) => {
    if (!userId) return
    if (!activeBrandId) {
      setNotice('Pick a brand first to create a session (Quick has no product, but needs a brand).')
      return
    }
    if (createLockRef.current || busy) return
    createLockRef.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const session = await createBrandChatSession(
        activeBrandId,
        userId,
        title || defaultSessionTitle()
      )
      preferredSessionRef.current = session.id
      setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)])
      commitSessionId(session.id)
      syncUrlAndStorage(activeBrandId, session.id)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      createLockRef.current = false
      setBusy(false)
    }
  }, [userId, activeBrandId, busy, syncUrlAndStorage, commitSessionId])

  const createQuickSession = useCallback(async () => {
    if (!userId) return
    const brandId = activeBrandId || businesses[0]?.id || null
    if (!brandId) {
      setNotice(
        'Create or select a brand before Quick generate. “No brand” means no product — business_id is still required.'
      )
      return
    }
    if (createLockRef.current || busy) return
    createLockRef.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const session = await createBrandChatSession(brandId, userId, quickSessionTitle())
      preferredSessionRef.current = session.id
      if (brandId !== activeBrandId) {
        setActiveBrandId(brandId)
      } else {
        setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)])
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
  }, [userId, activeBrandId, businesses, busy, syncUrlAndStorage, commitSessionId])

  const patchActiveSession = useCallback((next: ChatSession) => {
    setSessions((prev) => prev.map((s) => (s.id === next.id ? { ...s, ...next } : s)))
  }, [])

  /** Touch-load single session meta if missing from list (URL deep link). */
  useEffect(() => {
    if (!activeSessionId || sessions.some((s) => s.id === activeSessionId)) return
    let cancelled = false
    const sid = activeSessionId
    void (async () => {
      const row = await getChatSession(sid)
      if (cancelled || !row) return
      if (activeSessionIdRef.current !== sid) return
      if (row.business_id && row.business_id !== activeBrandId) {
        preferredSessionRef.current = row.id
        setActiveBrandId(row.business_id)
        return
      }
      setSessions((prev) => (prev.some((s) => s.id === row.id) ? prev : [row, ...prev]))
    })()
    return () => {
      cancelled = true
    }
  }, [activeSessionId, sessions, activeBrandId])

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
