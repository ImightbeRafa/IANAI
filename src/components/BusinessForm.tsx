import { useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import type { BusinessFormData, TargetAudienceFormData, SalesChannel, GeographicScope } from '../types'
import { Store, Truck, Plus, Trash2, Loader2, MessageSquare, Globe, X } from 'lucide-react'
import AutoFillButtons from './AutoFillButtons'

interface BusinessFormProps {
  onSubmit: (data: BusinessFormData) => Promise<void>
  onCancel: () => void
  initialData?: Partial<BusinessFormData>
  isEditing?: boolean
}

const EMPTY_AUDIENCE: TargetAudienceFormData = {
  sex: 'both',
  age_min: 18,
  age_max: 65,
  geographic_scope: 'country',
  has_specific_profession: false,
}

export default function BusinessForm({ onSubmit, onCancel, initialData, isEditing }: BusinessFormProps) {
  const { language } = useLanguage()
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState<BusinessFormData>({
    name: initialData?.name || '',
    sales_channels: initialData?.sales_channels || [],
    location: initialData?.location || '',
    does_shipping: initialData?.does_shipping ?? false,
    shipping_method: initialData?.shipping_method || '',
    target_audiences: initialData?.target_audiences?.length
      ? initialData.target_audiences
      : [{ ...EMPTY_AUDIENCE }],
  })

  const labels = {
    es: {
      title: isEditing ? 'Editar Negocio' : 'Nuevo Negocio',
      subtitle: 'Configura la información de tu negocio para generar mejores scripts',
      step: 'Paso',
      of: 'de',
      next: 'Siguiente',
      back: 'Atrás',
      save: isEditing ? 'Guardar' : 'Crear Negocio',
      cancel: 'Cancelar',
      // Section 1
      s1Title: 'Información General',
      businessName: 'Nombre del Negocio',
      businessNamePlaceholder: 'Ej: Clínica Vargas',
      // Section 2
      s2Title: '¿Por dónde quieres vender?',
      channelPhysical: 'Local físico',
      channelMessages: 'Venta por mensajes',
      channelMessagesHint: 'Recomendado para inmobiliaria',
      channelWebsite: 'Página web',
      // Section 3
      s3Title: 'Información Operativa',
      locationLabel: 'Ubicación exacta del negocio',
      locationPlaceholder: 'Ej: Escazú, San José, Costa Rica',
      locationHint: 'Solo se usa si vendes en local físico o solo a cercanías',
      shippingLabel: '¿Realiza envíos?',
      yes: 'Sí',
      no: 'No',
      shippingMethodLabel: '¿Cómo realiza los envíos?',
      shippingMethodPlaceholder: 'Ej: Correos, Uber Flash, envíos nacionales',
      // Section 4
      s4Title: 'Público Objetivo',
      audienceNumber: 'Público',
      addAudience: 'Agregar otro público',
      removeAudience: 'Eliminar',
      sexLabel: 'Sexo',
      sexMale: 'Masculino',
      sexFemale: 'Femenino',
      sexBoth: 'Ambos',
      ageLabel: 'Rango de edad',
      geoLabel: 'Alcance geográfico',
      geoLocal: 'Solo mi ciudad / cercanías',
      geoCountry: 'Todo mi país',
      geoWorld: 'Todo el mundo',
      geoCustom: 'Especificar manualmente',
      geoCustomPlaceholder: 'Ej: Latinoamérica, España, USA',
      professionLabel: '¿Se dedica a algo en particular?',
      professionNo: 'Nada en particular',
      professionYes: 'Sí',
      professionPlaceholder: 'Ej: Médicos, Abogados, Dueños de negocio',
    },
    en: {
      title: isEditing ? 'Edit Business' : 'New Business',
      subtitle: 'Configure your business info to generate better scripts',
      step: 'Step',
      of: 'of',
      next: 'Next',
      back: 'Back',
      save: isEditing ? 'Save' : 'Create Business',
      cancel: 'Cancel',
      s1Title: 'General Information',
      businessName: 'Business Name',
      businessNamePlaceholder: 'E.g.: Vargas Clinic',
      s2Title: 'Where do you want to sell?',
      channelPhysical: 'Physical store',
      channelMessages: 'Sales via messages',
      channelMessagesHint: 'Recommended for real estate',
      channelWebsite: 'Website',
      s3Title: 'Operational Information',
      locationLabel: 'Exact business location',
      locationPlaceholder: 'E.g.: Escazu, San Jose, Costa Rica',
      locationHint: 'Only used if you sell in-store or to nearby areas',
      shippingLabel: 'Do you offer shipping?',
      yes: 'Yes',
      no: 'No',
      shippingMethodLabel: 'How do you ship?',
      shippingMethodPlaceholder: 'E.g.: USPS, FedEx, local delivery',
      s4Title: 'Target Audience',
      audienceNumber: 'Audience',
      addAudience: 'Add another audience',
      removeAudience: 'Remove',
      sexLabel: 'Sex',
      sexMale: 'Male',
      sexFemale: 'Female',
      sexBoth: 'Both',
      ageLabel: 'Age range',
      geoLabel: 'Geographic scope',
      geoLocal: 'My city / nearby only',
      geoCountry: 'My whole country',
      geoWorld: 'Worldwide',
      geoCustom: 'Specify manually',
      geoCustomPlaceholder: 'E.g.: Latin America, Spain, USA',
      professionLabel: 'Do they have a specific profession?',
      professionNo: 'Nothing specific',
      professionYes: 'Yes',
      professionPlaceholder: 'E.g.: Doctors, Lawyers, Business owners',
    },
  }

  const t = labels[language]
  const totalSteps = 4

  const toggleChannel = (channel: SalesChannel) => {
    setFormData(prev => ({
      ...prev,
      sales_channels: prev.sales_channels.includes(channel)
        ? prev.sales_channels.filter(c => c !== channel)
        : [...prev.sales_channels, channel],
    }))
  }

  const updateAudience = (idx: number, field: keyof TargetAudienceFormData, value: unknown) => {
    setFormData(prev => ({
      ...prev,
      target_audiences: prev.target_audiences.map((a, i) =>
        i === idx ? { ...a, [field]: value } : a
      ),
    }))
  }

  const addAudience = () => {
    setFormData(prev => ({
      ...prev,
      target_audiences: [...prev.target_audiences, { ...EMPTY_AUDIENCE }],
    }))
  }

  const removeAudience = (idx: number) => {
    if (formData.target_audiences.length <= 1) return
    setFormData(prev => ({
      ...prev,
      target_audiences: prev.target_audiences.filter((_, i) => i !== idx),
    }))
  }

  const canProceed = () => {
    switch (step) {
      case 1: return formData.name.trim().length > 0
      case 2: return formData.sales_channels.length > 0
      case 3: return true
      case 4: return formData.target_audiences.length > 0
      default: return true
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

  const channelButton = (channel: SalesChannel, icon: React.ReactNode, label: string, hint?: string) => {
    const active = formData.sales_channels.includes(channel)
    return (
      <button
        type="button"
        onClick={() => toggleChannel(channel)}
        className={`p-4 rounded-xl border-2 transition-all text-left flex items-start gap-3 ${
          active ? 'border-primary-600 bg-primary-900/20' : 'border-dark-200 hover:border-dark-300'
        }`}
      >
        <div className={`mt-0.5 ${active ? 'text-primary-600' : 'text-dark-400'}`}>{icon}</div>
        <div>
          <span className={`font-medium ${active ? 'text-primary-600' : 'text-dark-600'}`}>{label}</span>
          {hint && <p className="text-xs text-dark-400 mt-0.5">{hint}</p>}
        </div>
      </button>
    )
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
            <button onClick={onCancel} className="p-2 hover:bg-dark-200 rounded-lg transition-colors">
              <X className="w-5 h-5 text-dark-400" />
            </button>
          </div>
          <div className="flex items-center gap-2 mt-4">
            {[...Array(totalSteps)].map((_, i) => (
              <div key={i} className={`h-2 flex-1 rounded-full transition-colors ${i + 1 <= step ? 'bg-primary-600' : 'bg-dark-100'}`} />
            ))}
          </div>
          <p className="text-sm text-dark-400 mt-2">{t.step} {step} {t.of} {totalSteps}</p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Business Name */}
          {step === 1 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-dark-900">{t.s1Title}</h3>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">{t.businessName}</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder={t.businessNamePlaceholder}
                  className="input-field"
                  autoFocus
                />
              </div>
              <AutoFillButtons
                formType="business"
                language={language}
                onResult={(data) => {
                  const channels: SalesChannel[] = []
                  if (Array.isArray(data.sales_channels)) {
                    for (const ch of data.sales_channels) {
                      if (['physical', 'messages', 'website'].includes(ch as string)) channels.push(ch as SalesChannel)
                    }
                  }
                  setFormData(prev => ({
                    ...prev,
                    name: (data.name as string) || prev.name,
                    sales_channels: channels.length > 0 ? channels : prev.sales_channels,
                    location: (data.location as string) || prev.location,
                    does_shipping: typeof data.does_shipping === 'boolean' ? data.does_shipping : prev.does_shipping,
                    shipping_method: (data.shipping_method as string) || prev.shipping_method,
                    target_audiences: [{
                      sex: (['male', 'female', 'both'].includes(data.audience_sex as string) ? data.audience_sex : prev.target_audiences[0]?.sex || 'both') as 'male' | 'female' | 'both',
                      age_min: typeof data.audience_age_min === 'number' ? data.audience_age_min : prev.target_audiences[0]?.age_min || 18,
                      age_max: typeof data.audience_age_max === 'number' ? data.audience_age_max : prev.target_audiences[0]?.age_max || 65,
                      geographic_scope: (['local', 'country', 'world'].includes(data.audience_geographic_scope as string) ? data.audience_geographic_scope : prev.target_audiences[0]?.geographic_scope || 'country') as GeographicScope,
                      has_specific_profession: !!(data.audience_profession as string)?.trim(),
                      profession_description: (data.audience_profession as string) || '',
                    }],
                  }))
                  setStep(2)
                }}
              />
            </div>
          )}

          {/* Step 2: Sales Channels */}
          {step === 2 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-dark-900">{t.s2Title}</h3>
              <div className="space-y-3">
                {channelButton('physical', <Store className="w-5 h-5" />, t.channelPhysical)}
                {channelButton('messages', <MessageSquare className="w-5 h-5" />, t.channelMessages, t.channelMessagesHint)}
                {channelButton('website', <Globe className="w-5 h-5" />, t.channelWebsite)}
              </div>
            </div>
          )}

          {/* Step 3: Operational Info */}
          {step === 3 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-dark-900">{t.s3Title}</h3>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">{t.locationLabel}</label>
                <input
                  type="text"
                  value={formData.location || ''}
                  onChange={e => setFormData(prev => ({ ...prev, location: e.target.value }))}
                  placeholder={t.locationPlaceholder}
                  className="input-field"
                />
                <p className="text-xs text-dark-400 mt-1">{t.locationHint}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.shippingLabel}</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, does_shipping: true }))}
                    className={`p-4 rounded-xl border-2 transition-all flex items-center justify-center gap-2 ${
                      formData.does_shipping ? 'border-primary-600 bg-primary-900/20' : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <Truck className={`w-5 h-5 ${formData.does_shipping ? 'text-primary-600' : 'text-dark-400'}`} />
                    <span className={`font-medium ${formData.does_shipping ? 'text-primary-600' : 'text-dark-600'}`}>{t.yes}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, does_shipping: false, shipping_method: '' }))}
                    className={`p-4 rounded-xl border-2 transition-all flex items-center justify-center gap-2 ${
                      !formData.does_shipping ? 'border-primary-600 bg-primary-900/20' : 'border-dark-200 hover:border-dark-300'
                    }`}
                  >
                    <span className={`font-medium ${!formData.does_shipping ? 'text-primary-600' : 'text-dark-600'}`}>{t.no}</span>
                  </button>
                </div>
              </div>

              {formData.does_shipping && (
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">{t.shippingMethodLabel}</label>
                  <input
                    type="text"
                    value={formData.shipping_method || ''}
                    onChange={e => setFormData(prev => ({ ...prev, shipping_method: e.target.value }))}
                    placeholder={t.shippingMethodPlaceholder}
                    className="input-field"
                  />
                </div>
              )}
            </div>
          )}

          {/* Step 4: Target Audiences */}
          {step === 4 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-dark-900">{t.s4Title}</h3>

              {formData.target_audiences.map((audience, idx) => (
                <div key={idx} className="p-4 bg-dark-50 rounded-xl space-y-4 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-dark-700">{t.audienceNumber} #{idx + 1}</span>
                    {formData.target_audiences.length > 1 && (
                      <button type="button" onClick={() => removeAudience(idx)} className="text-xs text-red-500 hover:text-red-400 flex items-center gap-1">
                        <Trash2 className="w-3 h-3" /> {t.removeAudience}
                      </button>
                    )}
                  </div>

                  {/* Sex */}
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-2">{t.sexLabel}</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['male', 'female', 'both'] as const).map(sex => (
                        <button
                          key={sex}
                          type="button"
                          onClick={() => updateAudience(idx, 'sex', sex)}
                          className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                            audience.sex === sex ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'
                          }`}
                        >
                          {sex === 'male' ? t.sexMale : sex === 'female' ? t.sexFemale : t.sexBoth}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Age Range */}
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-2">
                      {t.ageLabel}: {audience.age_min} - {audience.age_max}
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={13}
                        max={80}
                        value={audience.age_min}
                        onChange={e => {
                          const val = Number(e.target.value)
                          if (val < audience.age_max) updateAudience(idx, 'age_min', val)
                        }}
                        className="flex-1 accent-primary-600"
                      />
                      <input
                        type="range"
                        min={13}
                        max={80}
                        value={audience.age_max}
                        onChange={e => {
                          const val = Number(e.target.value)
                          if (val > audience.age_min) updateAudience(idx, 'age_max', val)
                        }}
                        className="flex-1 accent-primary-600"
                      />
                    </div>
                  </div>

                  {/* Geographic Scope */}
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-2">{t.geoLabel}</label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { val: 'local' as GeographicScope, label: t.geoLocal },
                        { val: 'country' as GeographicScope, label: t.geoCountry },
                        { val: 'world' as GeographicScope, label: t.geoWorld },
                        { val: 'custom' as GeographicScope, label: t.geoCustom },
                      ]).map(({ val, label }) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => updateAudience(idx, 'geographic_scope', val)}
                          className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all text-left ${
                            audience.geographic_scope === val ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {audience.geographic_scope === 'custom' && (
                      <input
                        type="text"
                        value={audience.geographic_scope_custom || ''}
                        onChange={e => updateAudience(idx, 'geographic_scope_custom', e.target.value)}
                        placeholder={t.geoCustomPlaceholder}
                        className="input-field mt-2"
                      />
                    )}
                  </div>

                  {/* Profession */}
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-2">{t.professionLabel}</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => updateAudience(idx, 'has_specific_profession', false)}
                        className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                          !audience.has_specific_profession ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'
                        }`}
                      >
                        {t.professionNo}
                      </button>
                      <button
                        type="button"
                        onClick={() => updateAudience(idx, 'has_specific_profession', true)}
                        className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                          audience.has_specific_profession ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'
                        }`}
                      >
                        {t.professionYes}
                      </button>
                    </div>
                    {audience.has_specific_profession && (
                      <input
                        type="text"
                        value={audience.profession_description || ''}
                        onChange={e => updateAudience(idx, 'profession_description', e.target.value)}
                        placeholder={t.professionPlaceholder}
                        className="input-field mt-2"
                      />
                    )}
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addAudience}
                className="w-full p-3 border-2 border-dashed border-dark-200 hover:border-primary-400 rounded-xl text-sm font-medium text-dark-500 hover:text-primary-600 transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> {t.addAudience}
              </button>
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
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {t.save}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
