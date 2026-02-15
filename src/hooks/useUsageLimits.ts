import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export interface UsageLimits {
  plan: string
  scriptsUsed: number
  scriptsLimit: number
  imagesUsed: number
  imagesLimit: number
  descriptionsUsed: number
  descriptionsLimit: number
  loading: boolean
}

/**
 * Hook to fetch current user's usage and plan limits.
 * Returns current usage counts and limits for scripts/images.
 * A limit of -1 means unlimited.
 */
export function useUsageLimits(): UsageLimits {
  const { user } = useAuth()
  const [data, setData] = useState<UsageLimits>({
    plan: 'free',
    scriptsUsed: 0,
    scriptsLimit: 10,
    imagesUsed: 0,
    imagesLimit: 1,
    descriptionsUsed: 0,
    descriptionsLimit: 10,
    loading: true
  })

  useEffect(() => {
    if (!user) return

    async function fetchUsage() {
      try {
        // Fetch subscription
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('plan, status')
          .eq('user_id', user!.id)
          .eq('status', 'active')
          .single()

        const plan = sub?.plan || 'free'

        // Fetch plan limits
        const { data: limits } = await supabase
          .from('plan_limits')
          .select('scripts_per_month, images_per_month, descriptions_per_month')
          .eq('plan', plan)
          .single()

        // Fetch current month usage
        const currentMonth = new Date().toISOString().slice(0, 7) + '-01'
        const { data: usage } = await supabase
          .from('usage')
          .select('scripts_generated, images_generated, descriptions_generated')
          .eq('user_id', user!.id)
          .eq('period_start', currentMonth)
          .single()

        setData({
          plan,
          scriptsUsed: usage?.scripts_generated || 0,
          scriptsLimit: limits?.scripts_per_month ?? 10,
          imagesUsed: usage?.images_generated || 0,
          imagesLimit: limits?.images_per_month ?? 1,
          descriptionsUsed: usage?.descriptions_generated || 0,
          descriptionsLimit: limits?.descriptions_per_month ?? 10,
          loading: false
        })
      } catch {
        setData(prev => ({ ...prev, loading: false }))
      }
    }

    fetchUsage()
  }, [user])

  return data
}
