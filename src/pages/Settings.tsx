import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage, Language } from '../contexts/LanguageContext'
import { getProfile } from '../services/database'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'
import Layout from '../components/Layout'
import { User, Mail, Save, AlertCircle, CheckCircle, Globe, Users, UserCircle, CreditCard, Zap, Crown, Check, ChevronRight, MessageCircle, Palette, Plus, X, Trash2, Code2, Rocket, MessageSquarePlus, Clock, Sparkles, Wrench, Bug, ArrowUpCircle, AlertTriangle, Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useUsageLimits } from '../hooks/useUsageLimits'
import { getBrandKit, upsertBrandKit, deleteBrandKit } from '../services/database'
import type { BrandKit, BrandKitFormData } from '../types'
import { CHANGELOG, ROADMAP, STATUS_ALERT, type ChangeCategory, type RoadmapStatus } from '../data/changelog'

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

  // Brand Kit state
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null)
  const [bkName, setBkName] = useState('My Brand')
  const [bkPrimary, setBkPrimary] = useState('#000000')
  const [bkSecondary, setBkSecondary] = useState('#ffffff')
  const [bkAccent, setBkAccent] = useState('#6366f1')
  const [bkVoice, setBkVoice] = useState('')
  const [bkToneKeywords, setBkToneKeywords] = useState<string[]>([])
  const [bkToneInput, setBkToneInput] = useState('')
  const [bkMustUse, setBkMustUse] = useState<string[]>([])
  const [bkMustUseInput, setBkMustUseInput] = useState('')
  const [bkForbidden, setBkForbidden] = useState<string[]>([])
  const [bkForbiddenInput, setBkForbiddenInput] = useState('')
  const [bkActive, setBkActive] = useState(true)
  const [bkSaving, setBkSaving] = useState(false)
  const [bkMessage, setBkMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [devTab, setDevTab] = useState<'changelog' | 'roadmap' | 'feedback'>('changelog')

  useEffect(() => {
    async function loadData() {
      if (!user) return
      const profileData = await getProfile(user.id)
      setProfile(profileData)
      // Load brand kit
      try {
        const kit = await getBrandKit(user.id)
        if (kit) {
          setBrandKit(kit)
          setBkName(kit.name)
          setBkPrimary(kit.primary_color || '#000000')
          setBkSecondary(kit.secondary_color || '#ffffff')
          setBkAccent(kit.accent_color || '#6366f1')
          setBkVoice(kit.brand_voice || '')
          setBkToneKeywords(kit.tone_keywords || [])
          setBkMustUse(kit.must_use_phrases || [])
          setBkForbidden(kit.forbidden_phrases || [])
          setBkActive(kit.is_active)
        }
      } catch (err) {
        console.warn('Failed to load brand kit:', err)
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

  const handleSaveBrandKit = async () => {
    if (!user) return
    setBkSaving(true)
    setBkMessage(null)
    try {
      const data: BrandKitFormData = {
        name: bkName || 'My Brand',
        primary_color: bkPrimary,
        secondary_color: bkSecondary,
        accent_color: bkAccent,
        brand_voice: bkVoice || null,
        tone_keywords: bkToneKeywords,
        must_use_phrases: bkMustUse,
        forbidden_phrases: bkForbidden,
        is_active: bkActive
      }
      const saved = await upsertBrandKit(user.id, data)
      setBrandKit(saved)
      setBkMessage({ type: 'success', text: language === 'es' ? 'Brand Kit guardado' : 'Brand Kit saved' })
    } catch (err) {
      setBkMessage({ type: 'error', text: language === 'es' ? 'Error al guardar' : 'Failed to save' })
    } finally {
      setBkSaving(false)
    }
  }

  const handleDeleteBrandKit = async () => {
    if (!user) return
    setBkSaving(true)
    try {
      await deleteBrandKit(user.id)
      setBrandKit(null)
      setBkName('My Brand')
      setBkPrimary('#000000')
      setBkSecondary('#ffffff')
      setBkAccent('#6366f1')
      setBkVoice('')
      setBkToneKeywords([])
      setBkMustUse([])
      setBkForbidden([])
      setBkActive(true)
      setBkMessage({ type: 'success', text: language === 'es' ? 'Brand Kit eliminado' : 'Brand Kit deleted' })
    } catch {
      setBkMessage({ type: 'error', text: language === 'es' ? 'Error al eliminar' : 'Failed to delete' })
    } finally {
      setBkSaving(false)
    }
  }

  const addTag = (list: string[], setList: (v: string[]) => void, input: string, setInput: (v: string) => void) => {
    const val = input.trim()
    if (val && !list.includes(val)) {
      setList([...list, val])
    }
    setInput('')
  }

  const removeTag = (list: string[], setList: (v: string[]) => void, index: number) => {
    setList(list.filter((_, i) => i !== index))
  }

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

        {/* Brand Kit */}
        <div className="card mt-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
              <Palette className="w-5 h-5 text-primary-500" />
              Brand Kit
            </h2>
            <div className="flex items-center gap-3">
              {brandKit && (
                <button
                  onClick={handleDeleteBrandKit}
                  className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                  disabled={bkSaving}
                >
                  <Trash2 className="w-3 h-3" />
                  {language === 'es' ? 'Eliminar' : 'Delete'}
                </button>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs text-dark-500">{bkActive ? (language === 'es' ? 'Activo' : 'Active') : (language === 'es' ? 'Inactivo' : 'Inactive')}</span>
                <div
                  onClick={() => setBkActive(!bkActive)}
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                    bkActive ? 'bg-primary-500' : 'bg-dark-300'
                  }`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    bkActive ? 'translate-x-4' : ''
                  }`} />
                </div>
              </label>
            </div>
          </div>

          {bkMessage && (
            <div className={`flex items-center gap-2 p-3 rounded-lg text-sm mb-4 ${
              bkMessage.type === 'success'
                ? 'bg-green-900/20 border border-green-700/30 text-green-400'
                : 'bg-red-900/20 border border-red-700/30 text-red-400'
            }`}>
              {bkMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {bkMessage.text}
            </div>
          )}

          <p className="text-xs text-dark-400 mb-4">
            {language === 'es'
              ? 'Define la identidad visual y tonal de tu marca. Se aplica automáticamente a posts, guiones y respuestas.'
              : 'Define your brand\'s visual and tonal identity. Auto-applied to posts, scripts, and replies.'}
          </p>

          <div className="space-y-5">
            {/* Brand Name */}
            <div>
              <label className="block text-sm font-medium text-dark-700 mb-1.5">
                {language === 'es' ? 'Nombre de Marca' : 'Brand Name'}
              </label>
              <input
                type="text"
                value={bkName}
                onChange={(e) => setBkName(e.target.value)}
                className="input-field"
                placeholder="My Brand"
              />
            </div>

            {/* Brand Colors */}
            <div>
              <label className="block text-sm font-medium text-dark-700 mb-2">
                {language === 'es' ? 'Colores de Marca' : 'Brand Colors'}
              </label>
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-center gap-1">
                  <input type="color" value={bkPrimary} onChange={e => setBkPrimary(e.target.value)} className="w-10 h-10 rounded-lg cursor-pointer border border-dark-200" />
                  <span className="text-[10px] text-dark-400">{language === 'es' ? 'Primario' : 'Primary'}</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <input type="color" value={bkSecondary} onChange={e => setBkSecondary(e.target.value)} className="w-10 h-10 rounded-lg cursor-pointer border border-dark-200" />
                  <span className="text-[10px] text-dark-400">{language === 'es' ? 'Secundario' : 'Secondary'}</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <input type="color" value={bkAccent} onChange={e => setBkAccent(e.target.value)} className="w-10 h-10 rounded-lg cursor-pointer border border-dark-200" />
                  <span className="text-[10px] text-dark-400">{language === 'es' ? 'Acento' : 'Accent'}</span>
                </div>
              </div>
            </div>

            {/* Brand Voice */}
            <div>
              <label className="block text-sm font-medium text-dark-700 mb-1.5">
                {language === 'es' ? 'Voz de Marca' : 'Brand Voice'}
              </label>
              <textarea
                value={bkVoice}
                onChange={(e) => setBkVoice(e.target.value)}
                className="input-field min-h-[80px] resize-y"
                placeholder={language === 'es'
                  ? 'Describe el tono y personalidad de tu marca... Ej: Profesional pero cercano, usa humor sutil'
                  : 'Describe your brand\'s tone & personality... E.g.: Professional yet approachable, uses subtle humor'}
                rows={3}
              />
            </div>

            {/* Tone Keywords */}
            <div>
              <label className="block text-sm font-medium text-dark-700 mb-1.5">
                {language === 'es' ? 'Palabras Clave de Tono' : 'Tone Keywords'}
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {bkToneKeywords.map((kw, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-primary-900/20 text-primary-400 rounded-full text-xs">
                    {kw}
                    <button onClick={() => removeTag(bkToneKeywords, setBkToneKeywords, i)} className="hover:text-red-400"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={bkToneInput}
                  onChange={e => setBkToneInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag(bkToneKeywords, setBkToneKeywords, bkToneInput, setBkToneInput))}
                  className="input-field flex-1"
                  placeholder={language === 'es' ? 'Ej: profesional, cercano...' : 'E.g.: bold, friendly...'}
                />
                <button
                  type="button"
                  onClick={() => addTag(bkToneKeywords, setBkToneKeywords, bkToneInput, setBkToneInput)}
                  className="btn-secondary px-3"
                ><Plus className="w-4 h-4" /></button>
              </div>
            </div>

            {/* Must-use Phrases */}
            <div>
              <label className="block text-sm font-medium text-dark-700 mb-1.5">
                {language === 'es' ? 'Frases Obligatorias' : 'Must-Use Phrases'}
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {bkMustUse.map((p, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-green-900/20 text-green-400 rounded-full text-xs">
                    {p}
                    <button onClick={() => removeTag(bkMustUse, setBkMustUse, i)} className="hover:text-red-400"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={bkMustUseInput}
                  onChange={e => setBkMustUseInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag(bkMustUse, setBkMustUse, bkMustUseInput, setBkMustUseInput))}
                  className="input-field flex-1"
                  placeholder={language === 'es' ? 'Ej: ¡Descúbrelo hoy!' : 'E.g.: Discover today!'}
                />
                <button
                  type="button"
                  onClick={() => addTag(bkMustUse, setBkMustUse, bkMustUseInput, setBkMustUseInput)}
                  className="btn-secondary px-3"
                ><Plus className="w-4 h-4" /></button>
              </div>
            </div>

            {/* Forbidden Phrases */}
            <div>
              <label className="block text-sm font-medium text-dark-700 mb-1.5">
                {language === 'es' ? 'Frases Prohibidas' : 'Forbidden Phrases'}
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {bkForbidden.map((p, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-red-900/20 text-red-400 rounded-full text-xs">
                    {p}
                    <button onClick={() => removeTag(bkForbidden, setBkForbidden, i)} className="hover:text-red-400"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={bkForbiddenInput}
                  onChange={e => setBkForbiddenInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag(bkForbidden, setBkForbidden, bkForbiddenInput, setBkForbiddenInput))}
                  className="input-field flex-1"
                  placeholder={language === 'es' ? 'Ej: barato, gratis...' : 'E.g.: cheap, free...'}
                />
                <button
                  type="button"
                  onClick={() => addTag(bkForbidden, setBkForbidden, bkForbiddenInput, setBkForbiddenInput)}
                  className="btn-secondary px-3"
                ><Plus className="w-4 h-4" /></button>
              </div>
            </div>
          </div>

          <button
            onClick={handleSaveBrandKit}
            disabled={bkSaving}
            className="btn-primary flex items-center gap-2 mt-6"
          >
            <Save className="w-4 h-4" />
            {bkSaving
              ? (language === 'es' ? 'Guardando...' : 'Saving...')
              : (language === 'es' ? 'Guardar Brand Kit' : 'Save Brand Kit')}
          </button>
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
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
              <div className="p-4 bg-dark-50 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <MessageCircle className="w-4 h-4 text-green-500" />
                  <span className="text-xs font-medium text-dark-700">
                    {language === 'es' ? 'Respuestas' : 'Replies'}
                  </span>
                </div>
                <div className="text-xl font-bold text-dark-900">
                  {usageLimits.repliesUsed}
                  <span className="text-sm font-normal text-dark-400">
                    / {usageLimits.repliesLimit === -1 ? '∞' : usageLimits.repliesLimit}
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

        {/* From the Developer */}
        <div className="card mt-6">
          <div className="flex items-center gap-2 mb-4">
            <Code2 className="w-5 h-5 text-primary-500" />
            <h2 className="text-lg font-semibold text-dark-900">
              {language === 'es' ? 'Desde el Desarrollador' : 'From the Developer'}
            </h2>
          </div>

          {/* Status Alert */}
          {STATUS_ALERT.active && (
            <div className={`flex items-start gap-2 p-3 rounded-lg text-sm mb-4 ${
              STATUS_ALERT.severity === 'error' ? 'bg-red-900/20 border border-red-700/30 text-red-400' :
              STATUS_ALERT.severity === 'warning' ? 'bg-amber-900/20 border border-amber-700/30 text-amber-400' :
              'bg-blue-900/20 border border-blue-700/30 text-blue-400'
            }`}>
              {STATUS_ALERT.severity === 'error' ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> :
               STATUS_ALERT.severity === 'warning' ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> :
               <Info className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{STATUS_ALERT.text[language]}</span>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-dark-50 rounded-lg mb-4">
            {([
              { key: 'changelog' as const, label: language === 'es' ? 'Cambios' : 'Changelog', icon: Clock },
              { key: 'roadmap' as const, label: language === 'es' ? 'Próximamente' : 'Coming Soon', icon: Rocket },
              { key: 'feedback' as const, label: 'Feedback', icon: MessageSquarePlus },
            ]).map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.key}
                  onClick={() => setDevTab(tab.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                    devTab === tab.key
                      ? 'bg-dark-100 text-dark-900 shadow-sm'
                      : 'text-dark-500 hover:text-dark-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Changelog Tab */}
          {devTab === 'changelog' && (
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
              {CHANGELOG.map((release, ri) => (
                <div key={ri}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-primary-400 bg-primary-900/20 px-2 py-0.5 rounded-full">
                      v{release.version}
                    </span>
                    <span className="text-[10px] text-dark-400">
                      {new Date(release.date).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                  <div className="space-y-1.5 ml-1">
                    {release.items.map((item, ii) => {
                      const catConfig: Record<ChangeCategory, { icon: typeof Sparkles; color: string; label: string }> = {
                        feature: { icon: Sparkles, color: 'text-green-400', label: language === 'es' ? 'Nuevo' : 'New' },
                        fix: { icon: Bug, color: 'text-red-400', label: 'Fix' },
                        improvement: { icon: ArrowUpCircle, color: 'text-blue-400', label: language === 'es' ? 'Mejora' : 'Improved' },
                        rework: { icon: Wrench, color: 'text-amber-400', label: 'Rework' },
                      }
                      const cfg = catConfig[item.category]
                      const CatIcon = cfg.icon
                      return (
                        <div key={ii} className="flex items-start gap-2 text-sm">
                          <CatIcon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cfg.color}`} />
                          <span className="text-dark-700">{item.text[language]}</span>
                        </div>
                      )
                    })}
                  </div>
                  {ri < CHANGELOG.length - 1 && <div className="border-b border-dark-200/50 mt-3" />}
                </div>
              ))}
            </div>
          )}

          {/* Roadmap Tab */}
          {devTab === 'roadmap' && (
            <div className="space-y-3">
              {ROADMAP.map((item, i) => {
                const statusConfig: Record<RoadmapStatus, { color: string; bg: string; label: string }> = {
                  planned: { color: 'text-dark-500', bg: 'bg-dark-200', label: language === 'es' ? 'Planeado' : 'Planned' },
                  in_progress: { color: 'text-blue-400', bg: 'bg-blue-900/20', label: language === 'es' ? 'En progreso' : 'In Progress' },
                  beta: { color: 'text-amber-400', bg: 'bg-amber-900/20', label: 'Beta' },
                  done: { color: 'text-green-400', bg: 'bg-green-900/20', label: language === 'es' ? 'Listo' : 'Done' },
                }
                const sc = statusConfig[item.status]
                return (
                  <div key={i} className="flex items-start gap-3 p-3 bg-dark-50 rounded-lg">
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${sc.color} ${sc.bg}`}>
                      {sc.label}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm text-dark-700">{item.text[language]}</p>
                      {item.eta && <p className="text-[10px] text-dark-400 mt-0.5">ETA: {item.eta}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Feedback Tab */}
          {devTab === 'feedback' && (
            <div className="text-center py-6">
              <MessageSquarePlus className="w-10 h-10 text-primary-500 mx-auto mb-3" />
              <p className="text-sm text-dark-700 mb-1">
                {language === 'es'
                  ? 'Tu feedback nos ayuda a mejorar la plataforma.'
                  : 'Your feedback helps us improve the platform.'}
              </p>
              <p className="text-xs text-dark-400 mb-4">
                {language === 'es'
                  ? 'Reporta bugs, sugiere funciones o haz preguntas.'
                  : 'Report bugs, suggest features, or ask questions.'}
              </p>
              <button
                onClick={() => {
                  const feedbackBtn = document.querySelector('[data-onboarding="feedback"]') as HTMLButtonElement
                  if (feedbackBtn) feedbackBtn.click()
                }}
                className="btn-primary inline-flex items-center gap-2"
              >
                <MessageSquarePlus className="w-4 h-4" />
                {language === 'es' ? 'Enviar Feedback' : 'Send Feedback'}
              </button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
