import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export type ChatShellFlagState = 'loading' | 'enabled' | 'disabled'

/**
 * Runtime feature flag from Supabase app_feature_flags.chat_shell.
 * Fail-closed: missing row, missing table, RLS/network errors => disabled.
 */
export function useChatShellFlag(): { state: ChatShellFlagState; refresh: () => void } {
  const [state, setState] = useState<ChatShellFlagState>('loading')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState('loading')

    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('app_feature_flags')
          .select('enabled')
          .eq('key', 'chat_shell')
          .maybeSingle()

        if (cancelled) return
        if (error || !data || data.enabled !== true) {
          setState('disabled')
          return
        }
        setState('enabled')
      } catch {
        if (!cancelled) setState('disabled')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [tick])

  return {
    state,
    refresh: () => setTick((n) => n + 1),
  }
}
