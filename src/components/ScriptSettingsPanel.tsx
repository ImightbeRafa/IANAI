import { 
  Layers,
  Sparkles,
  Cpu
} from 'lucide-react'
import type { ScriptGenerationSettings, AIModel } from '../types'

interface ScriptSettingsPanelProps {
  settings: ScriptGenerationSettings
  onChange: (settings: ScriptGenerationSettings) => void
  language: 'en' | 'es'
  compact?: boolean
  onGenerate?: () => void
  loading?: boolean
}

const LABELS = {
  en: {
    variations: 'How many scripts?',
    variationsDesc: 'Select how many script variations to generate',
    generate: 'Generate Scripts',
    model: 'AI Model',
    modelDesc: 'Select which AI model to use'
  },
  es: {
    variations: '¿Cuántos guiones?',
    variationsDesc: 'Selecciona cuántas variaciones de guiones generar',
    generate: 'Generar Guiones',
    model: 'Modelo IA',
    modelDesc: 'Selecciona qué modelo de IA usar'
  }
}

const MODEL_OPTIONS: { value: AIModel; label: string; description: string }[] = [
  { value: 'grok', label: 'Grok', description: 'xAI - Fast & Creative' },
  { value: 'gemini', label: 'Gemini 3 Pro', description: 'Google - State of the art' }
]

export default function ScriptSettingsPanel({ 
  settings, 
  onChange, 
  language,
  compact = false,
  onGenerate,
  loading = false
}: ScriptSettingsPanelProps) {
  const t = LABELS[language]

  const updateVariations = (value: number) => {
    onChange({ ...settings, variations: value })
  }

  const updateModel = (model: AIModel) => {
    onChange({ ...settings, model })
  }

  // Compact mode - just a simple selector
  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-dark-500">{t.variations}:</span>
          <div className="flex gap-1">
            {[1, 2, 3, 5].map(n => (
              <button
                key={n}
                onClick={() => updateVariations(n)}
                className={`w-7 h-7 text-xs rounded-lg transition-colors ${
                  settings.variations === n
                    ? 'bg-primary-100 text-primary-700 border border-primary-300'
                    : 'bg-dark-50 text-dark-600 hover:bg-dark-100 border border-transparent'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Cpu className="w-3 h-3 text-dark-400" />
          <div className="flex gap-1">
            {MODEL_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => updateModel(opt.value)}
                className={`px-2 py-1 text-xs rounded-lg transition-colors ${
                  settings.model === opt.value
                    ? 'bg-primary-100 text-primary-700 border border-primary-300'
                    : 'bg-dark-50 text-dark-600 hover:bg-dark-100 border border-transparent'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* AI Model Selector */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-dark-700 mb-1">
          <Cpu className="w-4 h-4 text-primary-500" />
          {t.model}
        </label>
        <p className="text-xs text-dark-400 mb-3">{t.modelDesc}</p>
        <div className="flex gap-2">
          {MODEL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => updateModel(opt.value)}
              className={`flex-1 px-4 py-3 rounded-xl transition-all ${
                settings.model === opt.value
                  ? 'bg-primary-500 text-white shadow-lg shadow-primary-200 scale-105'
                  : 'bg-dark-50 text-dark-600 hover:bg-dark-100 border border-dark-200'
              }`}
            >
              <div className="font-medium">{opt.label}</div>
              <div className={`text-xs mt-0.5 ${settings.model === opt.value ? 'text-primary-100' : 'text-dark-400'}`}>
                {opt.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Variations */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-dark-700 mb-1">
          <Layers className="w-4 h-4 text-primary-500" />
          {t.variations}
        </label>
        <p className="text-xs text-dark-400 mb-3">{t.variationsDesc}</p>
        <div className="flex gap-2">
          {[1, 2, 3, 5].map(n => (
            <button
              key={n}
              onClick={() => updateVariations(n)}
              className={`flex-1 px-4 py-3 text-lg font-medium rounded-xl transition-all ${
                settings.variations === n
                  ? 'bg-primary-500 text-white shadow-lg shadow-primary-200 scale-105'
                  : 'bg-dark-50 text-dark-600 hover:bg-dark-100 border border-dark-200'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Generate Button */}
      {onGenerate && (
        <button
          onClick={onGenerate}
          disabled={loading}
          className="w-full btn-primary py-3.5 flex items-center justify-center gap-2 mt-2 text-base font-medium"
        >
          <Sparkles className={`w-5 h-5 ${loading ? 'animate-pulse' : ''}`} />
          {t.generate}
        </button>
      )}
    </div>
  )
}
