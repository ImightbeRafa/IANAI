import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, Check, Shield, X } from 'lucide-react'
import AdvanceLogo from '../components/AdvanceLogo'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { buildOAuthConsentLoginPath } from '../lib/oauthReturnPath'

type AuthorizationDetails = {
  authorization_id?: string
  redirect_uri?: string
  scope?: string
  client?: {
    name?: string
    client_id?: string
  }
}

function scopeLines(scope: string | undefined): string[] {
  if (!scope?.trim()) {
    return [
      'Read your Advance brands and offers',
      'Read brand kit colors and voice',
      'Act as you inside Advance MCP tools you approve',
    ]
  }
  return scope.split(/\s+/).filter(Boolean).map((item) => {
    switch (item) {
      case 'email':
        return 'See your email address'
      case 'profile':
        return 'See your basic profile'
      case 'openid':
        return 'Confirm your signed-in identity'
      default:
        return item
    }
  })
}

export default function OAuthConsent() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const authorizationId = searchParams.get('authorization_id')
  const { user, loading: authLoading } = useAuth()

  const [authDetails, setAuthDetails] = useState<AuthorizationDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!authorizationId) {
        setError('Missing authorization_id')
        setLoading(false)
        return
      }
      if (authLoading) return
      if (!user) {
        navigate(buildOAuthConsentLoginPath(authorizationId), { replace: true })
        return
      }

      const { data, error: detailsError } = await supabase.auth.oauth.getAuthorizationDetails(
        authorizationId
      )
      if (cancelled) return
      if (detailsError) {
        setError(detailsError.message)
        setLoading(false)
        return
      }
      // Already consented — SDK may return redirect without authorization_id
      if (data && typeof data === 'object' && 'redirect_url' in data && !('authorization_id' in data)) {
        const redirectUrl = (data as { redirect_url?: string }).redirect_url
        if (redirectUrl) {
          window.location.href = redirectUrl
          return
        }
      }
      setAuthDetails((data || null) as AuthorizationDetails | null)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [authorizationId, authLoading, user, navigate])

  async function handleApprove() {
    if (!authorizationId || submitting) return
    setSubmitting(true)
    setError(null)
    const { data, error: approveError } = await supabase.auth.oauth.approveAuthorization(
      authorizationId
    )
    if (approveError) {
      setError(approveError.message)
      setSubmitting(false)
      return
    }
    const redirectUrl = (data as { redirect_url?: string } | null)?.redirect_url
    if (redirectUrl) {
      window.location.href = redirectUrl
      return
    }
    setError('Approved, but no redirect URL was returned')
    setSubmitting(false)
  }

  async function handleDeny() {
    if (!authorizationId || submitting) return
    setSubmitting(true)
    setError(null)
    const { data, error: denyError } = await supabase.auth.oauth.denyAuthorization(authorizationId)
    if (denyError) {
      setError(denyError.message)
      setSubmitting(false)
      return
    }
    const redirectUrl = (data as { redirect_url?: string } | null)?.redirect_url
    if (redirectUrl) {
      window.location.href = redirectUrl
      return
    }
    navigate('/dashboard', { replace: true })
  }

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    )
  }

  const clientName = authDetails?.client?.name || 'Grok / MCP client'
  const scopes = scopeLines(authDetails?.scope)

  return (
    <div className="min-h-screen bg-dark-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <AdvanceLogo size={44} />
            <span className="text-2xl font-bold text-dark-900">Advance AI</span>
          </div>
          <p className="text-dark-500 text-sm">Connect a trusted AI tool to your account</p>
        </div>

        <div className="card space-y-5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary-900/20 text-primary-600">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-dark-900">
                Allow {clientName}?
              </h1>
              <p className="text-sm text-dark-500 mt-1">
                This lets the tool use Advance on your behalf. You stay in control — deny anytime,
                and generation still needs your approval in chat.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-700/30 rounded-lg text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="rounded-lg border border-dark-200 bg-dark-50/60 p-4 space-y-2 text-sm">
            <p className="text-dark-700">
              <span className="font-medium">Client:</span> {clientName}
            </p>
            {authDetails?.redirect_uri && (
              <p className="text-dark-500 break-all">
                <span className="font-medium text-dark-700">Return URL:</span>{' '}
                {authDetails.redirect_uri}
              </p>
            )}
            <div>
              <p className="font-medium text-dark-700 mb-1">This tool can:</p>
              <ul className="space-y-1.5">
                {scopes.map((line) => (
                  <li key={line} className="flex items-start gap-2 text-dark-600">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => void handleApprove()}
              disabled={submitting || !authorizationId}
              className="btn-primary flex-1 justify-center"
            >
              {submitting ? 'Working…' : 'Allow access'}
            </button>
            <button
              type="button"
              onClick={() => void handleDeny()}
              disabled={submitting || !authorizationId}
              className="btn-secondary flex-1 justify-center gap-1.5"
            >
              <X className="w-4 h-4" />
              Deny
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
