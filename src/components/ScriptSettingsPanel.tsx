import { 
  Zap, 
  MessageCircle, 
  Clock, 
  Monitor,
  Layers
} from 'lucide-react'
import type { ScriptGenerationSettings, ScriptFramework, ScriptTone, ScriptDuration, ScriptPlatform } from '../types'

interface ScriptSettingsPanelProps {
  settings: ScriptGenerationSettings
  onChange: (settings: ScriptGenerationSettings) => void
  language: 'en' | 'es'
  compact?: boolean
}

const LABELS = {
  en: {
    framework: 'Framework',
    tone: 'Tone',
    duration: 'Duration',
    platform: 'Platform',
    variations: 'Variations',
    frameworks: {
      venta_directa: 'Direct Sale (La Madre)',
      desvalidar_alternativas: 'Invalidate Alternatives (Positioner)',
      mostrar_servicio: 'Show Service (Process)',
      variedad_productos: 'Product Variety (The Menu)',
      paso_a_paso: 'Step by Step (Retargeting)'
    },
    tones: {
      professional: 'Professional',
      casual: 'Casual',
      urgent: 'Urgent',
      humorous: 'Humorous',
      inspirational: 'Inspirational',
      controversial: 'Controversial'
    },
    durations: {
      '15s': '15 sec',
      '30s': '30 sec',
      '60s': '60 sec',
      '90s': '90 sec'
    },
    platforms: {
      general: 'General',
      tiktok: 'TikTok',
      instagram: 'Instagram',
      youtube: 'YouTube',
      facebook: 'Facebook',
      linkedin: 'LinkedIn',
      tv: 'TV',
      radio: 'Radio'
    }
  },
  es: {
    framework: 'Estructura',
    tone: 'Tono',
    duration: 'Duración',
    platform: 'Plataforma',
    variations: 'Variaciones',
    frameworks: {
      venta_directa: 'Venta Directa (La Madre)',
      desvalidar_alternativas: 'Desvalidar Alternativas (Posicionador)',
      mostrar_servicio: 'Mostrar Servicio (Proceso)',
      variedad_productos: 'Variedad de Productos (El Menú)',
      paso_a_paso: 'Paso a Paso (Retargeting)'
    },
    tones: {
      professional: 'Profesional',
      casual: 'Casual',
      urgent: 'Urgente',
      humorous: 'Humorístico',
      inspirational: 'Inspiracional',
      controversial: 'Controversial'
    },
    durations: {
      '15s': '15 seg',
      '30s': '30 seg',
      '60s': '60 seg',
      '90s': '90 seg'
    },
    platforms: {
      general: 'General',
      tiktok: 'TikTok',
      instagram: 'Instagram',
      youtube: 'YouTube',
      facebook: 'Facebook',
      linkedin: 'LinkedIn',
      tv: 'TV',
      radio: 'Radio'
    }
  }
}

