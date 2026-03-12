import { useState } from 'react'
import { Globe, ClipboardPaste, Loader2, X, Check, AlertCircle } from 'lucide-react'
import { autoFillFromUrl, autoFillFromText, type FormType } from '../utils/formAutoFill'

interface AutoFillButtonsProps {
  formType: FormType
  language: 'en' | 'es'
  disabled?: boolean
  onResult: (data: Record<string, unknown>) => void
}

export default function AutoFillButtons({ formType, language, disabled, onResult }: AutoFillButtonsProps) {
  const [showUrlModal, setShowUrlModal] = useState(false)
  const [showPasteModal, setShowPasteModal] = useState(false)
  const [url, setUrl] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [processing, setProcessing] = useState(false)
  const [status, setStatus] = useState<'' | 'extracting' | 'analyzing' | 'success' | 'error'>('')
  const [errorMessage, setErrorMessage] = useState('')

  const MAX_PASTE_LENGTH = 15000

  const t = {
    urlButton: language === 'es' ? 'Auto-llenar con enlace' : 'Auto-fill from link',
    pasteButton: language === 'es' ? 'Pegar información' : 'Paste information',
    urlTitle: language === 'es' ? 'Auto-llenar desde URL' : 'Auto-fill from URL',
    urlPlaceholder: language === 'es' ? 'Pega la URL de tu negocio o producto...' : 'Paste your business or product URL...',
    pasteTitle: language === 'es' ? 'Pegar información' : 'Paste information',
    pastePlaceholder: language === 'es' ? 'Pega aquí la información de tu negocio, producto o servicio...' : 'Paste your business, product or service info here...',
    process: language === 'es' ? 'Procesar' : 'Process',
    extracting: language === 'es' ? 'Extrayendo contenido...' : 'Extracting content...',
    analyzing: language === 'es' ? 'Analizando con IA...' : 'Analyzing with AI...',
    success: language === 'es' ? 'Campos completados' : 'Fields filled',
    error: language === 'es' ? 'No se pudo procesar' : 'Could not process',
    cancel: language === 'es' ? 'Cancelar' : 'Cancel',
  }

  const handleUrl = async () => {
    if (!url.trim() || processing) return
    setProcessing(true)
    setStatus('extracting')
    setErrorMessage('')
    try {
      setStatus('analyzing')
      const { data, error } = await autoFillFromUrl(url.trim(), formType, language)
      if (data && !error) {
        onResult(data)
        setStatus('success')
        setTimeout(() => { setShowUrlModal(false); setUrl(''); setStatus(''); setErrorMessage('') }, 1200)
      } else {
        setStatus('error')
        setErrorMessage(error || t.error)
      }
    } catch {
      setStatus('error')
      setErrorMessage(t.error)
    } finally {
      setProcessing(false)
    }
  }

  const handlePaste = async () => {
    if (!pasteText.trim() || processing) return
    setProcessing(true)
    setStatus('analyzing')
    setErrorMessage('')
    try {
      const { data, error } = await autoFillFromText(pasteText.trim(), formType, language)
      if (data && !error) {
        onResult(data)
        setStatus('success')
        setTimeout(() => { setShowPasteModal(false); setPasteText(''); setStatus(''); setErrorMessage('') }, 1200)
      } else {
        setStatus('error')
        setErrorMessage(error || t.error)
      }
    } catch {
      setStatus('error')
      setErrorMessage(t.error)
    } finally {
      setProcessing(false)
    }
  }

  const StatusIndicator = () => {
    if (!status) return null
    if (status === 'extracting') return <p className="text-sm text-blue-400 flex items-center gap-2 mt-3"><Loader2 className="w-4 h-4 animate-spin" />{t.extracting}</p>
    if (status === 'analyzing') return <p className="text-sm text-blue-400 flex items-center gap-2 mt-3"><Loader2 className="w-4 h-4 animate-spin" />{t.analyzing}</p>
    if (status === 'success') return <p className="text-sm text-green-400 flex items-center gap-2 mt-3"><Check className="w-4 h-4" />{t.success}</p>
    if (status === 'error') return <p className="text-sm text-red-400 flex items-center gap-2 mt-3"><AlertCircle className="w-4 h-4" />{errorMessage || t.error}</p>
    return null
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setShowUrlModal(true)}
          disabled={disabled}
          className={`p-4 border-2 border-dashed rounded-xl transition-all flex flex-col items-center gap-2 ${
            disabled
              ? 'border-dark-100 text-dark-300 cursor-not-allowed'
              : 'border-blue-200 hover:border-blue-400 hover:bg-blue-900/20 text-dark-500 hover:text-blue-600'
          }`}
        >
          <Globe className="w-5 h-5" />
          <span className="font-medium text-sm">{t.urlButton}</span>
        </button>
        <button
          type="button"
          onClick={() => setShowPasteModal(true)}
          disabled={disabled}
          className={`p-4 border-2 border-dashed rounded-xl transition-all flex flex-col items-center gap-2 ${
            disabled
              ? 'border-dark-100 text-dark-300 cursor-not-allowed'
              : 'border-dark-200 hover:border-primary-400 hover:bg-primary-900/20 text-dark-500 hover:text-primary-600'
          }`}
        >
          <ClipboardPaste className="w-5 h-5" />
          <span className="font-medium text-sm">{t.pasteButton}</span>
        </button>
      </div>

      {/* URL Modal */}
      {showUrlModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-dark-100 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-dark-900">{t.urlTitle}</h3>
              <button onClick={() => { setShowUrlModal(false); setUrl(''); setStatus(''); setErrorMessage('') }} className="p-1 hover:bg-dark-200 rounded"><X className="w-4 h-4 text-dark-400" /></button>
            </div>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={t.urlPlaceholder}
              className="input-field"
              autoFocus
              disabled={processing}
            />
            <StatusIndicator />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowUrlModal(false); setUrl(''); setStatus(''); setErrorMessage('') }} className="btn-secondary text-sm" disabled={processing}>{t.cancel}</button>
              <button onClick={handleUrl} disabled={!url.trim() || processing} className="btn-primary text-sm flex items-center gap-2">
                {processing && <Loader2 className="w-4 h-4 animate-spin" />}
                {t.process}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paste Modal */}
      {showPasteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-dark-100 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-dark-900">{t.pasteTitle}</h3>
              <button onClick={() => { setShowPasteModal(false); setPasteText(''); setStatus(''); setErrorMessage('') }} className="p-1 hover:bg-dark-200 rounded"><X className="w-4 h-4 text-dark-400" /></button>
            </div>
            <div>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder={t.pastePlaceholder}
                className="input-field min-h-[150px]"
                autoFocus
                disabled={processing}
              />
              <div className="flex justify-between mt-1">
                <span className={`text-xs ${pasteText.length > MAX_PASTE_LENGTH ? 'text-amber-400' : 'text-dark-400'}`}>
                  {pasteText.length > MAX_PASTE_LENGTH
                    ? (language === 'es' ? `Se usarán los primeros ${MAX_PASTE_LENGTH.toLocaleString()} caracteres` : `First ${MAX_PASTE_LENGTH.toLocaleString()} characters will be used`)
                    : ''}
                </span>
                <span className={`text-xs ${pasteText.length > MAX_PASTE_LENGTH ? 'text-amber-400' : 'text-dark-400'}`}>
                  {pasteText.length.toLocaleString()}{pasteText.length > MAX_PASTE_LENGTH ? ` / ${MAX_PASTE_LENGTH.toLocaleString()}` : ''}
                </span>
              </div>
            </div>
            <StatusIndicator />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowPasteModal(false); setPasteText(''); setStatus(''); setErrorMessage('') }} className="btn-secondary text-sm" disabled={processing}>{t.cancel}</button>
              <button onClick={handlePaste} disabled={!pasteText.trim() || processing} className="btn-primary text-sm flex items-center gap-2">
                {processing && <Loader2 className="w-4 h-4 animate-spin" />}
                {t.process}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
