import { 
  Layers,
  Sparkles,
  Shuffle,
  ListChecks,
  Minus,
  Plus,
  Megaphone,
  Leaf
} from 'lucide-react'
import type { ScriptGenerationSettings, ScriptFramework, ScriptTypeConfig, CTAStrength } from '../types'
import { setTextModelPreference, type TextModelProfile } from '../features/chat-shell/textModelPreference'

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
    modelDesc: 'Grok 4.6 Best or 4.5 Efficient',
    best: 'Grok 4.6 · Best',
    efficient: 'Grok 4.5 · Efficient',
    mode: 'Generation Mode',
    mixed: 'Mixed',
    mixedDesc: 'AI picks the best types',
    byType: 'By Type',
    byTypeDesc: 'Choose specific types',
    total: 'Total',
    scriptTypes: 'Script Types',
    diverseAngles: 'Force diverse angles',
    diverseAnglesDesc: 'Uses the new strategy-first pipeline'
  },
  es: {
    variations: '¿Cuántos guiones?',
    variationsDesc: 'Selecciona cuántas variaciones de guiones generar',
    generate: 'Generar Guiones',
    model: 'Modelo IA',
    modelDesc: 'Grok 4.6 Mejor o 4.5 Eficiente',
    best: 'Grok 4.6 · Mejor',
    efficient: 'Grok 4.5 · Eficiente',
    mode: 'Modo de Generación',
    mixed: 'Mixto',
    mixedDesc: 'La IA elige los tipos',
    byType: 'Por Tipo',
    byTypeDesc: 'Elige tipos específicos',
    total: 'Total',
    scriptTypes: 'Tipos de Guión',
    diverseAngles: 'Forzar angulos diversos',
    diverseAnglesDesc: 'Usa el nuevo pipeline estrategico'
  }
}

const SCRIPT_TYPE_LABELS: Record<ScriptFramework, { es: string; en: string; shortEs: string; shortEn: string }> = {
  // Sales frameworks
  venta_directa: { es: 'Venta Directa', en: 'Direct Sale', shortEs: 'V. Directa', shortEn: 'Direct' },
  desvalidar_alternativas: { es: 'Desvalidar Alternativas', en: 'Invalidate Alternatives', shortEs: 'Desvalidar', shortEn: 'Invalidate' },
  mostrar_servicio: { es: 'Mostrar Servicio', en: 'Show Service', shortEs: 'Mostrar', shortEn: 'Show' },
  variedad_productos: { es: 'Variedad de Productos', en: 'Product Variety', shortEs: 'Variedad', shortEn: 'Variety' },
  paso_a_paso: { es: 'Paso a Paso', en: 'Step by Step', shortEs: 'Pasos', shortEn: 'Steps' },
  reconocimiento: { es: 'Reconocimiento', en: 'Brand Awareness', shortEs: 'Reconoc.', shortEn: 'Awareness' },
  // Organic frameworks
  educativo: { es: 'Educativo', en: 'Educational', shortEs: 'Educ.', shortEn: 'Edu' },
  storytelling: { es: 'Storytelling', en: 'Storytelling', shortEs: 'Story', shortEn: 'Story' },
  tendencia: { es: 'Tendencia', en: 'Trending', shortEs: 'Trend', shortEn: 'Trend' },
  engagement: { es: 'Engagement', en: 'Engagement', shortEs: 'Engage', shortEn: 'Engage' }
}

const SALES_TYPES: ScriptFramework[] = ['venta_directa', 'desvalidar_alternativas', 'mostrar_servicio', 'variedad_productos', 'paso_a_paso', 'reconocimiento']
const ORGANIC_TYPES: ScriptFramework[] = ['educativo', 'storytelling', 'tendencia', 'engagement']

