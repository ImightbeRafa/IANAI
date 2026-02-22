import { useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import type { NewProductFormData } from '../types'
import { Loader2, X, Link2, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import AutoFillButtons from './AutoFillButtons'

interface ProductFormProps {
  onSubmit: (data: NewProductFormData) => Promise<void>
  onCancel: () => void
  businessId: string
  initialData?: Partial<NewProductFormData>
  isEditing?: boolean
}

const PRODUCT_CATEGORIES = [
  'tecnologia', 'hogar', 'salud', 'belleza', 'accesorio', 'otro'
] as const

const VARIATION_OPTIONS = [
  'colores', 'tamanos', 'modelos', 'versiones', 'personalizacion', 'otro'
] as const

export default function ProductForm({ onSubmit, onCancel, businessId, initialData, isEditing }: ProductFormProps) {
  const { language } = useLanguage()
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [linkInput, setLinkInput] = useState('')
  const [scrapingLinks, setScrapingLinks] = useState(false)
  const [linkErrors, setLinkErrors] = useState<string[]>([])

  const [formData, setFormData] = useState<NewProductFormData>({
    name: initialData?.name || '',
    type: 'product',
    business_id: businessId,
    product_category: initialData?.product_category || '',
    product_category_custom: initialData?.product_category_custom || '',
    product_description: initialData?.product_description || '',
    current_alternatives: initialData?.current_alternatives || '',
    alternatives_disadvantages: initialData?.alternatives_disadvantages || '',
    product_variations: initialData?.product_variations || [],
    technical_specs: initialData?.technical_specs || '',
    utility: initialData?.utility || '',
    result: initialData?.result || '',
    has_guarantee: initialData?.has_guarantee ?? undefined,
    guarantee_details: initialData?.guarantee_details || '',
    price_range: initialData?.price_range || '',
    stock_limited: initialData?.stock_limited ?? undefined,
    context_links: initialData?.context_links || [],
    context_links_content: initialData?.context_links_content || '',
  })

  const labels = {
    es: {
      title: isEditing ? 'Editar Producto' : 'Nuevo Producto',
      subtitle: 'Completa la información de tu producto para generar scripts de venta',
      step: 'Paso', of: 'de', next: 'Siguiente', back: 'Atrás',
      save: isEditing ? 'Guardar' : 'Crear Producto', cancel: 'Cancelar',
      // Section 1
      productName: 'Nombre del producto',
      productNamePlaceholder: 'Ej: Adaptador SmartDrive Pro',
      categoryLabel: 'Categoría del producto',
      categories: {
        tecnologia: 'Tecnología', hogar: 'Hogar', salud: 'Salud',
        belleza: 'Belleza', accesorio: 'Accesorio funcional', otro: 'Otro',
      },
      categoryCustomPlaceholder: 'Especifica la categoría...',
      // Section 2
      benefitsLabel: '¿Qué tiene de bueno este producto?',
      benefitsPlaceholder: 'Es resistente al agua, fácil de usar, portátil…',
      alternativesLabel: '¿Qué compra hoy la gente para solucionar el mismo problema?',
      alternativesPlaceholder: 'Adaptadores genéricos de Amazon, productos chinos baratos…',
      disadvantagesLabel: '¿Qué desventajas tiene la solución que la gente usa hoy?',
      disadvantagesPlaceholder: 'Se dañan rápido, son muy caros, no funcionan bien…',
      // Section 3
      variationsLabel: '¿Qué variaciones tiene?',
      variations: {
        colores: 'Colores', tamanos: 'Tamaños', modelos: 'Modelos',
        versiones: 'Versiones', personalizacion: 'Personalización', otro: 'Otro',
      },
      // Section 4
      specsLabel: 'Características técnicas del producto',
      specsPlaceholder: 'Material: acero inoxidable, batería 10h…',
      // Section 5
      utilityLabel: '¿Para qué sirve este producto realmente?',
      utilityPlaceholder: 'Permite ver Netflix en CarPlay…',
      // Section 6
      resultLabel: '¿Qué resultado consigue alguien al usarlo?',
      resultPlaceholder: 'Ahorra tiempo, mejora su productividad…',
      // Section 7
      guaranteeLabel: '¿Tiene garantía?',
      yes: 'Sí', no: 'No',
      guaranteeDetailsPlaceholder: '7 días, 30 días…',
      // Section 8
      priceLabel: '¿En qué rango de precio está?',
      priceOptions: { economico: 'Económico', medio: 'Medio', premium: 'Premium' },
      // Section 9
      stockLabel: '¿Es stock limitado?',
      // Context links
      contextLinksTitle: 'Enlaces de Referencia',
      contextLinksSubtitle: 'Agrega enlaces de tu producto, competencia o cualquier referencia',
      contextLinksPlaceholder: 'Pega uno o varios enlaces (uno por línea)',
      contextLinksAdd: 'Agregar', contextLinksOptional: 'Opcional',
    },
    en: {
      title: isEditing ? 'Edit Product' : 'New Product',
      subtitle: 'Complete your product info to generate sales scripts',
      step: 'Step', of: 'of', next: 'Next', back: 'Back',
      save: isEditing ? 'Save' : 'Create Product', cancel: 'Cancel',
      productName: 'Product name',
      productNamePlaceholder: 'E.g.: SmartDrive Pro Adapter',
      categoryLabel: 'Product category',
      categories: {
        tecnologia: 'Technology', hogar: 'Home', salud: 'Health',
        belleza: 'Beauty', accesorio: 'Functional accessory', otro: 'Other',
      },
      categoryCustomPlaceholder: 'Specify category...',
      benefitsLabel: 'What\'s good about this product?',
      benefitsPlaceholder: 'Waterproof, easy to use, portable…',
      alternativesLabel: 'What do people buy today to solve the same problem?',
      alternativesPlaceholder: 'Generic Amazon adapters, cheap Chinese products…',
      disadvantagesLabel: 'What disadvantages do current solutions have?',
      disadvantagesPlaceholder: 'Break easily, too expensive, don\'t work well…',
      variationsLabel: 'What variations does it have?',
      variations: {
        colores: 'Colors', tamanos: 'Sizes', modelos: 'Models',
        versiones: 'Versions', personalizacion: 'Customization', otro: 'Other',
      },
      specsLabel: 'Technical specifications',
      specsPlaceholder: 'Material: stainless steel, 10h battery…',
      utilityLabel: 'What does this product actually do?',
      utilityPlaceholder: 'Lets you watch Netflix on CarPlay…',
      resultLabel: 'What result does someone get from using it?',
      resultPlaceholder: 'Saves time, improves productivity…',
      guaranteeLabel: 'Does it have a guarantee?',
      yes: 'Yes', no: 'No',
      guaranteeDetailsPlaceholder: '7 days, 30 days…',
      priceLabel: 'What price range is it in?',
      priceOptions: { economico: 'Affordable', medio: 'Mid-range', premium: 'Premium' },
      stockLabel: 'Is stock limited?',
      contextLinksTitle: 'Reference Links',
      contextLinksSubtitle: 'Add links to your product, competitors or any useful reference',
      contextLinksPlaceholder: 'Paste one or more links (one per line)',
      contextLinksAdd: 'Add', contextLinksOptional: 'Optional',
    },
  }

  const t = labels[language]
  const totalSteps = 9

  const handleChange = (field: keyof NewProductFormData, value: unknown) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const toggleVariation = (v: string) => {
    setFormData(prev => ({
      ...prev,
      product_variations: (prev.product_variations || []).includes(v)
        ? (prev.product_variations || []).filter(x => x !== v)
        : [...(prev.product_variations || []), v],
    }))
  }

  const handleSubmit = async () => {
    setLoading(true)
    try { await onSubmit(formData) } finally { setLoading(false) }
  }

  const handleAddLinks = async () => {
    const newLinks = linkInput.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'))
    if (newLinks.length === 0) return
    const existing = formData.context_links || []
    const unique = newLinks.filter(l => !existing.includes(l))
    if (unique.length === 0) { setLinkInput(''); return }
    setScrapingLinks(true); setLinkErrors([])
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const fetchUrl = import.meta.env.PROD ? '/api/fetch-url' : 'http://localhost:3000/api/fetch-url'
      const scraped: string[] = []; const failed: string[] = []
      for (const url of unique) {
        try {
          const res = await fetch(fetchUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ url }) })
          const data = await res.json()
          if (res.ok && data.content && !data.warning) { scraped.push(`[${data.title || url}]\n${data.content}`) } else { failed.push(url) }
        } catch { failed.push(url) }
      }
      const existingContent = formData.context_links_content || ''
      const newContent = scraped.length > 0 ? (existingContent ? existingContent + '\n\n---\n\n' : '') + scraped.join('\n\n---\n\n') : existingContent
      setFormData(prev => ({ ...prev, context_links: [...(prev.context_links || []), ...unique], context_links_content: newContent }))
      if (failed.length > 0) setLinkErrors(failed)
    } catch (err) { console.error('Failed to scrape links:', err) }
    finally { setScrapingLinks(false); setLinkInput('') }
  }

  const handleRemoveLink = (url: string) => {
    setFormData(prev => ({ ...prev, context_links: (prev.context_links || []).filter(l => l !== url) }))
  }

  const handleAutoFillResult = (data: Record<string, unknown>) => {
    const stringFields: (keyof NewProductFormData)[] = [
      'name', 'product_category', 'product_description',
      'current_alternatives', 'alternatives_disadvantages',
      'technical_specs', 'utility', 'result',
      'guarantee_details', 'price_range',
    ]
    const updates: Partial<NewProductFormData> = {}
    for (const key of stringFields) {
      if (typeof data[key] === 'string' && (data[key] as string).trim()) {
        (updates as Record<string, unknown>)[key] = data[key]
      }
    }
    if (Array.isArray(data.product_variations)) {
      const validVariations = (data.product_variations as string[]).filter(v =>
        ['colores', 'tamanos', 'modelos', 'versiones', 'personalizacion', 'otro'].includes(v)
      )
      if (validVariations.length > 0) updates.product_variations = validVariations
    }
    if (typeof data.has_guarantee === 'boolean') {
      updates.has_guarantee = data.has_guarantee
    }
    if (typeof data.stock_limited === 'boolean') {
      updates.stock_limited = data.stock_limited
    }
    setFormData(prev => ({ ...prev, ...updates }))
    setStep(2)
  }

  const canProceed = () => {
    switch (step) {
      case 1: return formData.name.trim() && formData.product_category
      case 2: return (formData.product_description || '').trim()
      default: return true
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-100 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-dark-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-dark-900">{t.title}</h2>
              <p className="text-dark-500 mt-1">{t.subtitle}</p>
            </div>
            <button onClick={onCancel} className="p-2 hover:bg-dark-200 rounded-lg"><X className="w-5 h-5 text-dark-400" /></button>
          </div>
          <div className="flex items-center gap-1 mt-4">
            {[...Array(totalSteps)].map((_, i) => (
              <div key={i} className={`h-2 flex-1 rounded-full transition-colors ${i + 1 <= step ? 'bg-primary-600' : 'bg-dark-200'}`} />
            ))}
          </div>
          <p className="text-sm text-dark-400 mt-2">{t.step} {step} {t.of} {totalSteps}</p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Name + Category */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">{t.productName}</label>
                <input type="text" value={formData.name} onChange={e => handleChange('name', e.target.value)} placeholder={t.productNamePlaceholder} className="input-field" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.categoryLabel}</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {PRODUCT_CATEGORIES.map(cat => (
                    <button key={cat} type="button" onClick={() => handleChange('product_category', cat)}
                      className={`p-3 rounded-xl border-2 transition-all text-sm font-medium ${formData.product_category === cat ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'}`}>
                      {(t.categories as Record<string, string>)[cat]}
                    </button>
                  ))}
                </div>
                {formData.product_category === 'otro' && (
                  <input type="text" value={formData.product_category_custom || ''} onChange={e => handleChange('product_category_custom', e.target.value)} placeholder={t.categoryCustomPlaceholder} className="input-field mt-3" />
                )}
              </div>
              <AutoFillButtons
                formType="product"
                language={language}
                onResult={handleAutoFillResult}
              />
            </div>
          )}

          {/* Step 2: Value Proposition */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">{t.benefitsLabel}</label>
                <textarea value={formData.product_description || ''} onChange={e => handleChange('product_description', e.target.value)} placeholder={t.benefitsPlaceholder} className="input-field min-h-[100px]" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">{t.alternativesLabel}</label>
                <textarea value={formData.current_alternatives || ''} onChange={e => handleChange('current_alternatives', e.target.value)} placeholder={t.alternativesPlaceholder} className="input-field min-h-[80px]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">{t.disadvantagesLabel}</label>
                <textarea value={formData.alternatives_disadvantages || ''} onChange={e => handleChange('alternatives_disadvantages', e.target.value)} placeholder={t.disadvantagesPlaceholder} className="input-field min-h-[80px]" />
              </div>
            </div>
          )}

          {/* Step 3: Variations */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.variationsLabel}</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {VARIATION_OPTIONS.map(v => (
                    <button key={v} type="button" onClick={() => toggleVariation(v)}
                      className={`p-3 rounded-xl border-2 transition-all text-sm font-medium ${(formData.product_variations || []).includes(v) ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'}`}>
                      {(t.variations as Record<string, string>)[v]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Technical Specs */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">{t.specsLabel}</label>
                <textarea value={formData.technical_specs || ''} onChange={e => handleChange('technical_specs', e.target.value)} placeholder={t.specsPlaceholder} className="input-field min-h-[120px]" autoFocus />
              </div>
            </div>
          )}

          {/* Step 5: Utility */}
          {step === 5 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">{t.utilityLabel}</label>
                <textarea value={formData.utility || ''} onChange={e => handleChange('utility', e.target.value)} placeholder={t.utilityPlaceholder} className="input-field min-h-[100px]" autoFocus />
              </div>
            </div>
          )}

          {/* Step 6: Result */}
          {step === 6 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">{t.resultLabel}</label>
                <textarea value={formData.result || ''} onChange={e => handleChange('result', e.target.value)} placeholder={t.resultPlaceholder} className="input-field min-h-[100px]" autoFocus />
              </div>
            </div>
          )}

          {/* Step 7: Guarantee */}
          {step === 7 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.guaranteeLabel}</label>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => handleChange('has_guarantee', true)}
                    className={`p-4 rounded-xl border-2 transition-all font-medium ${formData.has_guarantee === true ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'}`}>{t.yes}</button>
                  <button type="button" onClick={() => handleChange('has_guarantee', false)}
                    className={`p-4 rounded-xl border-2 transition-all font-medium ${formData.has_guarantee === false ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'}`}>{t.no}</button>
                </div>
              </div>
              {formData.has_guarantee && (
                <div>
                  <input type="text" value={formData.guarantee_details || ''} onChange={e => handleChange('guarantee_details', e.target.value)} placeholder={t.guaranteeDetailsPlaceholder} className="input-field" />
                </div>
              )}
            </div>
          )}

          {/* Step 8: Price Range */}
          {step === 8 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.priceLabel}</label>
                <div className="space-y-3">
                  {(['economico', 'medio', 'premium'] as const).map(pr => (
                    <button key={pr} type="button" onClick={() => handleChange('price_range', pr)}
                      className={`w-full p-4 rounded-xl border-2 transition-all text-left font-medium ${formData.price_range === pr ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'}`}>
                      {(t.priceOptions as Record<string, string>)[pr]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 9: Availability + Context Links */}
          {step === 9 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.stockLabel}</label>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => handleChange('stock_limited', true)}
                    className={`p-4 rounded-xl border-2 transition-all font-medium ${formData.stock_limited === true ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'}`}>{t.yes}</button>
                  <button type="button" onClick={() => handleChange('stock_limited', false)}
                    className={`p-4 rounded-xl border-2 transition-all font-medium ${formData.stock_limited === false ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'}`}>{t.no}</button>
                </div>
              </div>

              {/* Context Links */}
              <div className="border-t border-dark-100 pt-6">
                <div className="flex items-center gap-2 mb-1">
                  <Link2 className="w-4 h-4 text-blue-500" />
                  <label className="text-sm font-medium text-dark-700">{t.contextLinksTitle}</label>
                  <span className="text-xs text-dark-400 bg-dark-50 px-1.5 py-0.5 rounded">{t.contextLinksOptional}</span>
                </div>
                <p className="text-xs text-dark-400 mb-3">{t.contextLinksSubtitle}</p>
                {(formData.context_links || []).length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {(formData.context_links || []).map((link, i) => (
                      <div key={i} className="flex items-center gap-2 bg-blue-900/20 rounded-lg px-3 py-1.5 group">
                        <Link2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                        <span className="text-xs text-dark-700 truncate flex-1">{link}</span>
                        <button type="button" onClick={() => handleRemoveLink(link)} className="p-0.5 text-dark-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea value={linkInput} onChange={e => setLinkInput(e.target.value)} placeholder={t.contextLinksPlaceholder} className="w-full px-3 py-2 bg-dark-50 text-dark-900 border border-dark-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 resize-none h-16 placeholder:text-dark-400" disabled={scrapingLinks} />
                {linkInput.trim() && (
                  <button type="button" onClick={handleAddLinks} disabled={scrapingLinks} className="mt-2 px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5">
                    {scrapingLinks ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {scrapingLinks ? (language === 'es' ? 'Extrayendo...' : 'Extracting...') : t.contextLinksAdd}
                  </button>
                )}
                {linkErrors.length > 0 && <p className="text-xs text-amber-600 mt-1">{language === 'es' ? `No se pudo extraer: ${linkErrors.join(', ')}` : `Failed: ${linkErrors.join(', ')}`}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-dark-100 flex items-center justify-between">
          <button onClick={step === 1 ? onCancel : () => setStep(s => s - 1)} className="btn-secondary" disabled={loading}>
            {step === 1 ? t.cancel : t.back}
          </button>
          {step < totalSteps ? (
            <button onClick={() => setStep(s => s + 1)} disabled={!canProceed()} className="btn-primary">{t.next}</button>
          ) : (
            <button onClick={handleSubmit} disabled={!canProceed() || loading} className="btn-primary flex items-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}{t.save}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