export default function ScriptSettingsPanel({ 
  settings, 
  onChange, 
  language,
  compact = false 
}: ScriptSettingsPanelProps) {
  const t = LABELS[language]

  const updateSetting = <K extends keyof ScriptGenerationSettings>(
    key: K, 
    value: ScriptGenerationSettings[K]
  ) => {
    onChange({ ...settings, [key]: value })
  }

  const frameworks: ScriptFramework[] = ['venta_directa', 'desvalidar_alternativas', 'mostrar_servicio', 'variedad_productos', 'paso_a_paso']
  const tones: ScriptTone[] = ['professional', 'casual', 'urgent', 'humorous', 'inspirational', 'controversial']
  const durations: ScriptDuration[] = ['15s', '30s', '60s', '90s']
  const platforms: ScriptPlatform[] = ['general', 'tiktok', 'instagram', 'youtube', 'facebook', 'linkedin', 'tv', 'radio']

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        <select
          value={settings.framework}
          onChange={(e) => updateSetting('framework', e.target.value as ScriptFramework)}
          className="text-xs px-2 py-1 bg-dark-50 border border-dark-200 rounded-lg"
        >
          {frameworks.map(f => (
            <option key={f} value={f}>{t.frameworks[f]}</option>
          ))}
        </select>
        <select
          value={settings.tone}
          onChange={(e) => updateSetting('tone', e.target.value as ScriptTone)}
          className="text-xs px-2 py-1 bg-dark-50 border border-dark-200 rounded-lg"
        >
          {tones.map(tone => (
            <option key={tone} value={tone}>{t.tones[tone]}</option>
          ))}
        </select>
        <select
          value={settings.duration}
          onChange={(e) => updateSetting('duration', e.target.value as ScriptDuration)}
          className="text-xs px-2 py-1 bg-dark-50 border border-dark-200 rounded-lg"
        >
          {durations.map(d => (
            <option key={d} value={d}>{t.durations[d]}</option>
          ))}
        </select>
        <select
          value={settings.platform}
          onChange={(e) => updateSetting('platform', e.target.value as ScriptPlatform)}
          className="text-xs px-2 py-1 bg-dark-50 border border-dark-200 rounded-lg"
        >
          {platforms.map(p => (
            <option key={p} value={p}>{t.platforms[p]}</option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Framework */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-dark-700 mb-2">
          <Zap className="w-4 h-4 text-amber-500" />
          {t.framework}
        </label>
        <div className="grid grid-cols-1 gap-1.5">
          {frameworks.map(f => (
            <button
              key={f}
              onClick={() => updateSetting('framework', f)}
              className={`text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                settings.framework === f
                  ? 'bg-primary-100 text-primary-700 border border-primary-300'
                  : 'bg-dark-50 text-dark-600 hover:bg-dark-100 border border-transparent'
              }`}
            >
              {t.frameworks[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Tone */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-dark-700 mb-2">
          <MessageCircle className="w-4 h-4 text-blue-500" />
          {t.tone}
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {tones.map(tone => (
            <button
              key={tone}
              onClick={() => updateSetting('tone', tone)}
              className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                settings.tone === tone
                  ? 'bg-primary-100 text-primary-700 border border-primary-300'
                  : 'bg-dark-50 text-dark-600 hover:bg-dark-100 border border-transparent'
              }`}
            >
              {t.tones[tone]}
            </button>
          ))}
        </div>
      </div>

      {/* Duration */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-dark-700 mb-2">
          <Clock className="w-4 h-4 text-green-500" />
          {t.duration}
        </label>
        <div className="flex gap-1.5">
          {durations.map(d => (
            <button
              key={d}
              onClick={() => updateSetting('duration', d)}
              className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${
                settings.duration === d
                  ? 'bg-primary-100 text-primary-700 border border-primary-300'
                  : 'bg-dark-50 text-dark-600 hover:bg-dark-100 border border-transparent'
              }`}
            >
              {t.durations[d]}
            </button>
          ))}
        </div>
      </div>

      {/* Platform */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-dark-700 mb-2">
          <Monitor className="w-4 h-4 text-purple-500" />
          {t.platform}
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {platforms.map(p => (
            <button
              key={p}
              onClick={() => updateSetting('platform', p)}
              className={`px-2 py-2 text-xs rounded-lg transition-colors ${
                settings.platform === p
                  ? 'bg-primary-100 text-primary-700 border border-primary-300'
                  : 'bg-dark-50 text-dark-600 hover:bg-dark-100 border border-transparent'
              }`}
            >
              {t.platforms[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Variations */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-dark-700 mb-2">
          <Layers className="w-4 h-4 text-orange-500" />
          {t.variations}
        </label>
        <div className="flex gap-1.5">
          {[1, 2, 3, 5].map(n => (
            <button
              key={n}
              onClick={() => updateSetting('variations', n)}
              className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${
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
    </div>
  )
}
