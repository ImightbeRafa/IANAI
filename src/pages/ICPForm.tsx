import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getICP, createICP, updateICP } from '../services/database'
import type { ICPFormData, AwarenessLevel, SophisticationLevel, UrgencyType, Gender, AgeRange } from '../types'
import Layout from '../components/Layout'
import { 
  ArrowLeft, 
  Save, 
  Users,
  Loader2,
  HelpCircle
} from 'lucide-react'

export default function ICPForm() {
  const { icpId, clientId } = useParams<{ icpId: string; clientId: string }>()
  const { user } = useAuth()
  const { language } = useLanguage()
  const navigate = useNavigate()
  const isEditing = icpId && icpId !== 'new'

  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState<ICPFormData>({
    name: '',
    description: '',
    awareness_level: 'problem_aware',
    sophistication_level: 'medium',
    urgency_type: 'latent',
    gender: 'any',
    age_range: '25-34'
  })

  const labels = {
    es: {
      createTitle: 'Crear Perfil ICP',
      editTitle: 'Editar Perfil ICP',
      back: 'Volver',
      save: 'Guardar',
      saving: 'Guardando...',
      
      nameLabel: 'Nombre del ICP',
      namePlaceholder: 'Ej: Dueño de ecommerce estancado',
      nameHelp: 'Un nombre descriptivo para identificar este perfil',
      
      descriptionLabel: 'Descripción breve del ICP',
      descriptionPlaceholder: 'Persona que [situación actual], quiere [resultado principal], pero está bloqueada por [problema/freno principal]',
      descriptionHelp: 'Sigue esta estructura: Persona que [situación], quiere [resultado], pero está bloqueada por [bloqueo]',
      
      awarenessLabel: 'Nivel de conciencia',
      awarenessHelp: 'Qué tan consciente es de su problema y de que necesita una solución',
      awarenessOptions: {
        unaware: 'Inconsciente - Siente frustración, pero no sabe qué le pasa',
        problem_aware: 'Consciente del problema - Sabe qué le duele, no la solución',
        solution_aware: 'Consciente de la solución - Sabe que existen soluciones',
        product_aware: 'Consciente del producto - Ya compara opciones'
      },
      
      sophisticationLabel: 'Nivel de sofisticación del mercado',
      sophisticationHelp: 'Qué tan expuesto está a promesas, anuncios y soluciones similares',
      sophisticationOptions: {
        low: 'Bajo - Casi no ha visto ofertas similares',
        medium: 'Medio - Ya vio anuncios y promesas parecidas',
        high: 'Alto - Está saturado, es escéptico y compara todo'
      },
      
      urgencyLabel: 'Tipo de urgencia',
      urgencyHelp: 'Qué tan rápido necesita resolver su problema',
      urgencyOptions: {
        immediate: 'Inmediata - Necesita solución ya',
        latent: 'Latente - Sabe que debe hacerlo pronto',
        low: 'Baja - No siente presión real todavía'
      },
      
      genderLabel: 'Sexo',
      genderOptions: {
        male: 'Masculino',
        female: 'Femenino',
        any: 'Indistinto'
      },
      
      ageLabel: 'Rango de edad',
      ageOptions: {
        '18-24': '18-24 años',
        '25-34': '25-34 años',
        '35-44': '35-44 años',
        '45-54': '45-54 años',
        '55+': '55+ años'
      }
    },
    en: {
      createTitle: 'Create ICP Profile',
      editTitle: 'Edit ICP Profile',
      back: 'Back',
      save: 'Save',
      saving: 'Saving...',
      
      nameLabel: 'ICP Name',
      namePlaceholder: 'Ex: Stuck ecommerce owner',
      nameHelp: 'A descriptive name to identify this profile',
      
      descriptionLabel: 'Brief ICP Description',
      descriptionPlaceholder: 'Person who [current situation], wants [main result], but is blocked by [main problem/brake]',
      descriptionHelp: 'Follow this structure: Person who [situation], wants [result], but is blocked by [block]',
      
      awarenessLabel: 'Awareness Level',
      awarenessHelp: 'How aware they are of their problem and that they need a solution',
      awarenessOptions: {
        unaware: 'Unaware - Feels frustration, but doesn\'t know what\'s wrong',
        problem_aware: 'Problem aware - Knows what hurts, not the solution',
        solution_aware: 'Solution aware - Knows solutions exist',
        product_aware: 'Product aware - Already comparing options'
      },
      
      sophisticationLabel: 'Market Sophistication Level',
      sophisticationHelp: 'How exposed they are to promises, ads, and similar solutions',
      sophisticationOptions: {
        low: 'Low - Has barely seen similar offers',
        medium: 'Medium - Has seen similar ads and promises',
        high: 'High - Saturated, skeptical, compares everything'
      },
      
      urgencyLabel: 'Urgency Type',
      urgencyHelp: 'How quickly they need to solve their problem',
      urgencyOptions: {
        immediate: 'Immediate - Needs solution now',
        latent: 'Latent - Knows they should do it soon',
        low: 'Low - Doesn\'t feel real pressure yet'
      },
      
      genderLabel: 'Gender',
      genderOptions: {
        male: 'Male',
        female: 'Female',
        any: 'Any'
      },
      
      ageLabel: 'Age Range',
      ageOptions: {
        '18-24': '18-24 years',
        '25-34': '25-34 years',
        '35-44': '35-44 years',
        '45-54': '45-54 years',
        '55+': '55+ years'
      }
    }
  }

  const t = labels[language]

  useEffect(() => {
    async function loadICP() {
      if (!isEditing || !icpId) return
      try {
        const icp = await getICP(icpId)
        if (icp) {
          setFormData({
            name: icp.name,
            description: icp.description,
            awareness_level: icp.awareness_level,
            sophistication_level: icp.sophistication_level,
            urgency_type: icp.urgency_type,
            gender: icp.gender,
            age_range: icp.age_range
          })
        }
      } catch (err) {
        console.error('Failed to load ICP:', err)
        setError(language === 'es' ? 'Error al cargar el ICP' : 'Failed to load ICP')
      } finally {
        setLoading(false)
      }
    }
    loadICP()
  }, [isEditing, icpId, language])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return

    if (!formData.name.trim() || !formData.description.trim()) {
      setError(language === 'es' ? 'Nombre y descripción son requeridos' : 'Name and description are required')
      return
    }

    setSaving(true)
    setError('')

    try {
      if (isEditing && icpId) {
        await updateICP(icpId, formData)
      } else {
        const icpPayload = { ...formData, ...(clientId ? { client_id: clientId } : {}) }
        await createICP(user.id, icpPayload)
      }
      navigate('/icps')
    } catch (err) {
      console.error('Failed to save ICP:', err)
      setError(language === 'es' ? 'Error al guardar el ICP' : 'Failed to save ICP')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            to="/icps"
            className="p-2 text-dark-500 hover:text-dark-900 hover:bg-dark-100 rounded-lg transition-colors"
            onClick={(e) => {
              e.preventDefault()
              navigate('/icps')
            }}
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-dark-900 flex items-center gap-3">
              <Users className="w-7 h-7 text-primary-500" />
              {isEditing ? t.editTitle : t.createTitle}
            </h1>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {/* Name */}
          <div className="bg-white rounded-xl border border-dark-100 p-6">
            <label className="block text-sm font-medium text-dark-900 mb-2">
              {t.nameLabel}
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={t.namePlaceholder}
              className="w-full px-4 py-3 border border-dark-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
            <p className="mt-2 text-xs text-dark-500 flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5" />
              {t.nameHelp}
            </p>
          </div>

          {/* Description */}
          <div className="bg-white rounded-xl border border-dark-100 p-6">
            <label className="block text-sm font-medium text-dark-900 mb-2">
              {t.descriptionLabel}
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder={t.descriptionPlaceholder}
              rows={3}
              className="w-full px-4 py-3 border border-dark-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
            />
            <p className="mt-2 text-xs text-dark-500 flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5" />
              {t.descriptionHelp}
            </p>
          </div>

          {/* Awareness Level */}
          <div className="bg-white rounded-xl border border-dark-100 p-6">
            <label className="block text-sm font-medium text-dark-900 mb-2">
              {t.awarenessLabel}
            </label>
            <p className="text-xs text-dark-500 mb-3">{t.awarenessHelp}</p>
            <div className="space-y-2">
              {(['unaware', 'problem_aware', 'solution_aware', 'product_aware'] as AwarenessLevel[]).map((level) => (
                <label key={level} className="flex items-center gap-3 p-3 border border-dark-100 rounded-lg cursor-pointer hover:bg-dark-50 transition-colors">
                  <input
                    type="radio"
                    name="awareness_level"
                    value={level}
                    checked={formData.awareness_level === level}
                    onChange={() => setFormData({ ...formData, awareness_level: level })}
                    className="w-4 h-4 text-primary-500"
                  />
                  <span className="text-sm text-dark-700">{t.awarenessOptions[level]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Sophistication Level */}
          <div className="bg-white rounded-xl border border-dark-100 p-6">
            <label className="block text-sm font-medium text-dark-900 mb-2">
              {t.sophisticationLabel}
            </label>
            <p className="text-xs text-dark-500 mb-3">{t.sophisticationHelp}</p>
            <div className="space-y-2">
              {(['low', 'medium', 'high'] as SophisticationLevel[]).map((level) => (
                <label key={level} className="flex items-center gap-3 p-3 border border-dark-100 rounded-lg cursor-pointer hover:bg-dark-50 transition-colors">
                  <input
                    type="radio"
                    name="sophistication_level"
                    value={level}
                    checked={formData.sophistication_level === level}
                    onChange={() => setFormData({ ...formData, sophistication_level: level })}
                    className="w-4 h-4 text-primary-500"
                  />
                  <span className="text-sm text-dark-700">{t.sophisticationOptions[level]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Urgency Type */}
          <div className="bg-white rounded-xl border border-dark-100 p-6">
            <label className="block text-sm font-medium text-dark-900 mb-2">
              {t.urgencyLabel}
            </label>
            <p className="text-xs text-dark-500 mb-3">{t.urgencyHelp}</p>
            <div className="space-y-2">
              {(['immediate', 'latent', 'low'] as UrgencyType[]).map((type) => (
                <label key={type} className="flex items-center gap-3 p-3 border border-dark-100 rounded-lg cursor-pointer hover:bg-dark-50 transition-colors">
                  <input
                    type="radio"
                    name="urgency_type"
                    value={type}
                    checked={formData.urgency_type === type}
                    onChange={() => setFormData({ ...formData, urgency_type: type })}
                    className="w-4 h-4 text-primary-500"
                  />
                  <span className="text-sm text-dark-700">{t.urgencyOptions[type]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Gender & Age Row */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Gender */}
            <div className="bg-white rounded-xl border border-dark-100 p-6">
              <label className="block text-sm font-medium text-dark-900 mb-3">
                {t.genderLabel}
              </label>
              <div className="flex gap-2">
                {(['male', 'female', 'any'] as Gender[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setFormData({ ...formData, gender: g })}
                    className={`flex-1 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      formData.gender === g
                        ? 'bg-primary-500 text-white border-primary-500'
                        : 'bg-white text-dark-600 border-dark-200 hover:border-primary-300'
                    }`}
                  >
                    {t.genderOptions[g]}
                  </button>
                ))}
              </div>
            </div>

            {/* Age Range */}
            <div className="bg-white rounded-xl border border-dark-100 p-6">
              <label className="block text-sm font-medium text-dark-900 mb-3">
                {t.ageLabel}
              </label>
              <select
                value={formData.age_range}
                onChange={(e) => setFormData({ ...formData, age_range: e.target.value as AgeRange })}
                className="w-full px-4 py-2 border border-dark-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                {(['18-24', '25-34', '35-44', '45-54', '55+'] as AgeRange[]).map((age) => (
                  <option key={age} value={age}>{t.ageOptions[age]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {t.saving}
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  {t.save}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  )
}
