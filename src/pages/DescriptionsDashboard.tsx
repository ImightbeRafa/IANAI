import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { 
  getProfile, 
  getProducts,
  getTeam,
  getClients,
  getClientProducts
} from '../services/database'
import type { Profile, Product, Team, Client } from '../types'
import Layout from '../components/Layout'
import { 
  Package, 
  FileText, 
  Briefcase,
  Users,
  FolderOpen,
  ChevronRight,
  ArrowLeft,
  UtensilsCrossed,
  Home
} from 'lucide-react'

export default function DescriptionsDashboard() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  
  // Team-specific state
  const [, setTeam] = useState<Team | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [clientProducts, setClientProducts] = useState<Product[]>([])

  const isTeamAccount = profile?.account_type === 'team'

  const labels = {
    es: {
      title: 'Descripciones de Video',
      subtitle: 'Genera descripciones para tus videos de redes sociales',
      noProducts: 'No hay productos aún',
      createFirst: 'Crea tu primer producto en el Dashboard para empezar a generar descripciones',
      clients: 'Categorías',
      back: 'Volver',
      selectClient: 'Selecciona una categoría para ver sus productos',
      noClients: 'No hay categorías aún',
      createFirstClient: 'Crea tu primera categoría en el Dashboard para organizar tus productos',
      orphanedProducts: 'Productos sin asignar',
      generateDescriptions: 'Generar Descripciones'
    },
    en: {
      title: 'Video Descriptions',
      subtitle: 'Generate descriptions for your social media videos',
      noProducts: 'No products yet',
      createFirst: 'Create your first product in the Dashboard to start generating descriptions',
      clients: 'Categories',
      back: 'Back',
      selectClient: 'Select a category to view its products',
      noClients: 'No categories yet',
      createFirstClient: 'Create your first category in the Dashboard to organize your products',
      orphanedProducts: 'Unassigned products',
      generateDescriptions: 'Generate Descriptions'
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
          setTeam(teamData)
          if (teamData) {
            const clientsData = await getClients(teamData.id)
            setClients(clientsData)
          }
          const orphanedProducts = await getProducts(user.id)
          setProducts(orphanedProducts)
        } else {
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

  const getProductIcon = (type: string) => {
    switch (type) {
      case 'service': return Briefcase
      case 'restaurant': return UtensilsCrossed
      case 'real_estate': return Home
      default: return Package
    }
  }

  const renderProductCard = (product: Product) => {
    const Icon = getProductIcon(product.type)
    return (
      <Link
        key={product.id}
        to={`/descriptions/product/${product.id}`}
        className="card hover:shadow-lg transition-all duration-200 group"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center group-hover:bg-primary-200 transition-colors">
            <Icon className="w-6 h-6 text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-dark-900 group-hover:text-primary-600 transition-colors truncate">
              {product.name}
            </h3>
            <p className="text-sm text-dark-500 capitalize">{product.type}</p>
            {product.description && (
              <p className="text-sm text-dark-400 mt-1 line-clamp-2">{product.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-dark-400" />
            <ChevronRight className="w-5 h-5 text-dark-400 group-hover:text-primary-600 transition-colors" />
          </div>
        </div>
      </Link>
    )
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      </Layout>
    )
  }

  // Team account view with clients
  if (isTeamAccount) {
    return (
      <Layout>
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-dark-900">{t.title}</h1>
              <p className="text-dark-500 mt-1">{t.subtitle}</p>
            </div>
          </div>

          {selectedClient ? (
            <div>
              <button
                onClick={() => setSelectedClient(null)}
                className="flex items-center gap-2 text-dark-600 hover:text-dark-900 mb-6"
              >
                <ArrowLeft className="w-4 h-4" />
                {t.back}
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                  <Briefcase className="w-5 h-5 text-primary-600" />
                </div>
                <h2 className="text-xl font-semibold text-dark-900">{selectedClient.name}</h2>
              </div>

              {clientProducts.length > 0 ? (
                <div className="grid gap-4">
                  {clientProducts.map(renderProductCard)}
                </div>
              ) : (
                <div className="card text-center py-12">
                  <Package className="w-12 h-12 text-dark-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-dark-900 mb-2">{t.noProducts}</h3>
                  <p className="text-dark-500">{t.createFirst}</p>
                </div>
              )}
            </div>
          ) : (
            <div>
              <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2 mb-6">
                <Users className="w-5 h-5" />
                {t.clients}
              </h2>

              {clients.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {clients.map(client => (
                    <button
                      key={client.id}
                      onClick={() => setSelectedClient(client)}
                      className="card hover:shadow-lg transition-all duration-200 text-left group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center group-hover:bg-primary-200 transition-colors">
                          <Briefcase className="w-6 h-6 text-primary-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-dark-900 group-hover:text-primary-600 transition-colors truncate">
                            {client.name}
                          </h3>
                        </div>
                        <ChevronRight className="w-5 h-5 text-dark-400 group-hover:text-primary-600 transition-colors" />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="card text-center py-12">
                  <FolderOpen className="w-12 h-12 text-dark-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-dark-900 mb-2">{t.noClients}</h3>
                  <p className="text-dark-500">{t.createFirstClient}</p>
                </div>
              )}

              {products.length > 0 && (
                <div className="mt-8">
                  <h2 className="text-lg font-semibold text-dark-900 mb-4">{t.orphanedProducts}</h2>
                  <div className="grid gap-4">
                    {products.map(renderProductCard)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Layout>
    )
  }

  // Single user view
  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-dark-900">{t.title}</h1>
            <p className="text-dark-500 mt-1">{t.subtitle}</p>
          </div>
        </div>

        {products.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {products.map(renderProductCard)}
          </div>
        ) : (
          <div className="card text-center py-16">
            <FileText className="w-16 h-16 text-dark-300 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-dark-900 mb-2">{t.noProducts}</h3>
            <p className="text-dark-500">{t.createFirst}</p>
          </div>
        )}
      </div>
    </Layout>
  )
}
