import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getProfile, getProducts, getTeam, getClients, getClientProducts, createClient } from '../services/database'
import type { Product, Profile, Team, Client } from '../types'
import Layout from '../components/Layout'
import { 
  Video,
  Plus,
  Package,
  Briefcase,
  UtensilsCrossed,
  Home,
  Loader2,
  Film,
  ChevronRight,
  ArrowLeft,
  Users,
  FolderOpen
} from 'lucide-react'

export default function BRollDashboard() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  
  // Team-specific state
  const [team, setTeam] = useState<Team | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [clientProducts, setClientProducts] = useState<Product[]>([])
  const [showNewClientForm, setShowNewClientForm] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [creatingClient, setCreatingClient] = useState(false)
  
  const isTeamAccount = profile?.account_type === 'team'

  const labels = {
    es: {
      title: 'Ad Videos',
      subtitle: 'Genera videos de anuncios a partir de guiones ganadores',
      selectProduct: 'Selecciona un producto para generar un Ad Video',
      noProducts: 'No tienes productos aún',
      createProduct: 'Crea tu primer producto para empezar a generar videos',
      goToDashboard: 'Ir a Dashboard',
      clients: 'Clientes',
      newClient: '+ Nuevo Cliente',
      clientName: 'Nombre del cliente',
      cancel: 'Cancelar',
      create: 'Crear',
      back: 'Volver',
      noClients: 'No hay clientes aún',
      createFirstClient: 'Crea tu primer cliente para organizar tus productos',
      generateBRoll: 'Generar Ad Video'
    },
    en: {
      title: 'Ad Videos',
      subtitle: 'Generate ad videos from winning scripts',
      selectProduct: 'Select a product to generate an Ad Video',
      noProducts: 'You have no products yet',
      createProduct: 'Create your first product to start generating videos',
      goToDashboard: 'Go to Dashboard',
      clients: 'Clients',
      newClient: '+ New Client',
      clientName: 'Client name',
      cancel: 'Cancel',
      create: 'Create',
      back: 'Back',
      noClients: 'No clients yet',
      createFirstClient: 'Create your first client to organize your products',
      generateBRoll: 'Generate Ad Video'
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
          // Team account: load team, clients, and orphaned products
          const teamData = await getTeam(user.id)
          setTeam(teamData)
          if (teamData) {
            const clientsData = await getClients(teamData.id)
            setClients(clientsData)
          }
          // Load orphaned products (not assigned to any client)
          const orphanedProducts = await getProducts(user.id)
          setProducts(orphanedProducts)
        } else {
          // Single user account: load all products
          const productsData = await getProducts(user.id)
          setProducts(productsData)
        }
      } catch (error) {
        console.error('Failed to load data:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [user])

  // Load products when a client is selected
  useEffect(() => {
    async function loadClientProducts() {
      if (!selectedClient) return
      try {
        const products = await getClientProducts(selectedClient.id)
        setClientProducts(products)
      } catch (error) {
        console.error('Failed to load client products:', error)
      }
    }
    loadClientProducts()
  }, [selectedClient])

  const handleCreateClient = async () => {
    if (!team || !newClientName.trim() || !user) return
    setCreatingClient(true)
    try {
      const newClient = await createClient(team.id, user.id, newClientName.trim())
      setClients([...clients, newClient])
      setNewClientName('')
      setShowNewClientForm(false)
    } catch (error) {
      console.error('Failed to create client:', error)
    } finally {
      setCreatingClient(false)
    }
  }

  const getProductIcon = (type: string) => {
    switch (type) {
      case 'service': return Briefcase
      case 'restaurant': return UtensilsCrossed
      case 'real_estate': return Home
      default: return Package
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </Layout>
    )
  }

  // Get products to display based on context
  const displayProducts = selectedClient ? clientProducts : products
  const hasNoProducts = isTeamAccount 
    ? (clients.length === 0 && products.length === 0)
    : products.length === 0

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            {selectedClient && (
              <button
                onClick={() => setSelectedClient(null)}
                className="p-2 hover:bg-dark-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-dark-600" />
              </button>
            )}
            <div>
              <h1 className="text-2xl font-bold text-dark-800 flex items-center gap-3">
                <Film className="w-7 h-7 text-primary-600" />
                {t.title}
                {selectedClient && (
                  <span className="text-lg font-normal text-dark-500">• {selectedClient.name}</span>
                )}
              </h1>
              <p className="text-dark-500 mt-1">{t.subtitle}</p>
            </div>
          </div>
        </div>

        {/* Team account: Show clients section */}
        {isTeamAccount && !selectedClient && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-dark-700 flex items-center gap-2">
                <Users className="w-5 h-5" />
                {t.clients}
              </h2>
              <button
                onClick={() => setShowNewClientForm(true)}
                className="btn-primary"
              >
                {t.newClient}
              </button>
            </div>

            {showNewClientForm && (
              <div className="bg-white rounded-xl shadow-sm border border-dark-100 p-4 mb-4">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder={t.clientName}
                    className="input flex-1"
                    autoFocus
                  />
                  <button
                    onClick={() => setShowNewClientForm(false)}
                    className="btn-secondary"
                  >
                    {t.cancel}
                  </button>
                  <button
                    onClick={handleCreateClient}
                    disabled={!newClientName.trim() || creatingClient}
                    className="btn-primary"
                  >
                    {creatingClient ? '...' : t.create}
                  </button>
                </div>
              </div>
            )}

            {clients.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {clients.map((client) => (
                  <button
                    key={client.id}
                    onClick={() => setSelectedClient(client)}
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
            ) : !showNewClientForm && (
              <div className="bg-white rounded-xl shadow-sm border border-dark-100 p-12 text-center">
                <FolderOpen className="w-12 h-12 text-dark-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-dark-700 mb-2">{t.noClients}</h3>
                <p className="text-dark-500 mb-6">{t.createFirstClient}</p>
                <button
                  onClick={() => setShowNewClientForm(true)}
                  className="btn-primary"
                >
                  {t.newClient}
                </button>
              </div>
            )}
          </div>
        )}

        {hasNoProducts && !selectedClient ? (
          <div className="bg-white rounded-xl shadow-sm border border-dark-100 p-12 text-center">
            <Video className="w-16 h-16 text-dark-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-dark-700 mb-2">{t.noProducts}</h2>
            <p className="text-dark-500 mb-6">{t.createProduct}</p>
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              {t.goToDashboard}
            </Link>
          </div>
        ) : displayProducts.length > 0 ? (
          <>
            <p className="text-dark-600 mb-4">{t.selectProduct}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayProducts.map((product) => {
                const ProductIcon = getProductIcon(product.type)
                return (
                  <Link
                    key={product.id}
                    to={`/broll/product/${product.id}`}
                    className="bg-white rounded-xl shadow-sm border border-dark-100 p-6 hover:shadow-md hover:border-primary-200 transition-all group"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center group-hover:bg-primary-200 transition-colors">
                        <ProductIcon className="w-6 h-6 text-primary-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-dark-800 truncate group-hover:text-primary-600 transition-colors">
                          {product.name}
                        </h3>
                        <p className="text-sm text-dark-500 mt-1 line-clamp-2">
                          {product.description || product.product_description || 'Sin descripción'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-primary-600 text-sm font-medium">
                      <Video className="w-4 h-4" />
                      {language === 'es' ? 'Generar Ad Video' : 'Generate Ad Video'}
                    </div>
                  </Link>
                )
              })}
            </div>
          </>
        ) : selectedClient && (
          <div className="bg-white rounded-xl shadow-sm border border-dark-100 p-12 text-center">
            <Video className="w-16 h-16 text-dark-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-dark-700 mb-2">{t.noProducts}</h2>
            <p className="text-dark-500 mb-6">{t.createProduct}</p>
          </div>
        )}
      </div>
    </Layout>
  )
}
