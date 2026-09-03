import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage, Language } from '../contexts/LanguageContext'
import { getProfile } from '../services/database'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'
import Layout from '../components/Layout'
import { User, Mail, Save, AlertCircle, CheckCircle, Globe, Users, UserCircle, CreditCard, Zap, Crown, Check, ChevronRight, Palette, Plus, X, Trash2, Code2, Rocket, MessageSquarePlus, Clock, Sparkles, Wrench, Bug, ArrowUpCircle, AlertTriangle, Info, Loader2, Lock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useUsageLimits } from '../hooks/useUsageLimits'
import CreditsChip from '../components/CreditsChip'
import UsageHistoryCard from '../components/UsageHistoryCard'
import { getBrandKits, createBrandKit, updateBrandKit, deleteBrandKit, setDefaultBrandKit, getSubscription, getPayments, getBusinesses, linkBrandKitToBusiness } from '../services/database'
import type { BrandKit, BrandKitFormData, Subscription, Payment, Business } from '../types'
import { CHANGELOG, ROADMAP, STATUS_ALERT, type ChangeCategory, type RoadmapStatus } from '../data/changelog'
import { uploadBrandKitAsset } from '../services/imageStorage'
import {
  getTextModelPreference,
  setTextModelPreference,
  type TextModelProfile,
} from '../features/chat-shell/textModelPreference'
import type { ChatShellTheme } from '../features/chat-shell/chatShellTheme'
import {
  CREDIT_PACK_UI,
  CREDITS_PITCH,
  PLAN_CATALOG_UI,
  PUBLIC_BILLING_PLANS,
  type FrontendPlanId,
} from '../lib/creditsCatalog'

type PlanKey = FrontendPlanId

const PLAN_DETAILS = PLAN_CATALOG_UI

export type SettingsSection = 'all' | 'general' | 'ai' | 'brand' | 'billing' | 'updates'

