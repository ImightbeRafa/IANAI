import { useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import type { RealEstateFormData } from '../types'
import { Loader2, X, Link2, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import AutoFillButtons from './AutoFillButtons'

interface RealEstateFormProps {
  onSubmit: (data: RealEstateFormData) => Promise<void>
  onCancel: () => void
  businessId: string
  initialData?: Partial<RealEstateFormData>
  isEditing?: boolean
}

export default function RealEstateForm({ onSubmit, onCancel, businessId, initialData, isEditing }: RealEstateFormProps) {
  const { language } = useLanguage()
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [linkInput, setLinkInput] = useState('')
  const [scrapingLinks, setScrapingLinks] = useState(false)
  const [linkErrors, setLinkErrors] = useState<string[]>([])

  const [formData, setFormData] = useState<RealEstateFormData>({
    name: initialData?.name || '',
    type: 'real_estate',
    business_id: businessId,
    re_business_type: initialData?.re_business_type || 'sale',
    re_price: initialData?.re_price || '',
    re_location: initialData?.re_location || '',
    re_construction_size: initialData?.re_construction_size || '',
    re_bedrooms: initialData?.re_bedrooms || '',
    re_capacity: initialData?.re_capacity || '',
    re_bathrooms: initialData?.re_bathrooms || '',
    re_parking: initialData?.re_parking || '',
    re_highlights: initialData?.re_highlights || '',
    re_location_reference: initialData?.re_location_reference || '',
    re_cta: initialData?.re_cta || '',
    context_links: initialData?.context_links || [],
    context_links_content: initialData?.context_links_content || '',
  })

  const labels = {
    es: {
      title: isEditing ? 'Editar Propiedad' : 'Nueva Propiedad',
      subtitle: 'Completa la información de la propiedad',
      step: 'Paso', of: 'de', next: 'Siguiente', back: 'Atrás',
      save: isEditing ? 'Guardar' : 'Crear', cancel: 'Cancelar',
      // S1
      nameLabel: '¿Cuál es el nombre o referencia de la propiedad?',
      namePh: 'Ej: Casa en La Guácima',
      businessTypeLabel: 'Tipo de negocio',
      businessTypes: { sale: 'Venta (Precio Total)', rent: 'Alquiler Largo Plazo (Mensual)', airbnb: 'Airbnb/Vacacional (Por Noche)' },
      priceLabel: 'Precio exacto', pricePh: 'Ej: $2.35 Millones / $1,200 mes',
      locationLabel: 'Ubicación (Barrio + Ciudad)', locationPh: 'Ej: La Guácima, Alajuela',
      // S2
      sizeLabel: 'Metros de construcción', sizePh: '1,300 m²',
      bedroomsLabel: 'Habitaciones', bedroomsPh: '4',
      capacityLabel: 'Para cuántas personas', capacityPh: '6',
      bathroomsLabel: 'Baños', bathroomsPh: '3',
      parkingLabel: 'Estacionamientos', parkingPh: '2',
      highlightsLabel: 'Puntos destacados (máximo 3, sé específico)',
      highlightsPh: 'Ej: Vista al valle, Seguridad 24/7, Piscina privada',
      locationRefLabel: 'Referencia de ubicación',
      locationRefPh: 'Ej: A 15 min del aeropuerto',
      ctaLabel: '¿Qué deben hacer los interesados?',
      ctaPh: 'Ej: Envíame un mensaje para agendar visita',
      // Links
      linksTitle: 'Enlaces de Referencia', linksOptional: 'Opcional',
      linksSubtitle: 'Agrega enlaces de la propiedad',
      linksPh: 'Pega enlaces (uno por línea)', linksAdd: 'Agregar',
    },
    en: {
      title: isEditing ? 'Edit Property' : 'New Property',
      subtitle: 'Complete the property information',
      step: 'Step', of: 'of', next: 'Next', back: 'Back',
      save: isEditing ? 'Save' : 'Create', cancel: 'Cancel',
      nameLabel: 'What is the name or reference of the property?',
      namePh: 'E.g.: House in La Guácima',
      businessTypeLabel: 'Business type',
      businessTypes: { sale: 'Sale (Total Price)', rent: 'Long-term Rent (Monthly)', airbnb: 'Airbnb/Vacation (Per Night)' },
      priceLabel: 'Exact price', pricePh: 'E.g.: $2.35M / $1,200/mo',
      locationLabel: 'Location (Neighborhood + City)', locationPh: 'E.g.: Downtown, Miami',
      sizeLabel: 'Construction size (m²)', sizePh: '1,300 m²',
      bedroomsLabel: 'Bedrooms', bedroomsPh: '4',
      capacityLabel: 'For how many people', capacityPh: '6',
      bathroomsLabel: 'Bathrooms', bathroomsPh: '3',
      parkingLabel: 'Parking spaces', parkingPh: '2',
      highlightsLabel: 'Key highlights (max 3, be specific)',
      highlightsPh: 'E.g.: Valley view, 24/7 Security, Private pool',
      locationRefLabel: 'Location reference',
      locationRefPh: 'E.g.: 15 min from airport',
      ctaLabel: 'What should interested people do?',
      ctaPh: 'E.g.: Send me a message to schedule a visit',
      linksTitle: 'Reference Links', linksOptional: 'Optional',
      linksSubtitle: 'Add property links',
      linksPh: 'Paste links (one per line)', linksAdd: 'Add',
    },
  }
  const t = labels[language]
  const totalSteps = 3

  const handleChange = (field: keyof RealEstateFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    setLoading(true)
    try { await onSubmit(formData) } finally { setLoading(false) }
  }

  const handleAutoFillResult = (data: Record<string, unknown>) => {
    const stringFields: (keyof RealEstateFormData)[] = [
      'name', 're_price', 're_location', 're_construction_size',
      're_bedrooms', 're_capacity', 're_bathrooms', 're_parking',
      're_highlights', 're_location_reference', 're_cta',
    ]
    const updates: Partial<RealEstateFormData> = {}
    for (const key of stringFields) {
      if (typeof data[key] === 'string' && (data[key] as string).trim()) {
        (updates as Record<string, unknown>)[key] = data[key]
      }
    }
    if (typeof data.re_business_type === 'string' && ['sale', 'rent', 'airbnb'].includes(data.re_business_type)) {
      updates.re_business_type = data.re_business_type as 'sale' | 'rent' | 'airbnb'
    }
    setFormData(prev => ({ ...prev, ...updates }))
    setStep(2)
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
          if (res.ok && data.content && !data.warning) scraped.push(`[${data.title || url}]\n${data.content}`); else failed.push(url)
        } catch { failed.push(url) }
      }
      const existingContent = formData.context_links_content || ''
      const newContent = scraped.length > 0 ? (existingContent ? existingContent + '\n\n---\n\n' : '') + scraped.join('\n\n---\n\n') : existingContent
      setFormData(prev => ({ ...prev, context_links: [...(prev.context_links || []), ...unique], context_links_content: newContent }))
      if (failed.length > 0) setLinkErrors(failed)
    } catch (err) { console.error('Failed:', err) }
    finally { setScrapingLinks(false); setLinkInput('') }
  }

  const handleRemoveLink = (url: string) => setFormData(prev => ({ ...prev, context_links: (prev.context_links || []).filter(l => l !== url) }))

  const canProceed = () => {
    switch (step) {
      case 1: return formData.name.trim() && formData.re_business_type && formData.re_price.trim() && formData.re_location.trim()
      case 2: return formData.re_highlights.trim() && formData.re_cta.trim()
      default: return true
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-100 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-dark-200">
          <div className="flex items-center justify-between">
            <div><h2 className="text-xl font-bold text-dark-900">{t.title}</h2><p className="text-dark-500 mt-1">{t.subtitle}</p></div>
            <button onClick={onCancel} className="p-2 hover:bg-dark-200 rounded-lg"><X className="w-5 h-5 text-dark-400" /></button>
          </div>
          <div className="flex items-center gap-1 mt-4">
            {[...Array(totalSteps)].map((_, i) => (<div key={i} className={`h-2 flex-1 rounded-full transition-colors ${i + 1 <= step ? 'bg-primary-600' : 'bg-dark-200'}`} />))}
          </div>
          <p className="text-sm text-dark-400 mt-2">{t.step} {step} {t.of} {totalSteps}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Type + Price + Location */}
          {step === 1 && (
            <div className="space-y-6">
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.nameLabel}</label><input type="text" value={formData.name} onChange={e => handleChange('name', e.target.value)} placeholder={t.namePh} className="input-field" autoFocus /></div>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.businessTypeLabel}</label>
                <div className="space-y-3">
                  {(['sale', 'rent', 'airbnb'] as const).map(bt => (
                    <button key={bt} type="button" onClick={() => handleChange('re_business_type', bt)}
                      className={`w-full p-4 rounded-xl border-2 transition-all text-left ${formData.re_business_type === bt ? 'border-primary-600 bg-primary-900/20' : 'border-dark-200 hover:border-dark-300'}`}>
                      <span className={`font-medium ${formData.re_business_type === bt ? 'text-primary-600' : 'text-dark-600'}`}>{(t.businessTypes as Record<string, string>)[bt]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.priceLabel}</label><input type="text" value={formData.re_price} onChange={e => handleChange('re_price', e.target.value)} placeholder={t.pricePh} className="input-field" /></div>
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.locationLabel}</label><input type="text" value={formData.re_location} onChange={e => handleChange('re_location', e.target.value)} placeholder={t.locationPh} className="input-field" /></div>
              <AutoFillButtons
                formType="real_estate"
                language={language}
                onResult={handleAutoFillResult}
              />
            </div>
          )}

          {/* Step 2: Details */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.sizeLabel}</label><input type="text" value={formData.re_construction_size} onChange={e => handleChange('re_construction_size', e.target.value)} placeholder={t.sizePh} className="input-field" autoFocus /></div>
                <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.bedroomsLabel}</label><input type="text" value={formData.re_bedrooms} onChange={e => handleChange('re_bedrooms', e.target.value)} placeholder={t.bedroomsPh} className="input-field" /></div>
                <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.capacityLabel}</label><input type="text" value={formData.re_capacity} onChange={e => handleChange('re_capacity', e.target.value)} placeholder={t.capacityPh} className="input-field" /></div>
                <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.bathroomsLabel}</label><input type="text" value={formData.re_bathrooms} onChange={e => handleChange('re_bathrooms', e.target.value)} placeholder={t.bathroomsPh} className="input-field" /></div>
                <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.parkingLabel}</label><input type="text" value={formData.re_parking} onChange={e => handleChange('re_parking', e.target.value)} placeholder={t.parkingPh} className="input-field" /></div>
              </div>
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.highlightsLabel}</label><textarea value={formData.re_highlights} onChange={e => handleChange('re_highlights', e.target.value)} placeholder={t.highlightsPh} className="input-field min-h-[80px]" /></div>
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.locationRefLabel}</label><input type="text" value={formData.re_location_reference} onChange={e => handleChange('re_location_reference', e.target.value)} placeholder={t.locationRefPh} className="input-field" /></div>
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.ctaLabel}</label><input type="text" value={formData.re_cta} onChange={e => handleChange('re_cta', e.target.value)} placeholder={t.ctaPh} className="input-field" /></div>
            </div>
          )}

          {/* Step 3: Links */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 mb-1"><Link2 className="w-4 h-4 text-blue-500" /><label className="text-sm font-medium text-dark-700">{t.linksTitle}</label><span className="text-xs text-dark-400 bg-dark-50 px-1.5 py-0.5 rounded">{t.linksOptional}</span></div>
              <p className="text-xs text-dark-400 mb-3">{t.linksSubtitle}</p>
              {(formData.context_links || []).length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {(formData.context_links || []).map((link, i) => (
                    <div key={i} className="flex items-center gap-2 bg-blue-900/20 rounded-lg px-3 py-1.5 group">
                      <Link2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" /><span className="text-xs text-dark-700 truncate flex-1">{link}</span>
                      <button type="button" onClick={() => handleRemoveLink(link)} className="p-1.5 text-dark-300 hover:text-red-500 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
              <textarea value={linkInput} onChange={e => setLinkInput(e.target.value)} placeholder={t.linksPh} className="w-full px-3 py-2 bg-dark-50 text-dark-900 border border-dark-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 resize-none h-16 placeholder:text-dark-400" disabled={scrapingLinks} />
              {linkInput.trim() && (
                <button type="button" onClick={handleAddLinks} disabled={scrapingLinks} className="mt-2 px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5">
                  {scrapingLinks ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}{scrapingLinks ? '...' : t.linksAdd}
                </button>
              )}
              {linkErrors.length > 0 && <p className="text-xs text-amber-600 mt-1">{linkErrors.join(', ')}</p>}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-dark-100 flex items-center justify-between">
          <button onClick={step === 1 ? onCancel : () => setStep(s => s - 1)} className="btn-secondary" disabled={loading}>{step === 1 ? t.cancel : t.back}</button>
          {step < totalSteps ? (
            <button onClick={() => setStep(s => s + 1)} disabled={!canProceed()} className="btn-primary">{t.next}</button>
          ) : (
            <button onClick={handleSubmit} disabled={!canProceed() || loading} className="btn-primary flex items-center gap-2">{loading && <Loader2 className="w-4 h-4 animate-spin" />}{t.save}</button>
          )}
        </div>
      </div>
    </div>
  )
}
