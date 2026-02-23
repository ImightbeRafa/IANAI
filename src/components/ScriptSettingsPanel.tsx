import { 
  Layers,
  Sparkles,
  Shuffle,
  ListChecks,
  Minus,
  Plus
} from 'lucide-react'
import type { ScriptGenerationSettings, ScriptFramework, ScriptTypeConfig } from '../types'

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
    modelDesc: 'Select which AI model to use',
    mode: 'Generation Mode',
    mixed: 'Mixed',
    mixedDesc: 'AI picks the best types',
    byType: 'By Type',
    byTypeDesc: 'Choose specific types',
    total: 'Total',
    scriptTypes: 'Script Types'
  },
  es: {
    variations: '¿Cuántos guiones?',
    variationsDesc: 'Selecciona cuántas variaciones de guiones generar',
    generate: 'Generar Guiones',
    model: 'Modelo IA',
    modelDesc: 'Selecciona qué modelo de IA usar',
    mode: 'Modo de Generación',
    mixed: 'Mixto',
    mixedDesc: 'La IA elige los tipos',
    byType: 'Por Tipo',
    byTypeDesc: 'Elige tipos específicos',
    total: 'Total',
    scriptTypes: 'Tipos de Guión'
  }
}

const SCRIPT_TYPE_LABELS: Record<ScriptFramework, { es: string; en: string; shortEs: string; shortEn: string }> = {
  venta_directa: { es: 'Venta Directa', en: 'Direct Sale', shortEs: 'V. Directa', shortEn: 'Direct' },
  desvalidar_alternativas: { es: 'Desvalidar Alternativas', en: 'Invalidate Alternatives', shortEs: 'Desvalidar', shortEn: 'Invalidate' },
  mostrar_servicio: { es: 'Mostrar Servicio', en: 'Show Service', shortEs: 'Mostrar', shortEn: 'Show' },
  variedad_productos: { es: 'Variedad de Productos', en: 'Product Variety', shortEs: 'Variedad', shortEn: 'Variety' },
  paso_a_paso: { es: 'Paso a Paso', en: 'Step by Step', shortEs: 'Pasos', shortEn: 'Steps' },
  reconocimiento: { es: 'Reconocimiento', en: 'Brand Awareness', shortEs: 'Reconoc.', shortEn: 'Awareness' }
}

const ALL_TYPES: ScriptFramework[] = ['venta_directa', 'desvalidar_alternativas', 'mostrar_servicio', 'variedad_productos', 'paso_a_paso', 'reconocimiento']

