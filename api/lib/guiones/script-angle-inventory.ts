import type { AngleCandidate, Language, ScriptContextProfile, ScriptSettings } from './types.js'
import { getRequestedScriptTypes, getTotalRequested, safeJsonParse } from './utils.js'
import { GROK_API_URL, GROK_TEXT_MODEL } from '../grok-models.js'

interface GenerateAngleInventoryInput {
  apiKey: string
  profile: ScriptContextProfile
  settings?: ScriptSettings
  language: Language
  categoryLens: string
  typeLenses: string[]
  memoryPrompt?: string
  templatePrompt?: string
  recentBriefs?: string[]
}

async function callGrokJson(apiKey: string, model: string, messages: Array<{ role: string; content: string }>, temperature: number, maxTokens: number): Promise<string> {
  const response = await fetch(GROK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  })
  if (!response.ok) throw new Error(`Grok ${model} failed: ${response.status} ${await response.text()}`)
  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

function normalizeCandidate(raw: Partial<AngleCandidate>, index: number, fallbackType: AngleCandidate['scriptType']): AngleCandidate {
  const buyerStage = raw.buyerStage === 'cold' || raw.buyerStage === 'warm' || raw.buyerStage === 'hot'
    ? raw.buyerStage
    : (index % 3 === 0 ? 'cold' : index % 3 === 1 ? 'warm' : 'hot')
  return {
    id: raw.id || `angle_${index + 1}`,
    scriptType: raw.scriptType || fallbackType,
    hookMechanism: raw.hookMechanism || `angle_${index + 1}`,
    buyerStage,
    audienceSegment: raw.audienceSegment || 'primary audience',
    coreDoubt: raw.coreDoubt || 'why this offer is the right fit',
    proofToUse: Array.isArray(raw.proofToUse) ? raw.proofToUse.slice(0, 4).map(String) : [],
    logisticsToUse: Array.isArray(raw.logisticsToUse) ? raw.logisticsToUse.slice(0, 3).map(String) : [],
    hookDraft: raw.hookDraft || '',
    whyItCouldWin: raw.whyItCouldWin || 'specific angle grounded in available context',
    score: typeof raw.score === 'number' ? raw.score : 7,
  }
}

export async function generateAngleInventory(input: GenerateAngleInventoryInput): Promise<AngleCandidate[]> {
  const requested = getRequestedScriptTypes(input.settings)
  const needed = Math.max(getTotalRequested(input.settings) * 3, 8)
  const isEs = input.language === 'es'
  const system = isEs
    ? `Eres un estratega senior de guiones para videos cortos. Tu trabajo es crear candidatos de angulo, NO escribir guiones finales. Responde SOLO JSON valido con la forma {"candidates":[...]}.`
    : `You are a senior short-form video script strategist. Your job is to create angle candidates, NOT final scripts. Return ONLY valid JSON shaped as {"candidates":[...]}.`
  const user = `${isEs ? 'Crea' : 'Create'} ${needed} ${isEs ? 'candidatos de angulo unicos' : 'unique angle candidates'}.

${isEs ? 'REGLAS' : 'RULES'}:
- ${isEs ? 'Usa solo hechos del perfil; nunca inventes claims.' : 'Use only facts from the profile; never invent claims.'}
- ${isEs ? 'Cada candidato debe variar hookMechanism, buyerStage, coreDoubt y proofToUse cuando sea posible.' : 'Each candidate must vary hookMechanism, buyerStage, coreDoubt and proofToUse where possible.'}
- ${isEs ? 'Si faltan datos, usa placeholders especificos en hookDraft o proofToUse.' : 'If facts are missing, use specific placeholders in hookDraft or proofToUse.'}
- ${isEs ? 'Incluye suficientes candidatos para estos tipos solicitados' : 'Include enough candidates for these requested types'}: ${requested.join(', ')}.
- ${isEs ? 'No reutilices estos briefs recientes' : 'Do not reuse these recent briefs'}: ${(input.recentBriefs || []).join(' | ') || 'none'}.

${isEs ? 'LENTE DE CATEGORIA' : 'CATEGORY LENS'}:
${input.categoryLens}

${isEs ? 'LENTES DE TIPO' : 'TYPE LENSES'}:
${input.typeLenses.join('\n\n')}

${input.memoryPrompt ? `${isEs ? 'MEMORIA RELEVANTE' : 'RELEVANT MEMORY'}:\n${input.memoryPrompt.slice(0, 2500)}` : ''}
${input.templatePrompt ? `${isEs ? 'PLANTILLAS RELEVANTES' : 'RELEVANT TEMPLATES'}:\n${input.templatePrompt.slice(0, 2500)}` : ''}

${isEs ? 'PERFIL DE CONTEXTO' : 'CONTEXT PROFILE'}:
${JSON.stringify(input.profile, null, 2)}

JSON schema:
{
  "candidates": [{
    "id": "angle_1",
    "scriptType": "${requested[0] || 'venta_directa'}",
    "hookMechanism": "direct_offer | alternative_invalidation | checklist | hidden_cost | use_case_split | myth_busting | process_certainty | social_proof | price_location | story_scene | options_menu | proof_milestone | logistics_risk_reversal",
    "buyerStage": "cold | warm | hot",
    "audienceSegment": "specific audience",
    "coreDoubt": "real doubt removed",
    "proofToUse": ["specific fact or placeholder"],
    "logisticsToUse": ["specific logistics or placeholder"],
    "hookDraft": "possible hook line",
    "whyItCouldWin": "why this angle could work",
    "score": 1-10
  }]
}`

  let text = ''
  try {
    text = await callGrokJson(input.apiKey, GROK_TEXT_MODEL, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], 0.7, 4000)
  } catch (error) {
    console.warn('Planning model failed:', error)
    throw error
  }

  const parsed = safeJsonParse<{ candidates?: Partial<AngleCandidate>[] }>(text)
  const rawCandidates = parsed?.candidates
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    throw new Error('Angle inventory returned no valid candidates')
  }
  return rawCandidates
    .slice(0, Math.max(needed, requested.length))
    .map((candidate, index) => normalizeCandidate(candidate, index, requested[index % requested.length] || 'venta_directa'))
}
