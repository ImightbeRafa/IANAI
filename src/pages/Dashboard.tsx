import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { 
  getProfile, 
  getProducts,
  getTeam,
  getClients,
  getClientProducts,
  getDashboardStats,
  createProduct,
  createClient,
  assignProductToClient
} from '../services/database'
import type { Profile, Product, DashboardStats, ProductFormData, RestaurantFormData, Team, Client } from '../types'
import Layout from '../components/Layout'
import ProductForm from '../components/ProductForm'
import RestaurantForm from '../components/RestaurantForm'
import { 
  Package, 
  FileText, 
  MessageSquare, 
  Clock,
  Plus,
  Briefcase,
  Users,
  FolderOpen,
  Building2,
  ChevronRight,
  ArrowLeft,
  UtensilsCrossed
} from 'lucide-react'

export default function Dashboard() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [showProductForm, setShowProductForm] = useState(false)
  const [showRestaurantForm, setShowRestaurantForm] = useState(false)
  const [showTypeSelector, setShowTypeSelector] = useState(false)
  
  // Team-specific state
  const [team, setTeam] = useState<Team | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [clientProducts, setClientProducts] = useState<Product[]>([])
  const [showNewClientForm, setShowNewClientForm] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [creatingClient, setCreatingClient] = useState(false)
  const [assigningProduct, setAssigningProduct] = useState<Product | null>(null)

  const isTeamAccount = profile?.account_type === 'team'

  useEffect(() => {
    async function loadData() {
      if (!user) return
      try {
        const profileData = await getProfile(user.id)
        setProfile(profileData)

        if (profileData?.account_type === 'team') {
          // Load team data
          const teamData = await getTeam(user.id)
          setTeam(teamData)
          if (teamData) {
            const clientsData = await getClients(teamData.id)
            setClients(clientsData)
          }
          // Also load orphaned products (products without a client)
          const orphanedProducts = await getProducts(user.id)
          setProducts(orphanedProducts)
        } else {
          // Load individual user data
          const [productsData, statsData] = await Promise.all([
            getProducts(user.id),
            getDashboardStats(user.id)
          ])
          setProducts(productsData)
          setStats(statsData)
        }
      } catch (error) {
        console.error('Failed to load dashboard data:', error)
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

  const handleCreateProduct = async (data: ProductFormData) => {
    if (!user) return
    try {
      // For team accounts, create product under the selected client
      const clientId = isTeamAccount && selectedClient ? selectedClient.id : undefined
      const newProduct = await createProduct(data, user.id, clientId)
      
      if (isTeamAccount && selectedClient) {
        setClientProducts(prev => [newProduct, ...prev])
      } else {
        setProducts(prev => [newProduct, ...prev])
      }
      setShowProductForm(false)
      navigate(`/product/${newProduct.id}`)
    } catch (error) {
      console.error('Failed to create product:', error)
    }
  }

  const handleCreateRestaurant = async (data: RestaurantFormData) => {
    if (!user) return
    try {
      const clientId = isTeamAccount && selectedClient ? selectedClient.id : undefined
      // Restaurant uses different fields - pass directly to createProduct
      const restaurantData = {
        name: data.name,
        type: 'restaurant' as const,
        product_description: '',
        main_problem: '',
        best_customers: '',
        failed_attempts: '',
        attention_grabber: '',
        expected_result: '',
        differentiation: '',
        awareness_level: '',
        // Restaurant-specific fields
        menu_text: data.menu_text,
        menu_pdf_url: data.menu_pdf_url,
        location: data.location,
        schedule: data.schedule,
        is_new_restaurant: data.is_new_restaurant
      }
      const newProduct = await createProduct(restaurantData, user.id, clientId)
      
      if (isTeamAccount && selectedClient) {
        setClientProducts(prev => [newProduct, ...prev])
      } else {
        setProducts(prev => [newProduct, ...prev])
      }
      setShowRestaurantForm(false)
      navigate(`/product/${newProduct.id}`)
    } catch (error) {
      console.error('Failed to create restaurant:', error)
    }
  }

  const handleCreateClient = async () => {
    if (!user || !team || !newClientName.trim()) return
    setCreatingClient(true)
    try {
      const newClient = await createClient(team.id, user.id, newClientName.trim())
      setClients(prev => [...prev, newClient])
      setNewClientName('')
      setShowNewClientForm(false)
    } catch (error) {
      console.error('Failed to create client:', error)
    } finally {
      setCreatingClient(false)
    }
  }

  const handleAssignToClient = async (clientId: string) => {
    if (!assigningProduct) return
    try {
      await assignProductToClient(assigningProduct.id, clientId)
      // Remove from unassigned products
      setProducts(prev => prev.filter(p => p.id !== assigningProduct.id))
      setAssigningProduct(null)
    } catch (error) {
      console.error('Failed to assign product to client:', error)
    }
  }

  const labels = {
    es: {
      welcome: '¡Bienvenido de nuevo',
      overview: 'Resumen de tu actividad',
      newProduct: 'Nuevo',
      upgradeTeam: 'Actualizar a Equipo',
      products: 'Productos',
      scripts: 'Scripts',
      sessions: 'Sesiones',
      thisMonth: 'Este Mes',
      yourProducts: 'Tus Productos y Servicios',
      noProducts: 'No tienes productos aún',
      startFirst: 'Crea tu primer producto o servicio para empezar a generar scripts',
      product: 'Producto',
      service: 'Servicio',
      restaurant: 'Restaurante',
      // Type selector
      selectType: '¿Qué quieres crear?',
      productDesc: 'Producto físico o digital',
      serviceDesc: 'Servicio profesional',
      restaurantDesc: 'Restaurante con menú',
      // Team labels
      yourClients: 'Tus Clientes',
      newClient: 'Nuevo Cliente',
      noClients: 'No tienes clientes aún',
      createFirstClient: 'Crea tu primer cliente para organizar tus productos y servicios',
      unassignedProducts: 'Productos Sin Asignar',
      unassignedDesc: 'Estos productos no están asignados a ningún cliente',
      assignTo: 'Asignar a',
      selectClient: 'Selecciona un cliente para asignar este producto',
      clientName: 'Nombre del Cliente',
      create: 'Crear',
      cancel: 'Cancelar',
      back: 'Volver',
      productsIn: 'Productos en',
      noProductsInClient: 'No hay productos en este cliente',
      addProductToClient: 'Agrega un producto o servicio a este cliente'
    },
    en: {
      welcome: 'Welcome back',
      overview: 'Overview of your activity',
      newProduct: 'New',
      upgradeTeam: 'Upgrade to Team',
      products: 'Products',
      scripts: 'Scripts',
      sessions: 'Sessions',
      thisMonth: 'This Month',
      yourProducts: 'Your Products & Services',
      noProducts: 'No products yet',
      startFirst: 'Create your first product or service to start generating scripts',
      product: 'Product',
      service: 'Service',
      restaurant: 'Restaurant',
      // Type selector
      selectType: 'What do you want to create?',
      productDesc: 'Physical or digital product',
      serviceDesc: 'Professional service',
      restaurantDesc: 'Restaurant with menu',
      // Team labels
      yourClients: 'Your Clients',
      newClient: 'New Client',
      noClients: 'No clients yet',
      createFirstClient: 'Create your first client to organize your products and services',
      unassignedProducts: 'Unassigned Products',
      unassignedDesc: 'These products are not assigned to any client',
      assignTo: 'Assign to',
      selectClient: 'Select a client to assign this product to',
      clientName: 'Client Name',
      create: 'Create',
      cancel: 'Cancel',
      back: 'Back',
      productsIn: 'Products in',
      noProductsInClient: 'No products in this client',
      addProductToClient: 'Add a product or service to this client'
    }
  }

  const t = labels[language]

  const statCards = [
    { label: t.products, value: stats?.totalProducts || 0, icon: Package, color: 'bg-blue-500' },
    { label: t.scripts, value: stats?.totalScripts || 0, icon: FileText, color: 'bg-green-500' },
    { label: t.sessions, value: stats?.totalSessions || 0, icon: MessageSquare, color: 'bg-purple-500' },
    { label: t.thisMonth, value: stats?.scriptsThisMonth || 0, icon: Clock, color: 'bg-orange-500' },
  ]

  // Render product card component
  const renderProductCard = (product: Product, showAssignButton = false) => {
    const getTypeStyles = () => {
      switch (product.type) {
        case 'product': return { bg: 'bg-blue-100', icon: <Package className="w-5 h-5 text-blue-600" />, label: t.product }
        case 'service': return { bg: 'bg-purple-100', icon: <Briefcase className="w-5 h-5 text-purple-600" />, label: t.service }
        case 'restaurant': return { bg: 'bg-orange-100', icon: <UtensilsCrossed className="w-5 h-5 text-orange-600" />, label: t.restaurant }
        default: return { bg: 'bg-blue-100', icon: <Package className="w-5 h-5 text-blue-600" />, label: t.product }
      }
    }
    const typeStyles = getTypeStyles()
    
    return (
      <div
        key={product.id}
        className="block p-5 bg-dark-50 hover:bg-dark-100 rounded-xl transition-colors group"
      >
        <div className="flex items-start gap-4">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${typeStyles.bg}`}>
            {typeStyles.icon}
          </div>
          <div className="flex-1 min-w-0">
            <Link to={`/product/${product.id}`} className="block">
              <p className="font-medium text-dark-900 group-hover:text-primary-600 truncate">
                {product.name}
              </p>
              <p className="text-sm text-dark-400 capitalize">
                {typeStyles.label}
              </p>
              {product.description && (
                <p className="text-sm text-dark-500 mt-2 line-clamp-2">
                  {product.description}
                </p>
              )}
              {product.type === 'restaurant' && product.location && (
                <p className="text-sm text-dark-500 mt-2 line-clamp-1">
                  📍 {product.location}
                </p>
              )}
            </Link>
            {showAssignButton && clients.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setAssigningProduct(product)
                }}
                className="mt-3 text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
              >
                <FolderOpen className="w-3 h-3" />
                {t.assignTo}...
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Render client card component
  const renderClientCard = (client: Client) => (
    <button
      key={client.id}
      onClick={() => setSelectedClient(client)}
      className="block w-full p-5 bg-dark-50 hover:bg-dark-100 rounded-xl transition-colors group text-left"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center">
          <Building2 className="w-6 h-6 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-dark-900 group-hover:text-primary-600 truncate">
            {client.name}
          </p>
          <p className="text-sm text-dark-400">
            {new Date(client.created_at).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US')}
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-dark-400 group-hover:text-primary-600" />
      </div>
    </button>
  )

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-dark-900">
              {t.welcome}, {user?.user_metadata?.full_name || 'there'}!
            </h1>
            <p className="text-dark-500 mt-1">{t.overview}</p>
          </div>
          <div className="flex items-center gap-3">
            {!isTeamAccount && (
              <Link to="/settings" className="btn-secondary flex items-center gap-2">
                <Users className="w-5 h-5" />
                {t.upgradeTeam}
              </Link>
            )}
            {/* Show new client button for team accounts when not viewing a client */}
            {isTeamAccount && !selectedClient && (
              <button 
                onClick={() => setShowNewClientForm(true)}
                className="btn-secondary flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                {t.newClient}
              </button>
            )}
            {/* Show new product button for individual OR when viewing a client */}
            {(!isTeamAccount || selectedClient) && (
              <button 
                onClick={() => setShowTypeSelector(true)}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                {t.newProduct}
              </button>
            )}
          </div>
        </div>

        {/* Stats Grid - Only for individual accounts */}
        {!isTeamAccount && (
          loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="card animate-pulse">
                  <div className="h-16 bg-dark-100 rounded"></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {statCards.map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="card">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center`}>
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-dark-900">{value}</p>
                      <p className="text-sm text-dark-500">{label}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* TEAM ACCOUNT VIEW */}
        {isTeamAccount && (
          <>
          {/* Unassigned Products Section */}
          {products.length > 0 && !selectedClient && (
            <div className="card mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-dark-900">{t.unassignedProducts}</h2>
                  <p className="text-sm text-dark-500">{t.unassignedDesc}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {products.map(p => renderProductCard(p, true))}
              </div>
            </div>
          )}
          <div className="card">
            {/* Client View - Show products within selected client */}
            {selectedClient ? (
              <>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setSelectedClient(null)
                        setClientProducts([])
                      }}
                      className="p-2 hover:bg-dark-100 rounded-lg transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5 text-dark-500" />
                    </button>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-dark-900">
                          {t.productsIn} {selectedClient.name}
                        </h2>
                      </div>
                    </div>
                  </div>
                </div>

                {clientProducts.length === 0 ? (
                  <div className="text-center py-12">
                    <Package className="w-12 h-12 text-dark-300 mx-auto mb-4" />
                    <p className="text-dark-500 mb-2">{t.noProductsInClient}</p>
                    <p className="text-dark-400 text-sm mb-4">{t.addProductToClient}</p>
                    <button 
                      onClick={() => setShowProductForm(true)}
                      className="btn-primary inline-flex items-center gap-2"
                    >
                      <Plus className="w-5 h-5" />
                      {t.newProduct}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {clientProducts.map(p => renderProductCard(p, false))}
                  </div>
                )}
              </>
            ) : (
              /* Clients List View */
              <>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-dark-900">{t.yourClients}</h2>
                </div>

                {loading ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-24 bg-dark-50 rounded-lg animate-pulse"></div>
                    ))}
                  </div>
                ) : clients.length === 0 ? (
                  <div className="text-center py-12">
                    <FolderOpen className="w-12 h-12 text-dark-300 mx-auto mb-4" />
                    <p className="text-dark-500 mb-2">{t.noClients}</p>
                    <p className="text-dark-400 text-sm mb-4">{t.createFirstClient}</p>
                    <button 
                      onClick={() => setShowNewClientForm(true)}
                      className="btn-primary inline-flex items-center gap-2"
                    >
                      <Plus className="w-5 h-5" />
                      {t.newClient}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {clients.map(renderClientCard)}
                  </div>
                )}
              </>
            )}
          </div>
          </>
        )}

        {/* INDIVIDUAL ACCOUNT VIEW - Products Grid */}
        {!isTeamAccount && (
          <div className="card">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-dark-900">{t.yourProducts}</h2>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-32 bg-dark-50 rounded-lg animate-pulse"></div>
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-12">
                <Package className="w-12 h-12 text-dark-300 mx-auto mb-4" />
                <p className="text-dark-500 mb-2">{t.noProducts}</p>
                <p className="text-dark-400 text-sm mb-4">{t.startFirst}</p>
                <button 
                  onClick={() => setShowProductForm(true)}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  {t.newProduct}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {products.map(p => renderProductCard(p, false))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Type Selector Modal */}
      {showTypeSelector && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-dark-900 mb-2">{t.selectType}</h3>
            <div className="grid grid-cols-1 gap-3 mt-4">
              <button
                onClick={() => {
                  setShowTypeSelector(false)
                  setShowProductForm(true)
                }}
                className="p-4 border-2 border-dark-200 hover:border-blue-400 hover:bg-blue-50 rounded-xl transition-all flex items-center gap-4 text-left"
              >
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Package className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-dark-900">{t.product}</p>
                  <p className="text-sm text-dark-500">{t.productDesc}</p>
                </div>
              </button>
              <button
                onClick={() => {
                  setShowTypeSelector(false)
                  setShowProductForm(true)
                }}
                className="p-4 border-2 border-dark-200 hover:border-purple-400 hover:bg-purple-50 rounded-xl transition-all flex items-center gap-4 text-left"
              >
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                  <Briefcase className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <p className="font-semibold text-dark-900">{t.service}</p>
                  <p className="text-sm text-dark-500">{t.serviceDesc}</p>
                </div>
              </button>
              <button
                onClick={() => {
                  setShowTypeSelector(false)
                  setShowRestaurantForm(true)
                }}
                className="p-4 border-2 border-dark-200 hover:border-orange-400 hover:bg-orange-50 rounded-xl transition-all flex items-center gap-4 text-left"
              >
                <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
                  <UtensilsCrossed className="w-6 h-6 text-orange-600" />
                </div>
                <div>
                  <p className="font-semibold text-dark-900">{t.restaurant}</p>
                  <p className="text-sm text-dark-500">{t.restaurantDesc}</p>
                </div>
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowTypeSelector(false)}
                className="btn-secondary"
              >
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Form Modal */}
      {showProductForm && (
        <ProductForm
          onSubmit={handleCreateProduct}
          onCancel={() => setShowProductForm(false)}
        />
      )}

      {/* Restaurant Form Modal */}
      {showRestaurantForm && (
        <RestaurantForm
          onSubmit={handleCreateRestaurant}
          onCancel={() => setShowRestaurantForm(false)}
        />
      )}

      {/* Assign Product Modal */}
      {assigningProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-dark-900 mb-2">
              {t.assignTo} "{assigningProduct.name}"
            </h3>
            <p className="text-sm text-dark-500 mb-4">{t.selectClient}</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {clients.map(client => (
                <button
                  key={client.id}
                  onClick={() => handleAssignToClient(client.id)}
                  className="w-full p-3 text-left bg-dark-50 hover:bg-dark-100 rounded-lg transition-colors flex items-center gap-3"
                >
                  <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                    <Building2 className="w-4 h-4 text-amber-600" />
                  </div>
                  <span className="font-medium text-dark-900">{client.name}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setAssigningProduct(null)}
                className="btn-secondary"
              >
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Client Form Modal */}
      {showNewClientForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-dark-900 mb-4">{t.newClient}</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-dark-700 mb-1.5">
                {t.clientName}
              </label>
              <input
                type="text"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                className="input-field"
                placeholder={language === 'es' ? 'Ej: Empresa ABC' : 'E.g., Company ABC'}
                autoFocus
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowNewClientForm(false)
                  setNewClientName('')
                }}
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
        </div>
      )}
    </Layout>
  )
}
