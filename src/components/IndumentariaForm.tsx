import { useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import type { IndumentariaFormData } from '../types'
import { Loader2, X, Link2, Plus, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import AutoFillButtons from './AutoFillButtons'

interface IndumentariaFormProps {
  onSubmit: (data: IndumentariaFormData) => Promise<void>
  onCancel: () => void
  businessId: string
  initialData?: Partial<IndumentariaFormData>
  isEditing?: boolean
}

const ARTICLE_TYPES = ['ropa', 'zapatos', 'joyeria', 'relojes', 'accesorios', 'otro'] as const

export default function IndumentariaForm({ onSubmit, onCancel, businessId, initialData, isEditing }: IndumentariaFormProps) {
  const { language } = useLanguage()
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [linkInput, setLinkInput] = useState('')
  const [scrapingLinks, setScrapingLinks] = useState(false)
  const [linkErrors, setLinkErrors] = useState<string[]>([])
  const [uploadingImages, setUploadingImages] = useState(false)

  const [formData, setFormData] = useState<IndumentariaFormData>({
    name: initialData?.name || '',
    type: 'indumentaria',
    business_id: businessId,
    ind_article_type: initialData?.ind_article_type || '',
    ind_article_type_custom: initialData?.ind_article_type_custom || '',
    ind_model_count: initialData?.ind_model_count || 1,
    ind_variations_description: initialData?.ind_variations_description || '',
    ind_sizes: initialData?.ind_sizes || '',
    ind_main_material: initialData?.ind_main_material || '',
    ind_quality_description: initialData?.ind_quality_description || '',
    ind_accepts_changes: initialData?.ind_accepts_changes ?? false,
    ind_change_policy: initialData?.ind_change_policy || '',
    has_guarantee: initialData?.has_guarantee ?? false,
    guarantee_details: initialData?.guarantee_details || '',
    ind_customizable: initialData?.ind_customizable ?? false,
    ind_customization_description: initialData?.ind_customization_description || '',
    ind_product_images: initialData?.ind_product_images || [],
    context_links: initialData?.context_links || [],
    context_links_content: initialData?.context_links_content || '',
  })

  const labels = {
    es: {
      title: isEditing ? 'Editar Indumentaria' : 'Nueva Indumentaria',
      subtitle: 'Completa la información de tu producto de moda',
      step: 'Paso', of: 'de', next: 'Siguiente', back: 'Atrás',
      save: isEditing ? 'Guardar' : 'Crear', cancel: 'Cancelar', yes: 'Sí', no: 'No',
      // S1
      nameLabel: 'Nombre del producto o colección',
      namePh: 'Ej: Colección Urban 2026',
      typeLabel: 'Tipo de artículo',
      articleTypes: { ropa: 'Ropa', zapatos: 'Zapatos', joyeria: 'Joyería', relojes: 'Relojes', accesorios: 'Accesorios', otro: 'Otro' },
      typeCustomPh: 'Especifica el tipo...',
      // S2
      modelCountLabel: '¿Cuántos modelos o diseños diferentes tienes?',
      modelCountPh: 'Ej: 12',
      variationsLabel: 'Describe todas las variaciones que existen',
      variationsPh: 'Ej: Disponible en negro, beige y azul. Diseño oversized y fit regular…',
      sizesLabel: 'Disponibilidad de tallas (si aplica)',
      sizesPh: 'Ej: S a XL / 36 al 42',
      // S3
      materialLabel: 'Material principal',
      materialPh: 'Ej: Algodón 100%, acero inoxidable…',
      qualityLabel: '¿Qué hace que la calidad sea buena?',
      qualityPh: 'No destiñe, no se oxida, costuras reforzadas…',
      // S4
      changesLabel: '¿Aceptan cambios?',
      changePolicyPh: 'Ej: 7 días para cambios',
      guaranteeLabel: '¿Tiene garantía?',
      guaranteePh: 'Ej: Garantía por defectos de fábrica',
      // S5
      customLabel: '¿Tus productos se pueden personalizar?',
      customDescPh: 'Ej: Se puede agregar nombre bordado en la manga…',
      // S6
      imagesLabel: 'Subir fotos del producto',
      imagesHint: 'JPG, PNG o WEBP. Máximo 10 imágenes.',
      uploading: 'Subiendo...',
      linksTitle: 'Enlaces de Referencia', linksOptional: 'Opcional',
      linksSubtitle: 'Agrega enlaces relevantes',
      linksPh: 'Pega enlaces (uno por línea)', linksAdd: 'Agregar',
    },
    en: {
      title: isEditing ? 'Edit Fashion Item' : 'New Fashion Item',
      subtitle: 'Complete your fashion product info',
      step: 'Step', of: 'of', next: 'Next', back: 'Back',
      save: isEditing ? 'Save' : 'Create', cancel: 'Cancel', yes: 'Yes', no: 'No',
      nameLabel: 'Product or collection name',
      namePh: 'E.g.: Urban Collection 2026',
      typeLabel: 'Article type',
      articleTypes: { ropa: 'Clothing', zapatos: 'Shoes', joyeria: 'Jewelry', relojes: 'Watches', accesorios: 'Accessories', otro: 'Other' },
      typeCustomPh: 'Specify type...',
      modelCountLabel: 'How many different models or designs do you have?',
      modelCountPh: 'E.g.: 12',
      variationsLabel: 'Describe all variations that exist',
      variationsPh: 'E.g.: Available in black, beige and blue. Oversized and regular fit…',
      sizesLabel: 'Size availability (if applicable)',
      sizesPh: 'E.g.: S to XL / 36 to 42',
      materialLabel: 'Main material',
      materialPh: 'E.g.: 100% cotton, stainless steel…',
      qualityLabel: 'What makes the quality good?',
      qualityPh: 'Doesn\'t fade, doesn\'t rust, reinforced stitching…',
      changesLabel: 'Do you accept returns/exchanges?',
      changePolicyPh: 'E.g.: 7 days for exchanges',
      guaranteeLabel: 'Does it have a guarantee?',
      guaranteePh: 'E.g.: Factory defect warranty',
      customLabel: 'Can your products be customized?',
      customDescPh: 'E.g.: Can add embroidered name on sleeve…',
      imagesLabel: 'Upload product photos',
      imagesHint: 'JPG, PNG or WEBP. Maximum 10 images.',
      uploading: 'Uploading...',
      linksTitle: 'Reference Links', linksOptional: 'Optional',
      linksSubtitle: 'Add relevant links',
      linksPh: 'Paste links (one per line)', linksAdd: 'Add',
    },
  }
  const t = labels[language]
  const totalSteps = 6
  const needsSizes = ['ropa', 'zapatos'].includes(formData.ind_article_type)

  const handleChange = (field: keyof IndumentariaFormData, value: unknown) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const maxImages = 10 - (formData.ind_product_images || []).length
    if (maxImages <= 0) return
    setUploadingImages(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const newUrls: string[] = []
      const filesToUpload = Array.from(files).slice(0, maxImages)
      for (const file of filesToUpload) {
        const ext = file.name.split('.').pop()?.toLowerCase()
        if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext || '')) continue
        const path = `product-images/${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const { error } = await supabase.storage.from('product-images').upload(path, file)
        if (!error) {
          const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path)
          if (urlData?.publicUrl) newUrls.push(urlData.publicUrl)
        }
      }
      if (newUrls.length > 0) {
        setFormData(prev => ({ ...prev, ind_product_images: [...(prev.ind_product_images || []), ...newUrls] }))
      }
    } catch (err) { console.error('Upload failed:', err) }
    finally { setUploadingImages(false) }
  }

  const removeImage = (url: string) => {
    setFormData(prev => ({ ...prev, ind_product_images: (prev.ind_product_images || []).filter(u => u !== url) }))
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

  const handleSubmit = async () => {
    setLoading(true)
    try { await onSubmit(formData) } finally { setLoading(false) }
  }

  const canProceed = () => {
    switch (step) {
      case 1: return formData.name.trim() && formData.ind_article_type
      case 2: return formData.ind_model_count >= 1 && formData.ind_variations_description.trim()
      case 3: return formData.ind_main_material.trim()
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
          {/* S1: Basic Info */}
          {step === 1 && (
            <div className="space-y-6">
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.nameLabel}</label><input type="text" value={formData.name} onChange={e => handleChange('name', e.target.value)} placeholder={t.namePh} className="input-field" autoFocus /></div>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.typeLabel}</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ARTICLE_TYPES.map(at => (
                    <button key={at} type="button" onClick={() => handleChange('ind_article_type', at)}
                      className={`p-3 rounded-xl border-2 transition-all text-sm font-medium ${formData.ind_article_type === at ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'}`}>
                      {(t.articleTypes as Record<string, string>)[at]}
                    </button>
                  ))}
                </div>
                {formData.ind_article_type === 'otro' && <input type="text" value={formData.ind_article_type_custom || ''} onChange={e => handleChange('ind_article_type_custom', e.target.value)} placeholder={t.typeCustomPh} className="input-field mt-3" />}
              </div>
              <AutoFillButtons
                formType="indumentaria"
                language={language}
                onResult={(data) => {
                  const updates: Partial<IndumentariaFormData> = {}
                  const stringFields: (keyof IndumentariaFormData)[] = ['name', 'ind_article_type', 'ind_variations_description', 'ind_sizes', 'ind_main_material', 'ind_quality_description']
                  for (const key of stringFields) {
                    if (typeof data[key] === 'string' && (data[key] as string).trim()) {
                      (updates as Record<string, unknown>)[key] = data[key]
                    }
                  }
                  if (typeof data.ind_model_count === 'number' && data.ind_model_count >= 1) {
                    updates.ind_model_count = data.ind_model_count
                  }
                  setFormData(prev => ({ ...prev, ...updates }))
                  setStep(2)
                }}
              />
            </div>
          )}

          {/* S2: Variety */}
          {step === 2 && (
            <div className="space-y-6">
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.modelCountLabel}</label><input type="number" min={1} value={formData.ind_model_count} onChange={e => handleChange('ind_model_count', Math.max(1, Number(e.target.value)))} placeholder={t.modelCountPh} className="input-field" autoFocus /></div>
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.variationsLabel}</label><textarea value={formData.ind_variations_description} onChange={e => handleChange('ind_variations_description', e.target.value)} placeholder={t.variationsPh} className="input-field min-h-[100px]" /></div>
              {needsSizes && <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.sizesLabel}</label><input type="text" value={formData.ind_sizes || ''} onChange={e => handleChange('ind_sizes', e.target.value)} placeholder={t.sizesPh} className="input-field" /></div>}
            </div>
          )}

          {/* S3: Quality */}
          {step === 3 && (
            <div className="space-y-6">
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.materialLabel}</label><input type="text" value={formData.ind_main_material} onChange={e => handleChange('ind_main_material', e.target.value)} placeholder={t.materialPh} className="input-field" autoFocus /></div>
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.qualityLabel}</label><textarea value={formData.ind_quality_description || ''} onChange={e => handleChange('ind_quality_description', e.target.value)} placeholder={t.qualityPh} className="input-field min-h-[80px]" /></div>
            </div>
          )}

          {/* S4: Changes & Guarantees */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.changesLabel}</label>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => handleChange('ind_accepts_changes', true)} className={`p-4 rounded-xl border-2 transition-all font-medium ${formData.ind_accepts_changes ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500'}`}>{t.yes}</button>
                  <button type="button" onClick={() => handleChange('ind_accepts_changes', false)} className={`p-4 rounded-xl border-2 transition-all font-medium ${!formData.ind_accepts_changes ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500'}`}>{t.no}</button>
                </div>
                {formData.ind_accepts_changes && <input type="text" value={formData.ind_change_policy || ''} onChange={e => handleChange('ind_change_policy', e.target.value)} placeholder={t.changePolicyPh} className="input-field mt-3" />}
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.guaranteeLabel}</label>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => handleChange('has_guarantee', true)} className={`p-4 rounded-xl border-2 transition-all font-medium ${formData.has_guarantee ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500'}`}>{t.yes}</button>
                  <button type="button" onClick={() => handleChange('has_guarantee', false)} className={`p-4 rounded-xl border-2 transition-all font-medium ${!formData.has_guarantee ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500'}`}>{t.no}</button>
                </div>
                {formData.has_guarantee && <input type="text" value={formData.guarantee_details || ''} onChange={e => handleChange('guarantee_details', e.target.value)} placeholder={t.guaranteePh} className="input-field mt-3" />}
              </div>
            </div>
          )}

          {/* S5: Personalization */}
          {step === 5 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.customLabel}</label>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => handleChange('ind_customizable', true)} className={`p-4 rounded-xl border-2 transition-all font-medium ${formData.ind_customizable ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500'}`}>{t.yes}</button>
                  <button type="button" onClick={() => handleChange('ind_customizable', false)} className={`p-4 rounded-xl border-2 transition-all font-medium ${!formData.ind_customizable ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500'}`}>{t.no}</button>
                </div>
                {formData.ind_customizable && <textarea value={formData.ind_customization_description || ''} onChange={e => handleChange('ind_customization_description', e.target.value)} placeholder={t.customDescPh} className="input-field min-h-[80px] mt-3" />}
              </div>
            </div>
          )}

          {/* S6: Images + Links */}
          {step === 6 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">{t.imagesLabel}</label>
                <p className="text-xs text-dark-400 mb-3">{t.imagesHint}</p>
                {(formData.ind_product_images || []).length > 0 && (
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {(formData.ind_product_images || []).map((url, i) => (
                      <div key={i} className="relative group aspect-square rounded-lg overflow-hidden bg-dark-50">
                        <img src={url} alt="" className="w-full h-full object-cover" />
                        <button type="button" onClick={() => removeImage(url)} className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
                {(formData.ind_product_images || []).length < 10 && (
                  <label className={`flex items-center justify-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition-all ${uploadingImages ? 'border-dark-200 text-dark-400' : 'border-dark-200 hover:border-primary-400 text-dark-500 hover:text-primary-600'}`}>
                    {uploadingImages ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                    <span className="text-sm font-medium">{uploadingImages ? t.uploading : t.imagesLabel}</span>
                    <input type="file" multiple accept=".jpg,.jpeg,.png,.webp" onChange={handleImageUpload} className="hidden" disabled={uploadingImages} />
                  </label>
                )}
              </div>

              {/* Context Links */}
              <div className="border-t border-dark-100 pt-6">
                <div className="flex items-center gap-2 mb-1"><Link2 className="w-4 h-4 text-blue-500" /><label className="text-sm font-medium text-dark-700">{t.linksTitle}</label><span className="text-xs text-dark-400 bg-dark-50 px-1.5 py-0.5 rounded">{t.linksOptional}</span></div>
                <p className="text-xs text-dark-400 mb-3">{t.linksSubtitle}</p>
                {(formData.context_links || []).length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {(formData.context_links || []).map((link, i) => (
                      <div key={i} className="flex items-center gap-2 bg-blue-900/20 rounded-lg px-3 py-1.5 group">
                        <Link2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" /><span className="text-xs text-dark-700 truncate flex-1">{link}</span>
                        <button type="button" onClick={() => handleRemoveLink(link)} className="p-0.5 text-dark-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
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
