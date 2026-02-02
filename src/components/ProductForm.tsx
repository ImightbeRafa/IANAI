import { useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import type { ProductFormData, ProductType } from '../types'
import { Package, Briefcase, Loader2 } from 'lucide-react'

interface ProductFormProps {
  onSubmit: (data: ProductFormData) => Promise<void>
  onCancel: () => void
  initialData?: Partial<ProductFormData>
  isEditing?: boolean
}

export default function ProductForm({ onSubmit, onCancel, initialData, isEditing }: ProductFormProps) {
  const { language } = useLanguage()
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState<ProductFormData>({
    name: initialData?.name || '',
    type: initialData?.type || 'product',
    description: initialData?.description || '',
    offer: initialData?.offer || '',
    awareness_level: initialData?.awareness_level || '',
    market_alternatives: initialData?.market_alternatives || '',
    customer_values: initialData?.customer_values || '',
    purchase_reason: initialData?.purchase_reason || '',
    target_audience: initialData?.target_audience || '',
    call_to_action: initialData?.call_to_action || ''
  })

  const labels = {
    es: {
      title: isEditing ? 'Editar Producto/Servicio' : 'Nuevo Producto/Servicio',
      subtitle: 'Responde estas preguntas para que la IA pueda generar scripts perfectos',
      step: 'Paso',
      of: 'de',
      next: 'Siguiente',
      back: 'Atrás',
      save: isEditing ? 'Guardar Cambios' : 'Crear',
      cancel: 'Cancelar',
      product: 'Producto',
      service: 'Servicio',
      questions: {
        name: '¿Cuál es el nombre de tu producto/servicio?',
        type: '¿Es un producto o un servicio?',
        description: '¿Qué es lo que vendes? Describe brevemente tu producto/servicio.',
        offer: '¿Cuál es tu oferta irresistible? (Precio, bonus, garantía, etc.)',
        awareness_level: '¿Cuál es el nivel de conciencia de tu cliente ideal? ¿Sabe que tiene el problema? ¿Conoce tu solución?',
        market_alternatives: '¿Qué otras opciones existen en el mercado y qué desventajas tienen comparadas contigo?',
        customer_values: '¿Qué es lo que MÁS valora tu cliente? (Precio, rapidez, calidad, estatus)',
        purchase_reason: '¿Por qué el cliente compra tu producto/servicio realmente? (La razón emocional o profunda)',
        target_audience: '¿A quién va dirigido? (Opcional)',
        call_to_action: '¿Cuál es el llamado a la acción? (Ej: "Envíanos un mensaje", "Compra ahora")'
      },
      placeholders: {
        name: 'Ej: Café de Especialidad Premium',
        description: 'Describe qué vendes y sus características principales...',
        offer: 'Ej: 3 bolsas por $50 con envío gratis + taza de regalo',
        awareness_level: 'Ej: Saben que les gusta el café pero no conocen café de especialidad...',
        market_alternatives: 'Ej: Starbucks cobra el doble y usa café comercial, supermercados...',
        customer_values: 'Ej: Calidad del producto y exclusividad',
        purchase_reason: 'Ej: Quieren sentirse especiales y conocedores',
        target_audience: 'Ej: Profesionales 25-45 años, amantes del café',
        call_to_action: 'Ej: Envíanos un mensaje para hacer tu pedido'
      }
    },
    en: {
      title: isEditing ? 'Edit Product/Service' : 'New Product/Service',
      subtitle: 'Answer these questions so AI can generate perfect scripts',
      step: 'Step',
      of: 'of',
      next: 'Next',
      back: 'Back',
      save: isEditing ? 'Save Changes' : 'Create',
      cancel: 'Cancel',
      product: 'Product',
      service: 'Service',
      questions: {
        name: 'What is the name of your product/service?',
        type: 'Is it a product or a service?',
        description: 'What do you sell? Briefly describe your product/service.',
        offer: 'What is your irresistible offer? (Price, bonus, guarantee, etc.)',
        awareness_level: 'What is the awareness level of your ideal customer? Do they know they have the problem? Do they know your solution?',
        market_alternatives: 'What other options exist in the market and what disadvantages do they have compared to you?',
        customer_values: 'What does your customer value MOST? (Price, speed, quality, status)',
        purchase_reason: 'Why does the customer really buy your product/service? (The emotional or deep reason)',
        target_audience: 'Who is it for? (Optional)',
        call_to_action: 'What is the call to action? (E.g.: "Send us a message", "Buy now")'
      },
      placeholders: {
        name: 'E.g.: Premium Specialty Coffee',
        description: 'Describe what you sell and its main features...',
        offer: 'E.g.: 3 bags for $50 with free shipping + free mug',
        awareness_level: 'E.g.: They know they like coffee but don\'t know specialty coffee...',
        market_alternatives: 'E.g.: Starbucks charges double and uses commercial coffee, supermarkets...',
        customer_values: 'E.g.: Product quality and exclusivity',
        purchase_reason: 'E.g.: They want to feel special and knowledgeable',
        target_audience: 'E.g.: Professionals 25-45 years, coffee lovers',
        call_to_action: 'E.g.: Send us a message to place your order'
      }
    }
  }

  const t = labels[language]
  const totalSteps = 4

  const handleChange = (field: keyof ProductFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleTypeSelect = (type: ProductType) => {
    setFormData(prev => ({ ...prev, type }))
  }

  const handleSubmit = async () => {
    setLoading(true)
    try {
      await onSubmit(formData)
    } finally {
      setLoading(false)
    }
  }

  const canProceed = () => {
    switch (step) {
      case 1:
        return formData.name.trim() && formData.type
      case 2:
        return formData.description.trim() && formData.offer.trim()
      case 3:
        return formData.awareness_level.trim() && formData.market_alternatives.trim()
      case 4:
        return formData.customer_values.trim() && formData.purchase_reason.trim()
      default:
        return true
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-dark-100">
          <h2 className="text-xl font-bold text-dark-900">{t.title}</h2>
          <p className="text-dark-500 mt-1">{t.subtitle}</p>
          <div className="flex items-center gap-2 mt-4">
            {[...Array(totalSteps)].map((_, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full transition-colors ${
                  i + 1 <= step ? 'bg-primary-600' : 'bg-dark-100'
                }`}
              />
            ))}
          </div>
          <p className="text-sm text-dark-400 mt-2">
            {t.step} {step} {t.of} {totalSteps}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.questions.name}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder={t.placeholders.name}
                  className="input-field"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">
                  {t.questions.type}
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => handleTypeSelect('product')}
                    className={`p-6 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${
                      formData.type === 'product'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <Package className={`w-8 h-8 ${formData.type === 'product' ? 'text-primary-600' : 'text-dark-400'}`} />
                    <span className={`font-medium ${formData.type === 'product' ? 'text-primary-600' : 'text-dark-600'}`}>
                      {t.product}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTypeSelect('service')}
                    className={`p-6 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${
                      formData.type === 'service'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <Briefcase className={`w-8 h-8 ${formData.type === 'service' ? 'text-primary-600' : 'text-dark-400'}`} />
                    <span className={`font-medium ${formData.type === 'service' ? 'text-primary-600' : 'text-dark-600'}`}>
                      {t.service}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.questions.description}
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder={t.placeholders.description}
                  className="input-field min-h-[100px]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.questions.offer}
                </label>
                <textarea
                  value={formData.offer}
                  onChange={(e) => handleChange('offer', e.target.value)}
                  placeholder={t.placeholders.offer}
                  className="input-field min-h-[80px]"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.questions.awareness_level}
                </label>
                <textarea
                  value={formData.awareness_level}
                  onChange={(e) => handleChange('awareness_level', e.target.value)}
                  placeholder={t.placeholders.awareness_level}
                  className="input-field min-h-[100px]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.questions.market_alternatives}
                </label>
                <textarea
                  value={formData.market_alternatives}
                  onChange={(e) => handleChange('market_alternatives', e.target.value)}
                  placeholder={t.placeholders.market_alternatives}
                  className="input-field min-h-[100px]"
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.questions.customer_values}
                </label>
                <textarea
                  value={formData.customer_values}
                  onChange={(e) => handleChange('customer_values', e.target.value)}
                  placeholder={t.placeholders.customer_values}
                  className="input-field min-h-[80px]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.questions.purchase_reason}
                </label>
                <textarea
                  value={formData.purchase_reason}
                  onChange={(e) => handleChange('purchase_reason', e.target.value)}
                  placeholder={t.placeholders.purchase_reason}
                  className="input-field min-h-[80px]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.questions.call_to_action}
                </label>
                <input
                  type="text"
                  value={formData.call_to_action}
                  onChange={(e) => handleChange('call_to_action', e.target.value)}
                  placeholder={t.placeholders.call_to_action}
                  className="input-field"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-dark-100 flex items-center justify-between">
          <button
            onClick={step === 1 ? onCancel : () => setStep(prev => prev - 1)}
            className="btn-secondary"
            disabled={loading}
          >
            {step === 1 ? t.cancel : t.back}
          </button>

          {step < totalSteps ? (
            <button
              onClick={() => setStep(prev => prev + 1)}
              disabled={!canProceed()}
              className="btn-primary"
            >
              {t.next}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canProceed() || loading}
              className="btn-primary flex items-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {t.save}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
