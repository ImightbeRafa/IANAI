import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getUsageLimits, type UsageLimitsRow } from '../services/database'

export interface UsageLimits extends UsageLimitsRow {
  loading: boolean
  refresh: () => void
}

const CACHE_TTL_MS = 60_000
let _cache: { data: UsageLimitsRow; userId: string; ts: number } | null = null

const DEFAULT_DATA: UsageLimitsRow = {
  plan: 'free',
  scriptsUsed: 0,
  scriptsLimit: 10,
  imagesUsed: 0,
  imagesLimit: 1,
  bonusImages: 0,
  descriptionsUsed: 0,
  descriptionsLimit: 10,
  repliesUsed: 0,
  repliesLimit: 10,
}

/**
 * Current user's usage and plan limits.
 * Cached 60s. Call refresh() after generate/enhance.
 * A limit of -1 means unlimited.
 */
export function useUsageLimits(): UsageLimits {
  const { user } = useAuth()

  const cachedForUser = _cache && user && _cache.userId === user.id && (Date.now() - _cache.ts < CACHE_TTL_MS)
  const [data, setData] = useState<UsageLimitsRow>(
    cachedForUser ? _cache!.data : DEFAULT_DATA
  )
  const [loading, setLoading] = useState(!cachedForUser)

  const doFetch = useCallback(async (force = false) => {
    if (!user) return
    if (!force && _cache && _cache.userId === user.id && (Date.now() - _cache.ts < CACHE_TTL_MS)) {
      setData(_cache.data)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await getUsageLimits(user.id)
      _cache = { data: result, userId: user.id, ts: Date.now() }
      setData(result)
    } catch {
      /* keep previous data */
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    void doFetch()
  }, [doFetch])

  const refresh = useCallback(() => {
    _cache = null
    void doFetch(true)
  }, [doFetch])

  return { ...data, loading, refresh }
}
