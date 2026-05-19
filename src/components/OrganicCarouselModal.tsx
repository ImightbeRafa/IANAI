import { useEffect, useRef, useState } from 'react'
import { X, Sparkles, Loader2, Minus, Plus, AlertTriangle, Leaf, ListChecks, ListOrdered, ArrowRightLeft, Scale, Download, Upload, Trash2 } from 'lucide-react'
import type { OrganicCarouselSubtype, CTAStrength } from '../types'
import { generateCarousel, type GenerateCarouselResponse, type CarouselAspectRatio } from '../services/carouselApi'
import { createCarouselPosts, type CarouselSlideInsert, type Post } from '../services/database'
import { compressBase64ForApi, urlToBase64 } from '../utils/imageCompression'

type Language = 'en' | 'es'

interface Props {
  open: boolean
  onClose: () => void
  productId: string
  userId: string
  language: Language
  brandKitId?: string
  /** Pre-fills the script textarea if opening from a script card. */
  initialScriptContent?: string
  savedScripts?: Array<{ id: string; title: string; content: string }>
  productContext?: {
    name?: string
    type?: string
    category?: string
    description?: string
    audience?: string
    differentiation?: string
    result?: string
    objection?: string
    logistics?: string
  }
  productReferenceImageUrls?: string[]
  contextReferenceImageUrls?: string[]
  /** Called once the carousel has been generated AND persisted. Passes the inserted slides (array of post rows). */
  onPersisted?: (slides: Post[], meta: GenerateCarouselResponse) => void
  /** Used to show cost confirmation and gate generation. */
  remainingImageCredits: number | null // null = unlimited
}

type SubtypeMeta = {
  id: OrganicCarouselSubtype
  es: string
  en: string
  desc_es: string
  desc_en: string
  Icon: typeof ListChecks
}

const SUBTYPES: SubtypeMeta[] = [
  { id: 'educational-list', es: 'Lista Educativa', en: 'Educational List', desc_es: '"7 cosas que no sabías sobre..."', desc_en: '"7 things you didn\'t know about..."', Icon: ListChecks },
  { id: 'how-to-steps', es: 'How-To / Pasos', en: 'How-To / Steps', desc_es: 'Pasos numerados accionables', desc_en: 'Numbered actionable steps', Icon: ListOrdered },
  { id: 'before-after', es: 'Antes / Después', en: 'Before / After', desc_es: 'Narrativa de transformación', desc_en: 'Transformation narrative', Icon: ArrowRightLeft },
  { id: 'myth-vs-fact', es: 'Mito vs Realidad', en: 'Myth vs Fact', desc_es: 'Desarma creencias comunes', desc_en: 'Debunk common beliefs', Icon: Scale },
]

const ASPECT_RATIOS: { id: CarouselAspectRatio; label: string }[] = [
  { id: '1:1', label: '1:1' },
  { id: '4:5', label: '4:5' },
  { id: '9:16', label: '9:16' },
]

const CTA_OPTIONS: { id: CTAStrength; es: string; en: string }[] = [
  { id: 'none', es: 'Ninguno', en: 'None' },
  { id: 'soft', es: 'Suave', en: 'Soft' },
  { id: 'brand_mention', es: 'Marca', en: 'Brand' },
  { id: 'sales', es: 'Ventas', en: 'Sales' },
]

