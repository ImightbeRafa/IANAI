import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { 
  BarChart3, 
  DollarSign, 
  Cpu, 
  ImageIcon, 
  FileText,
  TrendingUp,
  Calendar,
  RefreshCw,
  AlertCircle,
  Sparkles,
  FileUp,
  Link2,
  Wand2,
  MessageSquarePlus,
  Pencil,
  Gift,
  Users,
  Clock,
  CheckCircle,
  XCircle,
  Copy,
  Mic,
  Search,
  ChevronDown,
  CreditCard,
  TrendingDown,
  Zap
} from 'lucide-react'
import { Link } from 'react-router-dom'

interface UsageSummary {
  model: string
  feature: string
  total_calls: number
  successful_calls: number
  failed_calls: number
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  total_cost_usd: number
}

interface DailyUsage {
  day: string
  model: string
  total_calls: number
  total_cost_usd: number
}

interface RecentLog {
  id: string
  user_email: string
  feature: string
  model: string
  generation_id?: string | null
  total_tokens: number
  estimated_cost_usd: number
  success: boolean
  created_at: string
}

interface ImageModelPerformance {
  model: string
  attempts: number
  successes: number
  failures: number
  total_tokens: number
  total_cost_usd: number
  avg_cost_success_usd: number
  posts_generated: number
  upvotes: number
  downvotes: number
  rated_count: number
  upvote_rate: number | null
  cost_per_upvote_usd: number | null
  uncorrelated_logs: number
  uncorrelated_posts: number
}

interface UserUsageStats {
  user_id: string
  user_email: string
  total_calls: number
  total_cost_usd: number
  script_calls: number
  description_calls: number
  image_calls: number
  voice_calls: number
  other_calls: number
  last_active: string
}

interface ReferralCampaign {
  id: string
  code: string
  name: string
  plan: string
  trial_days: number
  max_signups: number | null
  current_signups: number
  is_active: boolean
  expires_at: string | null
  created_at: string
}

interface ReferralSignup {
  id: string
  campaign_id: string
  user_id: string
  signed_up_at: string
  trial_ends_at: string
  converted_to_paid: boolean
  user_email?: string
  user_name?: string
  current_plan?: string
  current_status?: string
}

interface AdminSubscription {
  id: string
  user_id: string
  plan: string
  status: string
  current_period_end: string | null
  cancel_at_period_end: boolean
  tilopay_subscription_id: string | null
  created_at: string
  updated_at: string
  user_email?: string
  user_name?: string
}

interface AdminPayment {
  id: string
  user_id: string
  amount: number
  currency: string
  status: string
  plan: string | null
  description: string | null
  paid_at: string | null
  created_at: string
  user_email?: string
}

// Plan monthly prices in USD for MRR calculation
const PLAN_PRICES_USD: Record<string, number> = {
  free: 0,
  starter: 29,
  pro: 49,
  meta_advanze: 49,
  enterprise: 199,
}

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-400',
  starter: 'bg-blue-500',
  pro: 'bg-purple-500',
  meta_advanze: 'bg-indigo-500',
  enterprise: 'bg-amber-500',
  image_boost: 'bg-green-500',
}

// Model display names and colors
const MODEL_INFO: Record<string, { name: string; color: string }> = {
  'grok': { name: 'Grok (xAI)', color: 'bg-purple-500' },
  'grok-4.3': { name: 'Grok 4.3', color: 'bg-violet-500' },
  'whisper-1': { name: 'Whisper (OpenAI)', color: 'bg-green-500' },
  'gemini': { name: 'Gemini 3 Pro', color: 'bg-blue-500' },
  'nano-banana': { name: 'Nano Banana', color: 'bg-yellow-500' },
  'nano-banana-pro': { name: 'Nano Banana Pro', color: 'bg-orange-500' },
  'gpt-image-2': { name: 'GPT Image 2', color: 'bg-emerald-500' },
  'grok-imagine': { name: 'Grok Imagine', color: 'bg-pink-500' },
  'pdf-parse': { name: 'PDF Parser', color: 'bg-amber-500' },
  'web-scraper': { name: 'Web Scraper', color: 'bg-teal-500' },
  'gemini-2.5-flash': { name: 'Gemini 2.5 Flash', color: 'bg-sky-500' },
}

// Cost per 1M tokens or per image (for reference display)
const MODEL_PRICING: Record<string, string> = {
  'grok': '$3/1M in, $15/1M out',
  'grok-4.3': '$2/1M in, $10/1M out',
  'whisper-1': '~$0.006/min',
  'gemini': '$0.15/1M in, $0.60/1M out',
  'nano-banana': '~$0.02/image',
  'nano-banana-pro': '$2/1M in, $120/1M image out',
  'gpt-image-2': '$5/1M text in, $8/1M image in, $30/1M image out',
  'grok-imagine': '~$0.07/image',
  'pdf-parse': 'Free (local)',
  'web-scraper': 'Free (local)',
  'gemini-2.5-flash': '$0.15/1M in, $0.60/1M out, $3.50/1M think',
}

