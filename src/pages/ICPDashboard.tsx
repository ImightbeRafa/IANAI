import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getICPs, getClientICPs, deleteICP, getProfile, getTeam, getClients } from '../services/database'
import type { ICP, Client, Profile } from '../types'
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
  Loader2,
  Briefcase,
  ChevronRight,
  ArrowLeft,
  FolderOpen
} from 'lucide-react'

export default function ICPDashboard() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const [icps, setICPs] = useState<ICP[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)

  const isTeamAccount = profile?.account_type === 'team'

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
      clients: 'Clientes',
      selectClient: 'Selecciona un cliente para gestionar sus perfiles ICP',
      noClients: 'No hay clientes aún',
      createFirstClient: 'Crea tu primer cliente desde el Dashboard para empezar',
      goToDashboard: 'Ir a Dashboard',
      back: 'Volver',
      noICPsClient: 'Este cliente no tiene perfiles ICP',
      noICPsClientDesc: 'Crea el primer perfil de cliente ideal para este cliente',
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
      clients: 'Clients',
      selectClient: 'Select a client to manage their ICP profiles',
      noClients: 'No clients yet',
      createFirstClient: 'Create your first client from the Dashboard to get started',
      goToDashboard: 'Go to Dashboard',
      back: 'Back',
      noICPsClient: 'This client has no ICP profiles',
      noICPsClientDesc: 'Create the first ideal client profile for this client',
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
    async function loadData() {
      if (!user) return
      try {
        const profileData = await getProfile(user.id)
        setProfile(profileData)

        if (profileData?.account_type === 'team') {
          const teamData = await getTeam(user.id)
          if (teamData) {
            const clientsData = await getClients(teamData.id)
            setClients(clientsData)
          }
        } else {
          // Single account: load user-scoped ICPs (no client_id)
          const data = await getICPs(user.id)
          setICPs(data)
        }
      } catch (err) {
        console.error('Failed to load data:', err)
        setError(language === 'es' ? 'Error al cargar los datos' : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [user, language])

  const handleSelectClient = async (client: Client) => {
    setSelectedClient(client)
    setLoading(true)
    try {
      const data = await getClientICPs(client.id)
      setICPs(data)
    } catch (err) {
      console.error('Failed to load client ICPs:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleBackToClients = () => {
    setSelectedClient(null)
    setICPs([])
  }

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

  const getCreateLink = () => {
    if (isTeamAccount && selectedClient) {
      return `/icps/client/${selectedClient.id}/new`
    }
    return '/icps/new'
  }

  const getEditLink = (icpId: string) => {
    if (isTeamAccount && selectedClient) {
      return `/icps/client/${selectedClient.id}/${icpId}/edit`
    }
    return `/icps/${icpId}/edit`
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

  // Render ICP list (shared between team client view and single account view)
  const renderICPList = () => (
    <>
      {icps.length === 0 ? (
        <div className="bg-white rounded-xl border border-dark-100 p-12 text-center">
          <Users className="w-16 h-16 text-dark-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark-900 mb-2">
            {isTeamAccount ? t.noICPsClient : t.noICPs}
          </h3>
          <p className="text-dark-500 mb-6">
            {isTeamAccount ? t.noICPsClientDesc : t.noICPsDesc}
          </p>
          <Link
            to={getCreateLink()}
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
                    to={getEditLink(icp.id)}
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
    </>
  )

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            {isTeamAccount && selectedClient && (
              <button
                onClick={handleBackToClients}
                className="p-2 text-dark-500 hover:text-dark-900 hover:bg-dark-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div>
              <h1 className="text-2xl font-bold text-dark-900 flex items-center gap-3">
                <Users className="w-7 h-7 text-primary-500" />
                {t.title}
                {isTeamAccount && selectedClient && (
                  <span className="text-primary-500">— {selectedClient.name}</span>
                )}
              </h1>
              <p className="text-dark-500 mt-1">
                {isTeamAccount && !selectedClient ? t.selectClient : t.subtitle}
              </p>
            </div>
          </div>
          {(!isTeamAccount || selectedClient) && (
            <Link
              to={getCreateLink()}
              className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
            >
              <Plus className="w-5 h-5" />
              {t.createNew}
            </Link>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {/* Team account: show clients first */}
        {isTeamAccount && !selectedClient ? (
          clients.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {clients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => handleSelectClient(client)}
                  className="bg-white rounded-xl shadow-sm border border-dark-100 p-6 hover:shadow-md hover:border-primary-200 transition-all text-left group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                        <Briefcase className="w-5 h-5 text-primary-600" />
                      </div>
                      <span className="font-semibold text-dark-800 group-hover:text-primary-600 transition-colors">
                        {client.name}
                      </span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-dark-400 group-hover:text-primary-600 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-dark-100 p-12 text-center">
              <FolderOpen className="w-12 h-12 text-dark-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-dark-700 mb-2">{t.noClients}</h3>
              <p className="text-dark-500 mb-6">{t.createFirstClient}</p>
              <Link to="/dashboard" className="btn-primary">
                {t.goToDashboard}
              </Link>
            </div>
          )
        ) : (
          renderICPList()
        )}
      </div>
    </Layout>
  )
}
