import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { 
  getProfile, 
  getProducts,
  getTeam,
  getClients,
  getClientProducts,
  createProduct,
  createClient,
  assignProductToClient
} from '../services/database'
import type { Profile, Product, ProductFormData, RestaurantFormData, Team, Client } from '../types'
import Layout from '../components/Layout'
import ProductForm from '../components/ProductForm'
import RestaurantForm from '../components/RestaurantForm'
import { 
  Package, 
  ImageIcon, 
  Plus,
  Briefcase,
  Users,
  FolderOpen,
  Building2,
  ChevronRight,
  ArrowLeft,
  UtensilsCrossed,
  Home
} from 'lucide-react'

export default function PostsDashboard() {
  const { user } = useAuth()
  const { language } = useLanguage()
    const [profile, setProfile] = useState<Profile | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showProductForm, setShowProductForm] = useState(false)
  const [showRestaurantForm, setShowRestaurantForm] = useState(false)
  
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

  const labels = {
    es: {
      title: 'Posts de Instagram',
      subtitle: 'Genera imágenes para tus publicaciones',
      newProduct: '+ Nuevo Producto',
      products: 'Productos',
      services: 'Servicios',
      restaurants: 'Restaurantes',
      realEstate: 'Inmobiliarias',
      noProducts: 'No hay productos aún',
      createFirst: 'Crea tu primer producto para empezar a generar posts',
      clients: 'Clientes',
      newClient: '+ Nuevo Cliente',
      clientName: 'Nombre del cliente',
      cancel: 'Cancelar',
      create: 'Crear',
      back: 'Volver',
      selectClient: 'Selecciona un cliente para ver sus productos',
      noClients: 'No hay clientes aún',
      createFirstClient: 'Crea tu primer cliente para organizar tus productos',
      orphanedProducts: 'Productos sin asignar',
      assignTo: 'Asignar a cliente',
      generatePosts: 'Generar Posts'
    },
    en: {
      title: 'Instagram Posts',
      subtitle: 'Generate images for your posts',
      newProduct: '+ New Product',
      products: 'Products',
      services: 'Services',
      restaurants: 'Restaurants',
      realEstate: 'Real Estate',
      noProducts: 'No products yet',
      createFirst: 'Create your first product to start generating posts',
      clients: 'Clients',
      newClient: '+ New Client',
      clientName: 'Client name',
      cancel: 'Cancel',
      create: 'Create',
      back: 'Back',
      selectClient: 'Select a client to view their products',
      noClients: 'No clients yet',
      createFirstClient: 'Create your first client to organize your products',
      orphanedProducts: 'Unassigned products',
      assignTo: 'Assign to client',
      generatePosts: 'Generate Posts'
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

  const handleCreateProduct = async (formData: ProductFormData) => {
    if (!user) return
    try {
      const newProduct = await createProduct(formData, user.id, selectedClient?.id)
      if (selectedClient) {
        setClientProducts([...clientProducts, newProduct])
      } else {
        setProducts([...products, newProduct])
      }
      setShowProductForm(false)
    } catch (error) {
      console.error('Failed to create product:', error)
    }
  }

  const handleCreateRestaurant = async (formData: RestaurantFormData) => {
    if (!user) return
    try {
      const productFormData: ProductFormData = {
        name: formData.name,
        type: 'restaurant',
        description: formData.menu_text,
        offer: formData.location,
        awareness_level: formData.schedule,
        market_alternatives: formData.is_new_restaurant ? 'new' : 'established',
        customer_values: '',
        purchase_reason: ''
      }
      const newProduct = await createProduct(productFormData, user.id, selectedClient?.id)
      if (selectedClient) {
        setClientProducts([...clientProducts, newProduct])
      } else {
        setProducts([...products, newProduct])
      }
      setShowRestaurantForm(false)
    } catch (error) {
      console.error('Failed to create restaurant:', error)
    }
  }

  const handleCreateClient = async () => {
    if (!team || !newClientName.trim() || !user) return
    setCreatingClient(true)
    try {
      const newClient = await createClient(team.id, newClientName.trim(), user.id)
      setClients([...clients, newClient])
      setNewClientName('')
      setShowNewClientForm(false)
    } catch (error) {
      console.error('Failed to create client:', error)
    } finally {
      setCreatingClient(false)
    }
  }

  const handleAssignProduct = async (clientId: string) => {
    if (!assigningProduct) return
    try {
      await assignProductToClient(assigningProduct.id, clientId)
      setProducts(products.filter(p => p.id !== assigningProduct.id))
      if (selectedClient?.id === clientId) {
        setClientProducts([...clientProducts, assigningProduct])
      }
      setAssigningProduct(null)
    } catch (error) {
      console.error('Failed to assign product:', error)
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

  const renderProductCard = (product: Product) => {
    const Icon = getProductIcon(product.type)
    return (
      <Link
        key={product.id}
        to={`/posts/product/${product.id}`}
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
            <ImageIcon className="w-4 h-4 text-dark-400" />
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
            // Client products view
            <div>
              <button
                onClick={() => setSelectedClient(null)}
                className="flex items-center gap-2 text-dark-600 hover:text-dark-900 mb-6"
              >
                <ArrowLeft className="w-4 h-4" />
                {t.back}
              </button>

              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-primary-600" />
                  </div>
                  <h2 className="text-xl font-semibold text-dark-900">{selectedClient.name}</h2>
                </div>
                <button
                  onClick={() => setShowProductForm(true)}
                  className="btn-primary"
                >
                  {t.newProduct}
                </button>
              </div>

              {clientProducts.length > 0 ? (
                <div className="grid gap-4">
                  {clientProducts.map(renderProductCard)}
                </div>
              ) : (
                <div className="card text-center py-12">
                  <Package className="w-12 h-12 text-dark-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-dark-900 mb-2">{t.noProducts}</h3>
                  <p className="text-dark-500 mb-6">{t.createFirst}</p>
                  <button
                    onClick={() => setShowProductForm(true)}
                    className="btn-primary"
                  >
                    {t.newProduct}
                  </button>
                </div>
              )}
            </div>
          ) : (
            // Clients list view
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
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
                <div className="card mb-6">
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
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {clients.map(client => (
                    <button
                      key={client.id}
                      onClick={() => setSelectedClient(client)}
                      className="card hover:shadow-lg transition-all duration-200 text-left group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center group-hover:bg-primary-200 transition-colors">
                          <Building2 className="w-6 h-6 text-primary-600" />
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
                  <p className="text-dark-500 mb-6">{t.createFirstClient}</p>
                  <button
                    onClick={() => setShowNewClientForm(true)}
                    className="btn-primary"
                  >
                    {t.newClient}
                  </button>
                </div>
              )}

              {/* Orphaned products section */}
              {products.length > 0 && (
                <div className="mt-8">
                  <h2 className="text-lg font-semibold text-dark-900 mb-4">{t.orphanedProducts}</h2>
                  <div className="grid gap-4">
                    {products.map(product => (
                      <div key={product.id} className="card">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-dark-100 rounded-lg flex items-center justify-center">
                              <Package className="w-5 h-5 text-dark-500" />
                            </div>
                            <div>
                              <h3 className="font-medium text-dark-900">{product.name}</h3>
                              <p className="text-sm text-dark-500 capitalize">{product.type}</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <select
                              onChange={(e) => {
                                setAssigningProduct(product)
                                if (e.target.value) handleAssignProduct(e.target.value)
                              }}
                              className="input text-sm"
                              defaultValue=""
                            >
                              <option value="" disabled>{t.assignTo}</option>
                              {clients.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                            <Link
                              to={`/posts/product/${product.id}`}
                              className="btn-primary text-sm"
                            >
                              {t.generatePosts}
                            </Link>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Product Form Modal */}
          {showProductForm && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto">
                <ProductForm
                  onSubmit={handleCreateProduct}
                  onCancel={() => setShowProductForm(false)}
                />
              </div>
            </div>
          )}

          {/* Restaurant Form Modal */}
          {showRestaurantForm && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto">
                <RestaurantForm
                  onSubmit={handleCreateRestaurant}
                  onCancel={() => setShowRestaurantForm(false)}
                />
              </div>
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
          <button
            onClick={() => setShowProductForm(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t.newProduct}
          </button>
        </div>

        {products.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {products.map(renderProductCard)}
          </div>
        ) : (
          <div className="card text-center py-16">
            <ImageIcon className="w-16 h-16 text-dark-300 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-dark-900 mb-2">{t.noProducts}</h3>
            <p className="text-dark-500 mb-6">{t.createFirst}</p>
            <button
              onClick={() => setShowProductForm(true)}
              className="btn-primary"
            >
              {t.newProduct}
            </button>
          </div>
        )}

        {/* Product Form Modal */}
        {showProductForm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto">
              <ProductForm
                onSubmit={handleCreateProduct}
                onCancel={() => setShowProductForm(false)}
              />
            </div>
          </div>
        )}

        {/* Restaurant Form Modal */}
        {showRestaurantForm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto">
              <RestaurantForm
                onSubmit={handleCreateRestaurant}
                onCancel={() => setShowRestaurantForm(false)}
              />
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
