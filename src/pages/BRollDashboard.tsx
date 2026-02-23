import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getBusinessProducts } from '../services/database'
import { useDashboardData } from '../hooks/useDashboardData'
import type { Product, Business } from '../types'
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
  Share2
} from 'lucide-react'

export default function BRollDashboard() {
  const { } = useAuth()
  const { language } = useLanguage()
  const dashData = useDashboardData()
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null)
  const [businessProducts, setBusinessProducts] = useState<Product[]>([])

  const businesses = dashData.businesses
  const products = dashData.products
  const sharedProducts = dashData.sharedProducts
  const loading = dashData.loading

  const labels = {
    es: {
      title: 'Ad Videos',
      subtitle: 'Genera videos de anuncios a partir de guiones ganadores',
      selectProduct: 'Selecciona un producto para generar un Ad Video',
      noProducts: 'No tienes productos aún',
      createProduct: 'Crea tu primer producto para empezar a generar videos',
      goToDashboard: 'Ir a Dashboard',
      yourBusinesses: 'Tus Negocios',
      noBusinesses: 'No hay negocios aún',
      createFirstBusiness: 'Crea tu primer negocio en el Dashboard para organizar tus productos',
      productsIn: 'Productos en',
      back: 'Volver',
      unassignedProducts: 'Productos sin asignar',
      generateBRoll: 'Generar Ad Video',
      sharedWithMe: 'Compartidos Conmigo',
      sharedBy: 'por',
      roleViewer: 'Lector',
      roleEditor: 'Editor'
    },
    en: {
      title: 'Ad Videos',
      subtitle: 'Generate ad videos from winning scripts',
      selectProduct: 'Select a product to generate an Ad Video',
      noProducts: 'You have no products yet',
      createProduct: 'Create your first product to start generating videos',
      goToDashboard: 'Go to Dashboard',
      yourBusinesses: 'Your Businesses',
      noBusinesses: 'No businesses yet',
      createFirstBusiness: 'Create your first business in the Dashboard to organize your products',
      productsIn: 'Products in',
      back: 'Back',
      unassignedProducts: 'Unassigned products',
      generateBRoll: 'Generate Ad Video',
      sharedWithMe: 'Shared With Me',
      sharedBy: 'by',
      roleViewer: 'Viewer',
      roleEditor: 'Editor'
    }
  }

  const t = labels[language]

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

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </Layout>
    )
  }

  const displayProducts = selectedBusiness ? businessProducts : products
  const hasNoContent = businesses.length === 0 && products.length === 0 && sharedProducts.length === 0

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
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
              <h1 className="text-2xl font-bold text-dark-800 flex items-center gap-3">
                <Film className="w-7 h-7 text-primary-600" />
                {t.title}
                {selectedBusiness && (
                  <span className="text-lg font-normal text-dark-500">• {selectedBusiness.name}</span>
                )}
              </h1>
              <p className="text-dark-500 mt-1">{t.subtitle}</p>
            </div>
          </div>
        </div>

        {/* Business list when no business selected */}
        {!selectedBusiness && businesses.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-dark-700 flex items-center gap-2 mb-4">
              <Briefcase className="w-5 h-5" />
              {t.yourBusinesses}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {businesses.map((business) => (
                <button
                  key={business.id}
                  onClick={() => setSelectedBusiness(business)}
                  className="bg-dark-100 rounded-xl shadow-sm border border-dark-100 p-6 hover:shadow-md hover:border-primary-200 transition-all text-left group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary-900/30 rounded-xl flex items-center justify-center">
                        <Briefcase className="w-5 h-5 text-primary-600" />
                      </div>
                      <span className="font-semibold text-dark-800 group-hover:text-primary-600 transition-colors">
                        {business.name}
                      </span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-dark-400 group-hover:text-primary-600 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {hasNoContent && !selectedBusiness ? (
          <div className="bg-dark-100 rounded-xl shadow-sm border border-dark-100 p-12 text-center">
            <Video className="w-16 h-16 text-dark-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-dark-700 mb-2">{t.noProducts}</h2>
            <p className="text-dark-500 mb-6">{t.createProduct}</p>
            <Link
              to="/scripts"
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
                    className="bg-dark-100 rounded-xl shadow-sm border border-dark-100 p-6 hover:shadow-md hover:border-primary-200 transition-all group"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-primary-900/30 rounded-lg flex items-center justify-center group-hover:bg-primary-200 transition-colors">
                        <ProductIcon className="w-6 h-6 text-primary-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-dark-800 truncate group-hover:text-primary-600 transition-colors">
                          {product.name}
                        </h3>
                        <p className="text-sm text-dark-500 mt-1 line-clamp-2">
                          {product.description || product.product_description || (language === 'es' ? 'Sin descripción' : 'No description')}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-primary-600 text-sm font-medium">
                      <Video className="w-4 h-4" />
                      {t.generateBRoll}
                    </div>
                  </Link>
                )
              })}
            </div>

            {/* Shared products */}
            {sharedProducts.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-dark-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-blue-500" />
                  {t.sharedWithMe}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sharedProducts.map((product) => (
                    <Link
                      key={product.id}
                      to={`/broll/product/${product.id}`}
                      className="bg-dark-100 rounded-xl shadow-sm border border-blue-500/20 p-6 hover:shadow-md hover:border-blue-400 transition-all group relative"
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
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                          <Share2 className="w-6 h-6 text-blue-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-dark-800 truncate group-hover:text-blue-600 transition-colors">
                            {product.name}
                          </h3>
                          <p className="text-xs text-dark-400">{t.sharedBy} {product.shared_by_email}</p>
                        </div>
                      </div>
                      <div className="mt-4 flex items-center gap-2 text-blue-500 text-sm font-medium">
                        <Video className="w-4 h-4" />
                        {t.generateBRoll}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : selectedBusiness && (
          <div className="bg-dark-100 rounded-xl shadow-sm border border-dark-100 p-12 text-center">
            <Video className="w-16 h-16 text-dark-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-dark-700 mb-2">{t.noProducts}</h2>
            <p className="text-dark-500 mb-6">{t.createProduct}</p>
          </div>
        )}
      </div>
    </Layout>
  )
}