const CTA_STRENGTH_LABELS: Record<CTAStrength, { es: string; en: string; desc_es: string; desc_en: string }> = {
  none: { es: 'Ninguno', en: 'None', desc_es: 'Sin CTA comercial', desc_en: 'No commercial CTA' },
  soft: { es: 'Suave', en: 'Soft', desc_es: 'Seguí, guardá, compartí', desc_en: 'Follow, save, share' },
  brand_mention: { es: 'Marca', en: 'Brand', desc_es: 'Mención sutil', desc_en: 'Subtle mention' },
  sales: { es: 'Ventas', en: 'Sales', desc_es: 'CTA de venta directa', desc_en: 'Direct sales CTA' }
}

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

  const updateModel = (model: TextModelProfile) => {
    setTextModelPreference(model)
    onChange({ ...settings, model })
  }

  const updateVariations = (value: number) => {
    onChange({ ...settings, variations: value })
  }

  const updateMode = (mode: 'mixed' | 'by_type') => {
    onChange({ ...settings, generationMode: mode })
  }

  const updateTypeCount = (type: ScriptFramework, delta: number) => {
    const current = settings.scriptTypeConfig[type] ?? 0
    const newVal = Math.max(0, Math.min(5, current + delta))
    const nextConfig = { ...settings.scriptTypeConfig, [type]: newVal }
    // Auto-adjust CTA strength default based on selection composition when the user
    // hasn't explicitly locked one (cta defaults: all-organic → soft, any sales → sales).
    const hasAnyOrganic = ORGANIC_TYPES.some(k => (nextConfig[k] ?? 0) > 0)
    const hasAnySales = SALES_TYPES.some(k => (nextConfig[k] ?? 0) > 0)
    let nextCTA = settings.ctaStrength ?? 'sales'
    // Only auto-flip when the current strength matches the old regime's default — avoid
    // stomping a user-picked value.
    if (!hasAnySales && hasAnyOrganic && nextCTA === 'sales') nextCTA = 'soft'
    if (hasAnySales && !hasAnyOrganic && nextCTA === 'soft') nextCTA = 'sales'
    onChange({
      ...settings,
      scriptTypeConfig: nextConfig,
      ctaStrength: nextCTA
    })
  }

  const updateCTAStrength = (strength: CTAStrength) => {
    onChange({ ...settings, ctaStrength: strength })
  }

  const updateStructuredPipeline = (enabled: boolean) => {
    onChange({ ...settings, useStructuredPipeline: enabled })
  }

  const totalByType = getTotalByType(settings.scriptTypeConfig)
  const effectiveCTA: CTAStrength = settings.ctaStrength ?? 'sales'
  const activeTextModel: TextModelProfile = settings.model === 'efficient' ? 'efficient' : 'best'

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
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-dark-700 mb-2">
          <Sparkles className="w-4 h-4 text-primary-500" />
          {t.model}
        </label>
        <p className="text-xs text-dark-400 mb-2">{t.modelDesc}</p>
        <div className="flex gap-2">
          {(['best', 'efficient'] as const).map((profile) => (
            <button
              key={profile}
              type="button"
              onClick={() => updateModel(profile)}
              className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                activeTextModel === profile
                  ? 'bg-primary-500 text-white shadow-lg shadow-primary-900/30'
                  : 'bg-dark-200 text-dark-600 hover:bg-dark-300 border border-dark-300'
              }`}
            >
              {profile === 'best' ? t.best : t.efficient}
            </button>
          ))}
        </div>
      </div>
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

      <div className="flex items-center justify-between rounded-lg bg-dark-200 border border-dark-300 px-3 py-2">
        <div>
          <div className="text-sm font-medium text-dark-700">{t.diverseAngles}</div>
          <div className="text-[10px] text-dark-400">{t.diverseAnglesDesc}</div>
        </div>
        <button
          type="button"
          onClick={() => updateStructuredPipeline(!settings.useStructuredPipeline)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            settings.useStructuredPipeline ? 'bg-emerald-600' : 'bg-dark-400'
          }`}
          title={t.diverseAnglesDesc}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              settings.useStructuredPipeline ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* By Type Mode: Per-type quantity controls */}
      {settings.generationMode === 'by_type' && (
        <div>
          <label className="text-sm font-medium text-dark-700 mb-2 block">
            {t.scriptTypes}
          </label>

          {/* Sales section */}
          <div className="flex items-center gap-1.5 px-1 mb-1.5 mt-1">
            <Megaphone className="w-3 h-3 text-primary-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary-400">
              {language === 'es' ? 'Ventas' : 'Sales'}
            </span>
          </div>
          <div className="space-y-1.5">
            {SALES_TYPES.map(type => {
              const count = settings.scriptTypeConfig[type] ?? 0
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

          {/* Organic section */}
          <div className="flex items-center gap-1.5 px-1 mb-1.5 mt-3">
            <Leaf className="w-3 h-3 text-emerald-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
              {language === 'es' ? 'Orgánico' : 'Organic'}
            </span>
            <span className="text-[9px] text-dark-400">
              · {language === 'es' ? 'valor, historia, tendencia' : 'value, story, trend'}
            </span>
          </div>
          <div className="space-y-1.5">
            {ORGANIC_TYPES.map(type => {
              const count = settings.scriptTypeConfig[type] ?? 0
              const label = SCRIPT_TYPE_LABELS[type]
              return (
                <div key={type} className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
                  count > 0 ? 'bg-emerald-900/20 border border-emerald-800/30' : 'bg-dark-200 border border-transparent'
                }`}>
                  <span className={`text-sm ${count > 0 ? 'font-medium text-emerald-400' : 'text-dark-500'}`}>
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
                    <span className={`w-6 text-center text-sm font-semibold ${count > 0 ? 'text-emerald-500' : 'text-dark-400'}`}>
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

          <div className="flex items-center justify-between mt-3 px-1">
            <span className="text-xs text-dark-400">{t.total}:</span>
            <span className={`text-sm font-bold ${totalByType > 0 ? 'text-primary-700' : 'text-red-500'}`}>
              {totalByType} {language === 'es' ? 'guión(es)' : 'script(s)'}
            </span>
          </div>

          {/* CTA Strength */}
          {totalByType > 0 && (
            <div className="mt-4 pt-3 border-t border-dark-300">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-dark-700">
                  {language === 'es' ? 'Fuerza del CTA' : 'CTA Strength'}
                </label>
                <span className="text-[10px] text-dark-400">
                  {language === 'es' ? CTA_STRENGTH_LABELS[effectiveCTA].desc_es : CTA_STRENGTH_LABELS[effectiveCTA].desc_en}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {(['none', 'soft', 'brand_mention', 'sales'] as CTAStrength[]).map(s => {
                  const active = effectiveCTA === s
                  const isSales = s === 'sales'
                  return (
                    <button
                      key={s}
                      onClick={() => updateCTAStrength(s)}
                      className={`px-2 py-1.5 text-[11px] font-medium rounded-lg transition-all ${
                        active
                          ? isSales
                            ? 'bg-primary-500 text-white shadow-md'
                            : 'bg-emerald-600 text-white shadow-md'
                          : 'bg-dark-200 text-dark-500 hover:bg-dark-300 border border-dark-300'
                      }`}
                      title={language === 'es' ? CTA_STRENGTH_LABELS[s].desc_es : CTA_STRENGTH_LABELS[s].desc_en}
                    >
                      {language === 'es' ? CTA_STRENGTH_LABELS[s].es : CTA_STRENGTH_LABELS[s].en}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
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
