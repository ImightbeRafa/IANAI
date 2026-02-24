import { useState, useRef } from 'react'
import { X, Upload, Loader2, ChevronRight, ChevronLeft, Sparkles, Check, Image as ImageIcon, Type, Shield, Eye } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'
import { compressForStyleAnalysis } from '../utils/imageCompression'

interface StylePreferences {
  brandColors: string
  typography: string
  mood: string
  textLanguage: string
  avoidElements: string
  mustInclude: string
  layoutPreference: string
}

interface AnalysisResult {
  masterPromptEs: string
  masterPromptEn: string
  extractedColors: string[]
  styleNameSuggestion: string
  styleDescriptionEs: string
  styleDescriptionEn: string
}

interface Props {
  onClose: () => void
  onSave: (data: {
    name: string
    description: string
    referenceImages: string[]
    masterPromptEs: string
    masterPromptEn: string
    stylePreferences: Record<string, unknown>
    thumbnailUrl?: string
  }) => Promise<void>
  initialReferenceImages?: string[]
  initialDescription?: string
}

const ANALYZE_API_URL = import.meta.env.PROD ? '/api/analyze-style' : 'http://localhost:3000/api/analyze-style'

const MOOD_OPTIONS = [
  { id: 'luxury', es: 'Lujo / Premium', en: 'Luxury / Premium' },
  { id: 'minimal', es: 'Minimalista', en: 'Minimalist' },
  { id: 'bold', es: 'Audaz / Llamativo', en: 'Bold / Eye-catching' },
  { id: 'playful', es: 'Divertido / Juvenil', en: 'Playful / Youthful' },
  { id: 'professional', es: 'Profesional / Corporativo', en: 'Professional / Corporate' },
  { id: 'warm', es: 'Cálido / Acogedor', en: 'Warm / Cozy' },
  { id: 'energetic', es: 'Enérgico / Dinámico', en: 'Energetic / Dynamic' },
  { id: 'elegant', es: 'Elegante / Sofisticado', en: 'Elegant / Sophisticated' },
]

const TYPOGRAPHY_OPTIONS = [
  { id: 'modern-sans', es: 'Sans-serif moderna (tipo Apple)', en: 'Modern sans-serif (Apple-like)' },
  { id: 'bold-impact', es: 'Bold / Impact (alto contraste)', en: 'Bold / Impact (high contrast)' },
  { id: 'serif-elegant', es: 'Serif elegante (editorial)', en: 'Elegant serif (editorial)' },
  { id: 'handwritten', es: 'Manuscrita / Orgánica', en: 'Handwritten / Organic' },
  { id: 'condensed', es: 'Condensada / Compacta', en: 'Condensed / Compact' },
  { id: 'any', es: 'Que la IA decida', en: 'Let AI decide' },
]

const LAYOUT_OPTIONS = [
  { id: 'centered', es: 'Centrado / Simétrico', en: 'Centered / Symmetric' },
  { id: 'asymmetric', es: 'Asimétrico / Dinámico', en: 'Asymmetric / Dynamic' },
  { id: 'split', es: 'Pantalla dividida', en: 'Split screen' },
  { id: 'full-image', es: 'Imagen completa + overlay', en: 'Full image + overlay' },
  { id: 'grid', es: 'Cuadrícula / Collage', en: 'Grid / Collage' },
  { id: 'any', es: 'Que la IA decida', en: 'Let AI decide' },
]

