import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useUsageLimits } from '../hooks/useUsageLimits'
import { getDashboardStats } from '../services/database'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import {
  FileText,
  ImageIcon,
  BarChart3,
  Clock,
  ArrowRight,
  Sparkles,
  Crown
} from 'lucide-react'

interface RecentScript {
  id: string
  title: string
  product_name: string
  created_at: string
}

interface ActivityStat {
  totalProducts: number
  totalScripts: number
  totalSessions: number
  scriptsThisMonth: number
}

export default function OverviewDashboard() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const usage = useUsageLimits()

  const [stats, setStats] = useState<ActivityStat>({
    totalProducts: 0,
    totalScripts: 0,
    totalSessions: 0,
    scriptsThisMonth: 0,
  })
  const [recentScripts, setRecentScripts] = useState<RecentScript[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return

    async function loadOverview() {
      try {
        // Use the proven getDashboardStats function (correct column joins)
        const [statsData, recentRes] = await Promise.all([
          getDashboardStats(user!.id),
          supabase
            .from('scripts')
            .select('id, title, created_at, product:products!inner(name, owner_id)')
            .eq('product.owner_id', user!.id)
            .order('created_at', { ascending: false })
            .limit(5),
        ])

        setStats({
          totalProducts: statsData.totalProducts,
          totalScripts: statsData.totalScripts,
          totalSessions: statsData.totalSessions,
          scriptsThisMonth: statsData.scriptsThisMonth,
        })

        const scripts = (recentRes.data || []).map((s: any) => ({
          id: s.id,
          title: s.title || (language === 'es' ? 'Sin título' : 'Untitled'),
          product_name: s.product?.name || '',
          created_at: s.created_at,
        }))
        setRecentScripts(scripts)
      } catch (err) {
        console.error('Failed to load overview:', err)
      } finally {
        setLoading(false)
      }
    }

    loadOverview()
  }, [user, language])

  const t = {
    es: {
      welcome: '¡Bienvenido de nuevo',
      subtitle: 'Resumen de tu actividad',
      products: 'Productos',
      scripts: 'Guiones',
      sessions: 'Sesiones',
      thisMonth: 'Este Mes',
      usage: 'Uso del Plan',
      plan: 'Plan',
      scriptsUsed: 'Guiones usados',
      imagesUsed: 'Imágenes usadas',
      unlimited: 'Ilimitado',
      of: 'de',
      recentScripts: 'Guiones Recientes',
      noScripts: 'Aún no has generado guiones',
      startGenerating: 'Crea un producto y empieza a generar',
      goToScripts: 'Ir a Guiones',
      viewAll: 'Ver todos',
      upgrade: 'Mejorar plan',
      free: 'Gratis',
      starter: 'Starter',
      pro: 'Pro',
      enterprise: 'Enterprise',
      quickActions: 'Acciones Rápidas',
      newScript: 'Nuevo Guión',
      newPost: 'Nuevo Post',
      viewICPs: 'Perfiles ICP',
    },
    en: {
      welcome: 'Welcome back',
      subtitle: 'Overview of your activity',
      products: 'Products',
      scripts: 'Scripts',
      sessions: 'Sessions',
      thisMonth: 'This Month',
      usage: 'Plan Usage',
      plan: 'Plan',
      scriptsUsed: 'Scripts used',
      imagesUsed: 'Images used',
      unlimited: 'Unlimited',
      of: 'of',
      recentScripts: 'Recent Scripts',
      noScripts: 'No scripts generated yet',
      startGenerating: 'Create a product and start generating',
      goToScripts: 'Go to Scripts',
      viewAll: 'View all',
      upgrade: 'Upgrade plan',
      free: 'Free',
      starter: 'Starter',
      pro: 'Pro',
      enterprise: 'Enterprise',
      quickActions: 'Quick Actions',
      newScript: 'New Script',
      newPost: 'New Post',
      viewICPs: 'ICP Profiles',
    },
  }[language]

  const planLabels: Record<string, string> = {
    free: t.free,
    starter: t.starter,
    pro: t.pro,
    enterprise: t.enterprise,
  }

  const statCards = [
    { label: t.products, value: stats.totalProducts, icon: BarChart3, color: 'bg-blue-500' },
    { label: t.scripts, value: stats.totalScripts, icon: FileText, color: 'bg-green-500' },
    { label: t.sessions, value: stats.totalSessions, icon: Sparkles, color: 'bg-purple-500' },
    { label: t.thisMonth, value: stats.scriptsThisMonth, icon: Clock, color: 'bg-orange-500' },
  ]

  const formatLimit = (used: number, limit: number) => {
    if (limit === -1) return `${used} / ${t.unlimited}`
    return `${used} / ${limit}`
  }

  const getPercentage = (used: number, limit: number) => {
    if (limit === -1) return 0
    if (limit === 0) return 100
    return Math.min((used / limit) * 100, 100)
  }

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return language === 'es' ? `hace ${mins}m` : `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return language === 'es' ? `hace ${hours}h` : `${hours}h ago`
    const days = Math.floor(hours / 24)
    return language === 'es' ? `hace ${days}d` : `${days}d ago`
  }

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-dark-900">
            {t.welcome}, {user?.user_metadata?.full_name || 'there'}!
          </h1>
          <p className="text-dark-500 mt-1">{t.subtitle}</p>
        </div>

        {/* Stats Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="h-16 bg-dark-100 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {statCards.map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="card">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-dark-900">{value}</p>
                    <p className="text-sm text-dark-500">{label}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Plan Usage Card */}
          <div className="card lg:col-span-1">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-500" />
                {t.usage}
              </h2>
              {usage.plan === 'free' && (
                <Link
                  to="/settings"
                  className="text-xs font-medium text-primary-600 hover:text-primary-700"
                >
                  {t.upgrade}
                </Link>
              )}
            </div>

            <div className="mb-5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-sm font-medium capitalize">
                {planLabels[usage.plan] || usage.plan}
              </span>
            </div>

            {/* Scripts usage */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-dark-600">{t.scriptsUsed}</span>
                <span className="text-dark-900 font-medium">
                  {formatLimit(usage.scriptsUsed, usage.scriptsLimit)}
                </span>
              </div>
              {usage.scriptsLimit !== -1 && (
                <div className="h-2 bg-dark-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${getPercentage(usage.scriptsUsed, usage.scriptsLimit)}%` }}
                  />
                </div>
              )}
            </div>

            {/* Images usage */}
            <div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-dark-600">{t.imagesUsed}</span>
                <span className="text-dark-900 font-medium">
                  {formatLimit(usage.imagesUsed, usage.imagesLimit)}
                </span>
              </div>
              {usage.imagesLimit !== -1 && (
                <div className="h-2 bg-dark-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${getPercentage(usage.imagesUsed, usage.imagesLimit)}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Recent Scripts */}
          <div className="card lg:col-span-2">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-dark-900">{t.recentScripts}</h2>
              {recentScripts.length > 0 && (
                <Link
                  to="/scripts"
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
                >
                  {t.viewAll}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              )}
            </div>

            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-14 bg-dark-50 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : recentScripts.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="w-10 h-10 text-dark-300 mx-auto mb-3" />
                <p className="text-dark-500 text-sm mb-1">{t.noScripts}</p>
                <p className="text-dark-400 text-xs mb-4">{t.startGenerating}</p>
                <Link
                  to="/scripts"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  {t.goToScripts}
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {recentScripts.map((script) => (
                  <div
                    key={script.id}
                    className="flex items-center gap-3 p-3 bg-dark-50 rounded-xl hover:bg-dark-100 transition-colors"
                  >
                    <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-dark-900 truncate">{script.title}</p>
                      {script.product_name && (
                        <p className="text-xs text-dark-400 truncate">{script.product_name}</p>
                      )}
                    </div>
                    <span className="text-xs text-dark-400 flex-shrink-0">
                      {timeAgo(script.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-dark-900 mb-4">{t.quickActions}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link
              to="/scripts"
              className="card hover:border-primary-200 hover:shadow-md transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center group-hover:bg-green-200 transition-colors">
                  <FileText className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-dark-900">{t.newScript}</p>
                  <p className="text-xs text-dark-400">{t.scripts}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-dark-300 ml-auto group-hover:text-primary-500 transition-colors" />
              </div>
            </Link>
            <Link
              to="/posts"
              className="card hover:border-primary-200 hover:shadow-md transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                  <ImageIcon className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-medium text-dark-900">{t.newPost}</p>
                  <p className="text-xs text-dark-400">Posts</p>
                </div>
                <ArrowRight className="w-4 h-4 text-dark-300 ml-auto group-hover:text-primary-500 transition-colors" />
              </div>
            </Link>
            <Link
              to="/icps"
              className="card hover:border-primary-200 hover:shadow-md transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="font-medium text-dark-900">{t.viewICPs}</p>
                  <p className="text-xs text-dark-400">ICP</p>
                </div>
                <ArrowRight className="w-4 h-4 text-dark-300 ml-auto group-hover:text-primary-500 transition-colors" />
              </div>
            </Link>
          </div>
        </div>
      </div>
    </Layout>
  )
}
