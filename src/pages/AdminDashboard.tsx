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
  AlertCircle
} from 'lucide-react'

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
  total_tokens: number
  estimated_cost_usd: number
  success: boolean
  created_at: string
}

// Model display names and colors
const MODEL_INFO: Record<string, { name: string; color: string }> = {
  'grok': { name: 'Grok (xAI)', color: 'bg-purple-500' },
  'gemini': { name: 'Gemini 3 Pro', color: 'bg-blue-500' },
  'flux': { name: 'Flux Klein', color: 'bg-green-500' },
  'nano-banana': { name: 'Nano Banana', color: 'bg-yellow-500' },
  'nano-banana-pro': { name: 'Nano Banana Pro', color: 'bg-orange-500' },
}

// Cost per 1M tokens or per image (for reference display)
const MODEL_PRICING: Record<string, string> = {
  'grok': '$3/1M in, $15/1M out',
  'gemini': '$0.15/1M in, $0.60/1M out',
  'flux': '~$0.003/image',
  'nano-banana': '~$0.02/image',
  'nano-banana-pro': '~$0.05/image',
}

// Admin emails (only these can access)
const ADMIN_EMAILS = ['ralauas@gmail.com', 'admin@advanceai.studio', 'ian@iankupfer.com']

export default function AdminDashboard() {
  const { user } = useAuth()
  const { language } = useLanguage()
  
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [usageSummary, setUsageSummary] = useState<UsageSummary[]>([])
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([])
  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([])
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d'>('30d')

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
      image: 'Imágenes',
      paste_organize: 'Auto-llenado',
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
      image: 'Images',
      paste_organize: 'Auto-fill',
      noData: 'No usage data yet',
      user: 'User',
      time: 'Time',
      status: 'Status',
      success: 'Success',
      failed: 'Failed'
    }
  }

  const t = labels[language]

  const isAdmin = user?.email && ADMIN_EMAILS.includes(user.email)

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

      // Fetch recent logs
      const { data: logsData, error: logsError } = await supabase
        .from('api_usage_logs')
        .select('id, user_email, feature, model, total_tokens, estimated_cost_usd, success, created_at')
        .order('created_at', { ascending: false })
        .limit(50)

      if (logsError) throw logsError
      setRecentLogs(logsData || [])

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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-dark-900">{t.title}</h1>
            <p className="text-dark-500 mt-1">{t.subtitle}</p>
          </div>
          <div className="flex items-center gap-4">
            {/* Date Range Selector */}
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as '7d' | '30d' | '90d')}
              className="px-3 py-2 border border-dark-200 rounded-lg text-sm"
            >
              <option value="7d">{t.last7days}</option>
              <option value="30d">{t.last30days}</option>
              <option value="90d">{t.last90days}</option>
            </select>
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
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg mb-6">
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
              <div className="bg-white rounded-xl p-6 shadow-sm border border-dark-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <DollarSign className="w-5 h-5 text-green-600" />
                  </div>
                  <span className="text-dark-500 text-sm">{t.totalCost}</span>
                </div>
                <p className="text-3xl font-bold text-dark-900">${totalCost.toFixed(4)}</p>
              </div>

              <div className="bg-white rounded-xl p-6 shadow-sm border border-dark-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <BarChart3 className="w-5 h-5 text-blue-600" />
                  </div>
                  <span className="text-dark-500 text-sm">{t.totalCalls}</span>
                </div>
                <p className="text-3xl font-bold text-dark-900">{totalCalls.toLocaleString()}</p>
              </div>

              <div className="bg-white rounded-xl p-6 shadow-sm border border-dark-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <TrendingUp className="w-5 h-5 text-purple-600" />
                  </div>
                  <span className="text-dark-500 text-sm">{t.successRate}</span>
                </div>
                <p className="text-3xl font-bold text-dark-900">{successRate}%</p>
              </div>
            </div>

            {/* Usage by Model */}
            <div className="bg-white rounded-xl shadow-sm border border-dark-100 mb-8">
              <div className="p-6 border-b border-dark-100">
                <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-primary-500" />
                  {t.byModel}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-dark-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-dark-500 uppercase">{t.model}</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.calls}</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.tokens}</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.cost}</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.pricing}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-100">
                    {Object.entries(byModel).map(([model, data]) => (
                      <tr key={model} className="hover:bg-dark-50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${MODEL_INFO[model]?.color || 'bg-gray-400'}`} />
                            <span className="font-medium text-dark-900">
                              {MODEL_INFO[model]?.name || model}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right text-dark-700">{data.calls.toLocaleString()}</td>
                        <td className="px-6 py-4 text-right text-dark-700">{data.tokens.toLocaleString()}</td>
                        <td className="px-6 py-4 text-right font-medium text-dark-900">${data.cost.toFixed(4)}</td>
                        <td className="px-6 py-4 text-right text-dark-500 text-sm">{MODEL_PRICING[model] || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Usage by Feature */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              <div className="bg-white rounded-xl shadow-sm border border-dark-100">
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
                        {feature === 'image' && <ImageIcon className="w-5 h-5 text-green-500" />}
                        {feature === 'paste_organize' && <FileText className="w-5 h-5 text-purple-500" />}
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
              <div className="bg-white rounded-xl shadow-sm border border-dark-100">
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

            {/* Recent Activity */}
            <div className="bg-white rounded-xl shadow-sm border border-dark-100">
              <div className="p-6 border-b border-dark-100">
                <h2 className="text-lg font-semibold text-dark-900">{t.recentActivity}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-dark-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-dark-500 uppercase">{t.time}</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-dark-500 uppercase">{t.user}</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-dark-500 uppercase">{t.feature}</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-dark-500 uppercase">{t.model}</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.tokens}</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-dark-500 uppercase">{t.cost}</th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-dark-500 uppercase">{t.status}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-100">
                    {recentLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-dark-50">
                        <td className="px-6 py-3 text-sm text-dark-500">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="px-6 py-3 text-sm text-dark-700">{log.user_email || '-'}</td>
                        <td className="px-6 py-3 text-sm text-dark-700">
                          {t[log.feature as keyof typeof t] || log.feature}
                        </td>
                        <td className="px-6 py-3">
                          <span className={`text-xs px-2 py-1 rounded ${MODEL_INFO[log.model]?.color || 'bg-gray-400'} text-white`}>
                            {MODEL_INFO[log.model]?.name || log.model}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-sm text-right text-dark-700">{log.total_tokens?.toLocaleString() || '-'}</td>
                        <td className="px-6 py-3 text-sm text-right font-medium text-dark-900">
                          ${Number(log.estimated_cost_usd).toFixed(6)}
                        </td>
                        <td className="px-6 py-3 text-center">
                          <span className={`text-xs px-2 py-1 rounded ${log.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {log.success ? t.success : t.failed}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
