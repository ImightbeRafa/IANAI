/** Optional Insights — theme / background steering for image + pack generates. */

export const INSIGHTS_MAX_CHARS = 500

export function sanitizeInsights(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, INSIGHTS_MAX_CHARS)
}

export function insightsThemeBackgroundBlock(
  insights: string,
  language: 'es' | 'en' = 'es'
): string {
  const text = sanitizeInsights(insights)
  if (!text) return ''
  if (language === 'en') {
    return [
      'USER INSIGHTS (theme / atmosphere / backgrounds only):',
      `"${text}"`,
      'Steer scene, lighting, mood, and background from this. Do not change the real product, logo, or offer facts.',
    ].join('\n')
  }
  return [
    'INSIGHTS DEL USUARIO (solo tema / ambiente / fondos):',
    `"${text}"`,
    'Dirigí escena, iluminación, mood y fondo con esto. No cambies el producto real, el logo ni los hechos de la oferta.',
  ].join('\n')
}
