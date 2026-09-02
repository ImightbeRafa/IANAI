import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { safeAppReturnPath } from '../lib/oauthReturnPath'
import { resolveClientAdminAccess } from '../lib/previewAdmin'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  isAdmin: boolean
  adminResolved: boolean
  signUp: (email: string, password: string, fullName?: string, referralCode?: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: (options?: { redirectPath?: string }) => Promise<void>
  signOut: () => Promise<void>
  updateProfile: (updates: { full_name?: string; avatar_url?: string }) => Promise<void>
  updatePassword: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminResolved, setAdminResolved] = useState(false)
  const authResolved = useRef(false)
  const currentUserIdRef = useRef<string | null>(null)

  const clearAdmin = () => {
    setIsAdmin(false)
    setAdminResolved(true)
  }

  // Fetch admin status from profiles table. Do not mark adminResolved until this finishes
  // so /admin does not bounce real admins to /dashboard during the profiles round-trip.
  // Preview-only: allowlisted QA emails may access /admin without profiles.is_admin.
  const fetchAdminStatus = async (userId: string, email?: string | null) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', userId)
        .maybeSingle()
      setIsAdmin(resolveClientAdminAccess({
        profileIsAdmin: data?.is_admin === true,
        email,
      }))
    } catch {
      setIsAdmin(resolveClientAdminAccess({
        profileIsAdmin: false,
        email,
      }))
    } finally {
      setAdminResolved(true)
    }
  }

  useEffect(() => {
    // Fail soft when env is missing/invalid (main.tsx normally shows ConfigErrorScreen first)
    if (!isSupabaseConfigured) {
      setLoading(false)
      setAdminResolved(true)
      return
    }

    // Detect if this is an OAuth callback (URL has code, access_token, or error params)
    const params = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(window.location.hash.substring(1))
    const hasOAuthCallback = params.has('code') || hashParams.has('access_token') || params.has('error') || hashParams.has('error')

    // Surface OAuth errors from the URL (Supabase appends these on failure)
    const oauthError = params.get('error') || hashParams.get('error')
    const oauthErrorDesc = params.get('error_description') || hashParams.get('error_description')
    if (oauthError) {
      console.error('OAuth error:', oauthError, oauthErrorDesc)
    }

    // Set up auth state listener FIRST (before getSession) to catch OAuth code exchange
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && !session) {
        console.warn('Token refresh failed, signing out')
        supabase.auth.signOut()
        setSession(null)
        setUser(null)
        clearAdmin()
      } else if (event === 'SIGNED_OUT') {
        setSession(null)
        setUser(null)
        clearAdmin()
      } else {
        authResolved.current = true
        const newUserId = session?.user?.id ?? null
        const isSameUser = newUserId !== null && newUserId === currentUserIdRef.current

        // For token refreshes where the user hasn't changed, skip state updates
        // to avoid re-rendering the entire app (which causes data re-fetches)
        if (isSameUser && (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
          // Silently update session ref without triggering React re-render
          setLoading(false)
          return
        }

        currentUserIdRef.current = newUserId
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          setAdminResolved(false)
          void fetchAdminStatus(session.user.id, session.user.email)
        } else {
          clearAdmin()
        }

        // Universal referral code fallback — applies on any sign-in event
        if (session?.user && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
          const storedRef = localStorage.getItem('referral_code')
          if (storedRef) {
            supabase.rpc('apply_referral_code', {
              p_user_id: session.user.id,
              p_code: storedRef
            }).then(({ data, error }) => {
              if (error) {
                console.warn('Referral apply (fallback) failed:', error.message)
              } else if (data?.success) {
                console.log('Referral applied successfully:', data)
              }
              // Always remove — either it worked, user already has it, or code is invalid
              localStorage.removeItem('referral_code')
            })
          }
        }
      }
      setLoading(false)
    })

    // For OAuth callbacks, let onAuthStateChange handle it (it will detect the code/token in URL)
    // For normal page loads, use getSession to restore existing session
    if (!hasOAuthCallback) {
      supabase.auth.getSession().then(({ data: { session }, error }) => {
        // Skip if onAuthStateChange already resolved (avoids double render + double fetchAdminStatus)
        if (authResolved.current) return
        if (error) {
          console.warn('Session recovery failed, signing out:', error.message)
          supabase.auth.signOut()
          setSession(null)
          setUser(null)
          clearAdmin()
        } else {
          currentUserIdRef.current = session?.user?.id ?? null
          setSession(session)
          setUser(session?.user ?? null)
          if (session?.user) {
            setAdminResolved(false)
            void fetchAdminStatus(session.user.id, session.user.email)
          } else {
            clearAdmin()
          }
        }
        setLoading(false)
      })
    } else {
      // OAuth callback: give Supabase SDK time to process the code exchange
      // If it doesn't resolve within 10s, stop loading to avoid infinite spinner
      const timeout = setTimeout(() => {
        if (oauthError) {
          console.error('OAuth authentication failed:', oauthError, oauthErrorDesc)
        }
        setLoading(false)
      }, 10000)

      // Also try explicit code exchange for PKCE flow
      if (params.has('code')) {
        supabase.auth.exchangeCodeForSession(params.get('code')!).then(({ data, error }) => {
          clearTimeout(timeout)
          if (error) {
            console.error('OAuth code exchange failed:', error.message)
            setLoading(false)
          } else if (data.session) {
            currentUserIdRef.current = data.session.user.id
            setSession(data.session)
            setUser(data.session.user)
            setAdminResolved(false)
            void fetchAdminStatus(data.session.user.id, data.session.user.email)
            // Apply referral code from localStorage (Google OAuth flow)
            const storedRef = localStorage.getItem('referral_code')
            if (storedRef) {
              Promise.resolve(
                supabase.rpc('apply_referral_code', {
                  p_user_id: data.session.user.id,
                  p_code: storedRef
                })
              ).then(() => {
                localStorage.removeItem('referral_code')
              }).catch((err: unknown) => {
                console.warn('Referral apply failed:', err)
              })
            }
            setLoading(false)
            // Clean OAuth params only — preserve chat-shell ?brand=&session= deep links.
            try {
              const next = new URL(window.location.href)
              next.searchParams.delete('code')
              next.searchParams.delete('error')
              next.searchParams.delete('error_description')
              next.searchParams.delete('state')
              const qs = next.searchParams.toString()
              window.history.replaceState({}, '', `${next.pathname}${qs ? `?${qs}` : ''}${next.hash}`)
            } catch {
              window.history.replaceState({}, '', window.location.pathname)
            }
          }
        })
      }
    }

    return () => subscription.unsubscribe()
  }, [])

  const signUp = async (email: string, password: string, fullName?: string, referralCode?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          ...(referralCode ? { referral_code: referralCode } : {})
        }
      }
    })
    if (error) throw error
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signInWithGoogle = async (options?: { redirectPath?: string }) => {
    const path = safeAppReturnPath(options?.redirectPath) || '/dashboard'
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${path}`,
      },
    })
    if (error) throw error
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const updateProfile = async (updates: { full_name?: string; avatar_url?: string }) => {
    if (!user) throw new Error('No user logged in')
    
    const { error } = await supabase.auth.updateUser({
      data: updates
    })
    if (error) throw error
  }

  const updatePassword = async (password: string) => {
    if (!user) throw new Error('No user logged in')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, isAdmin, adminResolved, signUp, signIn, signInWithGoogle, signOut, updateProfile, updatePassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
