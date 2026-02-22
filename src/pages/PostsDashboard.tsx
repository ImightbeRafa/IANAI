import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { 
  getProfile, 
  getProducts,
  createProduct,
  getSharedProducts,
  acceptPendingInvites,
  getBusinessProducts
} from '../services/database'
import type { Product, RestaurantFormData, Business, ProductType, NewProductFormData, NewServiceFormData, IndumentariaFormData, RealEstateFormData } from '../types'
import Layout from '../components/Layout'
import ProductForm from '../components/ProductForm'
import RestaurantForm from '../components/RestaurantForm'
import RealEstateForm from '../components/RealEstateForm'
import ServiceForm from '../components/ServiceForm'
import IndumentariaForm from '../components/IndumentariaForm'
import BusinessForm from '../components/BusinessForm'
import ProductTypeSelector from '../components/ProductTypeSelector'
import { getBusinesses, createBusiness } from '../services/database'
import { 
  Package, 
  ImageIcon, 
  Plus,
  Briefcase,
  FolderOpen,
  ChevronRight,
  ArrowLeft,
  UtensilsCrossed,
  Home,
  Share2
} from 'lucide-react'

export default function PostsDashboard() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showProductForm, setShowProductForm] = useState(false)
  const [showRestaurantForm, setShowRestaurantForm] = useState(false)
  const [showTypeSelector, setShowTypeSelector] = useState(false)
  const [showBusinessForm, setShowBusinessForm] = useState(false)
  const [showServiceForm, setShowServiceForm] = useState(false)
  const [showIndumentariaForm, setShowIndumentariaForm] = useState(false)
  const [showRealEstateForm, setShowRealEstateForm] = useState(false)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null)
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null)
  const [businessProducts, setBusinessProducts] = useState<Product[]>([])
  const [sharedProducts, setSharedProducts] = useState<(Product & { shared_role: string; shared_by_email: string })[]>([])

  const labels = {
    es: {
      title: 'Posts de Instagram',
      subtitle: 'Genera imágenes para tus publicaciones',
      newProduct: '+ Nuevo Producto',
      noProducts: 'No hay productos aún',
      createFirst: 'Crea tu primer producto para empezar a generar posts',
      yourBusinesses: 'Tus Negocios',
      newBusiness: '+ Nuevo Negocio',
      noBusinesses: 'No hay negocios aún',
      createFirstBusiness: 'Crea tu primer negocio para organizar tus productos',
      productsIn: 'Productos en',
      noProductsInBusiness: 'No hay productos en este negocio',
      addProductToBusiness: 'Agrega un producto o servicio a este negocio',
      unassignedProducts: 'Productos sin asignar',
      cancel: 'Cancelar',
      create: 'Crear',
      back: 'Volver',
      generatePosts: 'Generar Posts',
      sharedWithMe: 'Compartidos Conmigo',
      sharedBy: 'por',
      roleViewer: 'Lector',
      roleEditor: 'Editor'
    },
    en: {
      title: 'Instagram Posts',
      subtitle: 'Generate images for your posts',
      newProduct: '+ New Product',
      noProducts: 'No products yet',
      createFirst: 'Create your first product to start generating posts',
      yourBusinesses: 'Your Businesses',
      newBusiness: '+ New Business',
      noBusinesses: 'No businesses yet',
      createFirstBusiness: 'Create your first business to organize your products',
      productsIn: 'Products in',
      noProductsInBusiness: 'No products in this business',
      addProductToBusiness: 'Add a product or service to this business',
      unassignedProducts: 'Unassigned products',
      cancel: 'Cancel',
      create: 'Create',
      back: 'Back',
      generatePosts: 'Generate Posts',
      sharedWithMe: 'Shared With Me',
      sharedBy: 'by',
      roleViewer: 'Viewer',
      roleEditor: 'Editor'
    }
  }

  const t = labels[language]

  useEffect(() => {
    async function loadData() {
      if (!user) return
      try {
        const profileData = await getProfile(user.id)

        if (profileData?.email) {
          await acceptPendingInvites(user.id, profileData.email)
        }

        const shared = await getSharedProducts(user.id)
        setSharedProducts(shared)

        const [bizData, productsData] = await Promise.all([
          getBusinesses(user.id),
          getProducts(user.id)
        ])
        setBusinesses(bizData)
        setProducts(productsData)
      } catch (error) {
        console.error('Failed to load data:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [user])

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

  const handleCreateProduct = async (formData: NewProductFormData | NewServiceFormData | IndumentariaFormData | RealEstateFormData) => {
    if (!user) return
    try {
      const newProduct = await createProduct({ ...formData } as Record<string, unknown> & { name: string; type: string }, user.id)
      if (selectedBusiness) {
        setBusinessProducts(prev => [newProduct, ...prev])
      } else {
        setProducts(prev => [newProduct, ...prev])
      }
      setShowProductForm(false)
      setShowServiceForm(false)
      setShowIndumentariaForm(false)
      setShowRealEstateForm(false)
    } catch (error) {
      console.error('Failed to create product:', error)
    }
  }

  const handleCreateRestaurant = async (formData: RestaurantFormData) => {
    if (!user) return
    try {
      const restaurantData = {
        name: formData.name,
        type: 'restaurant' as const,
        business_id: formData.business_id,
        menu_text: formData.menu_text,
        menu_pdf_url: formData.menu_pdf_url,
        location: formData.location,
        schedule: formData.schedule,
        is_new_restaurant: formData.is_new_restaurant,
      }
      const newProduct = await createProduct(restaurantData, user.id)
      if (selectedBusiness) {
        setBusinessProducts(prev => [newProduct, ...prev])
      } else {
        setProducts(prev => [newProduct, ...prev])
      }
      setShowRestaurantForm(false)
    } catch (error) {
      console.error('Failed to create restaurant:', error)
    }
  }

  const handleCreateBusiness = async (data: import('../types').BusinessFormData) => {
    if (!user) return
    try {
      const newBiz = await createBusiness(user.id, data)
      setBusinesses(prev => [newBiz, ...prev])
      setSelectedBusinessId(newBiz.id)
      setShowBusinessForm(false)
    } catch (error) {
      console.error('Failed to create business:', error)
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

  const getProductIcon = (type: string) => {
    switch (type) {
      case 'service': return Briefcase
      case 'restaurant': return UtensilsCrossed
      case 'real_estate': return Home
      default: return Package
    }
  }

  const renderProductCard = (product: Product, sharedInfo?: { role: string; email: string }) => {
    const Icon = getProductIcon(product.type)
    return (
      <Link
        key={product.id}
        to={`/posts/product/${product.id}`}
        className="card hover:shadow-lg transition-all duration-200 group relative"
      >
        {sharedInfo && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              sharedInfo.role === 'editor'
                ? 'bg-primary-900/20 text-primary-600'
                : 'bg-dark-200 text-dark-500'
            }`}>
              {sharedInfo.role === 'editor' ? t.roleEditor : t.roleViewer}
            </span>
          </div>
        )}
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center group-hover:bg-primary-200 transition-colors ${
            sharedInfo ? 'bg-blue-500/10' : 'bg-primary-900/30'
          }`}>
            {sharedInfo ? <Share2 className="w-6 h-6 text-blue-500" /> : <Icon className="w-6 h-6 text-primary-600" />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-dark-900 group-hover:text-primary-600 transition-colors truncate">
              {product.name}
            </h3>
            {sharedInfo ? (
              <p className="text-xs text-dark-400">{t.sharedBy} {sharedInfo.email}</p>
            ) : (
              <p className="text-sm text-dark-500 capitalize">{product.type}</p>
            )}
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

  const renderBusinessCard = (business: Business) => (
    <button
      key={business.id}
      onClick={() => { setSelectedBusiness(business); setSelectedBusinessId(business.id) }}
      className="card hover:shadow-lg transition-all duration-200 text-left group"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-primary-900/30 rounded-xl flex items-center justify-center group-hover:bg-primary-200 transition-colors">
          <Briefcase className="w-6 h-6 text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-dark-900 group-hover:text-primary-600 transition-colors truncate">
            {business.name}
          </h3>
          <p className="text-sm text-dark-400">
            {new Date(business.created_at).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US')}
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-dark-400 group-hover:text-primary-600 transition-colors" />
      </div>
    </button>
  )

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-dark-900">{t.title}</h1>
            <p className="text-dark-500 mt-1">{t.subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            {!selectedBusiness && (
              <button
                onClick={() => setShowBusinessForm(true)}
                className="btn-secondary flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {t.newBusiness}
              </button>
            )}
            {selectedBusiness && (
              <button
                onClick={() => setShowTypeSelector(true)}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {t.newProduct}
              </button>
            )}
          </div>
        </div>

        {/* Unassigned products */}
        {products.length > 0 && !selectedBusiness && (
          <div className="card mb-6">
            <h2 className="text-lg font-semibold text-dark-900 mb-4">{t.unassignedProducts}</h2>
            <div className="grid gap-4">
              {products.map(p => renderProductCard(p))}
            </div>
          </div>
        )}

        {selectedBusiness ? (
          <div>
            <button
              onClick={() => { setSelectedBusiness(null); setSelectedBusinessId(null); setBusinessProducts([]) }}
              className="flex items-center gap-2 text-dark-600 hover:text-dark-900 mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              {t.back}
            </button>

            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-900/30 rounded-xl flex items-center justify-center">
                  <Briefcase className="w-5 h-5 text-primary-600" />
                </div>
                <h2 className="text-xl font-semibold text-dark-900">{t.productsIn} {selectedBusiness.name}</h2>
              </div>
            </div>

            {businessProducts.length > 0 ? (
              <div className="grid gap-4">
                {businessProducts.map(p => renderProductCard(p))}
              </div>
            ) : (
              <div className="card text-center py-12">
                <Package className="w-12 h-12 text-dark-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-dark-900 mb-2">{t.noProductsInBusiness}</h3>
                <p className="text-dark-500 mb-6">{t.addProductToBusiness}</p>
                <button
                  onClick={() => setShowTypeSelector(true)}
                  className="btn-primary"
                >
                  {t.newProduct}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
                <Briefcase className="w-5 h-5" />
                {t.yourBusinesses}
              </h2>
            </div>

            {businesses.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {businesses.map(renderBusinessCard)}
              </div>
            ) : (
              <div className="card text-center py-12">
                <FolderOpen className="w-12 h-12 text-dark-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-dark-900 mb-2">{t.noBusinesses}</h3>
                <p className="text-dark-500 mb-6">{t.createFirstBusiness}</p>
                <button
                  onClick={() => setShowBusinessForm(true)}
                  className="btn-primary"
                >
                  {t.newBusiness}
                </button>
              </div>
            )}

            {/* Shared With Me section */}
            {sharedProducts.length > 0 && (
              <div className="mt-8">
                <h2 className="text-lg font-semibold text-dark-900 mb-4 flex items-center gap-2">
                  <Share2 className="w-5 h-5 text-blue-500" />
                  {t.sharedWithMe}
                </h2>
                <div className="grid gap-4">
                  {sharedProducts.map(p => renderProductCard(p, { role: p.shared_role, email: p.shared_by_email }))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Modals */}
        {showTypeSelector && <ProductTypeSelector onSelect={handleTypeSelected} onCancel={() => setShowTypeSelector(false)} />}
        {showBusinessForm && <BusinessForm onSubmit={handleCreateBusiness} onCancel={() => { setShowBusinessForm(false); setShowTypeSelector(true) }} />}
        {showProductForm && selectedBusinessId && <ProductForm onSubmit={(data) => handleCreateProduct(data)} onCancel={() => setShowProductForm(false)} businessId={selectedBusinessId} />}
        {showServiceForm && selectedBusinessId && <ServiceForm onSubmit={(data) => handleCreateProduct(data)} onCancel={() => setShowServiceForm(false)} businessId={selectedBusinessId} />}
        {showIndumentariaForm && selectedBusinessId && <IndumentariaForm onSubmit={(data) => handleCreateProduct(data)} onCancel={() => setShowIndumentariaForm(false)} businessId={selectedBusinessId} />}
        {showRealEstateForm && selectedBusinessId && <RealEstateForm onSubmit={(data) => handleCreateProduct(data)} onCancel={() => setShowRealEstateForm(false)} businessId={selectedBusinessId} />}
        {showRestaurantForm && selectedBusinessId && <RestaurantForm onSubmit={handleCreateRestaurant} onCancel={() => setShowRestaurantForm(false)} businessId={selectedBusinessId} />}
      </div>
    </Layout>
  )
}
