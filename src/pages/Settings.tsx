import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage, Language } from '../contexts/LanguageContext'
import { getProfile, markOnboardingComplete } from '../services/database'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'
import Layout from '../components/Layout'
import OnboardingWizard from '../components/OnboardingWizard'
import { User, Mail, Save, AlertCircle, CheckCircle, Globe, Users, UserCircle, CreditCard, Zap, Crown, Check, ChevronRight, HelpCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useUsageLimits } from '../hooks/useUsageLimits'
import type { OnboardingStep } from '../hooks/useOnboarding'

type PlanKey = 'free' | 'starter' | 'pro' | 'enterprise' | 'meta_advanze'

const PLAN_DETAILS = {
  free: { name: 'Free', price: 0, scripts: 10, descriptions: 10, images: 1, color: 'gray', paymentLink: null },
  starter: { 
    name: 'Starter', 
    price: 33, 
    scripts: 30, 
    descriptions: -1, 
    images: 5, 
    color: 'blue',
    paymentLink: 'https://tp.cr/l/TkRnM01RPT18MQ=='
  },
  pro: { 
    name: 'Premium', 
    price: 49, 
    scripts: -1, 
    descriptions: -1, 
    images: 100, 
    color: 'purple',
    paymentLink: 'https://tp.cr/l/TkRnM01nPT18MQ=='
  },
  enterprise: { name: 'Enterprise', price: 299, scripts: -1, descriptions: -1, images: -1, color: 'amber', paymentLink: 'https://tp.cr/l/TkRrMk53PT18MQ==' },
  meta_advanze: {
    name: 'Meta AdVance',
    price: 24,
    scripts: -1,
    descriptions: -1,
    images: 100,
    color: 'purple',
    paymentLink: null
  }
} as const

