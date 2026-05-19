import type { GeneratedScript, Language, ScriptBrief, ScriptContextProfile } from './types.js'
import { safeJsonParse, typeLabel } from './utils.js'
import { GROK_API_URL, GROK_TEXT_MODEL } from '../grok-models.js'

interface DraftScriptsInput {
  apiKey: string
  briefs: ScriptBrief[]
  profile: ScriptContextProfile
  language: Language
  categoryLens: string
  typeLenses: string[]
}

async function callDraft(apiKey: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  const response = await fetch(GROK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROK_TEXT_MODEL,
      messages,
      temperature: 0.8,
      max_tokens: 5000,
      response_format: { type: 'json_object' },
    }),
  })
  if (!response.ok) throw new Error(`Grok draft failed: ${response.status} ${await response.text()}`)
  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

function normalizeScript(raw: Partial<GeneratedScript>, brief: ScriptBrief, language: Language): GeneratedScript {
  const hook = raw.spokenScript?.hook || brief.openingPromise || (language === 'es' ? '[GANCHO]' : '[HOOK]')
  const development = raw.spokenScript?.development || brief.developmentBeats.join(' ')
  const ctaOrClose = raw.spokenScript?.ctaOrClose || brief.cta.textDirection
  return {
    index: brief.index,
    title: raw.title || `${typeLabel(brief.scriptType, language)} - ${brief.hookMechanism}`,
    scriptType: brief.scriptType,
    hookMechanism: raw.hookMechanism || brief.hookMechanism,
    buyerStage: raw.buyerStage || brief.buyerStage,
    spokenScript: { hook, development, ctaOrClose },
    qualityScore: typeof raw.qualityScore === 'number' ? raw.qualityScore : 0,
  }
}

export async function draftScriptsFromBriefs(input: DraftScriptsInput): Promise<GeneratedScript[]> {
  const isEs = input.language === 'es'
  const system = isEs
    ? `Eres un copywriter senior. Vas a escribir guiones desde briefs bloqueados. No cambies la estrategia. Responde SOLO JSON valido {"scripts":[...]}.`
    : `You are a senior copywriter. You will write scripts from locked briefs. Do not change strategy. Return ONLY valid JSON {"scripts":[...]}.`
  const user = `${isEs ? 'Escribe exactamente' : 'Write exactly'} ${input.briefs.length} ${isEs ? 'guiones' : 'scripts'}.

${isEs ? 'REGLAS' : 'RULES'}:
- ${isEs ? 'Cada guion ejecuta su brief bloqueado. No agregues otra idea.' : 'Each script executes its locked brief. Do not add another idea.'}
- ${isEs ? 'Usa mustIncludeFacts. Si falta algo, usa placeholders especificos.' : 'Use mustIncludeFacts. If something is missing, use specific placeholders.'}
- ${isEs ? 'No repitas hookMechanism ni buyerStage entre guiones si el brief ya los separo.' : 'Do not repeat hookMechanism or buyerStage across scripts if the briefs separated them.'}
- ${isEs ? 'Frases de video corto, habladas, directas. Sin saludos.' : 'Short-form video spoken lines, direct. No greetings.'}
- ${isEs ? 'No inventes precios, garantias, resultados, cantidades, ubicaciones, platos ni casos.' : 'Do not invent prices, guarantees, outcomes, quantities, locations, dishes, or cases.'}

${isEs ? 'LENTE CATEGORIA' : 'CATEGORY LENS'}:
${input.categoryLens}

${isEs ? 'LENTES TIPO' : 'TYPE LENSES'}:
${input.typeLenses.join('\n\n')}

${isEs ? 'PERFIL' : 'PROFILE'}:
${JSON.stringify(input.profile, null, 2)}

${isEs ? 'BRIEFS BLOQUEADOS' : 'LOCKED BRIEFS'}:
${JSON.stringify(input.briefs, null, 2)}

JSON schema:
{
  "scripts": [{
    "index": 1,
    "title": "Venta Directa - price_location",
    "scriptType": "venta_directa",
    "hookMechanism": "price_location",
    "buyerStage": "hot",
    "spokenScript": {
      "hook": "literal hook",
      "development": "literal development",
      "ctaOrClose": "literal CTA or close"
    },
    "qualityScore": 0
  }]
}`

  const text = await callDraft(input.apiKey, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])
  const parsed = safeJsonParse<{ scripts?: Partial<GeneratedScript>[] }>(text)
  if (!Array.isArray(parsed?.scripts) || parsed.scripts.length === 0) {
    throw new Error('Drafting returned no valid scripts')
  }
  return input.briefs.map(brief => normalizeScript(parsed.scripts?.find(script => script.index === brief.index) || {}, brief, input.language))
}

export function renderScriptsAsText(scripts: GeneratedScript[], language: Language): string {
  const isEs = language === 'es'
  return scripts.map(script => {
    const type = typeLabel(script.scriptType, language)
    const hookLabel = isEs ? 'GANCHO' : 'HOOK'
    const devLabel = isEs ? 'DESARROLLO' : 'DEVELOPMENT'
    const ctaLabel = ['reconocimiento', 'educativo', 'storytelling', 'tendencia', 'engagement'].includes(script.scriptType)
      ? (isEs ? 'CIERRE' : 'CLOSE')
      : 'CTA'
    return `${isEs ? 'OPCION' : 'OPTION'} #${script.index} - ${type} - ${script.title}
[${hookLabel}]: ${script.spokenScript.hook}
[${devLabel}]: ${script.spokenScript.development}
[${ctaLabel}]: ${script.spokenScript.ctaOrClose}`
  }).join('\n\n')
}