export function SettingsContent({
  section = 'all',
  surface = 'page',
  theme,
  onThemeChange,
}: {
  section?: SettingsSection
  surface?: 'page' | 'dialog'
  theme?: ChatShellTheme
  onThemeChange?: (theme: ChatShellTheme) => void
}) {
  const { user, updateProfile, updatePassword } = useAuth()
  const show = (id: SettingsSection) => section === 'all' || section === id
  const { language, setLanguage } = useLanguage()
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const usageLimits = useUsageLimits()
  const currentPlan = (usageLimits.plan || 'free') as PlanKey
  const [textModel, setTextModel] = useState<TextModelProfile>(() => getTextModelPreference())

  // Brand Kit state (multi-kit)
  const [brandKits, setBrandKits] = useState<BrandKit[]>([])
  const [editingKit, setEditingKit] = useState<BrandKit | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [bkName, setBkName] = useState('My Brand')
  const [bkPrimary, setBkPrimary] = useState('#000000')
  const [bkSecondary, setBkSecondary] = useState('#ffffff')
  const [bkAccent, setBkAccent] = useState('#6366f1')
  const [bkFontPrimary, setBkFontPrimary] = useState('')
  const [bkFontSecondary, setBkFontSecondary] = useState('')
  const [bkTagline, setBkTagline] = useState('')
  const [bkIndustry, setBkIndustry] = useState('')
  const [bkTargetAudience, setBkTargetAudience] = useState('')
  const [bkVoice, setBkVoice] = useState('')
  const [bkToneKeywords, setBkToneKeywords] = useState<string[]>([])
  const [bkToneInput, setBkToneInput] = useState('')
  const [bkMustUse, setBkMustUse] = useState<string[]>([])
  const [bkMustUseInput, setBkMustUseInput] = useState('')
  const [bkForbidden, setBkForbidden] = useState<string[]>([])
  const [bkForbiddenInput, setBkForbiddenInput] = useState('')
  const [bkVisualStyleNotes, setBkVisualStyleNotes] = useState('')
  const [bkReferenceImages, setBkReferenceImages] = useState<string[]>([])
  const [bkLogoUrl, setBkLogoUrl] = useState<string | null>(null)
  const [bkActive, setBkActive] = useState(true)
  const [bkBusinessId, setBkBusinessId] = useState<string>('')
  const [bkSetPrimaryForBusiness, setBkSetPrimaryForBusiness] = useState(true)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [bkSaving, setBkSaving] = useState(false)
  const [bkAnalyzing, setBkAnalyzing] = useState(false)
  const [bkMessage, setBkMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [bkSection, setBkSection] = useState<'identity' | 'visual' | 'voice' | 'style'>('identity')
  const [showEditor, setShowEditor] = useState(false)
  const [bkUrlInput, setBkUrlInput] = useState('')
  const [bkUrlLoading, setBkUrlLoading] = useState(false)
  const [devTab, setDevTab] = useState<'changelog' | 'roadmap' | 'feedback'>('changelog')

  // Subscription & payments
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [billingLoading, setBillingLoading] = useState(true)

  const PLAN_KIT_LIMITS: Record<string, number> = {
    free: PLAN_DETAILS.free.kits,
    starter: PLAN_DETAILS.starter.kits,
    pro: PLAN_DETAILS.pro.kits,
    business: PLAN_DETAILS.business.kits,
    meta_advanze: PLAN_DETAILS.meta_advanze.kits,
    enterprise: PLAN_DETAILS.enterprise.kits,
  }
  const kitLimit = PLAN_KIT_LIMITS[currentPlan] || 1

  const loadBrandKitsData = async () => {
    if (!user) return
    try {
      const [kits, biz] = await Promise.all([
        getBrandKits(user.id),
        getBusinesses(user.id),
      ])
      setBrandKits(kits)
      setBusinesses(biz)
    } catch (err) {
      console.warn('Failed to load brand kits:', err)
    }
  }

  useEffect(() => {
    async function loadData() {
      if (!user) return
      const profileData = await getProfile(user.id)
      setProfile(profileData)
      await loadBrandKitsData()
      // Load billing data
      try {
        const [sub, pay] = await Promise.all([
          getSubscription(user.id),
          getPayments(user.id, 20)
        ])
        setSubscription(sub)
        setPayments(pay)
      } catch (err) {
        console.warn('Failed to load billing data:', err)
      } finally {
        setBillingLoading(false)
      }
    }
    loadData()
  }, [user?.id])

  const resetEditorForm = () => {
    setBkName('My Brand')
    setBkPrimary('#000000')
    setBkSecondary('#ffffff')
    setBkAccent('#6366f1')
    setBkFontPrimary('')
    setBkFontSecondary('')
    setBkTagline('')
    setBkIndustry('')
    setBkTargetAudience('')
    setBkVoice('')
    setBkToneKeywords([])
    setBkMustUse([])
    setBkForbidden([])
    setBkVisualStyleNotes('')
    setBkReferenceImages([])
    setBkLogoUrl(null)
    setBkActive(true)
    setBkBusinessId('')
    setBkSetPrimaryForBusiness(true)
    setBkSection('identity')
    setBkMessage(null)
    setBkUrlInput('')
  }

  const loadKitIntoEditor = (kit: BrandKit) => {
    setBkName(kit.name)
    setBkPrimary(kit.primary_color || '#000000')
    setBkSecondary(kit.secondary_color || '#ffffff')
    setBkAccent(kit.accent_color || '#6366f1')
    setBkFontPrimary(kit.font_primary || '')
    setBkFontSecondary(kit.font_secondary || '')
    setBkTagline(kit.tagline || '')
    setBkIndustry(kit.industry || '')
    setBkTargetAudience(kit.target_audience || '')
    setBkVoice(kit.brand_voice || '')
    setBkToneKeywords(kit.tone_keywords || [])
    setBkMustUse(kit.must_use_phrases || [])
    setBkForbidden(kit.forbidden_phrases || [])
    setBkVisualStyleNotes(kit.visual_style_notes || '')
    setBkReferenceImages(kit.reference_images || [])
    setBkLogoUrl(kit.logo_url || null)
    setBkActive(kit.is_active)
    setBkBusinessId(kit.business_id || '')
    setBkSetPrimaryForBusiness(kit.is_primary_for_business !== false)
    setBkSection('identity')
    setBkMessage(null)
  }

  const EXTRACT_BRAND_URL = import.meta.env.PROD ? '/api/extract-brand' : 'http://localhost:3000/api/extract-brand'

  const handleExtractBrandFromUrl = async () => {
    const url = bkUrlInput.trim()
    if (!url) return
    setBkUrlLoading(true)
    setBkMessage(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const response = await fetch(EXTRACT_BRAND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ url, language })
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Extraction failed')
      const b = result.brand
      if (b.brand_name) setBkName(b.brand_name)
      if (b.tagline) setBkTagline(b.tagline)
      if (b.primary_color) setBkPrimary(b.primary_color)
      if (b.secondary_color) setBkSecondary(b.secondary_color)
      if (b.accent_color) setBkAccent(b.accent_color)
      if (b.font_primary) setBkFontPrimary(b.font_primary)
      if (b.font_secondary) setBkFontSecondary(b.font_secondary)
      if (b.voice_tone) setBkVoice(b.voice_tone)
      if (b.style_notes) setBkVisualStyleNotes(b.style_notes)
      if (b.key_phrases && Array.isArray(b.key_phrases)) setBkMustUse(b.key_phrases)
      if (b.logo_url) setBkLogoUrl(b.logo_url)
      setBkMessage({ type: 'success', text: language === 'es' ? '¡Marca extraída exitosamente! Revisa y ajusta los campos.' : 'Brand extracted successfully! Review and adjust fields.' })
    } catch (err) {
      setBkMessage({ type: 'error', text: language === 'es' ? `Error al extraer marca: ${err instanceof Error ? err.message : 'Error'}` : `Failed to extract brand: ${err instanceof Error ? err.message : 'Error'}` })
    } finally {
      setBkUrlLoading(false)
    }
  }

  const labels = {
    es: {
      settings: 'Configuración',
      manageAccount: 'Administra tu cuenta',
      profileInfo: 'Información del Perfil',
      email: 'Correo Electrónico',
      emailCantChange: 'El correo no se puede cambiar',
      fullName: 'Nombre Completo',
      changePassword: 'Cambiar contraseña',
      newPassword: 'Nueva contraseña',
      confirmPassword: 'Confirmar contraseña',
      passwordHint: 'Mínimo 8 caracteres, con mayúscula, minúscula y un número.',
      passwordMismatch: 'Las contraseñas no coinciden',
      passwordUpdated: 'Contraseña actualizada',
      updatingPassword: 'Guardando…',
      savePassword: 'Actualizar contraseña',
      saveChanges: 'Guardar Cambios',
      saving: 'Guardando...',
      aiPreferences: 'Preferencias de IA',
      aiLanguage: 'Idioma de IA',
      languageDesc: 'Idioma para conversaciones de IA y scripts generados',
      textModel: 'Modelo de texto',
      textModelDesc: 'Grok 4.6 (Mejor) o Grok 4.5 (Eficiente) para guiones y asistente',
      textModelBest: 'Grok 4.6 · Mejor',
      textModelEfficient: 'Grok 4.5 · Eficiente',
      account: 'Cuenta',
      accountCreated: 'Cuenta Creada',
      accountType: 'Tipo de Cuenta',
      team: 'Equipo',
      individual: 'Individual',
      teamDesc: 'Colabora con tu equipo y gestiona múltiples clientes',
      individualDesc: 'Cuenta personal para uso individual',
      appearance: 'Apariencia',
      appearanceDesc: 'Tema del chat nuevo',
      themeDark: 'Oscuro',
      themeLight: 'Claro',
    },
    en: {
      settings: 'Settings',
      manageAccount: 'Manage your account settings',
      profileInfo: 'Profile Information',
      email: 'Email',
      emailCantChange: 'Email cannot be changed',
      fullName: 'Full Name',
      changePassword: 'Change password',
      newPassword: 'New password',
      confirmPassword: 'Confirm password',
      passwordHint: 'At least 8 characters, with uppercase, lowercase, and a number.',
      passwordMismatch: 'Passwords do not match',
      passwordUpdated: 'Password updated',
      updatingPassword: 'Saving…',
      savePassword: 'Update password',
      saveChanges: 'Save Changes',
      saving: 'Saving...',
      aiPreferences: 'AI Preferences',
      aiLanguage: 'AI Language',
      languageDesc: 'Language for AI conversations and generated scripts',
      textModel: 'Text model',
      textModelDesc: 'Grok 4.6 (Best) or Grok 4.5 (Efficient) for scripts and assistant',
      textModelBest: 'Grok 4.6 · Best',
      textModelEfficient: 'Grok 4.5 · Efficient',
      account: 'Account',
      accountCreated: 'Account Created',
      accountType: 'Account Type',
      team: 'Team',
      individual: 'Individual',
      teamDesc: 'Collaborate with your team and manage multiple clients',
      individualDesc: 'Personal account for individual use',
      appearance: 'Appearance',
      appearanceDesc: 'Theme for the new chat',
      themeDark: 'Dark',
      themeLight: 'Light',
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
        logo_url: bkLogoUrl,
        primary_color: bkPrimary,
        secondary_color: bkSecondary,
        accent_color: bkAccent,
        font_primary: bkFontPrimary || null,
        font_secondary: bkFontSecondary || null,
        tagline: bkTagline || null,
        industry: bkIndustry || null,
        target_audience: bkTargetAudience || null,
        brand_voice: bkVoice || null,
        tone_keywords: bkToneKeywords,
        must_use_phrases: bkMustUse,
        forbidden_phrases: bkForbidden,
        visual_style_notes: bkVisualStyleNotes || null,
        reference_images: bkReferenceImages,
        is_active: bkActive,
        business_id: bkBusinessId || null,
      }
      if (editingKit) {
        await updateBrandKit(editingKit.id, data)
        await linkBrandKitToBusiness(editingKit.id, bkBusinessId || null, {
          setAsPrimary: Boolean(bkBusinessId) && bkSetPrimaryForBusiness,
        })
      } else {
        const created = await createBrandKit(user.id, data)
        if (bkBusinessId) {
          await linkBrandKitToBusiness(created.id, bkBusinessId, {
            setAsPrimary: bkSetPrimaryForBusiness,
          })
        }
      }
      await loadBrandKitsData()
      setShowEditor(false)
      setEditingKit(null)
      setIsCreating(false)
      resetEditorForm()
      setBkMessage({ type: 'success', text: language === 'es' ? 'Brand Kit guardado' : 'Brand Kit saved' })
    } catch (err) {
      setBkMessage({ type: 'error', text: language === 'es' ? 'Error al guardar' : 'Failed to save' })
    } finally {
      setBkSaving(false)
    }
  }

  const handleDeleteBrandKit = async (kitId: string) => {
    if (!user) return
    setBkSaving(true)
    try {
      await deleteBrandKit(kitId)
      await loadBrandKitsData()
      if (editingKit?.id === kitId) {
        setShowEditor(false)
        setEditingKit(null)
        resetEditorForm()
      }
      setBkMessage({ type: 'success', text: language === 'es' ? 'Brand Kit eliminado' : 'Brand Kit deleted' })
    } catch {
      setBkMessage({ type: 'error', text: language === 'es' ? 'Error al eliminar' : 'Failed to delete' })
    } finally {
      setBkSaving(false)
    }
  }

  const handleSetDefault = async (kitId: string) => {
    if (!user) return
    try {
      await setDefaultBrandKit(user.id, kitId)
      await loadBrandKitsData()
    } catch {
      setBkMessage({ type: 'error', text: language === 'es' ? 'Error al establecer predeterminado' : 'Failed to set default' })
    }
  }

  const handleStartCreate = () => {
    if (brandKits.length >= kitLimit) {
      setBkMessage({ type: 'error', text: language === 'es' ? `Tu plan permite máximo ${kitLimit} Brand Kit${kitLimit > 1 ? 's' : ''}. Actualiza tu plan para crear más.` : `Your plan allows max ${kitLimit} Brand Kit${kitLimit > 1 ? 's' : ''}. Upgrade to create more.` })
      return
    }
    resetEditorForm()
    setEditingKit(null)
    setIsCreating(true)
    setShowEditor(true)
  }

  const handleStartEdit = (kit: BrandKit) => {
    loadKitIntoEditor(kit)
    setEditingKit(kit)
    setIsCreating(false)
    setShowEditor(true)
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

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordMessage(null)
    const errors: string[] = []
    if (newPassword.length < 8) errors.push(language === 'es' ? 'Mínimo 8 caracteres' : 'At least 8 characters')
    if (!/[A-Z]/.test(newPassword)) errors.push(language === 'es' ? 'Una letra mayúscula' : 'One uppercase letter')
    if (!/[a-z]/.test(newPassword)) errors.push(language === 'es' ? 'Una letra minúscula' : 'One lowercase letter')
    if (!/[0-9]/.test(newPassword)) errors.push(language === 'es' ? 'Un número' : 'One number')
    if (errors.length) {
      setPasswordMessage({ type: 'error', text: errors.join('. ') })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: t.passwordMismatch })
      return
    }
    setPasswordLoading(true)
    try {
      await updatePassword(newPassword)
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage({ type: 'success', text: t.passwordUpdated })
    } catch (error) {
      setPasswordMessage({
        type: 'error',
        text: error instanceof Error ? error.message : (language === 'es' ? 'No se pudo cambiar la contraseña' : 'Could not change password'),
      })
    } finally {
      setPasswordLoading(false)
    }
  }

  return (
      <div className={surface === 'dialog' ? 'chat-shell__settings-content' : 'p-6 lg:p-8 max-w-2xl mx-auto'}>
        {surface === 'page' && (
        <div className="mb-8 flex items-start justify-between gap-3">
          <div>
          <h1 className="text-2xl font-bold text-dark-900">{t.settings}</h1>
          <p className="text-dark-500 mt-1">{t.manageAccount}</p>
          </div>
          <CreditsChip usage={usageLimits} />
        </div>
        )}

        {show('general') && (
        <div className="card">
          {usageLimits.creditsEnabled && !usageLimits.loading ? (
            <p className="text-sm text-dark-600 mb-4 font-medium">
              {usageLimits.creditsRemaining} {language === 'es' ? 'créditos IA' : 'AI credits'}
            </p>
          ) : null}
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
          <form onSubmit={handleChangePassword} className="space-y-5 mt-6 pt-6 border-t border-dark-200">
            <h3 className="text-base font-semibold text-dark-900">{t.changePassword}</h3>
            <p className="text-xs text-dark-400">{t.passwordHint}</p>
            {passwordMessage && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                passwordMessage.type === 'success'
                  ? 'bg-green-900/20 border border-green-700/30 text-green-400'
                  : 'bg-red-900/20 border border-red-700/30 text-red-400'
              }`}>
                {passwordMessage.type === 'success' ? (
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                )}
                {passwordMessage.text}
              </div>
            )}
            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-dark-700 mb-1.5">
                {t.newPassword}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
                <input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input-field pl-10"
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-dark-700 mb-1.5">
                {t.confirmPassword}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input-field pl-10"
                  autoComplete="new-password"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={passwordLoading || !newPassword}
              className="btn-primary flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {passwordLoading ? t.updatingPassword : t.savePassword}
            </button>
          </form>
          <div className="mt-6 pt-6 border-t border-dark-200">
            <label htmlFor="language-general" className="block text-sm font-medium text-dark-700 mb-1.5">
              {language === 'es' ? 'Idioma' : 'Language'}
            </label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
              <select
                id="language-general"
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                className="input-field pl-10 appearance-none cursor-pointer"
              >
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </div>
          </div>
        </div>
        )}

        {show('general') && surface === 'dialog' && theme && onThemeChange && (
        <div className="card mt-6">
          <h2 className="text-lg font-semibold text-dark-900 mb-2">{t.appearance}</h2>
          <p className="text-xs text-dark-400 mb-4">{t.appearanceDesc}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onThemeChange('obsidian-dark')}
              className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium ${
                theme === 'obsidian-dark'
                  ? 'bg-primary-500 text-white'
                  : 'bg-dark-200 text-dark-600 border border-dark-300'
              }`}
            >
              {t.themeDark}
            </button>
            <button
              type="button"
              onClick={() => onThemeChange('obsidian-light')}
              className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium ${
                theme === 'obsidian-light'
                  ? 'bg-primary-500 text-white'
                  : 'bg-dark-200 text-dark-600 border border-dark-300'
              }`}
            >
              {t.themeLight}
            </button>
          </div>
        </div>
        )}

        {/* Preferencias de IA hidden for now — defaults only */}
        {false && show('ai') && (
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
          <div className="mt-6">
            <label className="block text-sm font-medium text-dark-700 mb-1.5">
              {t.textModel}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setTextModel('best')
                  setTextModelPreference('best')
                }}
                className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium ${
                  textModel === 'best'
                    ? 'bg-primary-500 text-white'
                    : 'bg-dark-200 text-dark-600 border border-dark-300'
                }`}
              >
                {t.textModelBest}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTextModel('efficient')
                  setTextModelPreference('efficient')
                }}
                className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium ${
                  textModel === 'efficient'
                    ? 'bg-primary-500 text-white'
                    : 'bg-dark-200 text-dark-600 border border-dark-300'
                }`}
              >
                {t.textModelEfficient}
              </button>
            </div>
            <p className="text-xs text-dark-400 mt-1">
              {t.textModelDesc}
            </p>
          </div>
        </div>
        )}

        {show('brand') && (
        <div className="card mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
              <Palette className="w-5 h-5 text-primary-500" />
              Brand Kits
              <span className="text-xs font-normal text-dark-400 ml-1">
                {brandKits.length}/{kitLimit === 999 ? '∞' : kitLimit}
              </span>
            </h2>
            <button
              onClick={handleStartCreate}
              className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              {language === 'es' ? 'Nuevo Kit' : 'New Kit'}
            </button>
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
              ? 'Vinculá cada kit a una carpeta de marca (business). Eso es lo que usa Grok/MCP — “Principal” solo es el default de la cuenta.'
              : 'Link each kit to a brand folder (business). That is what Grok/MCP uses — “Default” is only the account-wide Principal.'}
          </p>

          {/* Kit Cards Grid */}
          {brandKits.length === 0 && !showEditor && (
            <div className="text-center py-8 text-dark-400">
              <Palette className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">
                {language === 'es' ? 'No tienes Brand Kits aún' : 'No Brand Kits yet'}
              </p>
              <button onClick={handleStartCreate} className="text-primary-500 text-xs mt-1 hover:underline">
                {language === 'es' ? 'Crear tu primer Brand Kit' : 'Create your first Brand Kit'}
              </button>
            </div>
          )}

          {brandKits.length > 0 && !showEditor && (
            <div className="space-y-3">
              {brandKits.map(kit => (
                <div
                  key={kit.id}
                  className={`p-4 rounded-xl border transition-all cursor-pointer hover:border-primary-300 ${
                    kit.is_default ? 'border-primary-400 bg-primary-900/5' : 'border-dark-200'
                  } ${!kit.is_active ? 'opacity-50' : ''}`}
                  onClick={() => handleStartEdit(kit)}
                >
                  <div className="flex items-center gap-3">
                    {/* Logo or color swatch */}
                    {kit.logo_url ? (
                      <img src={kit.logo_url} alt="" className="w-10 h-10 rounded-lg object-cover border border-dark-200 flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg border border-dark-200 flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: kit.primary_color || '#f3f4f6' }}>
                        <span className="text-xs font-bold" style={{ color: kit.secondary_color || '#fff' }}>{kit.name.charAt(0)}</span>
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-dark-900 truncate">{kit.name}</span>
                        {kit.is_default && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium flex items-center gap-0.5">
                            <Sparkles className="w-2.5 h-2.5" />
                            {language === 'es' ? 'Principal (cuenta)' : 'Account default'}
                          </span>
                        )}
                        {kit.is_primary_for_business && kit.business_id && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-primary-100 text-primary-700 rounded-full font-medium">
                            {language === 'es' ? 'Primary carpeta' : 'Folder primary'}
                          </span>
                        )}
                        {!kit.business_id && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">
                            {language === 'es' ? 'Sin carpeta' : 'Unlinked'}
                          </span>
                        )}
                        {!kit.is_active && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-dark-100 text-dark-400 rounded-full">
                            {language === 'es' ? 'Inactivo' : 'Inactive'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {/* Color swatches */}
                        <div className="flex -space-x-0.5">
                          {[kit.primary_color, kit.secondary_color, kit.accent_color].filter(Boolean).map((c, i) => (
                            <div key={i} className="w-3.5 h-3.5 rounded-full border-2 border-white" style={{ backgroundColor: c || '#ccc' }} />
                          ))}
                        </div>
                        {kit.business_id && (
                          <span className="text-[10px] text-dark-500 truncate">
                            → {businesses.find((b) => b.id === kit.business_id)?.name || kit.business_id.slice(0, 8)}
                          </span>
                        )}
                        {kit.tagline && <span className="text-[10px] text-dark-400 truncate">{kit.tagline}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      {!kit.is_default && (
                        <button
                          onClick={() => handleSetDefault(kit.id)}
                          className="p-1.5 rounded-lg hover:bg-amber-50 text-dark-300 hover:text-amber-500 transition-colors"
                          title={language === 'es' ? 'Establecer como principal' : 'Set as default'}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => { if (confirm(language === 'es' ? '¿Eliminar este Brand Kit?' : 'Delete this Brand Kit?')) handleDeleteBrandKit(kit.id) }}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-dark-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Editor (shown when creating or editing) */}
          {showEditor && (
            <div className="mt-4 border border-dark-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-dark-900">
                  {isCreating
                    ? (language === 'es' ? 'Nuevo Brand Kit' : 'New Brand Kit')
                    : (language === 'es' ? `Editando: ${editingKit?.name}` : `Editing: ${editingKit?.name}`)}
                </h3>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs text-dark-500">{bkActive ? (language === 'es' ? 'Activo' : 'Active') : (language === 'es' ? 'Inactivo' : 'Inactive')}</span>
                    <div
                      onClick={() => setBkActive(!bkActive)}
                      className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${bkActive ? 'bg-primary-500' : 'bg-dark-300'}`}
                    >
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${bkActive ? 'translate-x-4' : ''}`} />
                    </div>
                  </label>
                  <button onClick={() => { setShowEditor(false); setEditingKit(null); setIsCreating(false); resetEditorForm() }} className="text-dark-400 hover:text-dark-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Auto-Build from URL */}
              <div className="flex items-center gap-2 mb-4 p-3 bg-gradient-to-r from-primary-900/10 to-transparent rounded-lg border border-primary-800/20">
                <Globe className="w-4 h-4 text-primary-400 flex-shrink-0" />
                <input
                  type="url"
                  value={bkUrlInput}
                  onChange={(e) => setBkUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleExtractBrandFromUrl() }}
                  placeholder={language === 'es' ? 'Pega la URL de tu sitio web para auto-rellenar...' : 'Paste your website URL to auto-fill...'}
                  className="flex-1 bg-transparent border-none outline-none text-sm text-dark-700 placeholder-dark-400"
                  disabled={bkUrlLoading}
                />
                <button
                  onClick={handleExtractBrandFromUrl}
                  disabled={bkUrlLoading || !bkUrlInput.trim()}
                  className="px-3 py-1.5 text-xs font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                >
                  {bkUrlLoading ? (
                    <><Loader2 className="w-3 h-3 animate-spin" />{language === 'es' ? 'Analizando...' : 'Analyzing...'}</>
                  ) : (
                    <>{language === 'es' ? 'Auto-rellenar' : 'Auto-fill'}</>
                  )}
                </button>
              </div>

              {/* Section Tabs */}
              <div className="flex gap-1 mb-5 bg-dark-50 rounded-lg p-1">
                {([
                  { key: 'identity' as const, es: 'Identidad', en: 'Identity' },
                  { key: 'visual' as const, es: 'Visual', en: 'Visual' },
                  { key: 'voice' as const, es: 'Voz y Tono', en: 'Voice & Tone' },
                  { key: 'style' as const, es: 'Estilo IA', en: 'AI Style' }
                ] as const).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setBkSection(tab.key)}
                    className={`flex-1 text-xs font-medium py-2 px-3 rounded-md transition-all ${
                      bkSection === tab.key ? 'bg-white text-dark-900 shadow-sm' : 'text-dark-400 hover:text-dark-600'
                    }`}
                  >
                    {language === 'es' ? tab.es : tab.en}
                  </button>
                ))}
              </div>

              {/* === IDENTITY SECTION === */}
              {bkSection === 'identity' && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-1.5">
                      {language === 'es' ? 'Nombre de Marca' : 'Brand Name'}
                    </label>
                    <input type="text" value={bkName} onChange={(e) => setBkName(e.target.value)} className="input-field" placeholder="My Brand" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-1.5">
                      {language === 'es' ? 'Carpeta de marca (MCP)' : 'Brand folder (MCP)'}
                    </label>
                    <select
                      className="input-field"
                      value={bkBusinessId}
                      onChange={(e) => setBkBusinessId(e.target.value)}
                    >
                      <option value="">
                        {language === 'es' ? '— Sin vincular —' : '— Unlinked —'}
                      </option>
                      {businesses.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-dark-400 mt-1">
                      {language === 'es'
                        ? 'Obligatorio para que Grok vea este kit en get_brand_context.'
                        : 'Required for Grok to see this kit via get_brand_context.'}
                    </p>
                    {bkBusinessId && (
                      <label className="mt-2 flex items-center gap-2 text-xs text-dark-600">
                        <input
                          type="checkbox"
                          checked={bkSetPrimaryForBusiness}
                          onChange={(e) => setBkSetPrimaryForBusiness(e.target.checked)}
                        />
                        {language === 'es'
                          ? 'Usar como primary de esta carpeta'
                          : 'Use as primary kit for this folder'}
                      </label>
                    )}
                  </div>

                  {/* Logo Upload */}
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-1.5">
                      Logo
                    </label>
                    {bkLogoUrl ? (
                      <div className="flex items-center gap-3">
                        <img src={bkLogoUrl} alt="Logo" className="w-16 h-16 rounded-lg object-cover border border-dark-200" />
                        <button onClick={() => setBkLogoUrl(null)} className="text-xs text-red-400 hover:text-red-300">
                          {language === 'es' ? 'Quitar logo' : 'Remove logo'}
                        </button>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed border-dark-200 rounded-lg cursor-pointer hover:border-primary-400 hover:bg-primary-900/5 transition-all">
                        <Plus className="w-5 h-5 text-dark-400 mb-1" />
                        <span className="text-xs text-dark-400">{language === 'es' ? 'Subir logo' : 'Upload logo'}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/svg+xml"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            try {
                              setBkLogoUrl(await uploadBrandKitAsset(file, 'logo'))
                            } catch (err) {
                              setBkMessage({
                                type: 'error',
                                text: err instanceof Error
                                  ? err.message
                                  : (language === 'es' ? 'Error al subir logo' : 'Failed to upload logo'),
                              })
                            }
                            e.target.value = ''
                          }}
                        />
                      </label>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-1.5">
                      {language === 'es' ? 'Tagline / Eslogan' : 'Tagline / Slogan'}
                    </label>
                    <input type="text" value={bkTagline} onChange={(e) => setBkTagline(e.target.value)} className="input-field" placeholder={language === 'es' ? 'Ej: "Tu aliado en bienestar"' : 'E.g.: "Your wellness ally"'} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-dark-700 mb-1.5">{language === 'es' ? 'Industria / Categoría' : 'Industry / Category'}</label>
                      <input type="text" value={bkIndustry} onChange={(e) => setBkIndustry(e.target.value)} className="input-field" placeholder={language === 'es' ? 'Ej: Salud y bienestar' : 'E.g.: Health & wellness'} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-dark-700 mb-1.5">{language === 'es' ? 'Audiencia Objetivo' : 'Target Audience'}</label>
                      <input type="text" value={bkTargetAudience} onChange={(e) => setBkTargetAudience(e.target.value)} className="input-field" placeholder={language === 'es' ? 'Ej: Mujeres 25-45' : 'E.g.: Women 25-45'} />
                    </div>
                  </div>
                </div>
              )}

              {/* === VISUAL SECTION === */}
              {bkSection === 'visual' && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-2">{language === 'es' ? 'Colores de Marca' : 'Brand Colors'}</label>
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
                      {bkLogoUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            const img = new Image()
                            img.crossOrigin = 'anonymous'
                            img.onload = () => {
                              const canvas = document.createElement('canvas')
                              const size = 50
                              canvas.width = size
                              canvas.height = size
                              const ctx = canvas.getContext('2d')
                              if (!ctx) return
                              ctx.drawImage(img, 0, 0, size, size)
                              const data = ctx.getImageData(0, 0, size, size).data
                              const pixels: [number, number, number][] = []
                              for (let i = 0; i < data.length; i += 4) {
                                const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
                                if (a < 128) continue
                                if (r > 240 && g > 240 && b > 240) continue
                                if (r < 15 && g < 15 && b < 15) continue
                                pixels.push([r, g, b])
                              }
                              if (pixels.length < 3) return
                              pixels.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]))
                              const toHex = ([r, g, b]: [number, number, number]) => '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
                              const pick = (pct: number) => pixels[Math.floor(pixels.length * pct)]
                              setBkPrimary(toHex(pick(0.15)))
                              setBkSecondary(toHex(pick(0.5)))
                              setBkAccent(toHex(pick(0.85)))
                              setBkMessage({ type: 'success', text: language === 'es' ? 'Colores extraídos del logo' : 'Colors extracted from logo' })
                            }
                            img.onerror = () => setBkMessage({ type: 'error', text: language === 'es' ? 'No se pudo analizar el logo' : 'Could not analyze logo' })
                            img.src = bkLogoUrl!
                          }}
                          className="flex flex-col items-center gap-1 ml-2 p-2 rounded-lg border border-dashed border-dark-200 hover:border-primary-400 hover:bg-primary-900/5 transition-all cursor-pointer"
                          title={language === 'es' ? 'Extraer colores del logo' : 'Extract colors from logo'}
                        >
                          <Palette className="w-4 h-4 text-primary-400" />
                          <span className="text-[9px] text-dark-400 whitespace-nowrap">{language === 'es' ? 'Del logo' : 'From logo'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-dark-700 mb-1.5">{language === 'es' ? 'Tipografía Principal' : 'Primary Font'}</label>
                      <input type="text" value={bkFontPrimary} onChange={(e) => setBkFontPrimary(e.target.value)} className="input-field" placeholder={language === 'es' ? 'Ej: Montserrat' : 'E.g.: Montserrat'} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-dark-700 mb-1.5">{language === 'es' ? 'Tipografía Secundaria' : 'Secondary Font'}</label>
                      <input type="text" value={bkFontSecondary} onChange={(e) => setBkFontSecondary(e.target.value)} className="input-field" placeholder={language === 'es' ? 'Ej: Playfair Display' : 'E.g.: Playfair Display'} />
                    </div>
                  </div>
                </div>
              )}

              {/* === VOICE & TONE SECTION === */}
              {bkSection === 'voice' && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-1.5">{language === 'es' ? 'Voz de Marca' : 'Brand Voice'}</label>
                    <textarea value={bkVoice} onChange={(e) => setBkVoice(e.target.value)} className="input-field min-h-[80px] resize-y" placeholder={language === 'es' ? 'Describe el tono y personalidad...' : "Describe your brand's tone..."} rows={3} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-1.5">{language === 'es' ? 'Palabras Clave de Tono' : 'Tone Keywords'}</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {bkToneKeywords.map((kw, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-primary-900/20 text-primary-400 rounded-full text-xs">
                          {kw}<button onClick={() => removeTag(bkToneKeywords, setBkToneKeywords, i)} className="hover:text-red-400"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input type="text" value={bkToneInput} onChange={e => setBkToneInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag(bkToneKeywords, setBkToneKeywords, bkToneInput, setBkToneInput))} className="input-field flex-1" placeholder={language === 'es' ? 'Ej: profesional...' : 'E.g.: bold...'} />
                      <button type="button" onClick={() => addTag(bkToneKeywords, setBkToneKeywords, bkToneInput, setBkToneInput)} className="btn-secondary px-3"><Plus className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-1.5">{language === 'es' ? 'Frases Obligatorias' : 'Must-Use Phrases'}</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {bkMustUse.map((p, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-green-900/20 text-green-400 rounded-full text-xs">
                          {p}<button onClick={() => removeTag(bkMustUse, setBkMustUse, i)} className="hover:text-red-400"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input type="text" value={bkMustUseInput} onChange={e => setBkMustUseInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag(bkMustUse, setBkMustUse, bkMustUseInput, setBkMustUseInput))} className="input-field flex-1" placeholder={language === 'es' ? 'Ej: ¡Descúbrelo hoy!' : 'E.g.: Discover today!'} />
                      <button type="button" onClick={() => addTag(bkMustUse, setBkMustUse, bkMustUseInput, setBkMustUseInput)} className="btn-secondary px-3"><Plus className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-1.5">{language === 'es' ? 'Frases Prohibidas' : 'Forbidden Phrases'}</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {bkForbidden.map((p, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-red-900/20 text-red-400 rounded-full text-xs">
                          {p}<button onClick={() => removeTag(bkForbidden, setBkForbidden, i)} className="hover:text-red-400"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input type="text" value={bkForbiddenInput} onChange={e => setBkForbiddenInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag(bkForbidden, setBkForbidden, bkForbiddenInput, setBkForbiddenInput))} className="input-field flex-1" placeholder={language === 'es' ? 'Ej: barato, gratis...' : 'E.g.: cheap, free...'} />
                      <button type="button" onClick={() => addTag(bkForbidden, setBkForbidden, bkForbiddenInput, setBkForbiddenInput)} className="btn-secondary px-3"><Plus className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>
              )}

              {/* === AI STYLE ANALYSIS SECTION === */}
              {bkSection === 'style' && (
                <div className="space-y-5">
                  <p className="text-xs text-dark-400">
                    {language === 'es'
                      ? 'Sube ejemplos de tus posts o diseños. La IA analizará el estilo visual.'
                      : 'Upload examples of your posts or designs. AI will analyze the visual style.'}
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-2">
                      {language === 'es' ? 'Imágenes de Referencia' : 'Reference Images'}
                      <span className="text-dark-400 font-normal ml-1">({language === 'es' ? 'máx. 3' : 'max 3'})</span>
                    </label>
                    {bkReferenceImages.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {bkReferenceImages.map((img, i) => (
                          <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-dark-200 group">
                            <img src={img} alt={`Ref ${i + 1}`} className="w-full h-full object-cover" />
                            <button onClick={() => setBkReferenceImages(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-1 right-1 w-6 h-6 bg-dark-900/70 rounded-full flex items-center justify-center opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                              <X className="w-3 h-3 text-white" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {bkReferenceImages.length < 3 && (
                      <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-dark-200 rounded-lg cursor-pointer hover:border-primary-400 hover:bg-primary-900/5 transition-all">
                        <Plus className="w-5 h-5 text-dark-400 mb-1" />
                        <span className="text-xs text-dark-400">{language === 'es' ? 'Subir imagen' : 'Upload image'}</span>
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" className="hidden" onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          try {
                            const url = await uploadBrandKitAsset(file, 'reference')
                            setBkReferenceImages(prev => [...prev, url])
                          } catch (err) {
                            setBkMessage({ type: 'error', text: language === 'es' ? 'Error al subir imagen' : 'Failed to upload image' })
                          }
                          e.target.value = ''
                        }} />
                      </label>
                    )}
                  </div>
                  {bkReferenceImages.length > 0 && (
                    <button
                      onClick={async () => {
                        if (!user || bkAnalyzing) return
                        setBkAnalyzing(true); setBkMessage(null)
                        try {
                          const { data: { session } } = await supabase.auth.getSession()
                          if (!session) return
                          const apiUrl = import.meta.env.PROD ? '/api/analyze-style' : 'http://localhost:3000/api/analyze-style'
                          const resp = await fetch(apiUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                            body: JSON.stringify({
                              referenceImages: bkReferenceImages,
                              description: `Brand: ${bkName}. ${bkIndustry ? `Industry: ${bkIndustry}.` : ''} ${bkTargetAudience ? `Audience: ${bkTargetAudience}.` : ''}`,
                              stylePreferences: { brandColors: [bkPrimary, bkSecondary, bkAccent].filter(c => c !== '#000000' && c !== '#ffffff').join(', '), typography: [bkFontPrimary, bkFontSecondary].filter(Boolean).join(', '), mood: bkVoice || undefined }
                            })
                          })
                          const data = await resp.json()
                          if (!resp.ok) throw new Error(data.error || 'Analysis failed')
                          setBkVisualStyleNotes((language === 'es' ? data.masterPromptEs : data.masterPromptEn) || '')
                          if (data.extractedColors?.length > 0) { const [c1, c2, c3] = data.extractedColors; if (c1) setBkPrimary(c1); if (c2) setBkSecondary(c2); if (c3) setBkAccent(c3) }
                          setBkMessage({ type: 'success', text: language === 'es' ? 'Estilo analizado' : 'Style analyzed' })
                        } catch (err) { setBkMessage({ type: 'error', text: err instanceof Error ? err.message : 'Analysis failed' }) }
                        finally { setBkAnalyzing(false) }
                      }}
                      disabled={bkAnalyzing}
                      className="btn-secondary flex items-center gap-2 w-full justify-center"
                    >
                      <Sparkles className={`w-4 h-4 ${bkAnalyzing ? 'animate-spin' : ''}`} />
                      {bkAnalyzing ? (language === 'es' ? 'Analizando...' : 'Analyzing...') : (language === 'es' ? 'Analizar Estilo con IA' : 'Analyze Style with AI')}
                    </button>
                  )}
                  {bkVisualStyleNotes && (
                    <div>
                      <label className="block text-sm font-medium text-dark-700 mb-1.5">{language === 'es' ? 'Guía de Estilo (IA)' : 'Style Guide (AI)'}</label>
                      <textarea value={bkVisualStyleNotes} onChange={(e) => setBkVisualStyleNotes(e.target.value)} className="input-field min-h-[120px] resize-y text-xs" rows={6} />
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button onClick={handleSaveBrandKit} disabled={bkSaving} className="btn-primary flex items-center gap-2 flex-1 justify-center">
                  <Save className="w-4 h-4" />
                  {bkSaving ? (language === 'es' ? 'Guardando...' : 'Saving...') : (language === 'es' ? 'Guardar' : 'Save')}
                </button>
                <button onClick={() => { setShowEditor(false); setEditingKit(null); setIsCreating(false); resetEditorForm() }} className="btn-secondary px-4">
                  {language === 'es' ? 'Cancelar' : 'Cancel'}
                </button>
              </div>
            </div>
          )}
        </div>
        )}

        {show('billing') && (
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

          {/* Current Usage — Créditos IA when enabled, else legacy meters */}
          {!usageLimits.loading && (
            <div className="space-y-4 mb-6">
              {usageLimits.creditsEnabled ? (
                <div className="p-4 bg-dark-50 rounded-xl">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-500" />
                      <span className="text-sm font-medium text-dark-700">
                        {language === 'es' ? 'Créditos IA' : 'AI credits'}
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-dark-900">{usageLimits.creditsRemaining}</div>
                  </div>
                  <p className="text-xs text-dark-500">
                    {language === 'es'
                      ? `Saldo actual disponible para generar. Guion 3 · Imagen 6 · Pro 24. ${CREDITS_PITCH.es}`
                      : `Current balance available for generation. Script 3 · Image 6 · Pro 24. ${CREDITS_PITCH.en}`}
                  </p>
                </div>
              ) : (
                <div className="p-4 bg-dark-50 rounded-xl space-y-2 text-sm text-dark-700">
                  <p>
                    {language === 'es' ? 'Guiones este mes' : 'Scripts this month'}: {usageLimits.scriptsUsed}
                    {usageLimits.scriptsLimit === -1 ? '' : ` / ${usageLimits.scriptsLimit}`}
                  </p>
                  <p>
                    {language === 'es' ? 'Imágenes este mes' : 'Images this month'}: {usageLimits.imagesUsed}
                    {usageLimits.imagesLimit === -1 ? '' : ` / ${usageLimits.imagesLimit}`}
                  </p>
                  <p className="text-xs text-dark-500">{CREDITS_PITCH[language]}</p>
                </div>
              )}
              <UsageHistoryCard language={language} />
            </div>
          )}

          {/* Plan Options — public plans only */}
          <div className="space-y-3">
            {PUBLIC_BILLING_PLANS.filter((p) => p !== 'free').map((plan) => (
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
                      {language === 'es' ? PLAN_DETAILS[plan].creditLabelEs : PLAN_DETAILS[plan].creditLabelEn}
                      {' · '}{PLAN_DETAILS[plan].kits} kits
                    </p>
                    {!PLAN_DETAILS[plan].paymentLink && (
                      <p className="text-xs text-amber-600 mt-1">
                        {language === 'es' ? 'Checkout pendiente (URL TiloPay)' : 'Checkout pending (TiloPay URL)'}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-dark-900">${PLAN_DETAILS[plan].price || 0}</div>
                    <p className="text-xs text-dark-400">/ {language === 'es' ? 'mes' : 'month'}</p>
                  </div>
                </div>
                {currentPlan !== plan && PLAN_DETAILS[plan].paymentLink && (() => {
                  const rank: Record<string, number> = { free: 0, starter: 1, pro: 2, business: 3, meta_advanze: 2, enterprise: 4 }
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

          {/* Credit pack — all users */}
          <div className="mt-4 p-4 rounded-xl border-2 border-dashed border-primary-300 bg-primary-900/20">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-primary-600" />
                  <span className="font-semibold text-dark-900">
                    {language === 'es' ? 'Paquete de créditos' : 'Credit pack'}
                  </span>
                </div>
                <p className="text-sm text-dark-500 mt-1">
                  {language === 'es' ? CREDIT_PACK_UI.labelEs : CREDIT_PACK_UI.labelEn}
                </p>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-dark-900">${CREDIT_PACK_UI.price}</div>
                <p className="text-xs text-dark-400">{language === 'es' ? 'único' : 'one-time'}</p>
              </div>
            </div>
            <button
              className="w-full mt-3 btn-primary py-2 flex items-center justify-center gap-2 disabled:opacity-50"
              disabled={loading || !CREDIT_PACK_UI.paymentLink}
              onClick={async () => {
                if (!CREDIT_PACK_UI.paymentLink) {
                  setMessage({
                    type: 'error',
                    text: language === 'es'
                      ? 'URL de TiloPay del paquete pendiente'
                      : 'Credit pack TiloPay URL pending',
                  })
                  return
                }
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
                    body: JSON.stringify({ plan: 'credit_pack' })
                  })
                  const data = await response.json()
                  if (data.checkoutUrl) {
                    window.open(data.checkoutUrl, '_blank')
                  } else {
                    setMessage({ type: 'error', text: data.error || 'Error al procesar' })
                  }
                } catch (error) {
                  console.error('Pack checkout error:', error)
                  setMessage({ type: 'error', text: language === 'es' ? 'Error de conexión' : 'Connection error' })
                } finally {
                  setLoading(false)
                }
              }}
            >
              <Zap className="w-4 h-4" />
              {!CREDIT_PACK_UI.paymentLink
                ? (language === 'es' ? 'Próximamente' : 'Coming soon')
                : (language === 'es' ? 'Comprar paquete' : 'Buy pack')}
            </button>
          </div>

          {/* Subscription Status */}
          {!billingLoading && subscription && subscription.plan !== 'free' && (
            <div className="mt-6 pt-5 border-t border-dark-100">
              <h3 className="text-sm font-semibold text-dark-700 mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-primary-500" />
                {language === 'es' ? 'Estado de Suscripción' : 'Subscription Status'}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-dark-50 rounded-lg">
                  <p className="text-[10px] uppercase font-medium text-dark-400 mb-1">
                    {language === 'es' ? 'Estado' : 'Status'}
                  </p>
                  <p className={`text-sm font-semibold ${
                    subscription.status === 'active' ? 'text-green-600' :
                    subscription.status === 'trialing' ? 'text-blue-600' :
                    subscription.status === 'past_due' ? 'text-red-600' :
                    subscription.status === 'cancelled' ? 'text-amber-600' : 'text-dark-500'
                  }`}>
                    {subscription.status === 'active' ? (language === 'es' ? 'Activa' : 'Active') :
                     subscription.status === 'trialing' ? (language === 'es' ? 'Periodo de prueba' : 'Trial') :
                     subscription.status === 'past_due' ? (language === 'es' ? 'Pago pendiente' : 'Past Due') :
                     subscription.status === 'cancelled' ? (language === 'es' ? 'Cancelada' : 'Cancelled') :
                     subscription.status}
                  </p>
                </div>
                {subscription.current_period_end && (
                  <div className="p-3 bg-dark-50 rounded-lg">
                    <p className="text-[10px] uppercase font-medium text-dark-400 mb-1">
                      {language === 'es' ? 'Próxima Renovación' : 'Next Renewal'}
                    </p>
                    <p className="text-sm font-semibold text-dark-800">
                      {new Date(subscription.current_period_end).toLocaleDateString(language === 'es' ? 'es-CR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                )}
                {subscription.trial_ends_at && subscription.status === 'trialing' && (
                  <div className="p-3 bg-dark-50 rounded-lg">
                    <p className="text-[10px] uppercase font-medium text-dark-400 mb-1">
                      {language === 'es' ? 'Prueba Termina' : 'Trial Ends'}
                    </p>
                    <p className="text-sm font-semibold text-blue-600">
                      {new Date(subscription.trial_ends_at).toLocaleDateString(language === 'es' ? 'es-CR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                )}
              </div>
              {subscription.cancel_at_period_end && (
                <p className="text-xs text-amber-600 mt-2 font-medium">
                  ⚠️ {language === 'es'
                    ? 'Tu suscripción se cancelará al final del periodo actual.'
                    : 'Your subscription will be cancelled at the end of the current period.'}
                </p>
              )}
            </div>
          )}

          {/* Payment History */}
          {!billingLoading && payments.length > 0 && (
            <div className="mt-5 pt-5 border-t border-dark-100">
              <h3 className="text-sm font-semibold text-dark-700 mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary-500" />
                {language === 'es' ? 'Historial de Pagos' : 'Payment History'}
              </h3>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-2 px-3 bg-dark-50 rounded-lg text-xs">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        p.status === 'succeeded' ? 'bg-green-500' :
                        p.status === 'failed' ? 'bg-red-500' :
                        p.status === 'refunded' ? 'bg-amber-500' : 'bg-dark-300'
                      }`} />
                      <span className="text-dark-700 font-medium">
                        {p.description || p.plan || (language === 'es' ? 'Pago' : 'Payment')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-semibold ${
                        p.status === 'succeeded' ? 'text-dark-900' :
                        p.status === 'failed' ? 'text-red-500 line-through' : 'text-dark-500'
                      }`}>
                        ${Number(p.amount).toFixed(2)} {p.currency}
                      </span>
                      <span className="text-dark-400 whitespace-nowrap">
                        {p.paid_at ? new Date(p.paid_at).toLocaleDateString(language === 'es' ? 'es-CR' : 'en-US', { day: 'numeric', month: 'short' }) : '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )}

        {show('general') && (
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
        )}

        {show('updates') && (
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
        )}
      </div>
  )
}

export default function Settings() {
  return (
    <Layout>
      <SettingsContent section="all" surface="page" />
    </Layout>
  )
}
