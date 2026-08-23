import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, Check, Shield, X } from 'lucide-react'
import AdvanceLogo from '../components/AdvanceLogo'
import { useAuth } from '../contexts/AuthContext'

type ApprovalDetails = {
  id: string
  tool_name: string
  status: string
  quoted_credit_cost: number | null
  expires_at: string
  input_json: unknown
}

export default function McpApprove() {
  const { approvalId } = useParams<{ approvalId: string }>()
  const navigate = useNavigate()
  const { user, session, loading: authLoading } = useAuth()
  const [details, setDetails] = useState<ApprovalDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'approved' | 'denied' | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!approvalId) {
        setError('Missing approval id')
        setLoading(false)
        return
      }
      if (authLoading) return
      if (!user || !session?.access_token) {
        navigate(`/login?redirect=${encodeURIComponent(`/mcp/approve/${approvalId}`)}`, { replace: true })
        return
      }

      const res = await fetch(`/api/mcp-approve?id=${encodeURIComponent(approvalId)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json().catch(() => ({})) as { approval?: ApprovalDetails; error?: string }
      if (cancelled) return
      if (!res.ok) {
        setError(json.error || 'Failed to load approval')
        setLoading(false)
        return
      }
      setDetails(json.approval || null)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [approvalId, authLoading, user, session?.access_token, navigate])

  async function submit(action: 'approve' | 'deny') {
    if (!approvalId || !session?.access_token || submitting) return
    setSubmitting(true)
    setError(null)
    const res = await fetch('/api/mcp-approve', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: approvalId, action }),
    })
    const json = await res.json().catch(() => ({})) as { error?: string; status?: string }
    if (!res.ok) {
      setError(json.error || 'Request failed')
      setSubmitting(false)
      return
    }
    setDone(action === 'approve' ? 'approved' : 'denied')
    setSubmitting(false)
  }

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <AdvanceLogo size={44} />
            <span className="text-2xl font-bold text-dark-900">Advance AI</span>
          </div>
          <p className="text-dark-500 text-sm">Approve an Advance MCP action from Grok</p>
        </div>

        <div className="card space-y-5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary-900/20 text-primary-600">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-dark-900">Confirm EXECUTE</h1>
              <p className="text-sm text-dark-500 mt-1">
                This spends Advance credits. Review carefully — approval lasts one hour and is single-use.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-700/30 rounded-lg text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {done === 'approved' && (
            <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-4 text-sm text-emerald-300">
              Approved. Return to Grok and retry the same tool with this approvalRequestId:
              <code className="block mt-2 break-all text-emerald-200">{approvalId}</code>
            </div>
          )}

          {done === 'denied' && (
            <div className="rounded-lg border border-dark-200 bg-dark-50/60 p-4 text-sm text-dark-600">
              Denied. Tell Grok the action was cancelled.
            </div>
          )}

          {details && !done && (
            <div className="rounded-lg border border-dark-200 bg-dark-50/60 p-4 space-y-2 text-sm">
              <p><span className="font-medium text-dark-700">Tool:</span> {details.tool_name}</p>
              <p><span className="font-medium text-dark-700">Status:</span> {details.status}</p>
              <p>
                <span className="font-medium text-dark-700">Credits:</span>{' '}
                {details.quoted_credit_cost ?? '—'}
              </p>
              <p>
                <span className="font-medium text-dark-700">Expires:</span>{' '}
                {new Date(details.expires_at).toLocaleString()}
              </p>
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-dark-100/80 p-2 text-xs text-dark-600">
                {JSON.stringify(details.input_json, null, 2)}
              </pre>
            </div>
          )}

          {!done && details?.status === 'pending' && (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => void submit('approve')}
                disabled={submitting}
                className="btn-primary flex-1 justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                {submitting ? 'Working…' : 'Approve & spend credits'}
              </button>
              <button
                type="button"
                onClick={() => void submit('deny')}
                disabled={submitting}
                className="btn-secondary flex-1 justify-center gap-1.5"
              >
                <X className="w-4 h-4" />
                Deny
              </button>
            </div>
          )}

          <p className="text-center text-sm text-dark-500">
            <Link to="/chat" className="text-primary-600 hover:text-primary-700 font-medium">
              Back to chat
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
