import { GROK_TEXT_MODEL, grokChatComplete } from '../grok-models.js'
import type { AngleBoardItem, BulkLanguage } from './types.js'

export async function generateScriptForAngle(options: {
  apiKey: string
  language: BulkLanguage
  brandName: string
  offerName: string
  brandVoice?: string | null
  audience?: string | null
  angle: AngleBoardItem
  recentSummaries?: string[]
}): Promise<{ title: string; content: string }> {
  const isEs = options.language === 'es'
  const recent = (options.recentSummaries || []).filter(Boolean).slice(0, 6)
  const system = isEs
    ? 'Eres un copywriter senior de video corto. Escribes UN guion hablado para UN nicho. No copies guiones recientes. No inventes claims. Responde texto plano: Título / Hook / Desarrollo / CTA.'
    : 'You are a senior short-form copywriter. Write ONE spoken script for ONE niche. Do not clone recent scripts. Do not invent claims. Plain text: Title / Hook / Development / CTA.'
  const user = [
    isEs ? `Marca: ${options.brandName}` : `Brand: ${options.brandName}`,
    isEs ? `Oferta: ${options.offerName}` : `Offer: ${options.offerName}`,
    options.brandVoice ? `Voice: ${options.brandVoice}` : '',
    options.audience ? `Audience: ${options.audience}` : '',
    `Angle title: ${options.angle.title}`,
    `Niche: ${options.angle.niche}`,
    `Why they buy: ${options.angle.whyItBuys}`,
    `Hook style: ${options.angle.hookStyle}`,
    `Framework hint: ${options.angle.frameworkHint}`,
    recent.length
      ? (isEs
        ? `No te acerques a estos resúmenes recientes:\n- ${recent.join('\n- ')}`
        : `Stay away from these recent summaries:\n- ${recent.join('\n- ')}`)
      : '',
    isEs
      ? 'Escribe un guion de 20–40s, hablado, específico de este nicho. Distinto a un anuncio genérico del mismo producto.'
      : 'Write a 20–40s spoken script specific to this niche. Not a generic ad for the same product.',
  ].filter(Boolean).join('\n')

  const completion = await grokChatComplete({
    apiKey: options.apiKey,
    model: GROK_TEXT_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.85,
    maxTokens: 1200,
  })
  const content = completion.content.trim()
  if (!content) throw new Error('Empty script from model')
  const titleLine = content.split('\n').find((line) => line.trim())
  const title = (titleLine || options.angle.title).replace(/^#+\s*/, '').replace(/^t[ií]tulo:\s*/i, '').slice(0, 120)
  return { title, content }
}
