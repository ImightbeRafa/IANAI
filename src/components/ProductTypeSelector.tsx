import { useLanguage } from '../contexts/LanguageContext'
import type { ProductType } from '../types'
import { Package, Briefcase, UtensilsCrossed, Home, Shirt, X } from 'lucide-react'

interface ProductTypeSelectorProps {
  onSelect: (type: ProductType) => void
  onCancel: () => void
}

export default function ProductTypeSelector({
  onSelect, onCancel
}: ProductTypeSelectorProps) {
  const { language } = useLanguage()

  const labels = {
    es: {
      title: '¿Qué quieres crear?',
      subtitle: 'Selecciona el tipo de producto o servicio',
      cancel: 'Cancelar',
      types: {
        product: { name: 'Producto', desc: 'Producto físico o digital' },
        service: { name: 'Servicio', desc: 'Servicio profesional' },
        indumentaria: { name: 'Indumentaria', desc: 'Ropa, zapatos, joyería' },
        restaurant: { name: 'Restaurante', desc: 'Restaurante con menú' },
        real_estate: { name: 'Inmobiliaria', desc: 'Venta o alquiler de propiedades' },
      },
    },
    en: {
      title: 'What do you want to create?',
      subtitle: 'Select the product or service type',
      cancel: 'Cancel',
      types: {
        product: { name: 'Product', desc: 'Physical or digital product' },
        service: { name: 'Service', desc: 'Professional service' },
        indumentaria: { name: 'Fashion', desc: 'Clothing, shoes, jewelry' },
        restaurant: { name: 'Restaurant', desc: 'Restaurant with menu' },
        real_estate: { name: 'Real Estate', desc: 'Property sale or rental' },
      },
    },
  }
  const t = labels[language]

  const typeCards: { type: ProductType; icon: React.ReactNode }[] = [
    { type: 'product', icon: <Package className="w-7 h-7" /> },
    { type: 'service', icon: <Briefcase className="w-7 h-7" /> },
    { type: 'indumentaria', icon: <Shirt className="w-7 h-7" /> },
    { type: 'restaurant', icon: <UtensilsCrossed className="w-7 h-7" /> },
    { type: 'real_estate', icon: <Home className="w-7 h-7" /> },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-100 rounded-2xl w-full max-w-lg overflow-hidden">
        <div className="p-6 border-b border-dark-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-dark-900">{t.title}</h2>
            <p className="text-dark-500 mt-1">{t.subtitle}</p>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-dark-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-dark-400" />
          </button>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-2 gap-3">
            {typeCards.map(({ type, icon }) => {
              const info = (t.types as Record<string, { name: string; desc: string }>)[type]
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onSelect(type)}
                  className="p-4 rounded-xl border-2 border-dark-200 hover:border-primary-500 hover:bg-primary-900/10 transition-all text-left group"
                >
                  <div className="text-dark-400 group-hover:text-primary-600 transition-colors mb-2">{icon}</div>
                  <p className="font-semibold text-dark-900 group-hover:text-primary-600 transition-colors">{info.name}</p>
                  <p className="text-xs text-dark-400 mt-0.5">{info.desc}</p>
                </button>
              )
            })}
          </div>
        </div>

        <div className="p-6 border-t border-dark-100">
          <button onClick={onCancel} className="btn-secondary w-full">{t.cancel}</button>
        </div>
      </div>
    </div>
  )
}