export default function CreateCustomPostType({ onClose, onSave, initialReferenceImages, initialDescription }: Props) {
  const { language } = useLanguage()
  const [step, setStep] = useState(initialReferenceImages && initialReferenceImages.length > 0 ? 2 : 1)
  const [referenceImages, setReferenceImages] = useState<string[]>(initialReferenceImages || [])
  const [description, setDescription] = useState(initialDescription || '')
  const [stylePrefs, setStylePrefs] = useState<StylePreferences>({
    brandColors: '',
    typography: 'any',
    mood: '',
    textLanguage: language === 'es' ? 'Español' : 'English',
    avoidElements: '',
    mustInclude: '',
    layoutPreference: 'any',
  })
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [customName, setCustomName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const t = language === 'es' ? {
    title: 'Crear Tipo de Post Personalizado',
    step1Title: 'Imágenes de Referencia',
    step1Desc: 'Sube 1-3 imágenes de ejemplo del estilo de post que quieres replicar',
    step2Title: 'Describe tu Estilo',
    step2Desc: 'Cuéntanos qué te gusta de estas imágenes y qué quieres lograr',
    step3Title: 'Preferencias de Estilo',
    step3Desc: 'Ajusta las preferencias de diseño para tu tipo de post',
    step4Title: 'Revisar y Guardar',
    step4Desc: 'Revisa el estilo generado y guárdalo',
    uploadImages: 'Subir imágenes',
    uploadHint: 'JPG, PNG o WebP • Máximo 3 imágenes',
    descPlaceholder: 'Describe el estilo que quieres... ej: "Quiero posts minimalistas con mucho espacio blanco, texto grande en negrita arriba y una foto de producto elegante centrada"',
    brandColorsLabel: 'Colores de marca (opcional)',
    brandColorsPlaceholder: 'ej: #FF5733, azul marino, dorado',
    typographyLabel: 'Estilo de tipografía',
    moodLabel: 'Tono / Ambiente',
    textLangLabel: 'Idioma del texto en posts',
    avoidLabel: 'Elementos a evitar (opcional)',
    avoidPlaceholder: 'ej: emojis, fondos oscuros, texto pequeño',
    mustIncludeLabel: 'Debe incluir siempre (opcional)',
    mustIncludePlaceholder: 'ej: logo en esquina, botón CTA, estrellas de rating',
    layoutLabel: 'Preferencia de layout',
    analyze: 'Analizar y Generar Estilo',
    analyzing: 'Analizando estilo con IA...',
    nameLabel: 'Nombre del estilo',
    namePlaceholder: 'ej: Mi Estilo Minimalista',
    extractedColors: 'Colores extraídos',
    generatedPrompt: 'Prompt generado (vista previa)',
    save: 'Guardar Tipo de Post',
    saving: 'Guardando...',
    back: 'Atrás',
    next: 'Siguiente',
    close: 'Cerrar',
    errorNoImages: 'Sube al menos una imagen de referencia',
    errorNoDesc: 'Describe brevemente el estilo que quieres',
    errorAnalysis: 'Error al analizar el estilo. Intenta de nuevo.',
    selectMood: 'Selecciona el tono',
    removeImage: 'Eliminar',
  } : {
    title: 'Create Custom Post Type',
    step1Title: 'Reference Images',
    step1Desc: 'Upload 1-3 example images of the post style you want to replicate',
    step2Title: 'Describe Your Style',
    step2Desc: 'Tell us what you like about these images and what you want to achieve',
    step3Title: 'Style Preferences',
    step3Desc: 'Fine-tune the design preferences for your post type',
    step4Title: 'Review & Save',
    step4Desc: 'Review the generated style and save it',
    uploadImages: 'Upload images',
    uploadHint: 'JPG, PNG, or WebP • Max 3 images',
    descPlaceholder: 'Describe the style you want... e.g. "I want minimalist posts with lots of white space, large bold text on top and an elegant centered product photo"',
    brandColorsLabel: 'Brand colors (optional)',
    brandColorsPlaceholder: 'e.g. #FF5733, navy blue, gold',
    typographyLabel: 'Typography style',
    moodLabel: 'Mood / Tone',
    textLangLabel: 'Text language in posts',
    avoidLabel: 'Elements to avoid (optional)',
    avoidPlaceholder: 'e.g. emojis, dark backgrounds, small text',
    mustIncludeLabel: 'Must always include (optional)',
    mustIncludePlaceholder: 'e.g. logo in corner, CTA button, star ratings',
    layoutLabel: 'Layout preference',
    analyze: 'Analyze & Generate Style',
    analyzing: 'Analyzing style with AI...',
    nameLabel: 'Style name',
    namePlaceholder: 'e.g. My Minimalist Style',
    extractedColors: 'Extracted colors',
    generatedPrompt: 'Generated prompt (preview)',
    save: 'Save Post Type',
    saving: 'Saving...',
    back: 'Back',
    next: 'Next',
    close: 'Close',
    errorNoImages: 'Upload at least one reference image',
    errorNoDesc: 'Briefly describe the style you want',
    errorAnalysis: 'Error analyzing style. Please try again.',
    selectMood: 'Select mood',
    removeImage: 'Remove',
  }

  const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB per file

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const maxNew = 3 - referenceImages.length
    if (maxNew <= 0) return

    for (const file of Array.from(files).slice(0, maxNew)) {
      if (file.size > MAX_FILE_SIZE) {
        setError(language === 'es'
          ? `"${file.name}" es demasiado grande (máx 5 MB)`
          : `"${file.name}" is too large (max 5 MB)`)
        continue
      }
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })
      const compressed = await compressForStyleAnalysis(dataUrl)
      setReferenceImages(prev => [...prev, compressed])
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index))
  }

  const handleAnalyze = async () => {
    if (referenceImages.length === 0) {
      setError(t.errorNoImages)
      return
    }

    setAnalyzing(true)
    setError('')

    try {
      const { data: { session } } = await (await import('../lib/supabase')).supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const compressedForApi = await Promise.all(
        referenceImages.map(img => compressForStyleAnalysis(img))
      )

      const response = await fetch(ANALYZE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          referenceImages: compressedForApi,
          description: description.trim(),
          stylePreferences: stylePrefs
        })
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t.errorAnalysis)

      setAnalysisResult(result)
      setCustomName(result.styleNameSuggestion || '')
      setStep(4)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorAnalysis)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSave = async () => {
    if (!analysisResult || !customName.trim()) return

    setSaving(true)
    setError('')

    try {
      await onSave({
        name: customName.trim(),
        description: language === 'es'
          ? analysisResult.styleDescriptionEs
          : analysisResult.styleDescriptionEn,
        referenceImages,
        masterPromptEs: analysisResult.masterPromptEs,
        masterPromptEn: analysisResult.masterPromptEn,
        stylePreferences: {
          ...stylePrefs,
          extractedColors: analysisResult.extractedColors
        },
        thumbnailUrl: referenceImages[0] || undefined
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const canGoNext = () => {
    if (step === 1) return referenceImages.length > 0
    if (step === 2) return true
    if (step === 3) return true
    return false
  }

  const handleNext = () => {
    if (step === 3) {
      handleAnalyze()
      return
    }
    if (canGoNext()) setStep(step + 1)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-100 rounded-2xl shadow-2xl border border-dark-200 w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-200">
          <div>
            <h2 className="text-sm font-bold text-dark-800">{t.title}</h2>
            <div className="flex items-center gap-2 mt-1.5">
              {[1, 2, 3, 4].map(s => (
                <div key={s} className="flex items-center gap-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                    s < step ? 'bg-primary-500 text-white' :
                    s === step ? 'bg-primary-900/30 text-primary-600 border-2 border-primary-400' :
                    'bg-dark-200 text-dark-400'
                  }`}>
                    {s < step ? <Check className="w-3 h-3" /> : s}
                  </div>
                  {s < 4 && <div className={`w-4 h-0.5 ${s < step ? 'bg-primary-500' : 'bg-dark-200'}`} />}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-dark-200 transition-colors text-dark-500 hover:text-dark-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* STEP 1: Reference Images */}
          {step === 1 && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <ImageIcon className="w-4 h-4 text-primary-500" />
                <div>
                  <h3 className="text-sm font-semibold text-dark-800">{t.step1Title}</h3>
                  <p className="text-[11px] text-dark-400">{t.step1Desc}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {referenceImages.map((img, i) => (
                  <div key={i} className="relative group aspect-square rounded-xl overflow-hidden border-2 border-dark-200">
                    <img src={img} alt={`Ref ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute top-1 right-1 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}

                {referenceImages.length < 3 && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square rounded-xl border-2 border-dashed border-dark-300 flex flex-col items-center justify-center text-dark-400 hover:border-primary-400 hover:text-primary-500 transition-colors"
                  >
                    <Upload className="w-6 h-6 mb-1" />
                    <span className="text-[10px] font-medium">{t.uploadImages}</span>
                  </button>
                )}
              </div>
              <p className="text-[10px] text-dark-400 text-center">{t.uploadHint}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleImageUpload}
                className="hidden"
              />
            </>
          )}

          {/* STEP 2: Description */}
          {step === 2 && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Type className="w-4 h-4 text-primary-500" />
                <div>
                  <h3 className="text-sm font-semibold text-dark-800">{t.step2Title}</h3>
                  <p className="text-[11px] text-dark-400">{t.step2Desc}</p>
                </div>
              </div>

              {/* Image thumbnails preview */}
              <div className="flex gap-2 mb-2">
                {referenceImages.map((img, i) => (
                  <img key={i} src={img} alt="" className="w-12 h-12 rounded-lg object-cover border border-dark-200" />
                ))}
              </div>

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.descPlaceholder}
                rows={5}
                className="w-full text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300"
              />
            </>
          )}

          {/* STEP 3: Style Preferences */}
          {step === 3 && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-4 h-4 text-primary-500" />
                <div>
                  <h3 className="text-sm font-semibold text-dark-800">{t.step3Title}</h3>
                  <p className="text-[11px] text-dark-400">{t.step3Desc}</p>
                </div>
              </div>

              <div className="space-y-3">
                {/* Mood */}
                <div>
                  <label className="text-[11px] font-semibold text-dark-600 uppercase tracking-wide">{t.moodLabel}</label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {MOOD_OPTIONS.map(m => (
                      <button
                        key={m.id}
                        onClick={() => setStylePrefs(prev => ({
                          ...prev,
                          mood: prev.mood === m.id ? '' : m.id
                        }))}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                          stylePrefs.mood === m.id
                            ? 'bg-primary-900/20 text-primary-700 border border-primary-300'
                            : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-200'
                        }`}
                      >
                        {language === 'es' ? m.es : m.en}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Typography */}
                <div>
                  <label className="text-[11px] font-semibold text-dark-600 uppercase tracking-wide">{t.typographyLabel}</label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {TYPOGRAPHY_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setStylePrefs(prev => ({ ...prev, typography: opt.id }))}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                          stylePrefs.typography === opt.id
                            ? 'bg-primary-900/20 text-primary-700 border border-primary-300'
                            : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-200'
                        }`}
                      >
                        {language === 'es' ? opt.es : opt.en}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Layout */}
                <div>
                  <label className="text-[11px] font-semibold text-dark-600 uppercase tracking-wide">{t.layoutLabel}</label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {LAYOUT_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setStylePrefs(prev => ({ ...prev, layoutPreference: opt.id }))}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                          stylePrefs.layoutPreference === opt.id
                            ? 'bg-primary-900/20 text-primary-700 border border-primary-300'
                            : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-200'
                        }`}
                      >
                        {language === 'es' ? opt.es : opt.en}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Brand Colors */}
                <div>
                  <label className="text-[11px] font-semibold text-dark-600 uppercase tracking-wide">{t.brandColorsLabel}</label>
                  <input
                    type="text"
                    value={stylePrefs.brandColors}
                    onChange={(e) => setStylePrefs(prev => ({ ...prev, brandColors: e.target.value }))}
                    placeholder={t.brandColorsPlaceholder}
                    className="w-full mt-1 text-xs bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300"
                  />
                </div>

                {/* Text Language */}
                <div>
                  <label className="text-[11px] font-semibold text-dark-600 uppercase tracking-wide">{t.textLangLabel}</label>
                  <div className="flex gap-1.5 mt-1.5">
                    {['Español', 'English'].map(lang => (
                      <button
                        key={lang}
                        onClick={() => setStylePrefs(prev => ({ ...prev, textLanguage: lang }))}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                          stylePrefs.textLanguage === lang
                            ? 'bg-primary-900/20 text-primary-700 border border-primary-300'
                            : 'bg-dark-50 text-dark-600 border border-transparent hover:bg-dark-200'
                        }`}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Avoid / Must Include */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-semibold text-dark-600 uppercase tracking-wide">{t.avoidLabel}</label>
                    <input
                      type="text"
                      value={stylePrefs.avoidElements}
                      onChange={(e) => setStylePrefs(prev => ({ ...prev, avoidElements: e.target.value }))}
                      placeholder={t.avoidPlaceholder}
                      className="w-full mt-1 text-xs bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-dark-600 uppercase tracking-wide">{t.mustIncludeLabel}</label>
                    <input
                      type="text"
                      value={stylePrefs.mustInclude}
                      onChange={(e) => setStylePrefs(prev => ({ ...prev, mustInclude: e.target.value }))}
                      placeholder={t.mustIncludePlaceholder}
                      className="w-full mt-1 text-xs bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* STEP 4: Review & Save */}
          {step === 4 && analysisResult && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Eye className="w-4 h-4 text-primary-500" />
                <div>
                  <h3 className="text-sm font-semibold text-dark-800">{t.step4Title}</h3>
                  <p className="text-[11px] text-dark-400">{t.step4Desc}</p>
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="text-[11px] font-semibold text-dark-600 uppercase tracking-wide">{t.nameLabel}</label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder={t.namePlaceholder}
                  className="w-full mt-1 text-sm bg-dark-50 text-dark-900 border border-dark-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-300"
                  autoFocus
                />
              </div>

              {/* Reference thumbnails */}
              <div className="flex gap-2">
                {referenceImages.map((img, i) => (
                  <img key={i} src={img} alt="" className="w-16 h-16 rounded-lg object-cover border border-dark-200" />
                ))}
              </div>

              {/* Extracted Colors */}
              {analysisResult.extractedColors.length > 0 && (
                <div>
                  <label className="text-[11px] font-semibold text-dark-600 uppercase tracking-wide">{t.extractedColors}</label>
                  <div className="flex items-center gap-2 mt-1.5">
                    {analysisResult.extractedColors.map((color, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <span className="w-6 h-6 rounded-lg border border-dark-200" style={{ backgroundColor: color }} />
                        <span className="text-[10px] text-dark-500 font-mono">{color}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Generated Prompt Preview */}
              <div>
                <label className="text-[11px] font-semibold text-dark-600 uppercase tracking-wide">{t.generatedPrompt}</label>
                <div className="mt-1.5 p-3 bg-dark-50 rounded-lg border border-dark-200 max-h-40 overflow-y-auto">
                  <p className="text-[11px] text-dark-600 leading-relaxed whitespace-pre-wrap">
                    {language === 'es' ? analysisResult.masterPromptEs : analysisResult.masterPromptEn}
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-900/20 border border-red-700/30 rounded-lg">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-dark-200">
          <button
            onClick={() => step > 1 && !analyzing ? setStep(step - 1) : onClose()}
            disabled={analyzing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-dark-600 hover:bg-dark-200 transition-colors disabled:opacity-50"
          >
            {step > 1 ? (
              <>
                <ChevronLeft className="w-3.5 h-3.5" />
                {t.back}
              </>
            ) : t.close}
          </button>

          {step < 4 ? (
            <button
              onClick={handleNext}
              disabled={!canGoNext() || analyzing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t.analyzing}
                </>
              ) : step === 3 ? (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  {t.analyze}
                </>
              ) : (
                <>
                  {t.next}
                  <ChevronRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving || !customName.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t.saving}
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  {t.save}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
