import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { getChatShellRollout, updatePreferredUi } from '../../services/database'
import type { PreferredUi } from '../../types'
import {
  resolveChatShellRollout,
  type ChatShellKillSwitch,
  type ChatShellRollout,
} from './chatShellRollout'

interface ChatShellRolloutContextValue extends ChatShellRollout {
  state: ChatShellKillSwitch
  loading: boolean
  refresh: () => void
  setPreferredUi: (next: PreferredUi) => Promise<boolean>
}

const ChatShellRolloutContext = createContext<ChatShellRolloutContextValue | null>(null)

const FAIL_CLOSED: ChatShellRollout = resolveChatShellRollout({
  killSwitch: 'disabled',
  betaAccess: null,
  preferredUi: null,
})

const VISIBILITY_REFRESH_MS = 60_000

export function ChatShellRolloutProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [row, setRow] = useState<ChatShellRollout>(FAIL_CLOSED)

  const userId = user?.id ?? null
  const userIdRef = useRef(userId)
  userIdRef.current = userId
  const fetchGen = useRef(0)
  const lastFetchAt = useRef(0)

  const applyRow = useCallback((next: Awaited<ReturnType<typeof getChatShellRollout>>) => {
    setRow(resolveChatShellRollout({
      killSwitch: next.killSwitch,
      betaAccess: next.betaAccess,
      preferredUi: next.preferredUi,
    }))
  }, [])

  const fetchRow = useCallback(async (opts?: { showLoading?: boolean }) => {
    const id = userIdRef.current
    const gen = ++fetchGen.current
    if (opts?.showLoading) setLoading(true)
    try {
      const next = await getChatShellRollout(id)
      if (gen !== fetchGen.current) return
      applyRow(next)
      lastFetchAt.current = Date.now()
    } finally {
      if (gen === fetchGen.current) setLoading(false)
    }
  }, [applyRow])

  useEffect(() => {
    void fetchRow({ showLoading: true })
    return () => {
      fetchGen.current += 1
    }
  }, [userId, fetchRow])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastFetchAt.current < VISIBILITY_REFRESH_MS) return
      void fetchRow({ showLoading: false })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fetchRow])

  const setPreferredUi = useCallback(async (next: PreferredUi) => {
    if (!userId || !row.canAccessChat) return false
    try {
      await updatePreferredUi(userId, next)
      setRow((prev) => resolveChatShellRollout({
        killSwitch: prev.killSwitch === 'loading' ? 'disabled' : prev.killSwitch,
        betaAccess: prev.betaAccess,
        preferredUi: next,
      }))
      return true
    } catch {
      return false
    }
  }, [userId, row.canAccessChat, row.killSwitch, row.betaAccess])

  const value = useMemo<ChatShellRolloutContextValue>(() => ({
    ...row,
    state: loading ? 'loading' : row.killSwitch,
    loading,
    refresh: () => {
      void fetchRow({ showLoading: false })
    },
    setPreferredUi,
  }), [row, loading, fetchRow, setPreferredUi])

  return (
    <ChatShellRolloutContext.Provider value={value}>
      {children}
    </ChatShellRolloutContext.Provider>
  )
}

export function useChatShellRollout(): ChatShellRolloutContextValue {
  const ctx = useContext(ChatShellRolloutContext)
  if (!ctx) {
    throw new Error('useChatShellRollout must be used within ChatShellRolloutProvider')
  }
  return ctx
}
