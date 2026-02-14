import { useState, useRef } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import type { RestaurantFormData } from '../types'
import { supabase } from '../lib/supabase'
import { UtensilsCrossed, Upload, FileText, Loader2, MapPin, Clock, X } from 'lucide-react'

interface RestaurantFormProps {
  onSubmit: (data: RestaurantFormData) => Promise<void>
  onCancel: () => void
  initialData?: Partial<RestaurantFormData>
  isEditing?: boolean
}

export default function RestaurantForm({ onSubmit, onCancel, initialData, isEditing }: RestaurantFormProps) {
  const { language } = useLanguage()
  const [loading, setLoading] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [step, setStep] = useState(1)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pdfFileName, setPdfFileName] = useState<string>('')
  
  const [formData, setFormData] = useState<RestaurantFormData>({
    name: initialData?.name || '',
    type: 'restaurant',
    menu_text: initialData?.menu_text || '',
    menu_pdf_url: initialData?.menu_pdf_url || '',
    location: initialData?.location || '',
    schedule: initialData?.schedule || '',
    is_new_restaurant: initialData?.is_new_restaurant ?? true
  })

  const labels = {
    es: {
      title: isEditing ? 'Editar Restaurante' : 'Nuevo Restaurante',
      subtitle: 'Completa la información de tu restaurante para generar scripts perfectos',
      step: 'Paso',
      of: 'de',
      next: 'Siguiente',
      back: 'Atrás',
      save: isEditing ? 'Guardar Cambios' : 'Crear Restaurante',
      cancel: 'Cancelar',
      questions: {
        name: '¿Cuál es el nombre de tu restaurante?',
        menu: 'Menú del restaurante',
        menuHelp: 'Sube un PDF con tu menú o pega el texto del menú directamente',
        uploadPdf: 'Subir PDF del menú',
        orPasteMenu: 'O pega el texto del menú aquí',
        location: '¿Cuál es la ubicación exacta del restaurante?',
        schedule: '¿Cuál es el horario de atención?',
        isNew: '¿El restaurante es nuevo/poco conocido o ya es conocido?',
        newRestaurant: 'Nuevo / Poco conocido',
        knownRestaurant: 'Ya es conocido'
      },
      placeholders: {
        name: 'Ej: La Porketa',
        menu: 'Pega aquí el menú completo con platillos y precios...',
        location: 'Ej: Central Market Curridabat, local 15',
        schedule: 'Ej: Lunes a Domingo de 11am a 9pm'
      },
      processing: 'Procesando PDF...',
      pdfUploaded: 'PDF cargado correctamente'
    },
    en: {
      title: isEditing ? 'Edit Restaurant' : 'New Restaurant',
      subtitle: 'Complete your restaurant information to generate perfect scripts',
      step: 'Step',
      of: 'of',
      next: 'Next',
      back: 'Back',
      save: isEditing ? 'Save Changes' : 'Create Restaurant',
      cancel: 'Cancel',
      questions: {
        name: 'What is the name of your restaurant?',
        menu: 'Restaurant menu',
        menuHelp: 'Upload a PDF with your menu or paste the menu text directly',
        uploadPdf: 'Upload menu PDF',
        orPasteMenu: 'Or paste the menu text here',
        location: 'What is the exact location of the restaurant?',
        schedule: 'What are the business hours?',
        isNew: 'Is the restaurant new/not well known or already known?',
        newRestaurant: 'New / Not well known',
        knownRestaurant: 'Already known'
      },
      placeholders: {
        name: 'E.g.: La Porketa',
        menu: 'Paste the complete menu with dishes and prices here...',
        location: 'E.g.: Central Market Curridabat, local 15',
        schedule: 'E.g.: Monday to Sunday 11am to 9pm'
      },
      processing: 'Processing PDF...',
      pdfUploaded: 'PDF uploaded successfully'
    }
  }

  const t = labels[language]
  const totalSteps = 3

  const handleChange = (field: keyof RestaurantFormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.type !== 'application/pdf') {
      alert(language === 'es' ? 'Por favor sube un archivo PDF' : 'Please upload a PDF file')
      return
    }

    setPdfLoading(true)
    setPdfFileName(file.name)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const formDataUpload = new FormData()
      formDataUpload.append('file', file)

      const parsePdfUrl = import.meta.env.PROD ? '/api/parse-pdf' : 'http://localhost:3000/api/parse-pdf'
      const response = await fetch(parsePdfUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formDataUpload
      })

      if (!response.ok) {
        throw new Error('Failed to parse PDF')
      }

      const data = await response.json()
      setFormData(prev => ({
        ...prev,
        menu_text: data.text,
        menu_pdf_url: data.url || ''
      }))
    } catch (error) {
      console.error('Error parsing PDF:', error)
      alert(language === 'es' ? 'Error al procesar el PDF. Por favor pega el menú manualmente.' : 'Error processing PDF. Please paste the menu manually.')
    } finally {
      setPdfLoading(false)
    }
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
        return formData.name.trim()
      case 2:
        return formData.menu_text.trim()
      case 3:
        return formData.location.trim() && formData.schedule.trim()
      default:
        return true
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-dark-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
              <UtensilsCrossed className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-dark-900">{t.title}</h2>
              <p className="text-dark-500 text-sm">{t.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            {[...Array(totalSteps)].map((_, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full transition-colors ${
                  i + 1 <= step ? 'bg-orange-500' : 'bg-dark-100'
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
                  {t.questions.isNew}
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => handleChange('is_new_restaurant', true)}
                    className={`p-4 rounded-xl border-2 transition-all text-left ${
                      formData.is_new_restaurant
                        ? 'border-orange-500 bg-orange-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <span className={`font-medium ${formData.is_new_restaurant ? 'text-orange-600' : 'text-dark-600'}`}>
                      {t.questions.newRestaurant}
                    </span>
                    <p className="text-xs text-dark-400 mt-1">
                      {language === 'es' 
                        ? 'Los scripts incluirán ubicación en el gancho'
                        : 'Scripts will include location in the hook'}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChange('is_new_restaurant', false)}
                    className={`p-4 rounded-xl border-2 transition-all text-left ${
                      !formData.is_new_restaurant
                        ? 'border-orange-500 bg-orange-50'
                        : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <span className={`font-medium ${!formData.is_new_restaurant ? 'text-orange-600' : 'text-dark-600'}`}>
                      {t.questions.knownRestaurant}
                    </span>
                    <p className="text-xs text-dark-400 mt-1">
                      {language === 'es'
                        ? 'Ubicación solo al final del script'
                        : 'Location only at the end of script'}
                    </p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  {t.questions.menu}
                </label>
                <p className="text-sm text-dark-400 mb-4">{t.questions.menuHelp}</p>

                {/* PDF Upload */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  onChange={handlePdfUpload}
                  className="hidden"
                />
                
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={pdfLoading}
                  className={`w-full p-4 border-2 border-dashed rounded-xl transition-all flex items-center justify-center gap-3 ${
                    pdfFileName 
                      ? 'border-green-400 bg-green-50' 
                      : 'border-dark-200 hover:border-orange-400 hover:bg-orange-50'
                  }`}
                >
                  {pdfLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                      <span className="text-dark-600">{t.processing}</span>
                    </>
                  ) : pdfFileName ? (
                    <>
                      <FileText className="w-5 h-5 text-green-600" />
                      <span className="text-green-600">{pdfFileName}</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation()
                          setPdfFileName('')
                          setFormData(prev => ({ ...prev, menu_text: '', menu_pdf_url: '' }))
                        }}
                        className="ml-2 text-dark-400 hover:text-dark-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5 text-dark-400" />
                      <span className="text-dark-600">{t.questions.uploadPdf}</span>
                    </>
                  )}
                </button>

                {/* Text input */}
                <p className="text-sm text-dark-400 mt-4 mb-2">{t.questions.orPasteMenu}</p>
                <textarea
                  value={formData.menu_text}
                  onChange={(e) => handleChange('menu_text', e.target.value)}
                  placeholder={t.placeholders.menu}
                  className="input-field min-h-[200px] font-mono text-sm"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-orange-500" />
                  {t.questions.location}
                </label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => handleChange('location', e.target.value)}
                  placeholder={t.placeholders.location}
                  className="input-field"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-orange-500" />
                  {t.questions.schedule}
                </label>
                <input
                  type="text"
                  value={formData.schedule}
                  onChange={(e) => handleChange('schedule', e.target.value)}
                  placeholder={t.placeholders.schedule}
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
              className="btn-primary bg-orange-500 hover:bg-orange-600"
            >
              {t.next}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canProceed() || loading}
              className="btn-primary bg-orange-500 hover:bg-orange-600 flex items-center gap-2"
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
