import type { ScriptFramework, ScriptSettings, ScriptTypeConfig } from './types.js'

export const SCRIPT_TYPES: ScriptFramework[] = [
  'venta_directa',
  'desvalidar_alternativas',
  'mostrar_servicio',
  'variedad_productos',
  'paso_a_paso',
  'reconocimiento',
  'educativo',
  'storytelling',
  'tendencia',
  'engagement',
]

export const ORGANIC_SCRIPT_TYPES: ScriptFramework[] = ['educativo', 'storytelling', 'tendencia', 'engagement']

export function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function pushUnique(target: string[], value: unknown, max = 12): void {
  const text = cleanText(value)
  if (!text) return
  const normalized = text.toLowerCase()
  if (target.some(item => item.toLowerCase() === normalized)) return
  if (target.length < max) target.push(text)
}

export function compactLines(values: unknown[], max = 12): string[] {
  const out: string[] = []
  for (const value of values) pushUnique(out, value, max)
  return out
}

export function getRequestedScriptTypes(settings?: ScriptSettings): ScriptFramework[] {
  if (settings?.generationMode === 'by_type' && settings.scriptTypeConfig) {
    const out: ScriptFramework[] = []
    for (const type of SCRIPT_TYPES) {
      const count = settings.scriptTypeConfig[type] ?? 0
      for (let i = 0; i < count; i += 1) out.push(type)
    }
    return out
  }
  const count = Math.max(1, Math.min(10, settings?.variations ?? 3))
  return Array.from({ length: count }, () => settings?.framework || 'venta_directa')
}

export function getTotalRequested(settings?: ScriptSettings): number {
  return getRequestedScriptTypes(settings).length
}

export function normalizeConfig(config?: Partial<ScriptTypeConfig>): ScriptTypeConfig {
  return {
    venta_directa: config?.venta_directa ?? 0,
    desvalidar_alternativas: config?.desvalidar_alternativas ?? 0,
    mostrar_servicio: config?.mostrar_servicio ?? 0,
    variedad_productos: config?.variedad_productos ?? 0,
    paso_a_paso: config?.paso_a_paso ?? 0,
    reconocimiento: config?.reconocimiento ?? 0,
    educativo: config?.educativo ?? 0,
    storytelling: config?.storytelling ?? 0,
    tendencia: config?.tendencia ?? 0,
    engagement: config?.engagement ?? 0,
  }
}

export function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced?.[1]) {
      try { return JSON.parse(fenced[1]) as T } catch { /* ignore */ }
    }
    const firstArray = text.indexOf('[')
    const lastArray = text.lastIndexOf(']')
    if (firstArray >= 0 && lastArray > firstArray) {
      try { return JSON.parse(text.slice(firstArray, lastArray + 1)) as T } catch { /* ignore */ }
    }
    const firstObj = text.indexOf('{')
    const lastObj = text.lastIndexOf('}')
    if (firstObj >= 0 && lastObj > firstObj) {
      try { return JSON.parse(text.slice(firstObj, lastObj + 1)) as T } catch { /* ignore */ }
    }
  }
  return null
}

export function typeLabel(type: ScriptFramework, language: 'en' | 'es'): string {
  const labels: Record<ScriptFramework, { es: string; en: string }> = {
    venta_directa: { es: 'Venta Directa', en: 'Direct Sale' },
    desvalidar_alternativas: { es: 'Desvalidar Alternativas', en: 'Invalidate Alternatives' },
    mostrar_servicio: { es: 'Mostrar Servicio', en: 'Show Service' },
    variedad_productos: { es: 'Variedad de Productos', en: 'Product Variety' },
    paso_a_paso: { es: 'Paso a Paso', en: 'Step by Step' },
    reconocimiento: { es: 'Reconocimiento', en: 'Brand Awareness' },
    educativo: { es: 'Educativo', en: 'Educational' },
    storytelling: { es: 'Storytelling', en: 'Storytelling' },
    tendencia: { es: 'Tendencia', en: 'Trending' },
    engagement: { es: 'Engagement', en: 'Engagement' },
  }
  return labels[type]?.[language] || type
}

