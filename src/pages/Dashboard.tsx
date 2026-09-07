import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { 
  getDashboardStats,
  createProduct,
  deleteProduct,
  getSubscription,
  getBusinessProducts,
  deleteBusinessWithContents
} from '../services/database'
import type { Product, DashboardStats, RestaurantFormData, Business, ProductType, NewProductFormData, NewServiceFormData, IndumentariaFormData, RealEstateFormData } from '../types'
import Layout from '../components/Layout'
import ProductForm from '../components/ProductForm'
import RestaurantForm from '../components/RestaurantForm'
import RealEstateForm from '../components/RealEstateForm'
import ServiceForm from '../components/ServiceForm'
import IndumentariaForm from '../components/IndumentariaForm'
import BusinessForm from '../components/BusinessForm'
import ProductTypeSelector from '../components/ProductTypeSelector'
import ShareProductModal from '../components/ShareProductModal'
import FeedbackToast from '../components/FeedbackToast'
import CreditsChip from '../components/CreditsChip'
import { useUsageLimits } from '../hooks/useUsageLimits'
import { createBusiness } from '../services/database'
import { useDashboardData } from '../hooks/useDashboardData'
import { 
  Package, 
  FileText, 
  MessageSquare, 
  Clock,
  Plus,
  Briefcase,
  FolderOpen,
  ChevronRight,
  ArrowLeft,
  UtensilsCrossed,
  Home,
  Trash2,
  Search,
  Share2,
  Sparkles
} from 'lucide-react'