export default function OrganicCarouselModal({
  open, onClose, productId, userId, language, brandKitId, initialScriptContent, savedScripts = [],
  productContext, productReferenceImageUrls = [], contextReferenceImageUrls = [], onPersisted, remainingImageCredits,
}: Props) {
  const [subtype, setSubtype] = useState<OrganicCarouselSubtype>('educational-list')
  const [slideCount, setSlideCount] = useState<number>(5)
  const [aspectRatio, setAspectRatio] = useState<CarouselAspectRatio>('1:1')
  const [ctaStrength, setCtaStrength] = useState<CTAStrength>('soft')
  const [scriptContent, setScriptContent] = useState<string>(initialScriptContent ?? '')
  const [designDirection, setDesignDirection] = useState<string>('')
  const [slideDetails, setSlideDetails] = useState<string>('')
  const [previewFirstSlideOnly, setPreviewFirstSlideOnly] = useState<boolean>(false)
  const [carouselReferenceImages, setCarouselReferenceImages] = useState<string[]>([])
  const [selectedSavedScriptId, setSelectedSavedScriptId] = useState<string>('')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<GenerateCarouselResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmCost, setConfirmCost] = useState(false)
  const carouselRefInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setScriptContent(initialScriptContent ?? '')
    setSelectedSavedScriptId('')
    setConfirmCost(false)
    setResult(null)
    setError(null)
    setDesignDirection('')
    setSlideDetails('')
    setPreviewFirstSlideOnly(false)
    setCarouselReferenceImages([])
  }, [open, initialScriptContent])

  if (!open) return null

  const t = (es: string, en: string) => (language === 'es' ? es : en)

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error(t('No se pudo leer la imagen.', 'Could not read the image.')))
      reader.readAsDataURL(file)
    })

  const handleCarouselReferenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const remaining = 8 - carouselReferenceImages.length
    const selected = Array.from(files).slice(0, remaining)
    try {
      const dataUrls = await Promise.all(selected.map(fileToDataUrl))
      setCarouselReferenceImages(prev => [...prev, ...dataUrls])
      setConfirmCost(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (carouselRefInputRef.current) carouselRefInputRef.current.value = ''
    }
  }

  const handleGenerate = async () => {
    setError(null)
    const content = scriptContent.trim()
    if (!content) {
      setError(t('Pegá tu guión o idea primero.', 'Paste your script or idea first.'))
      return
    }
    if (!confirmCost) {
      setConfirmCost(true)
      return
    }
    setGenerating(true)
    try {
      const productReferenceImages = await Promise.all(
        productReferenceImageUrls.slice(0, 4).map(async url => compressBase64ForApi(await urlToBase64(url)))
      )
      const contextReferenceImages = await Promise.all(
        contextReferenceImageUrls.slice(0, 4).map(async url => compressBase64ForApi(await urlToBase64(url)))
      )
      const uploadedCarouselReferenceImages = await Promise.all(
        carouselReferenceImages.map(img => compressBase64ForApi(img))
      )

      const resp = await generateCarousel({
        productId,
        subtype,
        slideCount,
        scriptContent: content,
        aspectRatio,
        language,
        brandKitId,
        ctaStrength,
        designDirection: designDirection.trim() || undefined,
        slideDetails: slideDetails.trim() || undefined,
        previewFirstSlideOnly,
        productContext,
        productReferenceImages,
        contextReferenceImages,
        carouselReferenceImages: uploadedCarouselReferenceImages,
      })
      setResult(resp)

      // Persist succeeded slides.
      const succeeded = resp.slides.filter(s => !!s.imageUrl)
      if (succeeded.length > 0) {
        const toInsert: CarouselSlideInsert[] = succeeded.map(s => ({
          prompt: s.headline + (s.body ? `\n\n${s.body}` : ''),
          generated_image_url: s.imageUrl!,
          width: aspectRatio === '1:1' ? 1080 : 1080,
          height: aspectRatio === '1:1' ? 1080 : aspectRatio === '4:5' ? 1350 : aspectRatio === '9:16' ? 1920 : 1440,
          slide_index: s.index,
          slide_total: resp.totalSlides,
          carousel_subtype: resp.subtype,
        }))
        try {
          const inserted = await createCarouselPosts(productId, userId, resp.carouselGroupId, toInsert)
          onPersisted?.(inserted, resp)
        } catch (persistErr) {
          console.warn('Carousel generated but failed to persist:', persistErr)
          setError(t(
            'Las imágenes se generaron pero no se pudieron guardar. Descargalas antes de cerrar.',
            'Images generated but could not be saved. Download them before closing.'
          ))
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  const cost = previewFirstSlideOnly ? 1 : slideCount
  const renderSlideCount = previewFirstSlideOnly ? 1 : slideCount
  const hasEnoughCredits = remainingImageCredits === null || remainingImageCredits >= cost

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-dark-100 rounded-2xl w-full max-w-3xl my-8 shadow-2xl border border-emerald-800/30">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Leaf className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-dark-900">
                {t('Carrusel Orgánico', 'Organic Carousel')}
              </h2>
              <p className="text-xs text-dark-400">
                {t('2–10 slides, generados con estilo consistente', '2–10 slides, generated with consistent style')}
              </p>
            </div>
          </div>
          <button
            onClick={() => { onClose(); setResult(null); setError(null); setConfirmCost(false) }}
            className="w-8 h-8 rounded-lg hover:bg-dark-200 flex items-center justify-center text-dark-500"
            aria-label={t('Cerrar', 'Close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {result ? (
            // Result view
            <div className="space-y-4">
              <div className="text-sm text-dark-600">
                {t(
                  `Carrusel generado: ${result.slides.filter(s => s.imageUrl).length} de ${result.totalSlides} slides.`,
                  `Carousel generated: ${result.slides.filter(s => s.imageUrl).length} of ${result.totalSlides} slides.`
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {result.slides.map(s => (
                  <div key={s.index} className="group/slide bg-dark-50 rounded-xl overflow-hidden border border-dark-200 hover:border-emerald-700/50 transition-colors">
                    <div className="aspect-square bg-dark-200 flex items-center justify-center relative">
                      {s.imageUrl ? (
                        <>
                          <img src={s.imageUrl} alt={`Slide ${s.index}`} className="w-full h-full object-cover" />
                          <button
                            onClick={async () => {
                              if (!s.imageUrl) return
                              try {
                                const resp = await fetch(s.imageUrl)
                                const blob = await resp.blob()
                                const url = URL.createObjectURL(blob)
                                const a = document.createElement('a')
                                a.href = url
                                a.download = `slide-${s.index}.jpg`
                                document.body.appendChild(a)
                                a.click()
                                document.body.removeChild(a)
                                URL.revokeObjectURL(url)
                              } catch (err) { console.error('Download slide failed:', err) }
                            }}
                            className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-black/60 backdrop-blur-sm text-white opacity-0 group-hover/slide:opacity-100 hover:bg-black/80 transition-all flex items-center justify-center"
                            title={t('Descargar', 'Download')}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold tabular-nums">
                            {s.index}/{result.totalSlides}
                          </div>
                        </>
                      ) : (
                        <div className="text-center px-2">
                          <AlertTriangle className="w-5 h-5 text-amber-500 mx-auto mb-1" />
                          <div className="text-[10px] text-amber-400">{t('Falló', 'Failed')}</div>
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
                        {s.role}
                      </div>
                      <div className="text-xs text-dark-700 mt-0.5 line-clamp-2">{s.headline}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => { setResult(null); setConfirmCost(false) }}
                  className="flex-1 px-4 py-2.5 text-sm rounded-lg bg-dark-200 text-dark-700 hover:bg-dark-300 transition-colors"
                >
                  {t('Generar otro', 'Generate another')}
                </button>
                <button
                  onClick={() => { onClose(); setResult(null); setConfirmCost(false) }}
                  className="flex-1 px-4 py-2.5 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors font-medium"
                >
                  {t('Listo', 'Done')}
                </button>
              </div>
            </div>
          ) : (
            // Configuration form
            <>
              {/* Subtype */}
              <div>
                <label className="text-xs font-medium text-dark-700 mb-2 block">
                  {t('Tipo de carrusel', 'Carousel type')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {SUBTYPES.map(s => {
                    const Icon = s.Icon
                    const active = subtype === s.id
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSubtype(s.id)}
                        className={`p-3 text-left rounded-xl border transition-all ${
                          active
                            ? 'bg-emerald-900/30 border-emerald-600 text-emerald-100 shadow-lg shadow-emerald-900/30 scale-[1.01]'
                            : 'bg-dark-50 border-dark-200 text-dark-600 hover:bg-dark-100 hover:border-dark-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                            active ? 'bg-emerald-600 text-white' : 'bg-dark-200 text-dark-500'
                          }`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="text-sm font-semibold">{language === 'es' ? s.es : s.en}</div>
                        </div>
                        <div className="text-[10px] text-dark-400 leading-tight">
                          {language === 'es' ? s.desc_es : s.desc_en}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Slide count */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-dark-700">
                    {t('Cantidad de slides', 'Slide count')}
                  </label>
                  <span className="text-xs text-dark-400">
                    {slideCount} {t('slides', 'slides')}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSlideCount(n => Math.max(2, n - 1))}
                    className="w-8 h-8 rounded-lg bg-dark-200 hover:bg-dark-300 flex items-center justify-center text-dark-600"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="range"
                    min={2}
                    max={10}
                    value={slideCount}
                    onChange={e => setSlideCount(parseInt(e.target.value))}
                    className="flex-1 h-1.5 bg-dark-200 rounded-full appearance-none accent-emerald-500"
                  />
                  <button
                    onClick={() => setSlideCount(n => Math.min(10, n + 1))}
                    className="w-8 h-8 rounded-lg bg-dark-200 hover:bg-dark-300 flex items-center justify-center text-dark-600"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Aspect ratio + CTA */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-dark-700 mb-2 block">
                    {t('Formato', 'Format')}
                  </label>
                  <div className="flex gap-1">
                    {ASPECT_RATIOS.map(ar => (
                      <button
                        key={ar.id}
                        onClick={() => setAspectRatio(ar.id)}
                        className={`flex-1 px-2 py-2 text-xs rounded-lg transition-colors ${
                          aspectRatio === ar.id
                            ? 'bg-emerald-600 text-white'
                            : 'bg-dark-200 text-dark-500 hover:bg-dark-300'
                        }`}
                      >
                        {ar.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-dark-700 mb-2 block">
                    {t('CTA', 'CTA')}
                  </label>
                  <div className="grid grid-cols-4 gap-0.5">
                    {CTA_OPTIONS.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setCtaStrength(c.id)}
                        className={`px-1 py-2 text-[10px] rounded-md transition-colors ${
                          ctaStrength === c.id
                            ? c.id === 'sales' ? 'bg-primary-500 text-white' : 'bg-emerald-600 text-white'
                            : 'bg-dark-200 text-dark-500 hover:bg-dark-300'
                        }`}
                      >
                        {language === 'es' ? c.es : c.en}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Script / idea */}
              <div>
                <label className="text-xs font-medium text-dark-700 mb-2 block">
                  {t('Guión o idea', 'Script or idea')}
                </label>
                {savedScripts.length > 0 && (
                  <select
                    value={selectedSavedScriptId}
                    onChange={e => {
                      const id = e.target.value
                      setSelectedSavedScriptId(id)
                      const picked = savedScripts.find(s => s.id === id)
                      if (picked) {
                        setScriptContent(picked.content)
                        setConfirmCost(false)
                      }
                    }}
                    className="w-full mb-2 px-3 py-2 bg-dark-50 border border-dark-200 rounded-lg text-xs text-dark-700 focus:outline-none focus:border-emerald-700"
                  >
                    <option value="">{t('Usar texto actual / pegado', 'Use current / pasted text')}</option>
                    {savedScripts.map(script => (
                      <option key={script.id} value={script.id}>{script.title}</option>
                    ))}
                  </select>
                )}
                <textarea
                  value={scriptContent}
                  onChange={e => {
                    setScriptContent(e.target.value)
                    setSelectedSavedScriptId('')
                    setConfirmCost(false)
                  }}
                  rows={5}
                  placeholder={t(
                    'Pegá el guión original o describí la idea (ej: 5 errores comunes al elegir un colchón)...',
                    'Paste the original script or describe the idea (e.g. 5 common mistakes when choosing a mattress)...'
                  )}
                  className="w-full px-3 py-2.5 bg-dark-50 border border-dark-200 rounded-lg text-sm text-dark-700 placeholder-dark-400 focus:outline-none focus:border-emerald-700 resize-none"
                />
                {(productReferenceImageUrls.length > 0 || contextReferenceImageUrls.length > 0 || productContext) && (
                  <div className="mt-2 text-[10px] text-dark-400">
                    {t(
                      `Se usara contexto del producto${productReferenceImageUrls.length ? ` + ${Math.min(productReferenceImageUrls.length, 4)} foto(s) reales` : ''}${contextReferenceImageUrls.length ? ` + ${Math.min(contextReferenceImageUrls.length, 4)} referencia(s) de contexto` : ''}.`,
                      `Product context will be used${productReferenceImageUrls.length ? ` + ${Math.min(productReferenceImageUrls.length, 4)} real product photo(s)` : ''}${contextReferenceImageUrls.length ? ` + ${Math.min(contextReferenceImageUrls.length, 4)} context reference(s)` : ''}.`
                    )}
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label className="text-xs font-medium text-dark-700 block">
                    {t('Imagenes para este carrusel', 'Images for this carousel')}
                  </label>
                  <span className="text-[10px] text-dark-400">
                    {carouselReferenceImages.length}/8
                  </span>
                </div>
                <p className="text-[10px] text-dark-400 mb-2 leading-relaxed">
                  {t(
                    'Subi referencias de estilo, ejemplos de posts, fotos o assets que queres usar en slides especificos. Explica como usarlas en Direccion de diseno o Detalle slide por slide.',
                    'Upload style references, post examples, photos, or assets you want used on specific slides. Explain how to use them in Design direction or Slide-by-slide detail.'
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  {carouselReferenceImages.map((img, idx) => (
                    <div key={`${idx}-${img.slice(0, 20)}`} className="relative group/ref">
                      <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-emerald-700/60 ring-2 ring-emerald-700/20 bg-dark-200">
                        <img src={img} alt={`Carousel reference ${idx + 1}`} className="w-full h-full object-cover" />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCarouselReferenceImages(prev => prev.filter((_, i) => i !== idx))
                          setConfirmCost(false)
                        }}
                        className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center opacity-100 lg:opacity-0 lg:group-hover/ref:opacity-100 transition-opacity hover:bg-red-700"
                        aria-label={t('Quitar imagen', 'Remove image')}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  {carouselReferenceImages.length < 8 && (
                    <button
                      type="button"
                      onClick={() => carouselRefInputRef.current?.click()}
                      className="w-16 h-16 rounded-lg border-2 border-dashed border-dark-300 flex flex-col items-center justify-center text-dark-400 hover:border-emerald-500 hover:text-emerald-400 transition-colors"
                    >
                      <Upload className="w-4 h-4" />
                      <span className="text-[8px] mt-0.5">
                        {t('Subir', 'Upload')}
                      </span>
                    </button>
                  )}
                  <input
                    ref={carouselRefInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
                    multiple
                    onChange={handleCarouselReferenceUpload}
                    className="hidden"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-dark-700 mb-2 block">
                  {t('Direccion de diseno (opcional)', 'Design direction (optional)')}
                </label>
                <textarea
                  value={designDirection}
                  onChange={e => {
                    setDesignDirection(e.target.value)
                    setConfirmCost(false)
                  }}
                  rows={3}
                  placeholder={t(
                    'Ej: fondo crema, tipografia editorial, fotos limpias, mucho aire, inspirado en el post que subi como referencia...',
                    'E.g. cream background, editorial typography, clean photos, generous spacing, inspired by the post I uploaded as reference...'
                  )}
                  className="w-full px-3 py-2.5 bg-dark-50 border border-dark-200 rounded-lg text-sm text-dark-700 placeholder-dark-400 focus:outline-none focus:border-emerald-700 resize-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-dark-700 mb-2 block">
                  {t('Detalle slide por slide (opcional)', 'Slide-by-slide detail (optional)')}
                </label>
                <textarea
                  value={slideDetails}
                  onChange={e => {
                    setSlideDetails(e.target.value)
                    setConfirmCost(false)
                  }}
                  rows={4}
                  placeholder={t(
                    'Ej: Slide 1: titulo. Slide 2: problema. Slide 3: checklist. Si lo dejas vacio, la IA arma la estructura.',
                    'E.g. Slide 1: title. Slide 2: problem. Slide 3: checklist. Leave blank and AI will build the structure.'
                  )}
                  className="w-full px-3 py-2.5 bg-dark-50 border border-dark-200 rounded-lg text-sm text-dark-700 placeholder-dark-400 focus:outline-none focus:border-emerald-700 resize-none"
                />
              </div>

              <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-dark-50 border border-dark-200 cursor-pointer">
                <span>
                  <span className="block text-xs font-medium text-dark-700">
                    {t('Generar solo slide 1', 'Generate slide 1 only')}
                  </span>
                  <span className="block text-[10px] text-dark-400 mt-0.5">
                    {t('Previsualiza la direccion antes del carrusel completo.', 'Preview the direction before the full carousel.')}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={previewFirstSlideOnly}
                  onChange={e => {
                    setPreviewFirstSlideOnly(e.target.checked)
                    setConfirmCost(false)
                  }}
                  className="w-4 h-4 accent-emerald-600"
                />
              </label>

              {/* Cost / warnings */}
              <div className={`flex items-center gap-2 text-xs px-3 py-2.5 rounded-lg ${
                hasEnoughCredits ? 'bg-dark-50 text-dark-500' : 'bg-amber-900/20 text-amber-400 border border-amber-800/30'
              }`}>
                {hasEnoughCredits ? (
                  <span>
                    {t(
                      `Esto usará ${cost} generación(es) de imagen.`,
                      `This will use ${cost} image generation(s).`
                    )}
                    {remainingImageCredits !== null && (
                      <span className="text-dark-400"> · {t(`Te quedan ${remainingImageCredits}.`, `You have ${remainingImageCredits} left.`)}</span>
                    )}
                  </span>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>
                      {t(
                        `Necesitás ${cost} créditos de imagen. Te quedan ${remainingImageCredits}.`,
                        `You need ${cost} image credits. You have ${remainingImageCredits}.`
                      )}
                    </span>
                  </>
                )}
              </div>

              {confirmCost && !generating && hasEnoughCredits && (
                <div className="bg-emerald-900/20 border border-emerald-800/40 text-emerald-200 text-xs px-3 py-2.5 rounded-lg">
                  {t(
                    `¿Confirmás? Se generarán ${cost} imágenes en paralelo (slide 1 primero, luego el resto con consistencia visual).`,
                    `Confirm? ${cost} images will be generated in parallel (slide 1 first, then the rest with visual consistency).`
                  )}
                </div>
              )}

              {error && (
                <div className="bg-red-900/20 border border-red-800/40 text-red-300 text-xs px-3 py-2.5 rounded-lg">
                  {error}
                </div>
              )}

              {/* Skeleton grid while generating — gives users a sense of scale before results land. */}
              {generating && (
                <div>
                  <div className="text-[11px] text-emerald-400 mb-2 flex items-center gap-1.5 font-medium">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {t('Preparando slides con consistencia visual...', 'Preparing slides with visual consistency...')}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {Array.from({ length: renderSlideCount }).map((_, i) => (
                      <div
                        key={i}
                        className="aspect-square rounded-lg bg-gradient-to-br from-dark-200 to-dark-100 relative overflow-hidden border border-emerald-900/20"
                        style={{ animation: `pulse 2s ease-in-out ${i * 0.1}s infinite` }}
                      >
                        <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-md bg-emerald-900/50 flex items-center justify-center text-[10px] font-bold text-emerald-300">
                          {i + 1}
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-emerald-500/10 to-transparent" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleGenerate}
                disabled={generating || !hasEnoughCredits}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium flex items-center justify-center gap-2 hover:from-emerald-700 hover:to-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-900/30"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('Generando slides...', 'Generating slides...')}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    {confirmCost ? t('Confirmar y generar', 'Confirm & generate') : t('Generar Carrusel', 'Generate Carousel')}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
