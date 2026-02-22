import { useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import type { NewServiceFormData, SuccessCaseFormData, ServiceFormat } from '../types'
import { Loader2, X, Plus, Trash2, Link2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import AutoFillButtons from './AutoFillButtons'

interface ServiceFormProps {
  onSubmit: (data: NewServiceFormData) => Promise<void>
  onCancel: () => void
  businessId: string
  initialData?: Partial<NewServiceFormData>
  isEditing?: boolean
}

const SERVICE_TYPES = [
  'consultoria', 'mentoria', 'profesional', 'agencia', 'salud_estetica', 'educacion', 'tecnico', 'otro'
] as const

const EMPTY_CASE: SuccessCaseFormData = {
  client_name: '', before_state: '', what_they_did: '', result: '', timeline: '', life_change: ''
}

export default function ServiceForm({ onSubmit, onCancel, businessId, initialData, isEditing }: ServiceFormProps) {
  const { language } = useLanguage()
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [linkInput, setLinkInput] = useState('')
  const [scrapingLinks, setScrapingLinks] = useState(false)
  const [linkErrors, setLinkErrors] = useState<string[]>([])

  const [formData, setFormData] = useState<NewServiceFormData>({
    name: initialData?.name || '',
    type: 'service',
    business_id: businessId,
    svc_service_type: initialData?.svc_service_type || '',
    svc_service_type_custom: initialData?.svc_service_type_custom || '',
    svc_problem: initialData?.svc_problem || '',
    svc_current_pain: initialData?.svc_current_pain || '',
    svc_alternatives_tried: initialData?.svc_alternatives_tried || '',
    svc_alternatives_failures: initialData?.svc_alternatives_failures || '',
    svc_concrete_result: initialData?.svc_concrete_result || '',
    svc_result_timeline: initialData?.svc_result_timeline || '',
    svc_life_change: initialData?.svc_life_change || '',
    svc_process_steps: initialData?.svc_process_steps || '',
    svc_service_format: initialData?.svc_service_format || 'one_on_one',
    svc_service_duration: initialData?.svc_service_duration || '',
    svc_differentiation: initialData?.svc_differentiation || '',
    svc_has_own_method: initialData?.svc_has_own_method ?? false,
    svc_method_name: initialData?.svc_method_name || '',
    svc_main_objection: initialData?.svc_main_objection || '',
    svc_has_guarantee: initialData?.svc_has_guarantee ?? false,
    svc_guarantee_details: initialData?.svc_guarantee_details || '',
    svc_has_success_cases: initialData?.svc_has_success_cases ?? false,
    success_cases: initialData?.success_cases || [],
    context_links: initialData?.context_links || [],
    context_links_content: initialData?.context_links_content || '',
  })

  const labels = {
    es: {
      title: isEditing ? 'Editar Servicio' : 'Nuevo Servicio',
      subtitle: 'Completa la información de tu servicio',
      step: 'Paso', of: 'de', next: 'Siguiente', back: 'Atrás',
      save: isEditing ? 'Guardar' : 'Crear Servicio', cancel: 'Cancelar',
      yes: 'Sí', no: 'No',
      // S1
      serviceName: 'Nombre del servicio', serviceNamePh: 'Ej: Programa Transformación 90 Días',
      serviceType: '¿Qué tipo de servicio es?',
      types: { consultoria: 'Consultoría', mentoria: 'Mentoría', profesional: 'Servicio profesional', agencia: 'Agencia', salud_estetica: 'Salud / estética', educacion: 'Educación / curso', tecnico: 'Técnico / instalación', otro: 'Otro' },
      typeCustomPh: 'Especifica el tipo...',
      // S2
      problemLabel: '¿Qué problema específico resuelve tu servicio?',
      problemPh: 'Ej: Dueños de negocio que no logran generar clientes constantes en redes.',
      painLabel: '¿Qué está pasando hoy en la vida de tu cliente por culpa de ese problema?',
      painPh: 'Ej: No tiene ingresos constantes, depende del boca a boca…',
      // S3
      altTriedLabel: '¿Qué intenta hacer hoy la gente para resolver ese problema?',
      altTriedPh: 'Ej: Hacen cursos, contratan freelancers, prueban anuncios solos…',
      altFailLabel: '¿Por qué esas soluciones no funcionan o no son suficientes?',
      altFailPh: 'Ej: No tienen estrategia, no hay seguimiento…',
      // S4
      resultLabel: '¿Qué resultado concreto obtiene alguien después de trabajar contigo?',
      resultPh: 'Ej: Genera clientes constantes todas las semanas.',
      timelineLabel: '¿En cuánto tiempo puede ver resultados?',
      timelinePh: 'Ej: 30 días / 3 meses',
      lifeChangeLabel: '¿Qué cambia en su vida o negocio después del resultado?',
      lifeChangePh: 'Ej: Tiene ingresos estables y tranquilidad.',
      // S5
      processLabel: '¿Cómo funciona tu servicio? (paso a paso resumido)',
      processPh: 'Ej: Diagnóstico → Estrategia → Implementación → Seguimiento.',
      formatLabel: '¿Es un servicio 1 a 1, grupal o automatizado?',
      formats: { one_on_one: '1 a 1', group: 'Grupal', automated: 'Automatizado', mixed: 'Mixto' },
      durationLabel: '¿Cuánto dura el servicio?',
      durationPh: 'Ej: 3 meses',
      // S6
      diffLabel: '¿Qué hace que tu servicio sea diferente al resto?',
      diffPh: 'Ej: Seguimiento semanal personalizado.',
      methodLabel: '¿Tienes un método o sistema propio?',
      methodNamePh: 'Nombre del método',
      // S7
      objectionLabel: '¿Cuál es la principal objeción antes de contratarte?',
      objectionPh: 'Ej: Es caro, no sé si funcione…',
      guaranteeLabel: '¿Ofreces algún tipo de garantía o respaldo?',
      guaranteePh: 'Ej: Garantía de satisfacción 30 días',
      // S8
      casesLabel: '¿Tienes casos de éxito?',
      addCase: 'Agregar caso de éxito',
      removeCase: 'Eliminar',
      caseName: 'Nombre (opcional)', caseNamePh: 'Ej: Juan Pérez',
      caseBefore: '¿Cómo estaba antes?', caseBeforePh: 'Ej: No tenía clientes…',
      caseDid: '¿Qué hizo contigo?', caseDidPh: 'Ej: Implementó el sistema…',
      caseResult: '¿Qué resultado obtuvo?', caseResultPh: 'Ej: 20 clientes nuevos al mes',
      caseTimeline: '¿En cuánto tiempo?', caseTimelinePh: 'Ej: 2 meses',
      caseChange: '¿Qué cambió en su vida?', caseChangePh: 'Ej: Tiene estabilidad económica…',
      // Links
      linksTitle: 'Enlaces de Referencia', linksSubtitle: 'Agrega enlaces relevantes',
      linksPh: 'Pega enlaces (uno por línea)', linksAdd: 'Agregar', linksOptional: 'Opcional',
    },
    en: {
      title: isEditing ? 'Edit Service' : 'New Service',
      subtitle: 'Complete your service information',
      step: 'Step', of: 'of', next: 'Next', back: 'Back',
      save: isEditing ? 'Save' : 'Create Service', cancel: 'Cancel',
      yes: 'Yes', no: 'No',
      serviceName: 'Service name', serviceNamePh: 'E.g.: 90-Day Transformation Program',
      serviceType: 'What type of service is it?',
      types: { consultoria: 'Consulting', mentoria: 'Mentoring', profesional: 'Professional service', agencia: 'Agency', salud_estetica: 'Health / aesthetics', educacion: 'Education / course', tecnico: 'Technical / installation', otro: 'Other' },
      typeCustomPh: 'Specify type...',
      problemLabel: 'What specific problem does your service solve?',
      problemPh: 'E.g.: Business owners who can\'t generate consistent clients on social media.',
      painLabel: 'What\'s happening in your client\'s life because of this problem?',
      painPh: 'E.g.: No consistent income, depends on word of mouth…',
      altTriedLabel: 'What do people try today to solve this problem?',
      altTriedPh: 'E.g.: Take courses, hire freelancers, try ads alone…',
      altFailLabel: 'Why don\'t those solutions work?',
      altFailPh: 'E.g.: No strategy, no follow-up…',
      resultLabel: 'What concrete result does someone get after working with you?',
      resultPh: 'E.g.: Generates consistent clients every week.',
      timelineLabel: 'How soon can they see results?',
      timelinePh: 'E.g.: 30 days / 3 months',
      lifeChangeLabel: 'What changes in their life/business after the result?',
      lifeChangePh: 'E.g.: Stable income and peace of mind.',
      processLabel: 'How does your service work? (step by step summary)',
      processPh: 'E.g.: Diagnosis → Strategy → Implementation → Follow-up.',
      formatLabel: 'Is it 1-on-1, group, or automated?',
      formats: { one_on_one: '1-on-1', group: 'Group', automated: 'Automated', mixed: 'Mixed' },
      durationLabel: 'How long does the service last?',
      durationPh: 'E.g.: 3 months',
      diffLabel: 'What makes your service different from the rest?',
      diffPh: 'E.g.: Weekly personalized follow-up.',
      methodLabel: 'Do you have your own method or system?',
      methodNamePh: 'Method name',
      objectionLabel: 'What\'s the main objection before hiring you?',
      objectionPh: 'E.g.: It\'s expensive, not sure if it works…',
      guaranteeLabel: 'Do you offer any guarantee?',
      guaranteePh: 'E.g.: 30-day satisfaction guarantee',
      casesLabel: 'Do you have success cases?',
      addCase: 'Add success case',
      removeCase: 'Remove',
      caseName: 'Name (optional)', caseNamePh: 'E.g.: John Smith',
      caseBefore: 'How were they before?', caseBeforePh: 'E.g.: Had no clients…',
      caseDid: 'What did they do with you?', caseDidPh: 'E.g.: Implemented the system…',
      caseResult: 'What result did they get?', caseResultPh: 'E.g.: 20 new clients/month',
      caseTimeline: 'In how long?', caseTimelinePh: 'E.g.: 2 months',
      caseChange: 'What changed in their life?', caseChangePh: 'E.g.: Financial stability…',
      linksTitle: 'Reference Links', linksSubtitle: 'Add relevant links',
      linksPh: 'Paste links (one per line)', linksAdd: 'Add', linksOptional: 'Optional',
    },
  }
  const t = labels[language]
  const totalSteps = 8

  const handleChange = (field: keyof NewServiceFormData, value: unknown) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const updateCase = (idx: number, field: keyof SuccessCaseFormData, value: string) => {
    setFormData(prev => ({
      ...prev,
      success_cases: (prev.success_cases || []).map((c, i) => i === idx ? { ...c, [field]: value } : c),
    }))
  }

  const addCase = () => setFormData(prev => ({ ...prev, success_cases: [...(prev.success_cases || []), { ...EMPTY_CASE }] }))
  const removeCase = (idx: number) => setFormData(prev => ({ ...prev, success_cases: (prev.success_cases || []).filter((_, i) => i !== idx) }))

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
    } catch (err) { console.error('Failed to scrape links:', err) }
    finally { setScrapingLinks(false); setLinkInput('') }
  }

  const handleRemoveLink = (url: string) => setFormData(prev => ({ ...prev, context_links: (prev.context_links || []).filter(l => l !== url) }))

  const handleSubmit = async () => {
    setLoading(true)
    try { await onSubmit(formData) } finally { setLoading(false) }
  }

  const canProceed = () => {
    switch (step) {
      case 1: return formData.name.trim() && formData.svc_service_type
      case 2: return formData.svc_problem.trim() && formData.svc_current_pain.trim()
      case 3: return formData.svc_alternatives_tried.trim() && formData.svc_alternatives_failures.trim()
      case 4: return formData.svc_concrete_result.trim() && formData.svc_result_timeline.trim() && formData.svc_life_change.trim()
      case 5: return formData.svc_process_steps.trim() && formData.svc_service_duration.trim()
      case 6: return formData.svc_differentiation.trim()
      case 7: return formData.svc_main_objection.trim()
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
          {/* S1: Identity */}
          {step === 1 && (
            <div className="space-y-6">
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.serviceName}</label><input type="text" value={formData.name} onChange={e => handleChange('name', e.target.value)} placeholder={t.serviceNamePh} className="input-field" autoFocus /></div>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.serviceType}</label>
                <div className="grid grid-cols-2 gap-2">
                  {SERVICE_TYPES.map(st => (
                    <button key={st} type="button" onClick={() => handleChange('svc_service_type', st)}
                      className={`p-3 rounded-xl border-2 transition-all text-sm font-medium text-left ${formData.svc_service_type === st ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'}`}>
                      {(t.types as Record<string, string>)[st]}
                    </button>
                  ))}
                </div>
                {formData.svc_service_type === 'otro' && <input type="text" value={formData.svc_service_type_custom || ''} onChange={e => handleChange('svc_service_type_custom', e.target.value)} placeholder={t.typeCustomPh} className="input-field mt-3" />}
              </div>
              <AutoFillButtons
                formType="service"
                language={language}
                onResult={(data) => {
                  const updates: Partial<NewServiceFormData> = {}
                  const stringFields: (keyof NewServiceFormData)[] = ['name', 'svc_service_type', 'svc_problem', 'svc_current_pain', 'svc_alternatives_tried', 'svc_alternatives_failures', 'svc_concrete_result', 'svc_result_timeline', 'svc_life_change', 'svc_process_steps', 'svc_service_duration', 'svc_differentiation', 'svc_main_objection']
                  for (const key of stringFields) {
                    if (typeof data[key] === 'string' && (data[key] as string).trim()) {
                      (updates as Record<string, unknown>)[key] = data[key]
                    }
                  }
                  if (typeof data.svc_service_format === 'string' && ['one_on_one', 'group', 'automated', 'mixed'].includes(data.svc_service_format)) {
                    updates.svc_service_format = data.svc_service_format as ServiceFormat
                  }
                  setFormData(prev => ({ ...prev, ...updates }))
                  setStep(2)
                }}
              />
            </div>
          )}

          {/* S2: Problem */}
          {step === 2 && (
            <div className="space-y-6">
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.problemLabel}</label><textarea value={formData.svc_problem} onChange={e => handleChange('svc_problem', e.target.value)} placeholder={t.problemPh} className="input-field min-h-[100px]" autoFocus /></div>
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.painLabel}</label><textarea value={formData.svc_current_pain} onChange={e => handleChange('svc_current_pain', e.target.value)} placeholder={t.painPh} className="input-field min-h-[100px]" /></div>
            </div>
          )}

          {/* S3: Alternatives */}
          {step === 3 && (
            <div className="space-y-6">
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.altTriedLabel}</label><textarea value={formData.svc_alternatives_tried} onChange={e => handleChange('svc_alternatives_tried', e.target.value)} placeholder={t.altTriedPh} className="input-field min-h-[100px]" autoFocus /></div>
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.altFailLabel}</label><textarea value={formData.svc_alternatives_failures} onChange={e => handleChange('svc_alternatives_failures', e.target.value)} placeholder={t.altFailPh} className="input-field min-h-[100px]" /></div>
            </div>
          )}

          {/* S4: Transformation */}
          {step === 4 && (
            <div className="space-y-6">
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.resultLabel}</label><textarea value={formData.svc_concrete_result} onChange={e => handleChange('svc_concrete_result', e.target.value)} placeholder={t.resultPh} className="input-field min-h-[80px]" autoFocus /></div>
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.timelineLabel}</label><input type="text" value={formData.svc_result_timeline} onChange={e => handleChange('svc_result_timeline', e.target.value)} placeholder={t.timelinePh} className="input-field" /></div>
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.lifeChangeLabel}</label><textarea value={formData.svc_life_change} onChange={e => handleChange('svc_life_change', e.target.value)} placeholder={t.lifeChangePh} className="input-field min-h-[80px]" /></div>
            </div>
          )}

          {/* S5: Process */}
          {step === 5 && (
            <div className="space-y-6">
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.processLabel}</label><textarea value={formData.svc_process_steps} onChange={e => handleChange('svc_process_steps', e.target.value)} placeholder={t.processPh} className="input-field min-h-[100px]" autoFocus /></div>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.formatLabel}</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['one_on_one', 'group', 'automated', 'mixed'] as ServiceFormat[]).map(f => (
                    <button key={f} type="button" onClick={() => handleChange('svc_service_format', f)}
                      className={`p-3 rounded-xl border-2 transition-all text-sm font-medium ${formData.svc_service_format === f ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500 hover:border-dark-300'}`}>
                      {(t.formats as Record<string, string>)[f]}
                    </button>
                  ))}
                </div>
              </div>
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.durationLabel}</label><input type="text" value={formData.svc_service_duration} onChange={e => handleChange('svc_service_duration', e.target.value)} placeholder={t.durationPh} className="input-field" /></div>
            </div>
          )}

          {/* S6: Differentiation */}
          {step === 6 && (
            <div className="space-y-6">
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.diffLabel}</label><textarea value={formData.svc_differentiation} onChange={e => handleChange('svc_differentiation', e.target.value)} placeholder={t.diffPh} className="input-field min-h-[100px]" autoFocus /></div>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.methodLabel}</label>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => handleChange('svc_has_own_method', true)} className={`p-4 rounded-xl border-2 transition-all font-medium ${formData.svc_has_own_method ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500'}`}>{t.yes}</button>
                  <button type="button" onClick={() => handleChange('svc_has_own_method', false)} className={`p-4 rounded-xl border-2 transition-all font-medium ${!formData.svc_has_own_method ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500'}`}>{t.no}</button>
                </div>
                {formData.svc_has_own_method && <input type="text" value={formData.svc_method_name || ''} onChange={e => handleChange('svc_method_name', e.target.value)} placeholder={t.methodNamePh} className="input-field mt-3" />}
              </div>
            </div>
          )}

          {/* S7: Objections */}
          {step === 7 && (
            <div className="space-y-6">
              <div><label className="block text-sm font-medium text-dark-700 mb-2">{t.objectionLabel}</label><textarea value={formData.svc_main_objection} onChange={e => handleChange('svc_main_objection', e.target.value)} placeholder={t.objectionPh} className="input-field min-h-[80px]" autoFocus /></div>
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.guaranteeLabel}</label>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => handleChange('svc_has_guarantee', true)} className={`p-4 rounded-xl border-2 transition-all font-medium ${formData.svc_has_guarantee ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500'}`}>{t.yes}</button>
                  <button type="button" onClick={() => handleChange('svc_has_guarantee', false)} className={`p-4 rounded-xl border-2 transition-all font-medium ${!formData.svc_has_guarantee ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500'}`}>{t.no}</button>
                </div>
                {formData.svc_has_guarantee && <input type="text" value={formData.svc_guarantee_details || ''} onChange={e => handleChange('svc_guarantee_details', e.target.value)} placeholder={t.guaranteePh} className="input-field mt-3" />}
              </div>
            </div>
          )}

          {/* S8: Success Cases + Links */}
          {step === 8 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-3">{t.casesLabel}</label>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <button type="button" onClick={() => handleChange('svc_has_success_cases', true)} className={`p-4 rounded-xl border-2 transition-all font-medium ${formData.svc_has_success_cases ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500'}`}>{t.yes}</button>
                  <button type="button" onClick={() => handleChange('svc_has_success_cases', false)} className={`p-4 rounded-xl border-2 transition-all font-medium ${!formData.svc_has_success_cases ? 'border-primary-600 bg-primary-900/20 text-primary-600' : 'border-dark-200 text-dark-500'}`}>{t.no}</button>
                </div>
              </div>

              {formData.svc_has_success_cases && (
                <>
                  {(formData.success_cases || []).map((sc, idx) => (
                    <div key={idx} className="p-4 bg-dark-50 rounded-xl space-y-3 relative">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-dark-700">#{idx + 1}</span>
                        <button type="button" onClick={() => removeCase(idx)} className="text-xs text-red-500 hover:text-red-400 flex items-center gap-1"><Trash2 className="w-3 h-3" />{t.removeCase}</button>
                      </div>
                      <div><label className="block text-xs text-dark-600 mb-1">{t.caseName}</label><input type="text" value={sc.client_name || ''} onChange={e => updateCase(idx, 'client_name', e.target.value)} placeholder={t.caseNamePh} className="input-field text-sm" /></div>
                      <div><label className="block text-xs text-dark-600 mb-1">{t.caseBefore}</label><textarea value={sc.before_state} onChange={e => updateCase(idx, 'before_state', e.target.value)} placeholder={t.caseBeforePh} className="input-field text-sm min-h-[60px]" /></div>
                      <div><label className="block text-xs text-dark-600 mb-1">{t.caseDid}</label><textarea value={sc.what_they_did} onChange={e => updateCase(idx, 'what_they_did', e.target.value)} placeholder={t.caseDidPh} className="input-field text-sm min-h-[60px]" /></div>
                      <div><label className="block text-xs text-dark-600 mb-1">{t.caseResult}</label><textarea value={sc.result} onChange={e => updateCase(idx, 'result', e.target.value)} placeholder={t.caseResultPh} className="input-field text-sm min-h-[60px]" /></div>
                      <div><label className="block text-xs text-dark-600 mb-1">{t.caseTimeline}</label><input type="text" value={sc.timeline} onChange={e => updateCase(idx, 'timeline', e.target.value)} placeholder={t.caseTimelinePh} className="input-field text-sm" /></div>
                      <div><label className="block text-xs text-dark-600 mb-1">{t.caseChange}</label><textarea value={sc.life_change} onChange={e => updateCase(idx, 'life_change', e.target.value)} placeholder={t.caseChangePh} className="input-field text-sm min-h-[60px]" /></div>
                    </div>
                  ))}
                  <button type="button" onClick={addCase} className="w-full p-3 border-2 border-dashed border-dark-200 hover:border-primary-400 rounded-xl text-sm font-medium text-dark-500 hover:text-primary-600 transition-all flex items-center justify-center gap-2">
                    <Plus className="w-4 h-4" />{t.addCase}
                  </button>
                </>
              )}

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
