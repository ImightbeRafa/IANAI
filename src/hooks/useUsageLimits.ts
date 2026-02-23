import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export interface UsageLimits {
  plan: string
  scriptsUsed: number
  scriptsLimit: number
  imagesUsed: number
  imagesLimit: number
  bonusImages: number
  descriptionsUsed: number
  descriptionsLimit: number
  loading: boolean
  refresh: () => void
}

// Module-level cache to avoid re-fetching on every page navigation
const CACHE_TTL_MS = 60_000 // 60 seconds
let _cache: { data: Omit<UsageLimits, 'loading' | 'refresh'>; userId: string; ts: number } | null = null

const DEFAULT_DATA: Omit<UsageLimits, 'loading' | 'refresh'> = {
  plan: 'free',
  scriptsUsed: 0,
  scriptsLimit: 10,
  imagesUsed: 0,
  imagesLimit: 1,
  bonusImages: 0,
  descriptionsUsed: 0,
  descriptionsLimit: 10,
}

async function fetchUsageData(userId: string): Promise<Omit<UsageLimits, 'loading' | 'refresh'>> {
  // Try single RPC call first (migration 041)
  try {
    const { data, error } = await supabase.rpc('get_usage_limits', { p_user_id: userId })
    if (!error && data) {
      return {
        plan: data.plan || 'free',
        scriptsUsed: data.scriptsUsed || 0,
        scriptsLimit: data.scriptsLimit ?? 10,
        imagesUsed: data.imagesUsed || 0,
        imagesLimit: data.imagesLimit ?? 1,
        bonusImages: data.bonusImages || 0,
        descriptionsUsed: data.descriptionsUsed || 0,
        descriptionsLimit: data.descriptionsLimit ?? 10,
      }
    }
  } catch {
    // RPC not available yet — fall back to multi-query
  }

  // Fallback: multiple queries (pre-migration 041)
  const currentMonth = new Date().toISOString().slice(0, 7) + '-01'

  const [subRes, usageRes, profileRes] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('plan, status')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing'])
      .maybeSingle(),
    supabase
      .from('usage')
      .select('scripts_generated, images_generated, descriptions_generated, enhances_generated')
      .eq('user_id', userId)
      .eq('period_start', currentMonth)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('bonus_images')
      .eq('id', userId)
      .maybeSingle(),
  ])

  const plan = subRes.data?.plan || 'free'

  const { data: limits } = await supabase
    .from('plan_limits')
    .select('scripts_per_month, images_per_month, descriptions_per_month')
    .eq('plan', plan)
    .maybeSingle()

  const usage = usageRes.data
  const bonus = profileRes.data?.bonus_images || 0
  const baseImageLimit = limits?.images_per_month ?? 1

  return {
    plan,
    scriptsUsed: usage?.scripts_generated || 0,
    scriptsLimit: limits?.scripts_per_month ?? 10,
    imagesUsed: (usage?.images_generated || 0) + Math.floor((usage?.enhances_generated || 0) / 2),
    imagesLimit: baseImageLimit === -1 ? -1 : baseImageLimit + bonus,
    bonusImages: bonus,
    descriptionsUsed: usage?.descriptions_generated || 0,
    descriptionsLimit: limits?.descriptions_per_month ?? 10,
  }
}

/**
 * Hook to fetch current user's usage and plan limits.
 * Results are cached for 60s to avoid redundant Supabase queries on page navigation.
 * Call refresh() after actions that change usage (generate, enhance).
 * A limit of -1 means unlimited.
 */
export function useUsageLimits(): UsageLimits {
  const { user } = useAuth()

  // Seed state from cache if available for this user
  const cachedForUser = _cache && user && _cache.userId === user.id && (Date.now() - _cache.ts < CACHE_TTL_MS)
  const [data, setData] = useState<Omit<UsageLimits, 'loading' | 'refresh'>>(
    cachedForUser ? _cache!.data : DEFAULT_DATA
  )
  const [loading, setLoading] = useState(!cachedForUser)

  const doFetch = useCallback(async (force = false) => {
    if (!user) return
    // Skip if cache is fresh (unless forced)
    if (!force && _cache && _cache.userId === user.id && (Date.now() - _cache.ts < CACHE_TTL_MS)) {
      setData(_cache.data)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await fetchUsageData(user.id)
      _cache = { data: result, userId: user.id, ts: Date.now() }
      setData(result)
    } catch {
      // keep previous data
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    doFetch()
  }, [doFetch])

  const refresh = useCallback(() => {
    _cache = null
    doFetch(true)
  }, [doFetch])

  return { ...data, loading, refresh }
}
