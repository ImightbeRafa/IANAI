import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage, Language } from '../contexts/LanguageContext'
import { getProfile } from '../services/database'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'
import Layout from '../components/Layout'
import { User, Mail, Save, AlertCircle, CheckCircle, Globe, Users, UserCircle, CreditCard, Zap, Crown, Check, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

interface Subscription {
  plan: 'free' | 'starter' | 'pro' | 'enterprise'
  status: string
  current_period_end?: string
}

interface Usage {
  scripts_generated: number
  images_generated: number
}

const PLAN_DETAILS = {
  free: { name: 'Gratis', price: 0, scripts: 10, images: 5, color: 'gray', paymentLink: null },
  starter: { 
    name: 'Individual', 
    price: 30, 
    scripts: 100, 
    images: 50, 
    color: 'blue',
    paymentLink: 'https://tp.cr/l/TkRnM01RPT18MQ=='
  },
  pro: { 
    name: 'Teams', 
    price: 400, 
    scripts: 500, 
    images: 200, 
    color: 'purple',
    paymentLink: 'https://tp.cr/l/TkRnM01nPT18MQ=='
  },
  enterprise: { name: 'Enterprise', price: null, scripts: -1, images: -1, color: 'amber', paymentLink: null }
}

export default function Settings() {
  const { user, updateProfile } = useAuth()
  const { language, setLanguage } = useLanguage()
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)

  useEffect(() => {
    async function loadData() {
      if (!user) return
      
      // Load profile
      const profileData = await getProfile(user.id)
      setProfile(profileData)
      
      // Load subscription
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('plan, status, current_period_end')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()
      
      if (subData) {
        setSubscription(subData as Subscription)
      } else {
        setSubscription({ plan: 'free', status: 'active' })
      }
      
      // Load current month usage
      const currentMonth = new Date().toISOString().slice(0, 7) + '-01'
      const { data: usageData } = await supabase
        .from('usage')
        .select('scripts_generated, images_generated')
        .eq('user_id', user.id)
        .eq('period_start', currentMonth)
        .single()
      
      if (usageData) {
        setUsage(usageData as Usage)
      } else {
        setUsage({ scripts_generated: 0, images_generated: 0 })
      }
    }
    loadData()
  }, [user])

  const labels = {
    es: {
      settings: 'Configuración',
      manageAccount: 'Administra tu cuenta',
      profileInfo: 'Información del Perfil',
      email: 'Correo Electrónico',
      emailCantChange: 'El correo no se puede cambiar',
      fullName: 'Nombre Completo',
      saveChanges: 'Guardar Cambios',
      saving: 'Guardando...',
      aiPreferences: 'Preferencias de IA',
      aiLanguage: 'Idioma de IA',
      languageDesc: 'Idioma para conversaciones de IA y scripts generados',
      account: 'Cuenta',
      accountCreated: 'Cuenta Creada',
      accountType: 'Tipo de Cuenta',
      team: 'Equipo',
      individual: 'Individual',
      teamDesc: 'Colabora con tu equipo y gestiona múltiples clientes',
      individualDesc: 'Cuenta personal para uso individual'
    },
    en: {
      settings: 'Settings',
      manageAccount: 'Manage your account settings',
      profileInfo: 'Profile Information',
      email: 'Email',
      emailCantChange: 'Email cannot be changed',
      fullName: 'Full Name',
      saveChanges: 'Save Changes',
      saving: 'Saving...',
      aiPreferences: 'AI Preferences',
      aiLanguage: 'AI Language',
      languageDesc: 'Language for AI conversations and generated scripts',
      account: 'Account',
      accountCreated: 'Account Created',
      accountType: 'Account Type',
      team: 'Team',
      individual: 'Individual',
      teamDesc: 'Collaborate with your team and manage multiple clients',
      individualDesc: 'Personal account for individual use'
    }
  }

  const t = labels[language]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      await updateProfile({ full_name: fullName })
      setMessage({ type: 'success', text: 'Profile updated successfully!' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to update profile' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-dark-900">Settings</h1>
          <p className="text-dark-500 mt-1">Manage your account settings</p>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-dark-900 mb-6">Profile Information</h2>
          
          <form onSubmit={handleSubmit} className="space-y-5">
            {message && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                message.type === 'success' 
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                {message.type === 'success' ? (
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                )}
                {message.text}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-dark-700 mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
                <input
                  id="email"
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="input-field pl-10 bg-dark-50 text-dark-500 cursor-not-allowed"
                />
              </div>
              <p className="text-xs text-dark-400 mt-1">Email cannot be changed</p>
            </div>

            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-dark-700 mb-1.5">
                Full Name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="input-field pl-10"
                  placeholder="Your name"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>

        <div className="card mt-6">
          <h2 className="text-lg font-semibold text-dark-900 mb-6">AI Preferences</h2>
          <div>
            <label htmlFor="language" className="block text-sm font-medium text-dark-700 mb-1.5">
              AI Language
            </label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
              <select
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                className="input-field pl-10 appearance-none cursor-pointer"
              >
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </div>
            <p className="text-xs text-dark-400 mt-1">
              Language for AI conversations and generated scripts
            </p>
          </div>
        </div>

        {/* Billing & Subscription */}
        <div className="card mt-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-primary-500" />
              {language === 'es' ? 'Plan y Facturación' : 'Plan & Billing'}
            </h2>
            {subscription && (
              <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                subscription.plan === 'free' ? 'bg-gray-100 text-gray-700' :
                subscription.plan === 'starter' ? 'bg-blue-100 text-blue-700' :
                subscription.plan === 'pro' ? 'bg-purple-100 text-purple-700' :
                'bg-amber-100 text-amber-700'
              }`}>
                {PLAN_DETAILS[subscription.plan].name}
              </span>
            )}
          </div>

          {/* Current Usage */}
          {usage && subscription && (
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-4 bg-dark-50 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-medium text-dark-700">
                    {language === 'es' ? 'Guiones' : 'Scripts'}
                  </span>
                </div>
                <div className="text-2xl font-bold text-dark-900">
                  {usage.scripts_generated}
                  <span className="text-sm font-normal text-dark-400">
                    / {PLAN_DETAILS[subscription.plan].scripts === -1 ? '∞' : PLAN_DETAILS[subscription.plan].scripts}
                  </span>
                </div>
              </div>
              <div className="p-4 bg-dark-50 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Crown className="w-4 h-4 text-purple-500" />
                  <span className="text-sm font-medium text-dark-700">
                    {language === 'es' ? 'Imágenes' : 'Images'}
                  </span>
                </div>
                <div className="text-2xl font-bold text-dark-900">
                  {usage.images_generated}
                  <span className="text-sm font-normal text-dark-400">
                    / {PLAN_DETAILS[subscription.plan].images === -1 ? '∞' : PLAN_DETAILS[subscription.plan].images}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Plan Options */}
          <div className="space-y-3">
            {(['starter', 'pro'] as const).map((plan) => (
              <div 
                key={plan}
                className={`p-4 rounded-xl border-2 transition-all ${
                  subscription?.plan === plan 
                    ? 'border-primary-500 bg-primary-50' 
                    : 'border-dark-200 hover:border-dark-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-dark-900">{PLAN_DETAILS[plan].name}</span>
                      {subscription?.plan === plan && (
                        <span className="px-2 py-0.5 text-xs bg-primary-500 text-white rounded-full">
                          {language === 'es' ? 'Actual' : 'Current'}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-dark-500 mt-1">
                      {PLAN_DETAILS[plan].scripts} {language === 'es' ? 'guiones' : 'scripts'} + {PLAN_DETAILS[plan].images} {language === 'es' ? 'imágenes' : 'images'} / {language === 'es' ? 'mes' : 'month'}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-dark-900">
                      ${PLAN_DETAILS[plan].price || 0}
                    </div>
                    <p className="text-xs text-dark-400">/ {language === 'es' ? 'mes' : 'month'}</p>
                  </div>
                </div>
                {subscription?.plan !== plan && subscription?.plan === 'free' && PLAN_DETAILS[plan].paymentLink && (
                  <button 
                    className="w-full mt-3 btn-primary py-2 flex items-center justify-center gap-2 disabled:opacity-50"
                    disabled={loading}
                    onClick={async () => {
                      setLoading(true)
                      setMessage(null)
                      try {
                        const { data: { session } } = await supabase.auth.getSession()
                        if (!session) {
                          setMessage({ type: 'error', text: language === 'es' ? 'Sesión expirada' : 'Session expired' })
                          return
                        }

                        const checkoutUrl = import.meta.env.PROD ? '/api/tilopay/create-checkout' : 'http://localhost:3000/api/tilopay/create-checkout'
                        const response = await fetch(checkoutUrl, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${session.access_token}`
                          },
                          body: JSON.stringify({ plan })
                        })

                        const data = await response.json()
                        
                        if (data.checkoutUrl) {
                          window.open(data.checkoutUrl, '_blank')
                        } else {
                          setMessage({ type: 'error', text: data.error || 'Error al procesar' })
                        }
                      } catch (error) {
                        console.error('Checkout error:', error)
                        setMessage({ type: 'error', text: language === 'es' ? 'Error de conexión' : 'Connection error' })
                      } finally {
                        setLoading(false)
                      }
                    }}
                  >
                    <Check className="w-4 h-4" />
                    {loading 
                      ? (language === 'es' ? 'Procesando...' : 'Processing...') 
                      : (language === 'es' ? 'Actualizar Plan' : 'Upgrade Plan')}
                  </button>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-dark-400 mt-4 text-center">
            {language === 'es' 
              ? 'Los pagos se procesan de forma segura con TiloPay' 
              : 'Payments processed securely via TiloPay'}
          </p>
        </div>

        <div className="card mt-6">
          <h2 className="text-lg font-semibold text-dark-900 mb-4">{t.account}</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-3 border-b border-dark-100">
              <div>
                <p className="font-medium text-dark-900">{t.accountCreated}</p>
                <p className="text-sm text-dark-500">
                  {user?.created_at 
                    ? new Date(user.created_at).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })
                    : 'N/A'}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between py-3 border-b border-dark-100">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  profile?.account_type === 'team' ? 'bg-purple-100' : 'bg-blue-100'
                }`}>
                  {profile?.account_type === 'team' ? (
                    <Users className="w-5 h-5 text-purple-600" />
                  ) : (
                    <UserCircle className="w-5 h-5 text-blue-600" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-dark-900">{t.accountType}</p>
                  <p className="text-sm text-dark-500">
                    {profile?.account_type === 'team' ? t.team : t.individual}
                  </p>
                </div>
              </div>
              <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                profile?.account_type === 'team' 
                  ? 'bg-purple-100 text-purple-700' 
                  : 'bg-blue-100 text-blue-700'
              }`}>
                {profile?.account_type === 'team' ? t.teamDesc : t.individualDesc}
              </span>
            </div>
            
            {/* Team Management Link */}
            {profile?.account_type === 'team' && (
              <Link 
                to="/team" 
                className="flex items-center justify-between py-3 hover:bg-dark-50 -mx-4 px-4 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-100">
                    <Users className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-dark-900">
                      {language === 'es' ? 'Gestionar Equipo' : 'Manage Team'}
                    </p>
                    <p className="text-sm text-dark-500">
                      {language === 'es' ? 'Invitar y administrar miembros' : 'Invite and manage members'}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-dark-400" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
