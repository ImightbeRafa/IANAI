import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage, Language } from '../contexts/LanguageContext'
import { getProfile } from '../services/database'
import type { Profile } from '../types'
import Layout from '../components/Layout'
import { User, Mail, Save, AlertCircle, CheckCircle, Globe, Users, UserCircle } from 'lucide-react'

export default function Settings() {
  const { user, updateProfile } = useAuth()
  const { language, setLanguage } = useLanguage()
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    async function loadProfile() {
      if (!user) return
      const data = await getProfile(user.id)
      setProfile(data)
    }
    loadProfile()
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
            <div className="flex items-center justify-between py-3">
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
          </div>
        </div>
      </div>
    </Layout>
  )
}