function getTotalByType(config: ScriptTypeConfig): number {
  return Object.values(config).reduce((sum, n) => sum + n, 0)
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

  const updateMode = (mode: 'mixed' | 'by_type') => {
    onChange({ ...settings, generationMode: mode })
  }

  const updateTypeCount = (type: ScriptFramework, delta: number) => {
    const current = settings.scriptTypeConfig[type]
    const newVal = Math.max(0, Math.min(5, current + delta))
    onChange({
      ...settings,
      scriptTypeConfig: { ...settings.scriptTypeConfig, [type]: newVal }
    })
  }

  const totalByType = getTotalByType(settings.scriptTypeConfig)

  // Compact mode - just a simple selector
  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-dark-500">{t.variations}:</span>
          <div className="flex gap-1">
            {settings.generationMode === 'mixed' ? (
              [1, 2, 3, 5].map(n => (
                <button
                  key={n}
                  onClick={() => updateVariations(n)}
                  className={`w-7 h-7 text-xs rounded-lg transition-colors ${
                    settings.variations === n
                      ? 'bg-primary-900/30 text-primary-400 border border-primary-700'
                      : 'bg-dark-200 text-dark-600 hover:bg-dark-300 border border-transparent'
                  }`}
                >
                  {n}
                </button>
              ))
            ) : (
              <span className="text-xs font-medium text-primary-400 bg-primary-900/30 px-2 py-1 rounded-lg">
                {totalByType} {language === 'es' ? 'por tipo' : 'by type'}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Generation Mode */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-dark-700 mb-2">
          <Layers className="w-4 h-4 text-primary-500" />
          {t.mode}
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => updateMode('mixed')}
            className={`flex-1 px-3 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 ${
              settings.generationMode === 'mixed'
                ? 'bg-primary-500 text-white shadow-lg shadow-primary-900/30'
                : 'bg-dark-200 text-dark-600 hover:bg-dark-300 border border-dark-300'
            }`}
          >
            <Shuffle className="w-4 h-4" />
            <div>
              <div className="font-medium text-sm">{t.mixed}</div>
              <div className={`text-[10px] ${settings.generationMode === 'mixed' ? 'text-primary-100' : 'text-dark-400'}`}>
                {t.mixedDesc}
              </div>
            </div>
          </button>
          <button
            onClick={() => updateMode('by_type')}
            className={`flex-1 px-3 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 ${
              settings.generationMode === 'by_type'
                ? 'bg-primary-500 text-white shadow-lg shadow-primary-900/30'
                : 'bg-dark-200 text-dark-600 hover:bg-dark-300 border border-dark-300'
            }`}
          >
            <ListChecks className="w-4 h-4" />
            <div>
              <div className="font-medium text-sm">{t.byType}</div>
              <div className={`text-[10px] ${settings.generationMode === 'by_type' ? 'text-primary-100' : 'text-dark-400'}`}>
                {t.byTypeDesc}
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Mixed Mode: Total count */}
      {settings.generationMode === 'mixed' && (
        <div>
          <label className="text-sm font-medium text-dark-700 mb-2 block">
            {t.variations}
          </label>
          <div className="flex gap-2">
            {[1, 2, 3, 5].map(n => (
              <button
                key={n}
                onClick={() => updateVariations(n)}
                className={`flex-1 px-4 py-3 text-lg font-medium rounded-xl transition-all ${
                  settings.variations === n
                    ? 'bg-primary-500 text-white shadow-lg shadow-primary-900/30 scale-105'
                    : 'bg-dark-200 text-dark-600 hover:bg-dark-300 border border-dark-300'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* By Type Mode: Per-type quantity controls */}
      {settings.generationMode === 'by_type' && (
        <div>
          <label className="text-sm font-medium text-dark-700 mb-2 block">
            {t.scriptTypes}
          </label>
          <div className="space-y-1.5">
            {ALL_TYPES.map(type => {
              const count = settings.scriptTypeConfig[type]
              const label = SCRIPT_TYPE_LABELS[type]
              return (
                <div key={type} className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
                  count > 0 ? 'bg-primary-900/20 border border-primary-800/30' : 'bg-dark-200 border border-transparent'
                }`}>
                  <span className={`text-sm ${count > 0 ? 'font-medium text-primary-400' : 'text-dark-500'}`}>
                    {language === 'es' ? label.es : label.en}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => updateTypeCount(type, -1)}
                      disabled={count === 0}
                      className="w-6 h-6 rounded-md flex items-center justify-center bg-dark-200 border border-dark-300 text-dark-500 hover:bg-dark-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className={`w-6 text-center text-sm font-semibold ${count > 0 ? 'text-primary-700' : 'text-dark-400'}`}>
                      {count}
                    </span>
                    <button
                      onClick={() => updateTypeCount(type, 1)}
                      disabled={count >= 5}
                      className="w-6 h-6 rounded-md flex items-center justify-center bg-dark-200 border border-dark-300 text-dark-500 hover:bg-dark-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-between mt-2 px-1">
            <span className="text-xs text-dark-400">{t.total}:</span>
            <span className={`text-sm font-bold ${totalByType > 0 ? 'text-primary-700' : 'text-red-500'}`}>
              {totalByType} {language === 'es' ? 'guión(es)' : 'script(s)'}
            </span>
          </div>
        </div>
      )}

      {/* Generate Button */}
      {onGenerate && (
        <button
          onClick={onGenerate}
          disabled={loading || (settings.generationMode === 'by_type' && totalByType === 0)}
          className="w-full btn-glow py-3.5 rounded-xl flex items-center justify-center gap-2 mt-2 text-base font-medium"
        >
          <Sparkles className={`w-5 h-5 ${loading ? 'animate-pulse' : ''}`} />
          {t.generate}
        </button>
      )}
    </div>
  )
}