export default function Dashboard() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const navigate = useNavigate()
  const dashData = useDashboardData()
  const usageLimits = useUsageLimits()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [showProductForm, setShowProductForm] = useState(false)
  const [showRestaurantForm, setShowRestaurantForm] = useState(false)
  const [showTypeSelector, setShowTypeSelector] = useState(false)
  const [showBusinessForm, setShowBusinessForm] = useState(false)
  const [showServiceForm, setShowServiceForm] = useState(false)
  const [showIndumentariaForm, setShowIndumentariaForm] = useState(false)
  const [showRealEstateForm, setShowRealEstateForm] = useState(false)
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null)
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null)
  const [businessProducts, setBusinessProducts] = useState<Product[]>([])
  const [searchBusinesses, setSearchBusinesses] = useState('')
  const [searchProducts, setSearchProducts] = useState('')
  const [sharingProduct, setSharingProduct] = useState<Product | null>(null)
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null)
  const [trialPlan, setTrialPlan] = useState<string | null>(null)

  const businesses = dashData.businesses
  const products = dashData.products
  const sharedProducts = dashData.sharedProducts

  const filteredBusinesses = businesses.filter(b =>
    b.name.toLowerCase().includes(searchBusinesses.toLowerCase())
  )
  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(searchProducts.toLowerCase()) ||
    (p.description || '').toLowerCase().includes(searchProducts.toLowerCase())
  )
  const filteredBusinessProducts = businessProducts.filter(p =>
    p.name.toLowerCase().includes(searchProducts.toLowerCase()) ||
    (p.description || '').toLowerCase().includes(searchProducts.toLowerCase())
  )

  useEffect(() => {
    async function loadExtra() {
      if (!user) return
      try {
        const [sub, statsData] = await Promise.all([
          getSubscription(user.id),
          getDashboardStats(user.id)
        ])

        if (sub?.status === 'trialing' && sub.trial_ends_at) {
          const daysLeft = Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
          setTrialDaysLeft(daysLeft)
          setTrialPlan(sub.plan)
        }

        setStats(statsData)
      } catch (error) {
        console.error('Failed to load dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }
    loadExtra()
  }, [user?.id])

  useEffect(() => {
    async function loadBusinessProducts() {
      if (!selectedBusiness) return
      try {
        const prods = await getBusinessProducts(selectedBusiness.id)
        setBusinessProducts(prods)
      } catch (error) {
        console.error('Failed to load business products:', error)
      }
    }
    loadBusinessProducts()
  }, [selectedBusiness])

  const handleCreateProduct = async (data: NewProductFormData | NewServiceFormData | IndumentariaFormData | RealEstateFormData) => {
    if (!user) return
    try {
      const newProduct = await createProduct({ ...data } as Record<string, unknown> & { name: string; type: string }, user.id)
      
      if (selectedBusiness) {
        setBusinessProducts(prev => [newProduct, ...prev])
      }
      dashData.refresh()
      setShowProductForm(false)
      setShowServiceForm(false)
      setShowIndumentariaForm(false)
      setShowRealEstateForm(false)
      navigate(`/product/${newProduct.id}`)
    } catch (error) {
      console.error('Failed to create product:', error)
    }
  }

  const handleCreateRestaurant = async (data: RestaurantFormData) => {
    if (!user) return
    try {
      const restaurantData = {
        name: data.name,
        type: 'restaurant' as const,
        business_id: data.business_id,
        menu_text: data.menu_text,
        menu_pdf_url: data.menu_pdf_url,
        location: data.location,
        schedule: data.schedule,
        is_new_restaurant: data.is_new_restaurant
      }
      const newProduct = await createProduct(restaurantData, user.id)
      
      if (selectedBusiness) {
        setBusinessProducts(prev => [newProduct, ...prev])
      }
      dashData.refresh()
      setShowRestaurantForm(false)
      navigate(`/product/${newProduct.id}`)
    } catch (error) {
      console.error('Failed to create restaurant:', error)
    }
  }

  const handleCreateBusiness = async (data: import('../types').BusinessFormData) => {
    if (!user) return
    try {
      const newBiz = await createBusiness(user.id, data)
      dashData.refresh()
      setSelectedBusinessId(newBiz.id)
      setShowBusinessForm(false)
    } catch (error) {
      console.error('Failed to create business:', error)
    }
  }

  const handleDeleteBusiness = async (business: Business) => {
    const confirmMsg = language === 'es'
      ? `¿Eliminar "${business.name}" y todos sus productos, guiones y datos? Esta acción no se puede deshacer.`
      : `Delete "${business.name}" and all its products, scripts, and data? This cannot be undone.`
    if (!confirm(confirmMsg)) return
    try {
      await deleteBusinessWithContents(business.id)
      dashData.refresh()
      if (selectedBusiness?.id === business.id) {
        setSelectedBusiness(null)
        setBusinessProducts([])
      }
    } catch (error) {
      console.error('Failed to delete business:', error)
    }
  }

  const handleTypeSelected = (type: ProductType) => {
    setShowTypeSelector(false)
    if (type === 'product') setShowProductForm(true)
    else if (type === 'service') setShowServiceForm(true)
    else if (type === 'indumentaria') setShowIndumentariaForm(true)
    else if (type === 'restaurant') setShowRestaurantForm(true)
    else if (type === 'real_estate') setShowRealEstateForm(true)
  }

  const handleDeleteProduct = async (product: Product) => {
    const confirmMsg = language === 'es' 
      ? `¿Eliminar "${product.name}" y todos sus guiones y datos? Esta acción no se puede deshacer.`
      : `Delete "${product.name}" and all its scripts and data? This cannot be undone.`
    
    if (!confirm(confirmMsg)) return

    try {
      await deleteProduct(product.id)
      if (selectedBusiness) {
        setBusinessProducts(prev => prev.filter(p => p.id !== product.id))
      }
      dashData.refresh()
    } catch (error) {
      console.error('Failed to delete product:', error)
    }
  }

  const labels = {
    es: {
      welcome: '¡Bienvenido de nuevo',
      overview: 'Resumen de tu actividad',
      newProduct: 'Nuevo',
      products: 'Productos',
      scripts: 'Scripts',
      sessions: 'Sesiones',
      thisMonth: 'Este Mes',
      product: 'Producto',
      service: 'Servicio',
      restaurant: 'Restaurante',
      realEstate: 'Inmobiliaria',
      yourBusinesses: 'Tus Negocios',
      newBusiness: 'Nuevo Negocio',
      noBusinesses: 'No tienes negocios aún',
      createFirstBusiness: 'Crea tu primer negocio para organizar tus productos y servicios',
      unassignedProducts: 'Productos Sin Asignar',
      unassignedDesc: 'Estos productos no están asignados a ningún negocio',
      cancel: 'Cancelar',
      back: 'Volver',
      productsIn: 'Productos en',
      noProductsInBusiness: 'No hay productos en este negocio',
      addProductToBusiness: 'Agrega un producto o servicio a este negocio',
      searchBusinesses: 'Buscar negocios...',
      searchProducts: 'Buscar productos...',
      sharedWithMe: 'Compartidos Conmigo',
      sharedBy: 'Compartido por',
      share: 'Compartir',
      roleViewer: 'Lector',
      roleEditor: 'Editor'
    },
    en: {
      welcome: 'Welcome back',
      overview: 'Overview of your activity',
      newProduct: 'New',
      products: 'Products',
      scripts: 'Scripts',
      sessions: 'Sessions',
      thisMonth: 'This Month',
      product: 'Product',
      service: 'Service',
      restaurant: 'Restaurant',
      realEstate: 'Real Estate',
      yourBusinesses: 'Your Businesses',
      newBusiness: 'New Business',
      noBusinesses: 'No businesses yet',
      createFirstBusiness: 'Create your first business to organize your products and services',
      unassignedProducts: 'Unassigned Products',
      unassignedDesc: 'These products are not assigned to any business',
      cancel: 'Cancel',
      back: 'Back',
      productsIn: 'Products in',
      noProductsInBusiness: 'No products in this business',
      addProductToBusiness: 'Add a product or service to this business',
      searchBusinesses: 'Search businesses...',
      searchProducts: 'Search products...',
      sharedWithMe: 'Shared With Me',
      sharedBy: 'Shared by',
      share: 'Share',
      roleViewer: 'Viewer',
      roleEditor: 'Editor'
    }
  }

  const t = labels[language]

  const statCards = [
    { label: t.products, value: stats?.totalProducts || 0, icon: Package, color: 'bg-blue-500' },
    { label: t.scripts, value: stats?.totalScripts || 0, icon: FileText, color: 'bg-green-500' },
    { label: t.sessions, value: stats?.totalSessions || 0, icon: MessageSquare, color: 'bg-purple-500' },
    { label: t.thisMonth, value: stats?.scriptsThisMonth || 0, icon: Clock, color: 'bg-orange-500' },
  ]

  const renderProductCard = (product: Product) => {
    const getTypeStyles = () => {
      switch (product.type) {
        case 'product': return { bg: 'bg-blue-900/20', icon: <Package className="w-5 h-5 text-blue-600" />, label: t.product }
        case 'service': return { bg: 'bg-purple-900/20', icon: <Briefcase className="w-5 h-5 text-purple-600" />, label: t.service }
        case 'restaurant': return { bg: 'bg-orange-900/20', icon: <UtensilsCrossed className="w-5 h-5 text-orange-600" />, label: t.restaurant }
        case 'real_estate': return { bg: 'bg-teal-900/20', icon: <Home className="w-5 h-5 text-teal-600" />, label: t.realEstate }
        default: return { bg: 'bg-blue-900/20', icon: <Package className="w-5 h-5 text-blue-600" />, label: t.product }
      }
    }
    const typeStyles = getTypeStyles()
    
    return (
      <div
        key={product.id}
        className="block p-5 bg-dark-50 rounded-xl group relative card-hover"
      >
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setSharingProduct(product)
            }}
            className="p-1.5 text-dark-300 hover:text-primary-500 hover:bg-primary-900/20 rounded-lg transition-colors"
            title={t.share}
          >
            <Share2 className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleDeleteProduct(product)
            }}
            className="p-1.5 text-dark-300 hover:text-red-500 hover:bg-red-900/20 rounded-lg transition-colors"
            title={language === 'es' ? 'Eliminar' : 'Delete'}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
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
          </div>
        </div>
      </div>
    )
  }

  const renderBusinessCard = (business: Business) => (
    <div
      key={business.id}
      className="relative p-5 bg-dark-50 rounded-xl group card-hover"
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          handleDeleteBusiness(business)
        }}
        className="absolute top-3 right-3 p-1.5 text-dark-300 hover:text-red-500 hover:bg-red-900/20 rounded-lg transition-colors opacity-100 lg:opacity-0 lg:group-hover:opacity-100 z-10"
        title={language === 'es' ? 'Eliminar negocio' : 'Delete business'}
      >
        <Trash2 className="w-4 h-4" />
      </button>
      <button
        onClick={() => { setSelectedBusiness(business); setSelectedBusinessId(business.id) }}
        className="w-full text-left"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-primary-900/30 rounded-xl flex items-center justify-center">
            <Briefcase className="w-6 h-6 text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-dark-900 group-hover:text-primary-600 truncate">
              {business.name}
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-dark-400 group-hover:text-primary-600" />
        </div>
      </button>
    </div>
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
            <CreditsChip usage={usageLimits} />
            {!selectedBusiness && (
              <button 
                onClick={() => setShowBusinessForm(true)}
                className="btn-secondary flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                {t.newBusiness}
              </button>
            )}
            {selectedBusiness && (
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

        {/* Trial Banner */}
        {trialDaysLeft !== null && trialDaysLeft > 0 && (
          <div className="mb-6 p-4 bg-gradient-to-r from-purple-900/30 via-primary-900/20 to-purple-900/30 border border-purple-500/30 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-purple-300">
                    {language === 'es' ? 'Plan Premium Activo' : 'Premium Plan Active'}
                    {trialPlan === 'meta_advanze' && ' — Meta AdVance'}
                  </p>
                  <p className="text-xs text-purple-400/80">
                    {language === 'es'
                      ? `Te quedan ${trialDaysLeft} días de prueba gratuita`
                      : `${trialDaysLeft} days remaining in your free trial`}
                  </p>
                </div>
              </div>
              <div className="text-xs text-purple-400/60 hidden sm:block">
                {language === 'es' ? 'Scripts, descripciones e imágenes ilimitadas' : 'Unlimited scripts, descriptions & images'}
              </div>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="card">
                <div className="flex items-center gap-4">
                  <div className="skeleton w-12 h-12 rounded-xl" />
                  <div><div className="skeleton w-16 h-6 mb-1.5" /><div className="skeleton w-20 h-4" /></div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {statCards.map(({ label, value, icon: Icon, color }, statIdx) => (
              <div key={label} className={`card animate-entrance stagger-${statIdx + 1}`}>
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
        )}

        {/* Unassigned Products */}
        {products.length > 0 && !selectedBusiness && (
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-dark-900">{t.unassignedProducts}</h2>
                <p className="text-sm text-dark-500">{t.unassignedDesc}</p>
              </div>
            </div>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
              <input
                type="text"
                value={searchProducts}
                onChange={(e) => setSearchProducts(e.target.value)}
                placeholder={t.searchProducts}
                className="w-full pl-9 pr-3 py-2 bg-dark-100 border border-dark-300 rounded-lg text-sm text-dark-900 appearance-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProducts.map(p => renderProductCard(p))}
            </div>
          </div>
        )}

        {/* Main Content: Business List or Business Products */}
        <div className="card">
          {selectedBusiness ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setSelectedBusiness(null)
                      setSelectedBusinessId(null)
                      setBusinessProducts([])
                    }}
                    className="p-2 hover:bg-dark-100 rounded-lg transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5 text-dark-500" />
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary-900/30 rounded-xl flex items-center justify-center">
                      <Briefcase className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-dark-900">
                        {t.productsIn} {selectedBusiness.name}
                      </h2>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
                <input
                  type="text"
                  value={searchProducts}
                  onChange={(e) => setSearchProducts(e.target.value)}
                  placeholder={t.searchProducts}
                  className="w-full pl-9 pr-3 py-2 bg-dark-100 border border-dark-300 rounded-lg text-sm text-dark-900 appearance-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              {businessProducts.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="w-12 h-12 text-dark-300 mx-auto mb-4" />
                  <p className="text-dark-500 mb-2">{t.noProductsInBusiness}</p>
                  <p className="text-dark-400 text-sm mb-4">{t.addProductToBusiness}</p>
                  <button 
                    onClick={() => setShowTypeSelector(true)}
                    className="btn-primary inline-flex items-center gap-2"
                  >
                    <Plus className="w-5 h-5" />
                    {t.newProduct}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredBusinessProducts.map(p => renderProductCard(p))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-dark-900">{t.yourBusinesses}</h2>
              </div>

              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
                <input
                  type="text"
                  value={searchBusinesses}
                  onChange={(e) => setSearchBusinesses(e.target.value)}
                  placeholder={t.searchBusinesses}
                  className="w-full pl-9 pr-3 py-2 bg-dark-100 border border-dark-300 rounded-lg text-sm text-dark-900 appearance-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="skeleton h-24 rounded-lg" />
                  ))}
                </div>
              ) : businesses.length === 0 ? (
                <div className="text-center py-12">
                  <FolderOpen className="w-12 h-12 text-dark-300 mx-auto mb-4" />
                  <p className="text-dark-500 mb-2">{t.noBusinesses}</p>
                  <p className="text-dark-400 text-sm mb-4">{t.createFirstBusiness}</p>
                  <button 
                    onClick={() => setShowBusinessForm(true)}
                    className="btn-primary inline-flex items-center gap-2"
                  >
                    <Plus className="w-5 h-5" />
                    {t.newBusiness}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredBusinesses.map(renderBusinessCard)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Shared With Me Section */}
      {sharedProducts.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
          <h2 className="text-lg font-semibold text-dark-900 mb-4 flex items-center gap-2">
            <Share2 className="w-5 h-5 text-primary-500" />
            {t.sharedWithMe}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sharedProducts.map(product => (
              <div
                key={product.id}
                className="block p-5 bg-dark-50 rounded-xl group relative card-hover"
              >
                <div className="absolute top-3 right-3">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    product.shared_role === 'editor'
                      ? 'bg-primary-900/20 text-primary-600'
                      : 'bg-dark-200 text-dark-500'
                  }`}>
                    {product.shared_role === 'editor' ? t.roleEditor : t.roleViewer}
                  </span>
                </div>
                <Link to={`/product/${product.id}`} className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary-900/20">
                    <Share2 className="w-5 h-5 text-primary-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-dark-900 group-hover:text-primary-600 truncate">
                      {product.name}
                    </p>
                    <p className="text-xs text-dark-400 mt-0.5">
                      {t.sharedBy} {product.shared_by_email}
                    </p>
                    {product.description && (
                      <p className="text-sm text-dark-500 mt-2 line-clamp-2">
                        {product.description}
                      </p>
                    )}
                  </div>
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Share Product Modal */}
      {sharingProduct && user && (
        <ShareProductModal
          productId={sharingProduct.id}
          productName={sharingProduct.name}
          userId={user.id}
          language={language}
          onClose={() => setSharingProduct(null)}
        />
      )}

      {/* Type Selector */}
      {showTypeSelector && (
        <ProductTypeSelector
          onSelect={handleTypeSelected}
          onCancel={() => setShowTypeSelector(false)}
        />
      )}

      {/* Business Form */}
      {showBusinessForm && (
        <BusinessForm
          onSubmit={handleCreateBusiness}
          onCancel={() => { setShowBusinessForm(false); setShowTypeSelector(true) }}
        />
      )}

      {showProductForm && selectedBusinessId && (
        <ProductForm
          onSubmit={(data) => handleCreateProduct(data)}
          onCancel={() => setShowProductForm(false)}
          businessId={selectedBusinessId}
        />
      )}

      {showServiceForm && selectedBusinessId && (
        <ServiceForm
          onSubmit={(data) => handleCreateProduct(data)}
          onCancel={() => setShowServiceForm(false)}
          businessId={selectedBusinessId}
        />
      )}

      {showIndumentariaForm && selectedBusinessId && (
        <IndumentariaForm
          onSubmit={(data) => handleCreateProduct(data)}
          onCancel={() => setShowIndumentariaForm(false)}
          businessId={selectedBusinessId}
        />
      )}

      {showRealEstateForm && selectedBusinessId && (
        <RealEstateForm
          onSubmit={(data) => handleCreateProduct(data)}
          onCancel={() => setShowRealEstateForm(false)}
          businessId={selectedBusinessId}
        />
      )}

      {showRestaurantForm && selectedBusinessId && (
        <RestaurantForm
          onSubmit={handleCreateRestaurant}
          onCancel={() => setShowRestaurantForm(false)}
          businessId={selectedBusinessId}
        />
      )}

      {/* Periodic feedback toast */}
      <FeedbackToast />
    </Layout>
  )
}
