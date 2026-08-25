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

function humanToolLabel(toolName: string): string {
  switch (toolName) {
    case 'execute_script_generate':
      return 'Generar guion'
    case 'execute_image_generate':
      return 'Generar imagen'
    case 'execute_image_edit':
      return 'Editar imagen'
    case 'execute_image_enhance':
      return 'Mejorar imagen'
    case 'execute_carousel_generate':
      return 'Generar carrusel'
    case 'execute_bulk_scripts':
      return 'Guiones en lote'
    case 'execute_bulk_posts':
      return 'Posts en lote'
    case 'execute_campaign_pack':
      return 'Campaign pack'
    case 'archive_brand':
      return 'Archivar marca'
    case 'delete_offer':
      return 'Eliminar oferta'
    case 'delete_brand':
      return 'Eliminar marca'
    case 'delete_asset':
      return 'Eliminar asset'
    default:
      return toolName
  }
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
  const [showDetails, setShowDetails] = useState(false)

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

  const toolLabel = details ? humanToolLabel(details.tool_name) : 'acción'
  const creditLabel = details?.quoted_credit_cost == null
    ? '—'
    : details.quoted_credit_cost === 0
      ? 'Sin costo de créditos'
      : `${details.quoted_credit_cost} créditos IA`

  return (
    <div className="min-h-screen bg-dark-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <AdvanceLogo size={44} />
            <span className="text-2xl font-bold text-dark-900">Advance AI</span>
          </div>
          <p className="text-dark-500 text-sm">
            Fallback de aprobación (preferí confirmar en el chat de Grok)
          </p>
        </div>

        <div className="card space-y-5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary-900/20 text-primary-600">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-dark-900">Confirmar acción</h1>
              <p className="text-sm text-dark-500 mt-1">
                Esta página es opcional. En Grok podés responder sí/no y el bot usa{' '}
                <code className="text-xs">confirm_execute</code>.
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
            <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-4 text-sm text-emerald-300 space-y-2">
              <p className="font-medium">Aprobado.</p>
              <p>
                Volvé a Grok y pedile que reintente la misma herramienta. Ya no hace falta pegar ningún ID.
              </p>
            </div>
          )}

          {done === 'denied' && (
            <div className="rounded-lg border border-dark-200 bg-dark-50/60 p-4 text-sm text-dark-600">
              Cancelado. Decile a Grok que no continúe con esta acción.
            </div>
          )}

          {details && !done && (
            <div className="rounded-lg border border-dark-200 bg-dark-50/60 p-4 space-y-2 text-sm">
              <p>
                <span className="font-medium text-dark-700">Acción:</span> {toolLabel}
              </p>
              <p>
                <span className="font-medium text-dark-700">Estado:</span> {details.status}
              </p>
              <p>
                <span className="font-medium text-dark-700">Costo:</span> {creditLabel}
              </p>
              <p>
                <span className="font-medium text-dark-700">Expira:</span>{' '}
                {new Date(details.expires_at).toLocaleString()}
              </p>
              <button
                type="button"
                className="text-xs text-primary-600 hover:text-primary-700 font-medium mt-1"
                onClick={() => setShowDetails((v) => !v)}
              >
                {showDetails ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}
              </button>
              {showDetails && (
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-dark-100/80 p-2 text-xs text-dark-600">
                  {JSON.stringify(details.input_json, null, 2)}
                </pre>
              )}
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
                {submitting ? 'Procesando…' : 'Aprobar'}
              </button>
              <button
                type="button"
                onClick={() => void submit('deny')}
                disabled={submitting}
                className="btn-secondary flex-1 justify-center gap-1.5"
              >
                <X className="w-4 h-4" />
                Cancelar
              </button>
            </div>
          )}

          <p className="text-center text-sm text-dark-500">
            <Link to="/chat" className="text-primary-600 hover:text-primary-700 font-medium">
              Volver al chat
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
