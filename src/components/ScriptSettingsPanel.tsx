import { 
  Layers,
  Sparkles
} from 'lucide-react'
import type { ScriptGenerationSettings } from '../types'

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
    generate: 'Generate Scripts'
  },
  es: {
    variations: '¿Cuántos guiones?',
    variationsDesc: 'Selecciona cuántas variaciones de guiones generar',
    generate: 'Generar Guiones'
  }
}

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

  // Compact mode - just a simple selector
  if (compact) {
    return (
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
    )
  }

  return (
    <div className="space-y-4">
      {/* Variations - The only setting now */}
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
