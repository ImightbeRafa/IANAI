import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'
import { GROK_API_URL, GROK_TEXT_MODEL } from './lib/grok-models.js'

type Language = 'en' | 'es'
type EditType = 'script_edit' | 'script_enhance' | 'script_hook' | 'script_consciousness'

function buildEditorPrompt(language: Language, editType: EditType, businessContext?: Record<string, unknown>, productContext?: Record<string, unknown>): string {
  const isEs = language === 'es'
  const contextBlock = `\n\n${isEs ? 'CONTEXTO DISPONIBLE' : 'AVAILABLE CONTEXT'}:\n${JSON.stringify({ businessContext, productContext }, null, 2)}`
  const modeRules = {
    script_edit: isEs
      ? 'Aplica solo la edicion solicitada. Conserva formato, estructura y cantidad de guiones.'
      : 'Apply only the requested edit. Preserve format, structure, and number of scripts.',
    script_enhance: isEs
      ? 'Mejora claridad, buyer qualification, hechos concretos y CTA. Si el guion es organico/reconocimiento, conserva el objetivo no comercial y evita presion de venta.'
      : 'Improve clarity, buyer qualification, concrete facts, and CTA. If the script is organic/awareness, preserve the non-commercial goal and avoid sales pressure.',
    script_hook: isEs
      ? 'Cambia el gancho y ajusta el desarrollo solo lo necesario para que pague la nueva promesa. No generes multiples opciones.'
      : 'Change the hook and adjust development only as needed to pay off the new promise. Do not generate multiple options.',
    script_consciousness: isEs
      ? 'Ajusta el guion al nivel de conciencia solicitado sin romper el formato ni inventar claims.'
      : 'Adjust the script to the requested awareness level without breaking format or inventing claims.',
  }

  return isEs
    ? `Eres un editor senior de guiones. Tu unica tarea es devolver el guion editado completo.

REGLAS:
- Devuelve SOLO el guion editado, sin explicaciones.
- Devuelve exactamente UN guion si recibiste un guion. No agregues opciones.
- Mantén el formato original salvo que la instrucción pida cambiarlo.
- No inventes precios, resultados, garantias, ubicaciones, platos, cantidades ni casos.
- Usa placeholders especificos cuando falten datos.
- ${modeRules[editType]}${contextBlock}`
    : `You are a senior script editor. Your only job is to return the complete edited script.

RULES:
- Return ONLY the edited script, no explanations.
- Return exactly ONE script if you received one script. Do not add options.
- Preserve the original format unless the instruction asks to change it.
- Do not invent prices, outcomes, guarantees, locations, dishes, quantities, or cases.
- Use specific placeholders when facts are missing.
- ${modeRules[editType]}${contextBlock}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireAuth(req, res)
  if (!user) return

  try {
    const { originalScript, editInstruction, language = 'es', businessContext, productContext, editType = 'script_edit' } = req.body || {}
    if (!originalScript || typeof originalScript !== 'string') return res.status(400).json({ error: 'originalScript is required' })
    if (!editInstruction || typeof editInstruction !== 'string') return res.status(400).json({ error: 'editInstruction is required' })
    if (!['en', 'es'].includes(language)) return res.status(400).json({ error: 'language must be en or es' })

    const grokApiKey = process.env.GROK_API_KEY
    if (!grokApiKey) return res.status(500).json({ error: 'Grok API key not configured' })

    const safeEditType: EditType = ['script_edit', 'script_enhance', 'script_hook', 'script_consciousness'].includes(editType)
      ? editType
      : 'script_edit'
    const systemPrompt = buildEditorPrompt(language, safeEditType, businessContext, productContext)
    const userPrompt = language === 'es'
      ? `GUION ORIGINAL:\n${originalScript}\n\nEDICION SOLICITADA:\n${editInstruction}`
      : `ORIGINAL SCRIPT:\n${originalScript}\n\nREQUESTED EDIT:\n${editInstruction}`

    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${grokApiKey}`,
      },
      body: JSON.stringify({
        model: GROK_TEXT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: safeEditType === 'script_edit' ? 0.35 : 0.65,
        max_tokens: 2500,
      }),
    })

    if (!response.ok) return res.status(response.status).json({ error: `Grok API error: ${response.status}` })
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'script',
      model: GROK_TEXT_MODEL,
      inputTokens: data.usage?.prompt_tokens || estimateTokens(systemPrompt + userPrompt),
      outputTokens: data.usage?.completion_tokens || estimateTokens(content),
      success: true,
      metadata: { editType: safeEditType },
    })

    return res.status(200).json({ content })
  } catch (error) {
    console.error('Edit script error:', error)
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' })
  }
}
