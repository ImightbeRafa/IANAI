import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  getProfile,
  getSharedProducts,
  getBusinesses,
  getUnassignedProducts,
  acceptPendingInvites
} from '../services/database'
import type { Product, Business, Profile } from '../types'

export interface DashboardData {
  profile: Profile | null
  sharedProducts: (Product & { shared_role: string; shared_by_email: string })[]
  businesses: Business[]
  products: Product[]
  loading: boolean
  refresh: () => void
}

// Module-level cache — shared across all dashboard pages
const CACHE_TTL_MS = 60_000 // 60 seconds
interface CacheEntry {
  profile: Profile | null
  sharedProducts: (Product & { shared_role: string; shared_by_email: string })[]
  businesses: Business[]
  products: Product[]
  userId: string
  ts: number
}
let _cache: CacheEntry | null = null

async function fetchDashboardData(userId: string): Promise<Omit<CacheEntry, 'userId' | 'ts'>> {
  const [profileData, shared, bizData, productsData] = await Promise.all([
    getProfile(userId),
    getSharedProducts(userId),
    getBusinesses(userId),
    getUnassignedProducts(userId)
  ])

  // Auto-accept pending invites (fire-and-forget)
  if (profileData?.email) {
    acceptPendingInvites(userId, profileData.email).catch(() => {})
  }

  return {
    profile: profileData,
    sharedProducts: shared,
    businesses: bizData,
    products: productsData,
  }
}

/**
 * Shared hook for dashboard data (profile, businesses, products, shared products).
 * Cached for 60s to avoid re-fetching when navigating between dashboard pages.
 * Call refresh() after mutations (create product, delete business, etc.).
 */
export function useDashboardData(): DashboardData {
  const { user } = useAuth()

  const cachedForUser = _cache && user && _cache.userId === user.id && (Date.now() - _cache.ts < CACHE_TTL_MS)

  const [profile, setProfile] = useState<Profile | null>(cachedForUser ? _cache!.profile : null)
  const [sharedProducts, setSharedProducts] = useState<DashboardData['sharedProducts']>(cachedForUser ? _cache!.sharedProducts : [])
  const [businesses, setBusinesses] = useState<Business[]>(cachedForUser ? _cache!.businesses : [])
  const [products, setProducts] = useState<Product[]>(cachedForUser ? _cache!.products : [])
  const [loading, setLoading] = useState(!cachedForUser)

  const doFetch = useCallback(async (force = false) => {
    if (!user) return
    if (!force && _cache && _cache.userId === user.id && (Date.now() - _cache.ts < CACHE_TTL_MS)) {
      setProfile(_cache.profile)
      setSharedProducts(_cache.sharedProducts)
      setBusinesses(_cache.businesses)
      setProducts(_cache.products)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await fetchDashboardData(user.id)
      _cache = { ...result, userId: user.id, ts: Date.now() }
      setProfile(result.profile)
      setSharedProducts(result.sharedProducts)
      setBusinesses(result.businesses)
      setProducts(result.products)
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
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

  return { profile, sharedProducts, businesses, products, loading, refresh }
}
