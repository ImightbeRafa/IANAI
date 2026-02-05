import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getICPs, deleteICP } from '../services/database'
import type { ICP } from '../types'
import Layout from '../components/Layout'
import { 
  Plus, 
  Users, 
  Trash2, 
  Edit,
  Target,
  Clock,
  User,
  AlertCircle,
  Loader2
} from 'lucide-react'

export default function ICPDashboard() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const [icps, setICPs] = useState<ICP[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  const labels = {
    es: {
      title: 'Perfiles de Cliente Ideal',
      subtitle: 'Crea perfiles de clientes ideales para generar guiones más precisos',
      createNew: 'Crear nuevo ICP',
      noICPs: 'No tienes perfiles ICP todavía',
      noICPsDesc: 'Crea tu primer perfil de cliente ideal para mejorar tus guiones',
      awareness: 'Nivel de conciencia',
      sophistication: 'Sofisticación',
      urgency: 'Urgencia',
      delete: 'Eliminar',
      edit: 'Editar',
      confirmDelete: '¿Estás seguro de eliminar este ICP?',
      awarenessLevels: {
        unaware: 'Inconsciente',
        problem_aware: 'Consciente del problema',
        solution_aware: 'Consciente de solución',
        product_aware: 'Consciente del producto'
      },
      sophisticationLevels: {
        low: 'Bajo',
        medium: 'Medio',
        high: 'Alto'
      },
      urgencyTypes: {
        immediate: 'Inmediata',
        latent: 'Latente',
        low: 'Baja'
      }
    },
    en: {
      title: 'Ideal Client Profiles',
      subtitle: 'Create ideal client profiles to generate more precise scripts',
      createNew: 'Create new ICP',
      noICPs: 'No ICP profiles yet',
      noICPsDesc: 'Create your first ideal client profile to improve your scripts',
      awareness: 'Awareness level',
      sophistication: 'Sophistication',
      urgency: 'Urgency',
      delete: 'Delete',
      edit: 'Edit',
      confirmDelete: 'Are you sure you want to delete this ICP?',
      awarenessLevels: {
        unaware: 'Unaware',
        problem_aware: 'Problem aware',
        solution_aware: 'Solution aware',
        product_aware: 'Product aware'
      },
      sophisticationLevels: {
        low: 'Low',
        medium: 'Medium',
        high: 'High'
      },
      urgencyTypes: {
        immediate: 'Immediate',
        latent: 'Latent',
        low: 'Low'
      }
    }
  }

  const t = labels[language]

  useEffect(() => {
    async function loadICPs() {
      if (!user) return
      try {
        const data = await getICPs(user.id)
        setICPs(data)
      } catch (err) {
        console.error('Failed to load ICPs:', err)
        setError(language === 'es' ? 'Error al cargar los ICPs' : 'Failed to load ICPs')
      } finally {
        setLoading(false)
      }
    }
    loadICPs()
  }, [user, language])

  const handleDelete = async (icpId: string) => {
    if (!confirm(t.confirmDelete)) return
    
    setDeleting(icpId)
    try {
      await deleteICP(icpId)
      setICPs(icps.filter(icp => icp.id !== icpId))
    } catch (err) {
      console.error('Failed to delete ICP:', err)
    } finally {
      setDeleting(null)
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
      <div className="p-6 lg:p-8 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-dark-900 flex items-center gap-3">
              <Users className="w-7 h-7 text-primary-500" />
              {t.title}
            </h1>
            <p className="text-dark-500 mt-1">{t.subtitle}</p>
          </div>
          <Link
            to="/icps/new"
            className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            <Plus className="w-5 h-5" />
            {t.createNew}
          </Link>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {/* ICP List */}
        {icps.length === 0 ? (
          <div className="bg-white rounded-xl border border-dark-100 p-12 text-center">
            <Users className="w-16 h-16 text-dark-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-dark-900 mb-2">{t.noICPs}</h3>
            <p className="text-dark-500 mb-6">{t.noICPsDesc}</p>
            <Link
              to="/icps/new"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
            >
              <Plus className="w-5 h-5" />
              {t.createNew}
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {icps.map((icp) => (
              <div
                key={icp.id}
                className="bg-white rounded-xl border border-dark-100 p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-dark-900 mb-2">{icp.name}</h3>
                    <p className="text-dark-600 text-sm mb-4">{icp.description}</p>
                    
                    <div className="flex flex-wrap gap-3">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                        <Target className="w-3.5 h-3.5" />
                        {t.awareness}: {t.awarenessLevels[icp.awareness_level]}
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-xs font-medium">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {t.sophistication}: {t.sophisticationLevels[icp.sophistication_level]}
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-orange-50 text-orange-700 rounded-full text-xs font-medium">
                        <Clock className="w-3.5 h-3.5" />
                        {t.urgency}: {t.urgencyTypes[icp.urgency_type]}
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
                        <User className="w-3.5 h-3.5" />
                        {icp.gender === 'any' ? (language === 'es' ? 'Indistinto' : 'Any') : icp.gender === 'male' ? (language === 'es' ? 'Masculino' : 'Male') : (language === 'es' ? 'Femenino' : 'Female')} • {icp.age_range}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <Link
                      to={`/icps/${icp.id}/edit`}
                      className="p-2 text-dark-500 hover:text-primary-500 hover:bg-dark-50 rounded-lg transition-colors"
                    >
                      <Edit className="w-5 h-5" />
                    </Link>
                    <button
                      onClick={() => handleDelete(icp.id)}
                      disabled={deleting === icp.id}
                      className="p-2 text-dark-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {deleting === icp.id ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Trash2 className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
