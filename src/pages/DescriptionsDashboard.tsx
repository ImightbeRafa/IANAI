import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { 
  getProfile, 
  getProducts,
  getBusinesses,
  getBusinessProducts,
  getSharedProducts,
  acceptPendingInvites
} from '../services/database'
import type { Product, Business } from '../types'
import Layout from '../components/Layout'
import { 
  Package, 
  FileText, 
  Briefcase,
  ChevronRight,
  ArrowLeft,
  UtensilsCrossed,
  Home,
  Share2
} from 'lucide-react'

export default function DescriptionsDashboard() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null)
  const [businessProducts, setBusinessProducts] = useState<Product[]>([])
  const [sharedProducts, setSharedProducts] = useState<(Product & { shared_role: string; shared_by_email: string })[]>([])

  const labels = {
    es: {
      title: 'Descripciones de Video',
      subtitle: 'Genera descripciones para tus videos de redes sociales',
      noProducts: 'No hay productos aún',
      createFirst: 'Crea tu primer producto en el Dashboard para empezar a generar descripciones',
      yourBusinesses: 'Tus Negocios',
      noBusinesses: 'No hay negocios aún',
      createFirstBusiness: 'Crea tu primer negocio en el Dashboard para organizar tus productos',
      productsIn: 'Productos en',
      back: 'Volver',
      unassignedProducts: 'Productos sin asignar',
      generateDescriptions: 'Generar Descripciones',
      sharedWithMe: 'Compartidos Conmigo',
      sharedBy: 'por',
      roleViewer: 'Lector',
      roleEditor: 'Editor'
    },
    en: {
      title: 'Video Descriptions',
      subtitle: 'Generate descriptions for your social media videos',
      noProducts: 'No products yet',
      createFirst: 'Create your first product in the Dashboard to start generating descriptions',
      yourBusinesses: 'Your Businesses',
      noBusinesses: 'No businesses yet',
      createFirstBusiness: 'Create your first business in the Dashboard to organize your products',
      productsIn: 'Products in',
      back: 'Back',
      unassignedProducts: 'Unassigned products',
      generateDescriptions: 'Generate Descriptions',
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
        to={`/descriptions/product/${product.id}`}
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

  const displayProducts = selectedBusiness ? businessProducts : products

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            {selectedBusiness && (
              <button
                onClick={() => { setSelectedBusiness(null); setBusinessProducts([]) }}
                className="p-2 hover:bg-dark-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-dark-600" />
              </button>
            )}
            <div>
              <h1 className="text-2xl font-bold text-dark-900">{t.title}</h1>
              <p className="text-dark-500 mt-1">{t.subtitle}</p>
            </div>
          </div>
        </div>

        {/* Business list when no business selected */}
        {!selectedBusiness && businesses.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2 mb-4">
              <Briefcase className="w-5 h-5" />
              {t.yourBusinesses}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {businesses.map(business => (
                <button
                  key={business.id}
                  onClick={() => setSelectedBusiness(business)}
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
                    </div>
                    <ChevronRight className="w-5 h-5 text-dark-400 group-hover:text-primary-600 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Products */}
        {displayProducts.length > 0 || (selectedBusiness && businessProducts.length === 0) ? (
          <>
            {selectedBusiness && (
              <h2 className="text-lg font-semibold text-dark-900 mb-4">
                {t.productsIn} {selectedBusiness.name}
              </h2>
            )}

            {displayProducts.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {displayProducts.map(p => renderProductCard(p))}
              </div>
            ) : (
              <div className="card text-center py-12">
                <Package className="w-12 h-12 text-dark-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-dark-900 mb-2">{t.noProducts}</h3>
                <p className="text-dark-500">{t.createFirst}</p>
              </div>
            )}
          </>
        ) : !selectedBusiness && products.length === 0 && businesses.length === 0 && sharedProducts.length === 0 ? (
          <div className="card text-center py-16">
            <FileText className="w-16 h-16 text-dark-300 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-dark-900 mb-2">{t.noProducts}</h3>
            <p className="text-dark-500">{t.createFirst}</p>
          </div>
        ) : null}

        {/* Unassigned products when on the main view and there are also businesses */}
        {!selectedBusiness && products.length > 0 && businesses.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-dark-900 mb-4">{t.unassignedProducts}</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {products.map(p => renderProductCard(p))}
            </div>
          </div>
        )}

        {/* Only unassigned products, no businesses */}
        {!selectedBusiness && products.length > 0 && businesses.length === 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {products.map(p => renderProductCard(p))}
          </div>
        )}

        {/* Shared With Me section */}
        {sharedProducts.length > 0 && !selectedBusiness && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-dark-900 mb-4 flex items-center gap-2">
              <Share2 className="w-5 h-5 text-blue-500" />
              {t.sharedWithMe}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sharedProducts.map(p => renderProductCard(p, { role: p.shared_role, email: p.shared_by_email }))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
