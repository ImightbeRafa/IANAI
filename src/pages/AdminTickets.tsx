import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getAllTickets, updateTicketStatus } from '../services/database'
import type { FeedbackTicket } from '../services/database'
import Layout from '../components/Layout'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  MessageSquarePlus,
  Bug,
  Lightbulb,
  HelpCircle,
  MoreHorizontal,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  ExternalLink,
  Monitor,
  AlertTriangle,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
  RefreshCw
} from 'lucide-react'

export default function AdminTickets() {
  const { isAdmin } = useAuth()
  const { language } = useLanguage()
  const [tickets, setTickets] = useState<FeedbackTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'open' | 'in_progress' | 'resolved' | 'closed'>('all')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({})

  const t = language === 'es' ? {
    title: 'Tickets de Feedback',
    subtitle: 'Tickets enviados por usuarios',
    back: 'Admin',
    all: 'Todos',
    open: 'Abiertos',
    in_progress: 'En Progreso',
    resolved: 'Resueltos',
    closed: 'Cerrados',
    noTickets: 'No hay tickets aún',
    category: 'Categoría',
    priority: 'Prioridad',
    status: 'Estado',
    user: 'Usuario',
    page: 'Página',
    browser: 'Navegador',
    screen: 'Pantalla',
    consoleErrors: 'Errores de Consola',
    screenshot: 'Captura',
    adminNotes: 'Notas del admin',
    notesPlaceholder: 'Agregar notas internas...',
    markOpen: 'Abrir',
    markInProgress: 'En Progreso',
    markResolved: 'Resolver',
    markClosed: 'Cerrar',
    refresh: 'Actualizar',
    unauthorized: 'No tienes permiso para ver esta página',
    bug: 'Bug',
    feature: 'Idea',
    question: 'Pregunta',
    other: 'Otro',
    low: 'Baja',
    medium: 'Media',
    high: 'Alta',
    urgent: 'Urgente',
    noErrors: 'Sin errores'
  } : {
    title: 'Feedback Tickets',
    subtitle: 'User-submitted tickets',
    back: 'Admin',
    all: 'All',
    open: 'Open',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    closed: 'Closed',
    noTickets: 'No tickets yet',
    category: 'Category',
    priority: 'Priority',
    status: 'Status',
    user: 'User',
    page: 'Page',
    browser: 'Browser',
    screen: 'Screen',
    consoleErrors: 'Console Errors',
    screenshot: 'Screenshot',
    adminNotes: 'Admin Notes',
    notesPlaceholder: 'Add internal notes...',
    markOpen: 'Open',
    markInProgress: 'In Progress',
    markResolved: 'Resolve',
    markClosed: 'Close',
    refresh: 'Refresh',
    unauthorized: 'You do not have permission to view this page',
    bug: 'Bug',
    feature: 'Feature',
    question: 'Question',
    other: 'Other',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    urgent: 'Urgent',
    noErrors: 'No errors'
  }

  const loadTickets = async () => {
    try {
      setLoading(true)
      const data = await getAllTickets()
      setTickets(data)
      const notes: Record<string, string> = {}
      data.forEach(ticket => { notes[ticket.id] = ticket.admin_notes || '' })
      setAdminNotes(notes)
    } catch (err) {
      console.error('Failed to load tickets:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTickets() }, [])

  const handleStatusChange = async (ticketId: string, status: FeedbackTicket['status']) => {
    setUpdatingId(ticketId)
    try {
      await updateTicketStatus(ticketId, status, adminNotes[ticketId])
      setTickets(prev => prev.map(t =>
        t.id === ticketId ? { ...t, status, admin_notes: adminNotes[ticketId] || t.admin_notes } : t
      ))
    } catch (err) {
      console.error('Failed to update ticket:', err)
    } finally {
      setUpdatingId(null)
    }
  }

  if (!isAdmin) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <p className="text-dark-500">{t.unauthorized}</p>
        </div>
      </Layout>
    )
  }

  const filtered = filter === 'all' ? tickets : tickets.filter(t => t.status === filter)

  const categoryIcon = (cat: string) => {
    switch (cat) {
      case 'bug': return <Bug className="w-4 h-4 text-red-400" />
      case 'feature': return <Lightbulb className="w-4 h-4 text-amber-400" />
      case 'question': return <HelpCircle className="w-4 h-4 text-blue-400" />
      default: return <MoreHorizontal className="w-4 h-4 text-dark-400" />
    }
  }

  const priorityLabel = (p: string) => t[p as keyof typeof t] || p

  const priorityColor = (p: string) => {
    switch (p) {
      case 'urgent': return 'text-red-400 bg-red-900/20'
      case 'high': return 'text-amber-400 bg-amber-900/20'
      case 'medium': return 'text-blue-400 bg-blue-900/20'
      default: return 'text-dark-400 bg-dark-200'
    }
  }

  const statusColor = (s: string) => {
    switch (s) {
      case 'open': return 'text-green-400 bg-green-900/20'
      case 'in_progress': return 'text-amber-400 bg-amber-900/20'
      case 'resolved': return 'text-blue-400 bg-blue-900/20'
      case 'closed': return 'text-dark-400 bg-dark-200'
      default: return 'text-dark-400 bg-dark-200'
    }
  }

  const statusIcon = (s: string) => {
    switch (s) {
      case 'open': return <Clock className="w-3.5 h-3.5" />
      case 'in_progress': return <Loader2 className="w-3.5 h-3.5" />
      case 'resolved': return <CheckCircle className="w-3.5 h-3.5" />
      case 'closed': return <XCircle className="w-3.5 h-3.5" />
      default: return null
    }
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link
              to="/admin"
              className="inline-flex items-center gap-1.5 text-dark-400 hover:text-dark-600 text-xs font-medium tracking-wide uppercase transition-colors mb-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t.back}
            </Link>
            <h1 className="text-2xl font-bold text-dark-900 flex items-center gap-3">
              <MessageSquarePlus className="w-7 h-7 text-primary-500" />
              {t.title}
            </h1>
            <p className="text-dark-500 text-sm mt-1">{t.subtitle}</p>
          </div>
          <button
            onClick={loadTickets}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-dark-100 border border-dark-200 rounded-lg text-sm text-dark-600 hover:bg-dark-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {t.refresh}
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-6 bg-dark-100 rounded-lg p-1 border border-dark-200">
          {(['all', 'open', 'in_progress', 'resolved', 'closed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-primary-600 text-white'
                  : 'text-dark-500 hover:text-dark-700 hover:bg-dark-50'
              }`}
            >
              {t[f]}
              {f !== 'all' && (
                <span className="ml-1.5 text-[10px] opacity-70">
                  ({tickets.filter(tk => tk.status === f).length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Ticket list */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <MessageSquarePlus className="w-12 h-12 text-dark-300 mx-auto mb-3" />
            <p className="text-dark-500">{t.noTickets}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(ticket => {
              const isExpanded = expandedId === ticket.id
              return (
                <div
                  key={ticket.id}
                  className="bg-dark-100 rounded-xl border border-dark-200 overflow-hidden"
                >
                  {/* Ticket header */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : ticket.id)}
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-dark-50/50 transition-colors"
                  >
                    {categoryIcon(ticket.category)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-dark-900 truncate">{ticket.subject}</p>
                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${priorityColor(ticket.priority)}`}>
                          {priorityLabel(ticket.priority)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[11px] text-dark-400">{ticket.user_email}</span>
                        <span className="text-[11px] text-dark-300">{new Date(ticket.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-full ${statusColor(ticket.status)}`}>
                      {statusIcon(ticket.status)}
                      {t[ticket.status as keyof typeof t]}
                    </span>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-dark-400" /> : <ChevronDown className="w-4 h-4 text-dark-400" />}
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t border-dark-200 px-4 py-4 space-y-4">
                      {/* Description */}
                      <div>
                        <p className="text-sm text-dark-800 whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
                      </div>

                      {/* Screenshot */}
                      {ticket.screenshot_url && (
                        <div>
                          <p className="text-[10px] font-semibold text-dark-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                            <ImageIcon className="w-3.5 h-3.5" /> {t.screenshot}
                          </p>
                          <a href={ticket.screenshot_url} target="_blank" rel="noopener noreferrer" className="block">
                            <img
                              src={ticket.screenshot_url}
                              alt="Screenshot"
                              className="max-w-full max-h-80 rounded-lg border border-dark-200 hover:border-primary-500 transition-colors"
                            />
                          </a>
                        </div>
                      )}

                      {/* Metadata grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-dark-50 rounded-lg p-2.5">
                          <p className="text-[10px] font-semibold text-dark-400 uppercase mb-1 flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" /> {t.page}
                          </p>
                          <p className="text-xs text-dark-700 font-mono truncate">{ticket.page_url || '-'}</p>
                        </div>
                        <div className="bg-dark-50 rounded-lg p-2.5">
                          <p className="text-[10px] font-semibold text-dark-400 uppercase mb-1 flex items-center gap-1">
                            <Monitor className="w-3 h-3" /> {t.screen}
                          </p>
                          <p className="text-xs text-dark-700 font-mono">{ticket.screen_size || '-'}</p>
                        </div>
                        <div className="bg-dark-50 rounded-lg p-2.5 col-span-2">
                          <p className="text-[10px] font-semibold text-dark-400 uppercase mb-1">{t.browser}</p>
                          <p className="text-[10px] text-dark-600 font-mono truncate">{ticket.browser_info || '-'}</p>
                        </div>
                      </div>

                      {/* Console errors */}
                      {Array.isArray(ticket.console_errors) && ticket.console_errors.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-dark-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> {t.consoleErrors}
                          </p>
                          <div className="bg-dark-50 rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
                            {ticket.console_errors.map((err, i) => (
                              <p key={i} className="text-[10px] font-mono text-red-400 break-all">{String(err)}</p>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Admin notes + status actions */}
                      <div className="border-t border-dark-200 pt-4">
                        <p className="text-[10px] font-semibold text-dark-500 uppercase tracking-wide mb-2">{t.adminNotes}</p>
                        <textarea
                          value={adminNotes[ticket.id] || ''}
                          onChange={(e) => setAdminNotes(prev => ({ ...prev, [ticket.id]: e.target.value }))}
                          placeholder={t.notesPlaceholder}
                          rows={2}
                          className="w-full px-3 py-2 bg-dark-50 text-dark-900 border border-dark-200 rounded-lg text-xs resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder:text-dark-400"
                        />
                        <div className="flex gap-2 mt-3">
                          {(['open', 'in_progress', 'resolved', 'closed'] as const).map(s => (
                            <button
                              key={s}
                              onClick={() => handleStatusChange(ticket.id, s)}
                              disabled={updatingId === ticket.id || ticket.status === s}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-30 ${
                                ticket.status === s
                                  ? `${statusColor(s)} border border-current`
                                  : 'bg-dark-50 text-dark-500 hover:bg-dark-200 border border-transparent'
                              }`}
                            >
                              {updatingId === ticket.id ? <Loader2 className="w-3 h-3 animate-spin" /> : statusIcon(s)}
                              {t[`mark${s.charAt(0).toUpperCase() + s.slice(1).replace('_p', 'P').replace('_', '')}` as keyof typeof t] || s}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}