export default function AdminDashboard() {
  const { isAdmin } = useAuth()
  const { language } = useLanguage()
  
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [usageSummary, setUsageSummary] = useState<UsageSummary[]>([])
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([])
  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([])
  const [imageModelPerformance, setImageModelPerformance] = useState<ImageModelPerformance[]>([])
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d'>('30d')
  const [campaigns, setCampaigns] = useState<ReferralCampaign[]>([])
  const [referralSignups, setReferralSignups] = useState<ReferralSignup[]>([])
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [userStats, setUserStats] = useState<UserUsageStats[]>([])
  const [logSearch, setLogSearch] = useState('')
  const [logPage, setLogPage] = useState(0)
  const [hasMoreLogs, setHasMoreLogs] = useState(true)
  const [loadingMoreLogs, setLoadingMoreLogs] = useState(false)
  const [userStatsSearch, setUserStatsSearch] = useState('')
  const [ticketStats, setTicketStats] = useState<{ open: number; urgent: number; in_progress: number; total: number }>({ open: 0, urgent: 0, in_progress: 0, total: 0 })
  const [allSubscriptions, setAllSubscriptions] = useState<AdminSubscription[]>([])
  const [allPayments, setAllPayments] = useState<AdminPayment[]>([])
  const [paymentSearch, setPaymentSearch] = useState('')
  const [subsSearch, setSubsSearch] = useState('')
  const [billingTab, setBillingTab] = useState<'overview' | 'payments' | 'subscriptions'>('overview')

  const labels = {
    es: {
      title: 'Panel de Administrador',
      subtitle: 'Monitoreo de uso y costos de API',
      unauthorized: 'No tienes permiso para ver esta página',
      totalCost: 'Costo Total Estimado',
      totalCalls: 'Total de Llamadas',
      successRate: 'Tasa de Éxito',
      byModel: 'Uso por Modelo',
      byFeature: 'Uso por Función',
      dailyTrend: 'Tendencia Diaria',
      recentActivity: 'Actividad Reciente',
      model: 'Modelo',
      feature: 'Función',
      calls: 'Llamadas',
      tokens: 'Tokens',
      cost: 'Costo',
      pricing: 'Precio',
      refresh: 'Actualizar',
      last7days: 'Últimos 7 días',
      last30days: 'Últimos 30 días',
      last90days: 'Últimos 90 días',
      script: 'Guiones',
      description: 'Descripciones',
      image: 'Imágenes',
      edit: 'Ediciones de Imagen',
      enhance: 'Mejoras de Imagen',
      prompt_condense: 'Condensar Prompt',
      paste_organize: 'Auto-llenado',
      prompt_enhance: 'Mejora de Prompts',
      pdf_extract: 'Extracción PDF',
      url_fetch: 'Lectura de URLs',
      voice_transcription: 'Transcripción de Voz',
      script_edit: 'Edición de Guión',
      script_enhance: 'Mejora de Guión',
      script_hook: 'Cambio de Gancho',
      script_consciousness: 'Nivel de Conciencia',
      style_analysis: 'Análisis de Estilo (Custom Post)',
      memory_reflection: 'Reflexión de Memoria',
      memory_synthesis: 'Síntesis de Memoria',
      brand_extraction: 'Extracción de Marca',
      reply: 'Respuestas a Clientes',
      ocr: 'OCR de Imágenes',
      logo: 'Generador de Logos',
      noData: 'No hay datos de uso aún',
      user: 'Usuario',
      time: 'Hora',
      status: 'Estado',
      success: 'Éxito',
      failed: 'Fallido'
    },
    en: {
      title: 'Admin Dashboard',
      subtitle: 'API usage and cost monitoring',
      unauthorized: 'You do not have permission to view this page',
      totalCost: 'Total Estimated Cost',
      totalCalls: 'Total Calls',
      successRate: 'Success Rate',
      byModel: 'Usage by Model',
      byFeature: 'Usage by Feature',
      dailyTrend: 'Daily Trend',
      recentActivity: 'Recent Activity',
      model: 'Model',
      feature: 'Feature',
      calls: 'Calls',
      tokens: 'Tokens',
      cost: 'Cost',
      pricing: 'Pricing',
      refresh: 'Refresh',
      last7days: 'Last 7 days',
      last30days: 'Last 30 days',
      last90days: 'Last 90 days',
      script: 'Scripts',
      description: 'Descriptions',
      image: 'Images',
      edit: 'Image Edits',
      enhance: 'Image Enhance',
      prompt_condense: 'Prompt Condense',
      paste_organize: 'Auto-fill',
      prompt_enhance: 'Prompt Enhancement',
      pdf_extract: 'PDF Extraction',
      url_fetch: 'URL Fetching',
      voice_transcription: 'Voice Transcription',
      script_edit: 'Script Edit',
      script_enhance: 'Script Enhance',
      script_hook: 'Hook Change',
      script_consciousness: 'Consciousness Level',
      style_analysis: 'Style Analysis (Custom Post)',
      memory_reflection: 'Memory Reflection',
      memory_synthesis: 'Memory Synthesis',
      brand_extraction: 'Brand Extraction',
      reply: 'Client Replies',
      ocr: 'Image OCR',
      logo: 'Logo Generator',
      noData: 'No usage data yet',
      user: 'User',
      time: 'Time',
      status: 'Status',
      success: 'Success',
      failed: 'Failed'
    }
  }

  const t = labels[language]

  const fetchData = async () => {
    if (!isAdmin) return
    
    setRefreshing(true)
    setError('')

    try {
      const days = dateRange === '7d' ? 7 : dateRange === '90d' ? 90 : 30
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)

      // Fetch usage summary
      const { data: summaryData, error: summaryError } = await supabase
        .rpc('get_usage_summary', {
          start_date: startDate.toISOString(),
          end_date: new Date().toISOString()
        })

      if (summaryError) throw summaryError
      setUsageSummary(summaryData || [])

      // Fetch daily usage
      const { data: dailyData, error: dailyError } = await supabase
        .rpc('get_daily_usage', {
          start_date: startDate.toISOString(),
          end_date: new Date().toISOString()
        })

      if (dailyError) throw dailyError
      setDailyUsage(dailyData || [])

      // Fetch per-user stats
      const { data: userStatsData, error: userStatsError } = await supabase
        .rpc('get_user_usage_stats', {
          start_date: startDate.toISOString(),
          end_date: new Date().toISOString()
        })

      if (userStatsError) console.warn('User stats not available yet:', userStatsError.message)
      else setUserStats(userStatsData || [])

      // Fetch first page of logs
      setLogPage(0)
      setLogSearch('')
      const PAGE_SIZE = 20
      const { data: logsData, error: logsError } = await supabase
        .from('api_usage_logs')
        .select('id, user_email, feature, model, total_tokens, estimated_cost_usd, success, created_at')
        .order('created_at', { ascending: false })
        .range(0, PAGE_SIZE - 1)

      if (logsError) throw logsError
      setRecentLogs(logsData || [])
      setHasMoreLogs((logsData || []).length >= PAGE_SIZE)

      // Fetch referral campaigns
      const { data: campaignsData } = await supabase
        .from('referral_campaigns')
        .select('*')
        .order('created_at', { ascending: false })

      setCampaigns(campaignsData || [])

      // Fetch referral signups (no FK join — user_id references auth.users, not profiles)
      const { data: signupsData } = await supabase
        .from('referral_signups')
        .select('*')
        .order('signed_up_at', { ascending: false })

      const rawSignups = signupsData || []
      const userIds = [...new Set(rawSignups.map((s: Record<string, unknown>) => s.user_id as string))]

      // Fetch profiles and subscriptions for these users in bulk
      let profilesMap: Record<string, { email: string; full_name: string }> = {}
      let subsMap: Record<string, { plan: string; status: string }> = {}

      if (userIds.length > 0) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .in('id', userIds)

        for (const p of (profilesData || []) as { id: string; email: string; full_name: string }[]) {
          profilesMap[p.id] = { email: p.email, full_name: p.full_name }
        }

        const { data: subsData } = await supabase
          .from('subscriptions')
          .select('user_id, plan, status')
          .in('user_id', userIds)

        for (const s of (subsData || []) as { user_id: string; plan: string; status: string }[]) {
          subsMap[s.user_id] = { plan: s.plan, status: s.status }
        }
      }

      const enrichedSignups: ReferralSignup[] = rawSignups.map((s: Record<string, unknown>) => {
        const uid = s.user_id as string
        return {
          id: s.id as string,
          campaign_id: s.campaign_id as string,
          user_id: uid,
          signed_up_at: s.signed_up_at as string,
          trial_ends_at: s.trial_ends_at as string,
          converted_to_paid: s.converted_to_paid as boolean,
          user_email: profilesMap[uid]?.email || 'Unknown',
          user_name: profilesMap[uid]?.full_name || '',
          current_plan: subsMap[uid]?.plan || 'free',
          current_status: subsMap[uid]?.status || 'unknown'
        }
      })
      setReferralSignups(enrichedSignups)

      // Fetch ALL billing data via admin API (uses service role — bypasses RLS)
      try {
        const { data: { session: adminSession } } = await supabase.auth.getSession()
        if (adminSession) {
          const billingApiUrl = import.meta.env.PROD ? '/api/admin-billing' : 'http://localhost:3000/api/admin-billing'
          const billingResp = await fetch(billingApiUrl, {
            headers: { 'Authorization': `Bearer ${adminSession.access_token}` }
          })
          if (billingResp.ok) {
            const billingData = await billingResp.json()
            setAllSubscriptions((billingData.subscriptions || []) as AdminSubscription[])
            setAllPayments((billingData.payments || []) as AdminPayment[])
          } else {
            console.warn('Admin billing API failed:', billingResp.status)
          }

          const imagePerformanceApiUrl = import.meta.env.PROD ? '/api/admin-image-performance' : 'http://localhost:3000/api/admin-image-performance'
          const imagePerfResp = await fetch(`${imagePerformanceApiUrl}?start_date=${encodeURIComponent(startDate.toISOString())}&end_date=${encodeURIComponent(new Date().toISOString())}`, {
            headers: { 'Authorization': `Bearer ${adminSession.access_token}` }
          })
          if (imagePerfResp.ok) {
            const imagePerfData = await imagePerfResp.json()
            setImageModelPerformance((imagePerfData.performance || []) as ImageModelPerformance[])
          } else {
            console.warn('Admin image performance API failed:', imagePerfResp.status)
          }
        }
      } catch { /* billing non-critical */ }

      // Fetch ticket summary stats
      try {
        const { data: ticketData } = await supabase
          .from('feedback_tickets')
          .select('status, priority')
        if (ticketData) {
          setTicketStats({
            total: ticketData.length,
            open: ticketData.filter(t => t.status === 'open').length,
            urgent: ticketData.filter(t => t.priority === 'urgent' && t.status !== 'closed' && t.status !== 'resolved').length,
            in_progress: ticketData.filter(t => t.status === 'in_progress').length,
          })
        }
      } catch { /* ticket stats are non-critical */ }

    } catch (err) {
      console.error('Failed to fetch admin data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (isAdmin) {
      fetchData()
    } else {
      setLoading(false)
    }
  }, [isAdmin, dateRange])

  const LOG_PAGE_SIZE = 20

  const fetchLogs = async (search: string) => {
    setLogSearch(search)
    setLogPage(0)
    setLoadingMoreLogs(true)
    try {
      let query = supabase
        .from('api_usage_logs')
        .select('id, user_email, feature, model, total_tokens, estimated_cost_usd, success, created_at')
        .order('created_at', { ascending: false })
        .range(0, LOG_PAGE_SIZE - 1)

      if (search.trim()) {
        query = query.ilike('user_email', `%${search.trim()}%`)
      }

      const { data, error: err } = await query
      if (err) throw err
      setRecentLogs(data || [])
      setHasMoreLogs((data || []).length >= LOG_PAGE_SIZE)
    } catch (err) {
      console.error('Failed to search logs:', err)
    } finally {
      setLoadingMoreLogs(false)
    }
  }

  const loadMoreLogs = async () => {
    const nextPage = logPage + 1
    setLoadingMoreLogs(true)
    try {
      const from = nextPage * LOG_PAGE_SIZE
      const to = from + LOG_PAGE_SIZE - 1

      let query = supabase
        .from('api_usage_logs')
        .select('id, user_email, feature, model, total_tokens, estimated_cost_usd, success, created_at')
        .order('created_at', { ascending: false })
        .range(from, to)

      if (logSearch.trim()) {
        query = query.ilike('user_email', `%${logSearch.trim()}%`)
      }

      const { data, error: err } = await query
      if (err) throw err
      setRecentLogs(prev => [...prev, ...(data || [])])
      setHasMoreLogs((data || []).length >= LOG_PAGE_SIZE)
      setLogPage(nextPage)
    } catch (err) {
      console.error('Failed to load more logs:', err)
    } finally {
      setLoadingMoreLogs(false)
    }
  }

  // Filter user stats by search (client-side, already loaded)
  const filteredUserStats = userStatsSearch.trim()
    ? userStats.filter(u => u.user_email?.toLowerCase().includes(userStatsSearch.toLowerCase()))
    : userStats

  // Calculate totals
  const totalCost = usageSummary.reduce((sum, u) => sum + Number(u.total_cost_usd), 0)
  const totalCalls = usageSummary.reduce((sum, u) => sum + u.total_calls, 0)
  const successfulCalls = usageSummary.reduce((sum, u) => sum + u.successful_calls, 0)
  const successRate = totalCalls > 0 ? (successfulCalls / totalCalls * 100).toFixed(1) : '0'

  // Group by model
  const byModel = usageSummary.reduce((acc, u) => {
    if (!acc[u.model]) {
      acc[u.model] = { calls: 0, tokens: 0, cost: 0 }
    }
    acc[u.model].calls += u.total_calls
    acc[u.model].tokens += u.total_tokens
    acc[u.model].cost += Number(u.total_cost_usd)
    return acc
  }, {} as Record<string, { calls: number; tokens: number; cost: number }>)

  // Group by feature
  const byFeature = usageSummary.reduce((acc, u) => {
    if (!acc[u.feature]) {
      acc[u.feature] = { calls: 0, cost: 0 }
    }
    acc[u.feature].calls += u.total_calls
    acc[u.feature].cost += Number(u.total_cost_usd)
    return acc
  }, {} as Record<string, { calls: number; cost: number }>)

  // Billing calculations
  const activePaidSubs = allSubscriptions.filter(s => (s.status === 'active' || s.status === 'trialing') && s.plan !== 'free')
  const cancelledSubs = allSubscriptions.filter(s => s.status === 'cancelled')
  const totalPaidEver = allSubscriptions.filter(s => s.plan !== 'free')
  const churnRate = totalPaidEver.length > 0 ? (cancelledSubs.length / totalPaidEver.length * 100).toFixed(1) : '0'
  const mrr = activePaidSubs.reduce((sum, s) => sum + (PLAN_PRICES_USD[s.plan] || 0), 0)
  const totalRevenue = allPayments.filter(p => p.status === 'succeeded').reduce((sum, p) => sum + Number(p.amount), 0)
  const boostPayments = allPayments.filter(p => p.plan === 'image_boost' && p.status === 'succeeded')
  const boostRevenue = boostPayments.reduce((sum, p) => sum + Number(p.amount), 0)

  // Plan distribution
  const planDistribution = allSubscriptions.reduce((acc, s) => {
    const plan = s.plan || 'free'
    acc[plan] = (acc[plan] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  const totalSubsCount = allSubscriptions.length || 1

  // Filter payments/subs by search
  const filteredPayments = paymentSearch.trim()
    ? allPayments.filter(p => p.user_email?.toLowerCase().includes(paymentSearch.toLowerCase()) || p.plan?.toLowerCase().includes(paymentSearch.toLowerCase()))
    : allPayments
  const filteredSubs = subsSearch.trim()
    ? allSubscriptions.filter(s => s.user_email?.toLowerCase().includes(subsSearch.toLowerCase()) || s.plan?.toLowerCase().includes(subsSearch.toLowerCase()))
    : allSubscriptions

  if (!isAdmin) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-dark-900 mb-2">{t.unauthorized}</h1>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-dark-900">{t.title}</h1>
            <p className="text-dark-500 mt-1 text-sm">{t.subtitle}</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
            {/* Date Range Selector */}
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as '7d' | '30d' | '90d')}
              className="px-3 py-2 bg-dark-50 text-dark-900 border border-dark-200 rounded-lg text-sm"
            >
              <option value="7d">{t.last7days}</option>
              <option value="30d">{t.last30days}</option>
              <option value="90d">{t.last90days}</option>
            </select>
            <Link
              to="/admin/tickets"
              className="btn-secondary flex items-center gap-2"
            >
              <MessageSquarePlus className="w-4 h-4" />
              Tickets
            </Link>
            <button
              onClick={fetchData}
              disabled={refreshing}
              className="btn-secondary flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {t.refresh}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-900/20 border border-red-700/30 rounded-lg mb-6">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : usageSummary.length === 0 ? (
          <div className="text-center py-20">
            <BarChart3 className="w-16 h-16 text-dark-300 mx-auto mb-4" />
            <p className="text-dark-500">{t.noData}</p>
          </div>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-dark-100 rounded-xl p-6 shadow-sm border border-dark-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-green-900/20 rounded-lg">
                    <DollarSign className="w-5 h-5 text-green-600" />
                  </div>
                  <span className="text-dark-500 text-sm">{t.totalCost}</span>
                </div>
<p className="text-2xl sm:text-3xl font-bold text-dark-900">${totalCost.toFixed(4)}</p>
              </div>

              <div className="bg-dark-100 rounded-xl p-6 shadow-sm border border-dark-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-blue-900/20 rounded-lg">
                    <BarChart3 className="w-5 h-5 text-blue-600" />
                  </div>
                  <span className="text-dark-500 text-sm">{t.totalCalls}</span>
                </div>
<p className="text-2xl sm:text-3xl font-bold text-dark-900">{totalCalls.toLocaleString()}</p>
              </div>

              <div className="bg-dark-100 rounded-xl p-6 shadow-sm border border-dark-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-purple-900/20 rounded-lg">
                    <TrendingUp className="w-5 h-5 text-purple-600" />
                  </div>
                  <span className="text-dark-500 text-sm">{t.successRate}</span>
                </div>
<p className="text-2xl sm:text-3xl font-bold text-dark-900">{successRate}%</p>
              </div>
            </div>

            {/* Ticket Summary */}
            {ticketStats.total > 0 && (
              <div className="mb-8">
                <Link
                  to="/admin/tickets"
                  className="bg-dark-100 rounded-xl p-5 border border-dark-100 flex items-center justify-between hover:border-primary-500/30 transition-colors block"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary-900/20 rounded-lg">
                      <MessageSquarePlus className="w-5 h-5 text-primary-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-dark-900">
                        {language === 'es' ? 'Tickets de Feedback' : 'Feedback Tickets'}
                      </p>
                      <p className="text-xs text-dark-500">{ticketStats.total} total</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                    {ticketStats.urgent > 0 && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-900/20">
                        <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                        <span className="text-xs font-bold text-red-400">{ticketStats.urgent}</span>
                        <span className="text-[10px] text-red-400/70">{language === 'es' ? 'urgentes' : 'urgent'}</span>
                      </div>
                    )}
                    {ticketStats.open > 0 && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-900/20">
                        <Clock className="w-3.5 h-3.5 text-green-400" />
                        <span className="text-xs font-bold text-green-400">{ticketStats.open}</span>
                        <span className="text-[10px] text-green-400/70">{language === 'es' ? 'abiertos' : 'open'}</span>
                      </div>
                    )}
                    {ticketStats.in_progress > 0 && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-900/20">
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-xs font-bold text-amber-400">{ticketStats.in_progress}</span>
                        <span className="text-[10px] text-amber-400/70">{language === 'es' ? 'en progreso' : 'in progress'}</span>
                      </div>
                    )}
                  </div>
                </Link>
              </div>
            )}

            {/* Revenue & Billing Section */}
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2 mb-4">
                <CreditCard className="w-5 h-5 text-green-500" />
                {language === 'es' ? 'Ingresos y Facturación' : 'Revenue & Billing'}
              </h2>

              {/* Revenue KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-dark-100 rounded-xl p-4 border border-dark-100">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="w-4 h-4 text-green-500" />
                    <span className="text-xs text-dark-500">{language === 'es' ? 'Ingresos Totales' : 'Total Revenue'}</span>
                  </div>
                  <p className="text-2xl font-bold text-dark-900">${totalRevenue.toFixed(2)}</p>
                  {boostRevenue > 0 && (
                    <p className="text-[10px] text-dark-400 mt-0.5">
                      ${boostRevenue.toFixed(2)} {language === 'es' ? 'de boosts' : 'from boosts'}
                    </p>
                  )}
                </div>
                <div className="bg-dark-100 rounded-xl p-4 border border-dark-100">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-4 h-4 text-blue-500" />
                    <span className="text-xs text-dark-500">MRR</span>
                  </div>
                  <p className="text-2xl font-bold text-dark-900">${mrr.toFixed(0)}</p>
                  <p className="text-[10px] text-dark-400 mt-0.5">
                    {activePaidSubs.length} {language === 'es' ? 'suscriptores activos' : 'active subscribers'}
                  </p>
                </div>
                <div className="bg-dark-100 rounded-xl p-4 border border-dark-100">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="w-4 h-4 text-purple-500" />
                    <span className="text-xs text-dark-500">{language === 'es' ? 'Suscriptores de Pago' : 'Paid Subscribers'}</span>
                  </div>
                  <p className="text-2xl font-bold text-dark-900">{activePaidSubs.length}</p>
                  <p className="text-[10px] text-dark-400 mt-0.5">
                    {allSubscriptions.length} total
                  </p>
                </div>
                <div className="bg-dark-100 rounded-xl p-4 border border-dark-100">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingDown className="w-4 h-4 text-red-500" />
                    <span className="text-xs text-dark-500">{language === 'es' ? 'Tasa de Abandono' : 'Churn Rate'}</span>
                  </div>
                  <p className="text-2xl font-bold text-dark-900">{churnRate}%</p>
                  <p className="text-[10px] text-dark-400 mt-0.5">
                    {cancelledSubs.length} {language === 'es' ? 'cancelados' : 'cancelled'}
                  </p>
                </div>
              </div>

              {/* Plan Distribution */}
              {Object.keys(planDistribution).length > 0 && (
                <div className="bg-dark-100 rounded-xl p-5 border border-dark-100 mb-6">
                  <h3 className="text-sm font-semibold text-dark-700 mb-3">
                    {language === 'es' ? 'Distribución por Plan' : 'Plan Distribution'}
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(planDistribution)
                      .sort((a, b) => b[1] - a[1])
                      .map(([plan, count]) => (
                        <div key={plan} className="flex items-center gap-3">
                          <div className="w-24 text-xs font-medium text-dark-700 capitalize">{plan.replace('_', ' ')}</div>
                          <div className="flex-1 h-5 bg-dark-50 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${PLAN_COLORS[plan] || 'bg-gray-400'} transition-all`}
                              style={{ width: `${Math.max(2, (count / totalSubsCount) * 100)}%` }}
                            />
                          </div>
                          <div className="w-20 text-right">
                            <span className="text-sm font-bold text-dark-900">{count}</span>
                            <span className="text-xs text-dark-400 ml-1">({((count / totalSubsCount) * 100).toFixed(0)}%)</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Billing Tabs */}
              <div className="flex gap-2 mb-4">
                {(['overview', 'payments', 'subscriptions'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setBillingTab(tab)}
                    className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${
                      billingTab === tab
                        ? 'bg-primary-600 text-white'
                        : 'bg-dark-50 text-dark-600 hover:bg-dark-100'
                    }`}
                  >
                    {tab === 'overview' ? (language === 'es' ? 'Resumen' : 'Overview')
                      : tab === 'payments' ? (language === 'es' ? 'Pagos' : 'Payments')
                      : (language === 'es' ? 'Suscripciones' : 'Subscriptions')}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              {billingTab === 'overview' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Recent Payments Mini */}
                  <div className="bg-dark-100 rounded-xl border border-dark-100">
                    <div className="p-4 border-b border-dark-50 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-dark-700 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-green-500" />
                        {language === 'es' ? 'Últimos Pagos' : 'Recent Payments'}
                      </h3>
                      <button onClick={() => setBillingTab('payments')} className="text-xs text-primary-500 hover:text-primary-600">
                        {language === 'es' ? 'Ver todos' : 'View all'}
                      </button>
                    </div>
                    <div className="divide-y divide-dark-50 max-h-64 overflow-y-auto">
                      {allPayments.slice(0, 8).map(p => (
                        <div key={p.id} className="px-4 py-2.5 flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium text-dark-900">{p.user_email}</p>
                            <p className="text-[10px] text-dark-400">{p.plan || '-'} &middot; {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '-'}</p>
                          </div>
                          <div className="text-right">
                            <p className={`text-sm font-bold ${p.status === 'succeeded' ? 'text-green-500' : p.status === 'failed' ? 'text-red-400' : 'text-amber-400'}`}>
                              ${Number(p.amount).toFixed(2)}
                            </p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              p.status === 'succeeded' ? 'bg-green-900/20 text-green-400'
                                : p.status === 'failed' ? 'bg-red-900/20 text-red-400'
                                : 'bg-amber-900/20 text-amber-400'
                            }`}>{p.status}</span>
                          </div>
                        </div>
                      ))}
                      {allPayments.length === 0 && (
                        <div className="px-4 py-6 text-center text-xs text-dark-400">
                          {language === 'es' ? 'No hay pagos registrados' : 'No payments recorded'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Boost Sales Mini */}
                  <div className="bg-dark-100 rounded-xl border border-dark-100">
                    <div className="p-4 border-b border-dark-50">
                      <h3 className="text-sm font-semibold text-dark-700 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-500" />
                        {language === 'es' ? 'Ventas de Image Boost' : 'Image Boost Sales'}
                      </h3>
                    </div>
                    <div className="p-4">
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <p className="text-xs text-dark-400">{language === 'es' ? 'Compras' : 'Purchases'}</p>
                          <p className="text-2xl font-bold text-dark-900">{boostPayments.length}</p>
                        </div>
                        <div>
                          <p className="text-xs text-dark-400">{language === 'es' ? 'Ingresos' : 'Revenue'}</p>
                          <p className="text-2xl font-bold text-green-500">${boostRevenue.toFixed(2)}</p>
                        </div>
                      </div>
                      {boostPayments.length > 0 && (
                        <div className="divide-y divide-dark-50 max-h-36 overflow-y-auto">
                          {boostPayments.slice(0, 5).map(p => (
                            <div key={p.id} className="py-2 flex items-center justify-between">
                              <span className="text-xs text-dark-600">{p.user_email}</span>
                              <span className="text-xs text-dark-400">{p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '-'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {billingTab === 'payments' && (
                <div className="bg-dark-100 rounded-xl border border-dark-100">
                  <div className="p-4 border-b border-dark-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-dark-700">
                      {language === 'es' ? `Todos los Pagos (${allPayments.length})` : `All Payments (${allPayments.length})`}
                    </h3>
                    <div className="relative">
                      <Search className="w-4 h-4 text-dark-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={paymentSearch}
                        onChange={(e) => setPaymentSearch(e.target.value)}
                        placeholder={language === 'es' ? 'Buscar por email o plan...' : 'Search by email or plan...'}
                        className="pl-9 pr-3 py-1.5 text-sm bg-dark-50 border border-dark-200 rounded-lg text-dark-900 w-full sm:w-60"
                      />
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full">
                      <thead className="bg-dark-50 sticky top-0">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Fecha' : 'Date'}</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Usuario' : 'User'}</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-500 uppercase">Plan</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Monto' : 'Amount'}</th>
                          <th className="px-4 py-2.5 text-center text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Estado' : 'Status'}</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Descripción' : 'Description'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-dark-50">
                        {filteredPayments.map(p => (
                          <tr key={p.id} className="hover:bg-dark-50">
                            <td className="px-4 py-2.5 text-sm text-dark-600 whitespace-nowrap">
                              {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : new Date(p.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-dark-900 font-medium">{p.user_email}</td>
                            <td className="px-4 py-2.5">
                              <span className={`text-xs px-2 py-0.5 rounded ${PLAN_COLORS[p.plan || ''] ? PLAN_COLORS[p.plan || ''] + ' text-white' : 'bg-dark-50 text-dark-600'}`}>
                                {p.plan || '-'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right text-sm font-bold text-dark-900">
                              ${Number(p.amount).toFixed(2)} <span className="text-xs text-dark-400 font-normal">{p.currency}</span>
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded ${
                                p.status === 'succeeded' ? 'bg-green-900/20 text-green-400'
                                  : p.status === 'failed' ? 'bg-red-900/20 text-red-400'
                                  : p.status === 'refunded' ? 'bg-purple-900/20 text-purple-400'
                                  : 'bg-amber-900/20 text-amber-400'
                              }`}>{p.status}</span>
                            </td>
                            <td className="px-4 py-2.5 text-sm text-dark-500 max-w-40 truncate">{p.description || '-'}</td>
                          </tr>
                        ))}
                        {filteredPayments.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-sm text-dark-400">
                              {language === 'es' ? 'No hay pagos' : 'No payments found'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {billingTab === 'subscriptions' && (
                <div className="bg-dark-100 rounded-xl border border-dark-100">
                  <div className="p-4 border-b border-dark-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-dark-700">
                      {language === 'es' ? `Todas las Suscripciones (${allSubscriptions.length})` : `All Subscriptions (${allSubscriptions.length})`}
                    </h3>
                    <div className="relative">
                      <Search className="w-4 h-4 text-dark-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={subsSearch}
                        onChange={(e) => setSubsSearch(e.target.value)}
                        placeholder={language === 'es' ? 'Buscar por email o plan...' : 'Search by email or plan...'}
                        className="pl-9 pr-3 py-1.5 text-sm bg-dark-50 border border-dark-200 rounded-lg text-dark-900 w-full sm:w-60"
                      />
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full">
                      <thead className="bg-dark-50 sticky top-0">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Usuario' : 'User'}</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-500 uppercase">Plan</th>
                          <th className="px-4 py-2.5 text-center text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Estado' : 'Status'}</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Vence' : 'Period End'}</th>
                          <th className="px-4 py-2.5 text-center text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Cancela' : 'Cancels'}</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-500 uppercase">TiloPay ID</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Actualizado' : 'Updated'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-dark-50">
                        {filteredSubs.map(s => {
                          const isNearExpiry = s.current_period_end && new Date(s.current_period_end).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
                          return (
                            <tr key={s.id} className="hover:bg-dark-50">
                              <td className="px-4 py-2.5">
                                <div>
                                  <p className="text-sm font-medium text-dark-900">{s.user_name || '-'}</p>
                                  <p className="text-xs text-dark-500">{s.user_email}</p>
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`text-xs px-2 py-0.5 rounded ${PLAN_COLORS[s.plan] ? PLAN_COLORS[s.plan] + ' text-white' : 'bg-dark-50 text-dark-600'}`}>
                                  {s.plan}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${
                                  s.status === 'active' ? 'bg-green-900/20 text-green-400'
                                    : s.status === 'trialing' ? 'bg-blue-900/20 text-blue-400'
                                    : s.status === 'cancelled' ? 'bg-red-900/20 text-red-400'
                                    : s.status === 'past_due' ? 'bg-amber-900/20 text-amber-400'
                                    : 'bg-dark-50 text-dark-500'
                                }`}>
                                  {s.status === 'active' && <CheckCircle className="w-3 h-3" />}
                                  {s.status === 'cancelled' && <XCircle className="w-3 h-3" />}
                                  {s.status === 'trialing' && <Clock className="w-3 h-3" />}
                                  {s.status}
                                </span>
                              </td>
                              <td className={`px-4 py-2.5 text-sm ${isNearExpiry ? 'text-amber-400 font-semibold' : 'text-dark-600'}`}>
                                {s.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : '-'}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                {s.cancel_at_period_end ? (
                                  <span className="text-xs px-2 py-0.5 rounded bg-red-900/20 text-red-400">{language === 'es' ? 'Sí' : 'Yes'}</span>
                                ) : (
                                  <span className="text-xs text-dark-400">-</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-xs text-dark-500 font-mono max-w-32 truncate">
                                {s.tilopay_subscription_id || '-'}
                              </td>
                              <td className="px-4 py-2.5 text-xs text-dark-500">
                                {new Date(s.updated_at).toLocaleDateString()}
                              </td>
                            </tr>
                          )
                        })}
                        {filteredSubs.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-sm text-dark-400">
                              {language === 'es' ? 'No hay suscripciones' : 'No subscriptions found'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Referral Tracking Section */}
            {campaigns.length > 0 && (
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2 mb-4">
                  <Gift className="w-5 h-5 text-purple-500" />
                  {language === 'es' ? 'Seguimiento de Referidos' : 'Referral Tracking'}
                </h2>

                {/* Referral Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-dark-100 rounded-xl p-4 border border-dark-100">
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="w-4 h-4 text-purple-500" />
                      <span className="text-xs text-dark-500">{language === 'es' ? 'Total Referidos' : 'Total Signups'}</span>
                    </div>
                    <p className="text-2xl font-bold text-dark-900">{referralSignups.length}</p>
                  </div>
                  <div className="bg-dark-100 rounded-xl p-4 border border-dark-100">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="w-4 h-4 text-blue-500" />
                      <span className="text-xs text-dark-500">{language === 'es' ? 'Trials Activos' : 'Active Trials'}</span>
                    </div>
                    <p className="text-2xl font-bold text-dark-900">
                      {referralSignups.filter(s => new Date(s.trial_ends_at) > new Date() && s.current_status === 'trialing').length}
                    </p>
                  </div>
                  <div className="bg-dark-100 rounded-xl p-4 border border-dark-100">
                    <div className="flex items-center gap-2 mb-1">
                      <XCircle className="w-4 h-4 text-amber-500" />
                      <span className="text-xs text-dark-500">{language === 'es' ? 'Trials Expirados' : 'Expired Trials'}</span>
                    </div>
                    <p className="text-2xl font-bold text-dark-900">
                      {referralSignups.filter(s => new Date(s.trial_ends_at) <= new Date() && !s.converted_to_paid).length}
                    </p>
                  </div>
                  <div className="bg-dark-100 rounded-xl p-4 border border-dark-100">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-xs text-dark-500">{language === 'es' ? 'Convertidos' : 'Converted'}</span>
                    </div>
                    <p className="text-2xl font-bold text-dark-900">
                      {referralSignups.filter(s => s.converted_to_paid).length}
                    </p>
                  </div>
                </div>

                {/* Campaign Cards */}
                {campaigns.map(campaign => (
                  <div key={campaign.id} className="bg-dark-100 rounded-xl border border-dark-100 mb-4">
                    <div className="p-5 border-b border-dark-50">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${campaign.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
                          <div>
                            <h3 className="font-semibold text-dark-900">{campaign.name}</h3>
                            <p className="text-xs text-dark-500">
                              {campaign.plan} &middot; {campaign.trial_days} {language === 'es' ? 'días de prueba' : 'day trial'}
                              {campaign.expires_at && ` &middot; ${language === 'es' ? 'Expira' : 'Expires'}: ${new Date(campaign.expires_at).toLocaleDateString()}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-sm font-medium text-dark-700">
                            {campaign.current_signups}{campaign.max_signups ? `/${campaign.max_signups}` : ''} {language === 'es' ? 'registros' : 'signups'}
                          </span>
                          <button
                            onClick={() => {
                              const url = `${window.location.origin}/signup?ref=${campaign.code}`
                              navigator.clipboard.writeText(url)
                              setCopiedCode(campaign.code)
                              setTimeout(() => setCopiedCode(null), 2000)
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-900/20 text-purple-400 hover:bg-purple-900/30 transition-colors"
                          >
                            {copiedCode === campaign.code ? (
                              <><CheckCircle className="w-3.5 h-3.5" /> {language === 'es' ? 'Copiado' : 'Copied'}</>
                            ) : (
                              <><Copy className="w-3.5 h-3.5" /> {language === 'es' ? 'Copiar Link' : 'Copy Link'}</>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Signups Table for this campaign */}
                    {referralSignups.filter(s => s.campaign_id === campaign.id).length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-dark-50">
                            <tr>
                              <th className="px-5 py-2.5 text-left text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Usuario' : 'User'}</th>
                              <th className="px-5 py-2.5 text-left text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Registro' : 'Signed Up'}</th>
                              <th className="px-5 py-2.5 text-left text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Trial Expira' : 'Trial Ends'}</th>
                              <th className="px-5 py-2.5 text-center text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Días Rest.' : 'Days Left'}</th>
                              <th className="px-5 py-2.5 text-center text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Plan Actual' : 'Current Plan'}</th>
                              <th className="px-5 py-2.5 text-center text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Estado' : 'Status'}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-dark-50">
                            {referralSignups.filter(s => s.campaign_id === campaign.id).map(signup => {
                              const daysLeft = Math.max(0, Math.ceil((new Date(signup.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                              const isExpired = daysLeft === 0
                              const isConverted = signup.converted_to_paid || (signup.current_plan !== 'free' && signup.current_plan !== 'meta_advanze' && signup.current_status === 'active')
                              return (
                                <tr key={signup.id} className="hover:bg-dark-50">
                                  <td className="px-5 py-3">
                                    <div>
                                      <p className="text-sm font-medium text-dark-900">{signup.user_name || '-'}</p>
                                      <p className="text-xs text-dark-500">{signup.user_email}</p>
                                    </div>
                                  </td>
                                  <td className="px-5 py-3 text-sm text-dark-600">
                                    {new Date(signup.signed_up_at).toLocaleDateString()}
                                  </td>
                                  <td className="px-5 py-3 text-sm text-dark-600">
                                    {new Date(signup.trial_ends_at).toLocaleDateString()}
                                  </td>
                                  <td className="px-5 py-3 text-center">
                                    <span className={`text-sm font-semibold ${isExpired ? 'text-red-400' : daysLeft <= 14 ? 'text-amber-400' : 'text-green-400'}`}>
                                      {isExpired ? '0' : daysLeft}
                                    </span>
                                  </td>
                                  <td className="px-5 py-3 text-center">
                                    <span className="text-xs px-2 py-1 rounded bg-dark-50 text-dark-700 capitalize">
                                      {signup.current_plan}
                                    </span>
                                  </td>
                                  <td className="px-5 py-3 text-center">
                                    {isConverted ? (
                                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-green-900/20 text-green-400">
                                        <CheckCircle className="w-3 h-3" /> {language === 'es' ? 'Convertido' : 'Converted'}
                                      </span>
                                    ) : isExpired ? (
                                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-900/20 text-red-400">
                                        <XCircle className="w-3 h-3" /> {language === 'es' ? 'Expirado' : 'Expired'}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-900/20 text-blue-400">
                                        <Clock className="w-3 h-3" /> {language === 'es' ? 'En Trial' : 'Trialing'}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Usage by Model */}
            <div className="bg-dark-100 rounded-xl shadow-sm border border-dark-100 mb-8">
              <div className="p-4 sm:p-6 border-b border-dark-100">
                <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-primary-500" />
                  {t.byModel}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-dark-50">
                    <tr>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-dark-500 uppercase">{t.model}</th>
                      <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.calls}</th>
                      <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.tokens}</th>
                      <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.cost}</th>
                      <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.pricing}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-100">
                    {Object.entries(byModel).map(([model, data]) => (
                      <tr key={model} className="hover:bg-dark-50">
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <div className="flex items-center gap-2 sm:gap-3">
                            <div className={`w-3 h-3 rounded-full flex-shrink-0 ${MODEL_INFO[model]?.color || 'bg-gray-400'}`} />
                            <span className="font-medium text-dark-900 text-sm sm:text-base">
                              {MODEL_INFO[model]?.name || model}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4 text-right text-dark-700 text-sm">{data.calls.toLocaleString()}</td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4 text-right text-dark-700 text-sm">{data.tokens.toLocaleString()}</td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4 text-right font-medium text-dark-900 text-sm">${data.cost.toFixed(4)}</td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4 text-right text-dark-500 text-xs sm:text-sm">{MODEL_PRICING[model] || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Image Model Performance */}
            <div className="bg-dark-100 rounded-xl shadow-sm border border-dark-100 mb-8">
              <div className="p-4 sm:p-6 border-b border-dark-100">
                <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-primary-500" />
                  {language === 'es' ? 'Rendimiento de Modelos de Imagen' : 'Image Model Performance'}
                </h2>
                <p className="text-xs text-dark-400 mt-1">
                  {language === 'es'
                    ? 'Costos y votos se correlacionan por generation_id cuando existe; filas antiguas sin ID aparecen como no correlacionadas.'
                    : 'Costs and votes are correlated by generation_id when available; older rows without IDs are shown as uncorrelated.'}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-dark-50">
                    <tr>
                      <th className="px-3 sm:px-5 py-3 text-left text-xs font-medium text-dark-500 uppercase">{t.model}</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Intentos' : 'Attempts'}</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.success}</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.failed}</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Posts' : 'Posts'}</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.cost}</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Costo/ok' : 'Cost/ok'}</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Arriba' : 'Up'}</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Abajo' : 'Down'}</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? '% arriba' : 'Up %'}</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? '$/arriba' : '$/up'}</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Sin ID' : 'No ID'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-100">
                    {imageModelPerformance.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-5 py-6 text-sm text-dark-400 text-center">
                          {language === 'es' ? 'Sin datos de imagen en este rango.' : 'No image data in this range.'}
                        </td>
                      </tr>
                    ) : imageModelPerformance.map(row => (
                      <tr key={row.model} className="hover:bg-dark-50">
                        <td className="px-3 sm:px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full flex-shrink-0 ${MODEL_INFO[row.model]?.color || 'bg-gray-400'}`} />
                            <span className="font-medium text-dark-900 text-sm">{MODEL_INFO[row.model]?.name || row.model}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-sm text-right text-dark-700">{row.attempts.toLocaleString()}</td>
                        <td className="px-3 py-3 text-sm text-right text-dark-700">{row.successes.toLocaleString()}</td>
                        <td className="px-3 py-3 text-sm text-right text-dark-700">{row.failures.toLocaleString()}</td>
                        <td className="px-3 py-3 text-sm text-right text-dark-700">{row.posts_generated.toLocaleString()}</td>
                        <td className="px-3 py-3 text-sm text-right font-medium text-dark-900">${row.total_cost_usd.toFixed(4)}</td>
                        <td className="px-3 py-3 text-sm text-right text-dark-700">${row.avg_cost_success_usd.toFixed(4)}</td>
                        <td className="px-3 py-3 text-sm text-right text-emerald-600">{row.upvotes}</td>
                        <td className="px-3 py-3 text-sm text-right text-red-500">{row.downvotes}</td>
                        <td className="px-3 py-3 text-sm text-right text-dark-700">{row.upvote_rate === null ? '-' : `${(row.upvote_rate * 100).toFixed(1)}%`}</td>
                        <td className="px-3 py-3 text-sm text-right text-dark-700">{row.cost_per_upvote_usd === null ? '-' : `$${row.cost_per_upvote_usd.toFixed(4)}`}</td>
                        <td className="px-3 py-3 text-xs text-right text-dark-500">{row.uncorrelated_logs + row.uncorrelated_posts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Usage by Feature */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              <div className="bg-dark-100 rounded-xl shadow-sm border border-dark-100">
                <div className="p-6 border-b border-dark-100">
                  <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary-500" />
                    {t.byFeature}
                  </h2>
                </div>
                <div className="p-6 space-y-4">
                  {Object.entries(byFeature).map(([feature, data]) => (
                    <div key={feature} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {feature === 'script' && <FileText className="w-5 h-5 text-blue-500" />}
                        {feature === 'description' && <FileText className="w-5 h-5 text-indigo-500" />}
                        {feature === 'image' && <ImageIcon className="w-5 h-5 text-green-500" />}
                        {feature === 'edit' && <Pencil className="w-5 h-5 text-emerald-500" />}
                        {feature === 'enhance' && <Wand2 className="w-5 h-5 text-pink-500" />}
                        {feature === 'prompt_condense' && <Cpu className="w-5 h-5 text-indigo-500" />}
                        {feature === 'paste_organize' && <FileText className="w-5 h-5 text-purple-500" />}
                        {feature === 'prompt_enhance' && <Sparkles className="w-5 h-5 text-amber-500" />}
                        {feature === 'pdf_extract' && <FileUp className="w-5 h-5 text-orange-500" />}
                        {feature === 'url_fetch' && <Link2 className="w-5 h-5 text-teal-500" />}
                        {feature === 'voice_transcription' && <Mic className="w-5 h-5 text-rose-500" />}
                        {feature === 'script_edit' && <Pencil className="w-5 h-5 text-sky-500" />}
                        {feature === 'script_enhance' && <Wand2 className="w-5 h-5 text-amber-600" />}
                        {feature === 'script_hook' && <FileText className="w-5 h-5 text-blue-400" />}
                        {feature === 'script_consciousness' && <Sparkles className="w-5 h-5 text-violet-400" />}
                        {feature === 'style_analysis' && <ImageIcon className="w-5 h-5 text-fuchsia-500" />}
                        {feature === 'memory_reflection' && <Zap className="w-5 h-5 text-yellow-500" />}
                        {feature === 'memory_synthesis' && <Zap className="w-5 h-5 text-yellow-600" />}
                        {feature === 'brand_extraction' && <Sparkles className="w-5 h-5 text-indigo-500" />}
                        {feature === 'reply' && <MessageSquarePlus className="w-5 h-5 text-teal-500" />}
                        {feature === 'ocr' && <FileText className="w-5 h-5 text-gray-500" />}
                        {feature === 'logo' && <Sparkles className="w-5 h-5 text-pink-500" />}
                        <span className="font-medium text-dark-900">
                          {t[feature as keyof typeof t] || feature}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-dark-900">{data.calls} {t.calls.toLowerCase()}</p>
                        <p className="text-sm text-dark-500">${data.cost.toFixed(4)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Daily Trend (simplified) */}
              <div className="bg-dark-100 rounded-xl shadow-sm border border-dark-100">
                <div className="p-6 border-b border-dark-100">
                  <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-primary-500" />
                    {t.dailyTrend}
                  </h2>
                </div>
                <div className="p-6 max-h-64 overflow-y-auto">
                  {dailyUsage.slice(0, 14).map((day, i) => (
                    <div key={`${day.day}-${day.model}-${i}`} className="flex items-center justify-between py-2 border-b border-dark-50 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-dark-500">{new Date(day.day).toLocaleDateString()}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${MODEL_INFO[day.model]?.color || 'bg-gray-400'} text-white`}>
                          {day.model}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-medium text-dark-700">{day.total_calls} calls</span>
                        <span className="text-xs text-dark-400 ml-2">${Number(day.total_cost_usd).toFixed(4)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* User Activity */}
            {userStats.length > 0 && (
              <div className="bg-dark-100 rounded-xl shadow-sm border border-dark-100 mb-8">
                <div className="p-4 sm:p-6 border-b border-dark-100">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
                      <Users className="w-5 h-5 text-primary-500" />
                      {language === 'es' ? 'Actividad por Usuario' : 'User Activity'}
                    </h2>
                    <div className="relative">
                      <Search className="w-4 h-4 text-dark-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={userStatsSearch}
                        onChange={(e) => setUserStatsSearch(e.target.value)}
                        placeholder={language === 'es' ? 'Buscar usuario...' : 'Search user...'}
                        className="pl-9 pr-3 py-1.5 text-sm bg-dark-50 border border-dark-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 w-full sm:w-56"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-dark-400 mt-1">
                    {language === 'es' ? `${filteredUserStats.length} usuarios activos` : `${filteredUserStats.length} active users`}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-dark-50">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs font-medium text-dark-500 uppercase">{t.user}</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Guiones' : 'Scripts'}</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Desc.' : 'Desc.'}</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Imágenes' : 'Images'}</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Voz' : 'Voice'}</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Otro' : 'Other'}</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.calls}</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.cost}</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-dark-500 uppercase">{language === 'es' ? 'Última Act.' : 'Last Active'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-100">
                      {filteredUserStats.map((u) => (
                        <tr key={u.user_id || u.user_email} className="hover:bg-dark-50">
                          <td className="px-5 py-3">
                            <span className="text-sm text-dark-700 font-medium">{u.user_email || '-'}</span>
                          </td>
                          <td className="px-3 py-3 text-sm text-right text-dark-700">{u.script_calls || 0}</td>
                          <td className="px-3 py-3 text-sm text-right text-dark-700">{u.description_calls || 0}</td>
                          <td className="px-3 py-3 text-sm text-right text-dark-700">{u.image_calls || 0}</td>
                          <td className="px-3 py-3 text-sm text-right text-dark-700">{u.voice_calls || 0}</td>
                          <td className="px-3 py-3 text-sm text-right text-dark-700">{u.other_calls || 0}</td>
                          <td className="px-3 py-3 text-sm text-right font-medium text-dark-900">{u.total_calls}</td>
                          <td className="px-3 py-3 text-sm text-right font-medium text-dark-900">${Number(u.total_cost_usd).toFixed(4)}</td>
                          <td className="px-4 py-3 text-xs text-right text-dark-500">{new Date(u.last_active).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recent Activity — searchable + paginated */}
            <div className="bg-dark-100 rounded-xl shadow-sm border border-dark-100">
              <div className="p-4 sm:p-6 border-b border-dark-100">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-dark-900">{t.recentActivity}</h2>
                  <div className="relative">
                    <Search className="w-4 h-4 text-dark-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') fetchLogs(logSearch) }}
                      placeholder={language === 'es' ? 'Buscar por email...' : 'Search by email...'}
                      className="pl-9 pr-3 py-1.5 text-sm bg-dark-50 border border-dark-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 w-full sm:w-64"
                    />
                  </div>
                </div>
                <p className="text-xs text-dark-400 mt-1">
                  {language === 'es' ? `Mostrando ${recentLogs.length} registros` : `Showing ${recentLogs.length} logs`}
                  {logSearch && (language === 'es' ? ` — filtrado por "${logSearch}"` : ` — filtered by "${logSearch}"`)}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-dark-50">
                    <tr>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-dark-500 uppercase">{t.time}</th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-dark-500 uppercase">{t.user}</th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-dark-500 uppercase">{t.feature}</th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-dark-500 uppercase">{t.model}</th>
                      <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.tokens}</th>
                      <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.cost}</th>
                      <th className="px-3 sm:px-6 py-3 text-center text-xs font-medium text-dark-500 uppercase">{t.status}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-100">
                    {recentLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-dark-50">
                        <td className="px-3 sm:px-6 py-3 text-xs sm:text-sm text-dark-500 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 sm:px-6 py-3 text-xs sm:text-sm text-dark-700">{log.user_email || '-'}</td>
                        <td className="px-3 sm:px-6 py-3 text-xs sm:text-sm text-dark-700">
                          {t[log.feature as keyof typeof t] || log.feature}
                        </td>
                        <td className="px-3 sm:px-6 py-3">
                          <span className={`text-xs px-2 py-1 rounded ${MODEL_INFO[log.model]?.color || 'bg-gray-400'} text-white`}>
                            {MODEL_INFO[log.model]?.name || log.model}
                          </span>
                        </td>
                        <td className="px-3 sm:px-6 py-3 text-xs sm:text-sm text-right text-dark-700">{log.total_tokens?.toLocaleString() || '-'}</td>
                        <td className="px-3 sm:px-6 py-3 text-xs sm:text-sm text-right font-medium text-dark-900">
                          ${Number(log.estimated_cost_usd).toFixed(6)}
                        </td>
                        <td className="px-3 sm:px-6 py-3 text-center">
                          <span className={`text-xs px-2 py-1 rounded ${log.success ? 'bg-green-900/20 text-green-700' : 'bg-red-900/20 text-red-700'}`}>
                            {log.success ? t.success : t.failed}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Load More */}
              {hasMoreLogs && (
                <div className="p-4 border-t border-dark-100 flex justify-center">
                  <button
                    onClick={loadMoreLogs}
                    disabled={loadingMoreLogs}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-dark-600 hover:text-dark-900 bg-dark-50 hover:bg-dark-200 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {loadingMoreLogs ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                    {language === 'es' ? 'Cargar más' : 'Load more'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