export default function Settings() {
  const { user, updateProfile } = useAuth()
  const { language, setLanguage } = useLanguage()
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const usageLimits = useUsageLimits()
  const currentPlan = (usageLimits.plan || 'free') as PlanKey

  // Replay wizard state
  const WIZARD_STEPS: OnboardingStep[] = ['welcome', 'dashboard', 'scripts', 'posts', 'descriptions', 'settings', 'feedback', 'complete']
  const [showWizard, setShowWizard] = useState(false)
  const [wizardStepIndex, setWizardStepIndex] = useState(0)

  const handleReplayWizard = async () => {
    if (user) {
      // Reset the flag in DB so it can re-trigger naturally too
      try {
        await supabase.from('profiles').update({ has_completed_onboarding: false }).eq('id', user.id)
      } catch {}
    }
    setWizardStepIndex(0)
    setShowWizard(true)
  }

  const wizardNextStep = () => {
    if (wizardStepIndex >= WIZARD_STEPS.length - 1) {
      setShowWizard(false)
      setWizardStepIndex(0)
      if (user) markOnboardingComplete(user.id).catch(() => {})
    } else {
      setWizardStepIndex(prev => prev + 1)
    }
  }
  const wizardPrevStep = () => { if (wizardStepIndex > 0) setWizardStepIndex(prev => prev - 1) }
  const wizardSkipAll = () => {
    setShowWizard(false)
    setWizardStepIndex(0)
    if (user) markOnboardingComplete(user.id).catch(() => {})
  }

  useEffect(() => {
    async function loadData() {
      if (!user) return
      const profileData = await getProfile(user.id)
      setProfile(profileData)
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
          <h1 className="text-2xl font-bold text-dark-900">{t.settings}</h1>
          <p className="text-dark-500 mt-1">{t.manageAccount}</p>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-dark-900 mb-6">{t.profileInfo}</h2>
          
          <form onSubmit={handleSubmit} className="space-y-5">
            {message && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                message.type === 'success' 
                  ? 'bg-green-900/20 border border-green-700/30 text-green-400'
                  : 'bg-red-900/20 border border-red-700/30 text-red-400'
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
                {t.email}
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
              <p className="text-xs text-dark-400 mt-1">{t.emailCantChange}</p>
            </div>

            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-dark-700 mb-1.5">
                {t.fullName}
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
              {loading ? t.saving : t.saveChanges}
            </button>
          </form>
        </div>

        <div className="card mt-6">
          <h2 className="text-lg font-semibold text-dark-900 mb-6">{t.aiPreferences}</h2>
          <div>
            <label htmlFor="language" className="block text-sm font-medium text-dark-700 mb-1.5">
              {t.aiLanguage}
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
              {t.languageDesc}
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
            {!usageLimits.loading && (
              <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                currentPlan === 'free' ? 'bg-dark-300 text-gray-700' :
                currentPlan === 'starter' ? 'bg-blue-900/20 text-blue-700' :
                currentPlan === 'pro' ? 'bg-purple-900/20 text-purple-700' :
                'bg-amber-900/20 text-amber-400'
              }`}>
                {PLAN_DETAILS[currentPlan].name}
              </span>
            )}
          </div>

          {/* Current Usage */}
          {!usageLimits.loading && (
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="p-4 bg-dark-50 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-medium text-dark-700">
                    {language === 'es' ? 'Guiones' : 'Scripts'}
                  </span>
                </div>
                <div className="text-xl font-bold text-dark-900">
                  {usageLimits.scriptsUsed}
                  <span className="text-sm font-normal text-dark-400">
                    / {usageLimits.scriptsLimit === -1 ? '∞' : usageLimits.scriptsLimit}
                  </span>
                </div>
              </div>
              <div className="p-4 bg-dark-50 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-medium text-dark-700">
                    {language === 'es' ? 'Descripciones' : 'Descriptions'}
                  </span>
                </div>
                <div className="text-xl font-bold text-dark-900">
                  {usageLimits.descriptionsUsed}
                  <span className="text-sm font-normal text-dark-400">
                    / {usageLimits.descriptionsLimit === -1 ? '∞' : usageLimits.descriptionsLimit}
                  </span>
                </div>
              </div>
              <div className="p-4 bg-dark-50 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Crown className="w-4 h-4 text-purple-500" />
                  <span className="text-xs font-medium text-dark-700">
                    {language === 'es' ? 'Diseños' : 'Designs'}
                  </span>
                </div>
                <div className="text-xl font-bold text-dark-900">
                  {usageLimits.imagesUsed}
                  <span className="text-sm font-normal text-dark-400">
                    / {usageLimits.imagesLimit === -1 ? '∞' : usageLimits.imagesLimit}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Plan Options */}
          <div className="space-y-3">
            {(['starter', 'pro', 'enterprise'] as const).map((plan) => (
              <div 
                key={plan}
                className={`p-4 rounded-xl border-2 transition-all ${
                  currentPlan === plan 
                    ? 'border-primary-500 bg-primary-900/20' 
                    : 'border-dark-200 hover:border-dark-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-dark-900">{PLAN_DETAILS[plan].name}</span>
                      {currentPlan === plan && (
                        <span className="px-2 py-0.5 text-xs bg-primary-500 text-white rounded-full">
                          {language === 'es' ? 'Actual' : 'Current'}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-dark-500 mt-1">
                      {PLAN_DETAILS[plan].scripts === -1 ? '∞' : PLAN_DETAILS[plan].scripts} {language === 'es' ? 'guiones' : 'scripts'} + {PLAN_DETAILS[plan].images} {language === 'es' ? 'diseños' : 'designs'} / {language === 'es' ? 'mes' : 'month'}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-dark-900">
                      ${PLAN_DETAILS[plan].price || 0}
                    </div>
                    <p className="text-xs text-dark-400">/ {language === 'es' ? 'mes' : 'month'}</p>
                  </div>
                </div>
                {currentPlan !== plan && PLAN_DETAILS[plan].paymentLink && (() => {
                  const rank: Record<string, number> = { free: 0, starter: 1, pro: 2, meta_advanze: 2, enterprise: 3 }
                  return (rank[currentPlan] || 0) < (rank[plan] || 0)
                })() && (
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

          {/* Image Boost — only for pro plan users */}
          {(currentPlan === 'pro' || currentPlan === 'meta_advanze') && (
            <div className="mt-4 p-4 rounded-xl border-2 border-dashed border-primary-300 bg-primary-900/20">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Crown className="w-4 h-4 text-primary-600" />
                    <span className="font-semibold text-dark-900">
                      {language === 'es' ? 'Más Diseños' : 'More Designs'}
                    </span>
                  </div>
                  <p className="text-sm text-dark-500 mt-1">
                    {language === 'es' 
                      ? '+100 diseños extra (pago único, no se reinician)' 
                      : '+100 extra designs (one-time, no reset)'}
                  </p>
                  {usageLimits.bonusImages > 0 && (
                    <p className="text-xs text-primary-600 mt-1 font-medium">
                      {language === 'es' 
                        ? `${usageLimits.bonusImages} diseños bonus disponibles` 
                        : `${usageLimits.bonusImages} bonus designs available`}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-dark-900">$14.99</div>
                  <p className="text-xs text-dark-400">{language === 'es' ? 'único' : 'one-time'}</p>
                </div>
              </div>
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
                      body: JSON.stringify({ plan: 'image_boost' })
                    })
                    const data = await response.json()
                    if (data.checkoutUrl) {
                      window.open(data.checkoutUrl, '_blank')
                    } else {
                      setMessage({ type: 'error', text: data.error || 'Error al procesar' })
                    }
                  } catch (error) {
                    console.error('Boost checkout error:', error)
                    setMessage({ type: 'error', text: language === 'es' ? 'Error de conexión' : 'Connection error' })
                  } finally {
                    setLoading(false)
                  }
                }}
              >
                <Zap className="w-4 h-4" />
                {loading 
                  ? (language === 'es' ? 'Procesando...' : 'Processing...')
                  : (language === 'es' ? 'Comprar +100 Diseños' : 'Buy +100 Designs')}
              </button>
            </div>
          )}
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
                  profile?.account_type === 'team' ? 'bg-purple-900/20' : 'bg-blue-900/20'
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
                  ? 'bg-purple-900/20 text-purple-700' 
                  : 'bg-blue-900/20 text-blue-700'
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
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-900/20">
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

        {/* Replay Setup Wizard */}
        <div className="card mt-6">
          <button
            onClick={handleReplayWizard}
            className="flex items-center justify-between w-full py-3 hover:bg-dark-50 -mx-4 px-4 rounded-lg transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary-900/20">
                <HelpCircle className="w-5 h-5 text-primary-600" />
              </div>
              <div className="text-left">
                <p className="font-medium text-dark-900">
                  {language === 'es' ? 'Tutorial de la Plataforma' : 'Platform Tutorial'}
                </p>
                <p className="text-sm text-dark-500">
                  {language === 'es' ? 'Revisa el tour guiado de todas las funciones' : 'Replay the guided tour of all features'}
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-dark-400" />
          </button>
        </div>
      </div>
      {showWizard && (
        <OnboardingWizard
          currentStep={WIZARD_STEPS[wizardStepIndex]}
          stepIndex={wizardStepIndex}
          totalSteps={WIZARD_STEPS.length}
          nextStep={wizardNextStep}
          prevStep={wizardPrevStep}
          skipAll={wizardSkipAll}
        />
      )}
    </Layout>
  )
}
