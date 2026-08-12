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

  /** One-shot preferred session for the next brand sessions load (hydrate / deep link). */
  const preferredSessionRef = useRef<string | null>(null)
  const sessionsRequestIdRef = useRef(0)

  const activeBrand = useMemo(
    () => businesses.find((b) => b.id === activeBrandId) ?? null,
    [businesses, activeBrandId]
  )
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  )

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
      preferredSessionRef.current = null
      setActiveBrandId(brandId)
      setActiveSessionId(null)
      setSessions([])
      setNotice(null)
      syncUrlAndStorage(brandId, null)
    },
    [syncUrlAndStorage]
  )

  const selectSession = useCallback(
    (session: ChatSession) => {
      const brandId = session.business_id || activeBrandId
      if (brandId) setActiveBrandId(brandId)
      setActiveSessionId(session.id)
      setNotice(null)
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
      setActiveSessionId(null)
      if (nextBrandId) {
        syncUrlAndStorage(nextBrandId, brandStillValid ? initial.sessionId : null)
      } else {
        syncUrlAndStorage(null, null)
      }
    } catch (err) {
      console.error(err)
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
    preferredSessionRef.current = null
    const requestId = ++sessionsRequestIdRef.current

    let cancelled = false
    setLoadingSessions(true)
    setError(null)

    void (async () => {
      try {
        const list = await getBusinessChatSessions(brandId)
        if (cancelled || requestId !== sessionsRequestIdRef.current) return
        setSessions(list)
        const stillThere = preferred && list.some((s) => s.id === preferred)
        const nextSessionId = stillThere ? preferred : (list[0]?.id ?? null)
        setActiveSessionId(nextSessionId)
        syncUrlAndStorage(brandId, nextSessionId)
      } catch (err) {
        if (cancelled || requestId !== sessionsRequestIdRef.current) return
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load sessions')
        setSessions([])
        setActiveSessionId(null)
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
  }, [activeBrandId, syncUrlAndStorage])

  const createSession = useCallback(async (title?: string) => {
    if (!userId) return
    if (!activeBrandId) {
      setNotice('Pick a brand first to create a session (Quick has no product, but needs a brand).')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const session = await createBrandChatSession(
        activeBrandId,
        userId,
        title || defaultSessionTitle()
      )
      setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)])
      setActiveSessionId(session.id)
      syncUrlAndStorage(activeBrandId, session.id)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setBusy(false)
    }
  }, [userId, activeBrandId, syncUrlAndStorage])

  const createQuickSession = useCallback(async () => {
    if (!userId) return
    const brandId = activeBrandId || businesses[0]?.id || null
    if (!brandId) {
      setNotice(
        'Create or select a brand before Quick generate. “No brand” means no product — business_id is still required.'
      )
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const session = await createBrandChatSession(brandId, userId, quickSessionTitle())
      if (brandId !== activeBrandId) {
        preferredSessionRef.current = session.id
        setActiveBrandId(brandId)
      } else {
        const list = await getBusinessChatSessions(brandId)
        setSessions(list)
        setActiveSessionId(session.id)
        syncUrlAndStorage(brandId, session.id)
      }
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to create Quick session')
    } finally {
      setBusy(false)
    }
  }, [userId, activeBrandId, businesses, syncUrlAndStorage])

  /** Touch-load single session meta if missing from list (URL deep link). */
  useEffect(() => {
    if (!activeSessionId || sessions.some((s) => s.id === activeSessionId)) return
    let cancelled = false
    void (async () => {
      const row = await getChatSession(activeSessionId)
      if (cancelled || !row) return
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
    refreshBusinesses,
  }
}
