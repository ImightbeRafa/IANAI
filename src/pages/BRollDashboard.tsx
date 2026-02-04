import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getProducts } from '../services/database'
import type { Product } from '../types'
import Layout from '../components/Layout'
import { 
  Video,
  Plus,
  Package,
  Briefcase,
  UtensilsCrossed,
  Home,
  Loader2,
  Film
} from 'lucide-react'

export default function BRollDashboard() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  const labels = {
    es: {
      title: 'B-Roll Videos',
      subtitle: 'Genera videos cortos para tu contenido',
      selectProduct: 'Selecciona un producto para generar B-Roll',
      noProducts: 'No tienes productos aún',
      createProduct: 'Crea tu primer producto para empezar a generar videos',
      goToDashboard: 'Ir a Dashboard'
    },
    en: {
      title: 'B-Roll Videos',
      subtitle: 'Generate short videos for your content',
      selectProduct: 'Select a product to generate B-Roll',
      noProducts: 'You have no products yet',
      createProduct: 'Create your first product to start generating videos',
      goToDashboard: 'Go to Dashboard'
    }
  }

  const t = labels[language]

  useEffect(() => {
    async function loadProducts() {
      if (!user) return
      try {
        const userProducts = await getProducts(user.id)
        setProducts(userProducts)
      } catch (error) {
        console.error('Failed to load products:', error)
      } finally {
        setLoading(false)
      }
    }
    loadProducts()
  }, [user])

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

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-dark-800 flex items-center gap-3">
              <Film className="w-7 h-7 text-primary-600" />
              {t.title}
            </h1>
            <p className="text-dark-500 mt-1">{t.subtitle}</p>
          </div>
        </div>

        {products.length === 0 ? (
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
        ) : (
          <>
            <p className="text-dark-600 mb-4">{t.selectProduct}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {products.map((product) => {
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
                      Generar B-Roll
                    </div>
                  </Link>
                )
              })}
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
