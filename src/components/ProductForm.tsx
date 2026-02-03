import { useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import type { ProductFormData, ProductType } from '../types'
import { Package, Briefcase, Loader2, ClipboardPaste, Sparkles, X } from 'lucide-react'

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
  const [showPasteModal, setShowPasteModal] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [processingPaste, setProcessingPaste] = useState(false)
  const [formData, setFormData] = useState<ProductFormData>({
    name: initialData?.name || '',
    type: initialData?.type || 'product',
    product_description: initialData?.product_description || '',
    main_problem: initialData?.main_problem || '',
    best_customers: initialData?.best_customers || '',
    failed_attempts: initialData?.failed_attempts || '',
    attention_grabber: initialData?.attention_grabber || '',
    real_pain: initialData?.real_pain || '',
    pain_consequences: initialData?.pain_consequences || '',
    expected_result: initialData?.expected_result || '',
    differentiation: initialData?.differentiation || '',
    key_objection: initialData?.key_objection || '',
    shipping_info: initialData?.shipping_info || '',
    awareness_level: initialData?.awareness_level || ''
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
      product: 'Producto Físico',
      service: 'Servicio',
      quickPaste: 'Pegar Respuestas',
      quickPasteDesc: 'Pega todas las respuestas del cliente y la IA las organizará automáticamente',
      pasteHere: 'Pega aquí las respuestas del cliente...',
      processing: 'Procesando...',
      organize: 'Organizar con IA',
      // Product questions
      productQuestions: {
        name: '¿Cuál es el nombre de tu producto?',
        type: '¿Es un producto o un servicio?',
        product_description: '¿Qué producto estás vendiendo y para qué sirve?',
        main_problem: '¿Qué problema principal resuelve?',
        best_customers: 'Describe cómo son tus actuales mejores clientes que ya te compran',
        failed_attempts: '¿Qué han intentado antes que no les funcionó?',
        attention_grabber: '¿Qué es lo que más les llama la atención de tu producto?',
        expected_result: '¿Qué resultado espera lograr con tu producto?',
        differentiation: '¿Qué hace a este producto distinto o mejor que otros similares?',
        key_objection: '¿Qué es lo primero que la gente duda o pregunta antes de comprar?',
        shipping_info: '¿Cómo funciona el envío?',
        awareness_level: '¿Cómo llega la mayoría de tus compradores a este producto?'
      },
      // Service questions
      serviceQuestions: {
        name: '¿Cuál es el nombre de tu servicio?',
        type: '¿Es un producto o un servicio?',
        product_description: '¿Qué servicio ofrecés y qué hacés exactamente?',
        main_problem: '¿Qué problema principal resolvés con ese servicio?',
        best_customers: 'Describí cómo son tus mejores clientes actuales (los que sí pagan y se quedan)',
        failed_attempts: '¿Qué han intentado antes que no les funcionó?',
        attention_grabber: '¿Qué es lo que más les llama la atención de tu servicio?',
        real_pain: '¿Qué es lo que más les molesta a tus potenciales clientes hoy del problema que tienen?',
        pain_consequences: '¿Qué pasa si no lo resuelven? (tiempo, dinero, estrés, oportunidades perdidas)',
        expected_result: '¿Qué resultado concreto espera lograr tu cliente con el servicio?',
        differentiation: '¿Qué hacés distinto o mejor que otros que ofrecen lo mismo?',
        awareness_level: '¿Cómo llega la mayoría de tus clientes a este servicio?'
      },
      awarenessOptions: {
        active: 'Lo buscan activamente',
        passive: 'No lo buscan, pero lo necesitan',
        impulse: 'No lo necesitan, pero lo compran por impulso'
      },
      serviceAwarenessOptions: {
        active: 'Lo buscan activamente',
        passive: 'No lo buscan, pero saben que lo necesitan',
        impulse: 'No lo estaban buscando, pero el mensaje los activa'
      },
      placeholders: {
        name: 'Ej: Café de Especialidad Premium',
        product_description: 'Describe qué vendes y para qué sirve...',
        main_problem: 'Ej: Café de mala calidad que no satisface...',
        best_customers: 'Ej: Profesionales que aprecian el buen café...',
        failed_attempts: 'Ej: Han probado marcas comerciales sin éxito...',
        attention_grabber: 'Ej: La frescura y el origen del grano...',
        expected_result: 'Ej: Disfrutar de un café de calidad en casa...',
        differentiation: 'Ej: Tostado artesanal y granos de origen único...',
        key_objection: 'Ej: ¿Vale la pena pagar más por café?',
        shipping_info: 'Ej: Envío gratis en 24-48 horas...',
        real_pain: 'Ej: Les frustra no ver resultados...',
        pain_consequences: 'Ej: Pierden tiempo y dinero...'
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
      product: 'Physical Product',
      service: 'Service',
      quickPaste: 'Paste Answers',
      quickPasteDesc: 'Paste all client answers and AI will organize them automatically',
      pasteHere: 'Paste client answers here...',
      processing: 'Processing...',
      organize: 'Organize with AI',
      // Product questions
      productQuestions: {
        name: 'What is the name of your product?',
        type: 'Is it a product or a service?',
        product_description: 'What product are you selling and what is it for?',
        main_problem: 'What main problem does it solve?',
        best_customers: 'Describe your current best customers who already buy from you',
        failed_attempts: 'What have they tried before that didn\'t work?',
        attention_grabber: 'What catches their attention most about your product?',
        expected_result: 'What result do they expect to achieve with your product?',
        differentiation: 'What makes this product different or better than similar ones?',
        key_objection: 'What is the first thing people doubt or ask before buying?',
        shipping_info: 'How does shipping work?',
        awareness_level: 'How do most buyers find this product?'
      },
      // Service questions  
      serviceQuestions: {
        name: 'What is the name of your service?',
        type: 'Is it a product or a service?',
        product_description: 'What service do you offer and what exactly do you do?',
        main_problem: 'What main problem do you solve with this service?',
        best_customers: 'Describe your best current clients (the ones who pay and stay)',
        failed_attempts: 'What have they tried before that didn\'t work?',
        attention_grabber: 'What catches their attention most about your service?',
        real_pain: 'What bothers your potential clients most about the problem they have?',
        pain_consequences: 'What happens if they don\'t solve it? (time, money, stress, lost opportunities)',
        expected_result: 'What concrete result does your client expect from the service?',
        differentiation: 'What do you do differently or better than others who offer the same?',
        awareness_level: 'How do most clients find this service?'
      },
      awarenessOptions: {
        active: 'They actively search for it',
        passive: 'They don\'t search for it, but they need it',
        impulse: 'They don\'t need it, but buy on impulse'
      },
      serviceAwarenessOptions: {
        active: 'They actively search for it',
        passive: 'They don\'t search for it, but know they need it',
        impulse: 'They weren\'t looking, but the message activates them'
      },
      placeholders: {
        name: 'E.g.: Premium Specialty Coffee',
        product_description: 'Describe what you sell and what it\'s for...',
        main_problem: 'E.g.: Poor quality coffee that doesn\'t satisfy...',
        best_customers: 'E.g.: Professionals who appreciate good coffee...',
        failed_attempts: 'E.g.: They\'ve tried commercial brands without success...',
        attention_grabber: 'E.g.: The freshness and origin of the beans...',
        expected_result: 'E.g.: Enjoy quality coffee at home...',
        differentiation: 'E.g.: Artisanal roasting and single-origin beans...',
        key_objection: 'E.g.: Is it worth paying more for coffee?',
        shipping_info: 'E.g.: Free shipping in 24-48 hours...',
        real_pain: 'E.g.: They\'re frustrated not seeing results...',
        pain_consequences: 'E.g.: They lose time and money...'
      }
    }
  }

  const t = labels[language]
  const totalSteps = formData.type === 'service' ? 5 : 5
  const questions = formData.type === 'service' ? t.serviceQuestions : t.productQuestions
  const awarenessOpts = formData.type === 'service' ? t.serviceAwarenessOptions : t.awarenessOptions

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

  const handleProcessPaste = async () => {
    if (!pasteText.trim()) return
    setProcessingPaste(true)
    try {
      const isProduct = formData.type === 'product'
      const prompt = isProduct 
        ? `Eres un asistente experto en marketing. Organiza las siguientes respuestas de un formulario de producto físico. Las preguntas son:
1. ¿Qué producto estás vendiendo y para qué sirve?
2. ¿Qué problema principal resuelve?
3. Describe cómo son tus actuales mejores clientes
4. ¿Qué han intentado antes que no les funcionó?
5. ¿Qué es lo que más les llama la atención de tu producto?
6. ¿Qué resultado espera lograr con tu producto?
7. ¿Qué hace a este producto distinto o mejor que otros similares?
8. ¿Qué es lo primero que la gente duda o pregunta antes de comprar?
9. ¿Cómo funciona el envío?
10. ¿Cómo llega la mayoría de tus compradores? (activo/pasivo/impulso)

Responde en JSON con estos campos: product_description, main_problem, best_customers, failed_attempts, attention_grabber, expected_result, differentiation, key_objection, shipping_info, awareness_level`
        : `Eres un asistente experto en marketing. Organiza las siguientes respuestas de un formulario de servicio. Las preguntas son:
1. ¿Qué servicio ofrecés y qué hacés exactamente?
2. ¿Qué problema principal resolvés?
3. Describí cómo son tus mejores clientes actuales
4. ¿Qué han intentado antes que no les funcionó?
5. ¿Qué es lo que más les llama la atención de tu servicio?
6. ¿Qué es lo que más les molesta del problema que tienen?
7. ¿Qué pasa si no lo resuelven?
8. ¿Qué resultado concreto espera lograr tu cliente?
9. ¿Qué hacés distinto o mejor que otros?
10. ¿Cómo llega la mayoría de tus clientes? (activo/pasivo/impulso)

Responde en JSON con estos campos: product_description, main_problem, best_customers, failed_attempts, attention_grabber, real_pain, pain_consequences, expected_result, differentiation, awareness_level`

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `${prompt}\n\nRespuestas del cliente:\n${pasteText}` }],
          businessDetails: {},
          language
        })
      })
      
      const data = await response.json()
      if (data.content) {
        // Try to parse JSON from the response
        const jsonMatch = data.content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          setFormData(prev => ({ ...prev, ...parsed }))
          setShowPasteModal(false)
          setPasteText('')
          setStep(2) // Skip to step 2 since we have data
        }
      }
    } catch (error) {
      console.error('Failed to process paste:', error)
    } finally {
      setProcessingPaste(false)
    }
  }

  const canProceed = () => {
    switch (step) {
      case 1:
        return formData.name.trim() && formData.type
      case 2:
        return formData.product_description.trim() && formData.main_problem.trim()
      case 3:
        return formData.best_customers.trim() && formData.attention_grabber.trim()
      case 4:
        if (formData.type === 'service') {
          return formData.expected_result.trim() && formData.differentiation.trim()
        }
        return formData.expected_result.trim() && formData.differentiation.trim()
      case 5:
        return formData.awareness_level.trim()
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
          {/* Step 1: Name, Type & Quick Paste */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {questions.name}
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
                  {questions.type}
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

              {/* Quick Paste Button */}
              <button
                type="button"
                onClick={() => setShowPasteModal(true)}
                className="w-full p-4 border-2 border-dashed border-dark-200 hover:border-primary-400 hover:bg-primary-50 rounded-xl transition-all flex items-center justify-center gap-3 text-dark-500 hover:text-primary-600"
              >
                <ClipboardPaste className="w-5 h-5" />
                <span className="font-medium">{t.quickPaste}</span>
              </button>
            </div>
          )}

          {/* Step 2: Product/Service Description & Problem */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {questions.product_description}
                </label>
                <textarea
                  value={formData.product_description}
                  onChange={(e) => handleChange('product_description', e.target.value)}
                  placeholder={t.placeholders.product_description}
                  className="input-field min-h-[100px]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {questions.main_problem}
                </label>
                <textarea
                  value={formData.main_problem}
                  onChange={(e) => handleChange('main_problem', e.target.value)}
                  placeholder={t.placeholders.main_problem}
                  className="input-field min-h-[80px]"
                />
              </div>
            </div>
          )}

          {/* Step 3: Client & Context */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {questions.best_customers}
                </label>
                <textarea
                  value={formData.best_customers}
                  onChange={(e) => handleChange('best_customers', e.target.value)}
                  placeholder={t.placeholders.best_customers}
                  className="input-field min-h-[80px]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {questions.failed_attempts}
                </label>
                <textarea
                  value={formData.failed_attempts}
                  onChange={(e) => handleChange('failed_attempts', e.target.value)}
                  placeholder={t.placeholders.failed_attempts}
                  className="input-field min-h-[80px]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {questions.attention_grabber}
                </label>
                <textarea
                  value={formData.attention_grabber}
                  onChange={(e) => handleChange('attention_grabber', e.target.value)}
                  placeholder={t.placeholders.attention_grabber}
                  className="input-field min-h-[80px]"
                />
              </div>

              {/* Service-specific: Real Pain */}
              {formData.type === 'service' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-2">
                      {t.serviceQuestions.real_pain}
                    </label>
                    <textarea
                      value={formData.real_pain || ''}
                      onChange={(e) => handleChange('real_pain', e.target.value)}
                      placeholder={t.placeholders.real_pain}
                      className="input-field min-h-[80px]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-2">
                      {t.serviceQuestions.pain_consequences}
                    </label>
                    <textarea
                      value={formData.pain_consequences || ''}
                      onChange={(e) => handleChange('pain_consequences', e.target.value)}
                      placeholder={t.placeholders.pain_consequences}
                      className="input-field min-h-[80px]"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 4: Result & Differentiation */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {questions.expected_result}
                </label>
                <textarea
                  value={formData.expected_result}
                  onChange={(e) => handleChange('expected_result', e.target.value)}
                  placeholder={t.placeholders.expected_result}
                  className="input-field min-h-[80px]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {questions.differentiation}
                </label>
                <textarea
                  value={formData.differentiation}
                  onChange={(e) => handleChange('differentiation', e.target.value)}
                  placeholder={t.placeholders.differentiation}
                  className="input-field min-h-[80px]"
                />
              </div>

              {/* Product-specific: Objection & Shipping */}
              {formData.type === 'product' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-2">
                      {t.productQuestions.key_objection}
                    </label>
                    <textarea
                      value={formData.key_objection || ''}
                      onChange={(e) => handleChange('key_objection', e.target.value)}
                      placeholder={t.placeholders.key_objection}
                      className="input-field min-h-[80px]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-2">
                      {t.productQuestions.shipping_info}
                    </label>
                    <textarea
                      value={formData.shipping_info || ''}
                      onChange={(e) => handleChange('shipping_info', e.target.value)}
                      placeholder={t.placeholders.shipping_info}
                      className="input-field min-h-[80px]"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 5: Awareness Level */}
          {step === 5 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">
                  {questions.awareness_level}
                </label>
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => handleChange('awareness_level', 'active')}
                    className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                      formData.awareness_level === 'active'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <span className={`font-medium ${formData.awareness_level === 'active' ? 'text-primary-600' : 'text-dark-600'}`}>
                      {awarenessOpts.active}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChange('awareness_level', 'passive')}
                    className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                      formData.awareness_level === 'passive'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <span className={`font-medium ${formData.awareness_level === 'passive' ? 'text-primary-600' : 'text-dark-600'}`}>
                      {awarenessOpts.passive}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChange('awareness_level', 'impulse')}
                    className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                      formData.awareness_level === 'impulse'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <span className={`font-medium ${formData.awareness_level === 'impulse' ? 'text-primary-600' : 'text-dark-600'}`}>
                      {awarenessOpts.impulse}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quick Paste Modal */}
        {showPasteModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
              <div className="p-6 border-b border-dark-100 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-dark-900 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary-600" />
                    {t.quickPaste}
                  </h3>
                  <p className="text-sm text-dark-500 mt-1">{t.quickPasteDesc}</p>
                </div>
                <button
                  onClick={() => {
                    setShowPasteModal(false)
                    setPasteText('')
                  }}
                  className="p-2 hover:bg-dark-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-dark-500" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={t.pasteHere}
                  className="input-field min-h-[300px] w-full"
                  autoFocus
                />
              </div>
              <div className="p-6 border-t border-dark-100 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowPasteModal(false)
                    setPasteText('')
                  }}
                  className="btn-secondary"
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleProcessPaste}
                  disabled={!pasteText.trim() || processingPaste}
                  className="btn-primary flex items-center gap-2"
                >
                  {processingPaste ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t.processing}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      {t.organize}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

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
