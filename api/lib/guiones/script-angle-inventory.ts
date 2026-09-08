import type { AngleCandidate, Language, ScriptContextProfile, ScriptSettings } from './types.js'
import {
  ANGLE_MAX_TOKENS,
  angleInventoryNeeded,
  compactJson,
  getRequestedScriptTypes,
  safeJsonParse,
} from './utils.js'
import { GROK_API_URL, GROK_TEXT_MODEL_EFFICIENT } from '../grok-models.js'

interface GenerateAngleInventoryInput {
  apiKey: string
  profile: ScriptContextProfile
  settings?: ScriptSettings
  language: Language
  categoryLens: string
  /** Requested script type ids only — full type lenses belong on the draft call. */
  requestedTypes: string[]
  memoryPrompt?: string
  templatePrompt?: string
  recentBriefs?: string[]
}

/** Slim profile for planning: keep facts, drop empty arrays / nullish noise. */
export function compactProfileForAngles(profile: ScriptContextProfile): Record<string, unknown> {
  const slim: Record<string, unknown> = {
    productType: profile.productType,
    productName: profile.productName,
  }
  if (profile.businessName) slim.businessName = profile.businessName
  if (profile.category) slim.category = profile.category
  if (profile.activeSalesChannel) slim.activeSalesChannel = profile.activeSalesChannel
  if (profile.ctaStrength) slim.ctaStrength = profile.ctaStrength
  if (profile.offerFacts?.length) slim.offerFacts = profile.offerFacts.slice(0, 8)
  if (profile.proof?.length) slim.proof = profile.proof.slice(0, 6)
  if (profile.logistics?.length) slim.logistics = profile.logistics.slice(0, 4)
  if (profile.audienceSegments?.length) slim.audienceSegments = profile.audienceSegments.slice(0, 4)
  if (profile.pains?.length) slim.pains = profile.pains.slice(0, 4)
  if (profile.desires?.length) slim.desires = profile.desires.slice(0, 4)
  if (profile.objections?.length) slim.objections = profile.objections.slice(0, 4)
  if (profile.alternatives?.length) {
    slim.alternatives = profile.alternatives.slice(0, 4).map((alt) => ({
      name: alt.name,
      weakness: alt.weakness,
    }))
  }
  if (profile.bannedClaims?.length) slim.bannedClaims = profile.bannedClaims.slice(0, 8)
  if (profile.missingFacts?.length) slim.missingFacts = profile.missingFacts.slice(0, 6)
  return slim
}

async function callGrokJson(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  temperature: number,
  maxTokens: number
): Promise<string> {
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

export function anglePromptCharEstimate(input: {
  language: Language
  categoryLens: string
  requestedTypes: string[]
  memoryPrompt?: string
  templatePrompt?: string
  profile: ScriptContextProfile
  recentBriefs?: string[]
  settings?: ScriptSettings
}): { needed: number; userChars: number } {
  const needed = angleInventoryNeeded(input.settings)
  const isEs = input.language === 'es'
  const memory = (input.memoryPrompt || '').slice(0, 400)
  const templates = (input.templatePrompt || '').slice(0, 400)
  const user = `${isEs ? 'Crea' : 'Create'} ${needed}...
${input.categoryLens}
${input.requestedTypes.join(', ')}
${memory}
${templates}
${compactJson(compactProfileForAngles(input.profile))}
${(input.recentBriefs || []).join(' | ')}`
  return { needed, userChars: user.length }
}

export async function generateAngleInventory(input: GenerateAngleInventoryInput): Promise<AngleCandidate[]> {
  const requested = input.requestedTypes.length > 0
    ? input.requestedTypes
    : getRequestedScriptTypes(input.settings)
  const needed = angleInventoryNeeded(input.settings)
  const isEs = input.language === 'es'
  const memory = (input.memoryPrompt || '').slice(0, 400)
  const templates = (input.templatePrompt || '').slice(0, 400)
  const system = isEs
    ? `Eres un estratega senior de guiones para videos cortos. Creá candidatos de ángulo, NO guiones finales. Responde SOLO JSON válido {"candidates":[...]}.`
    : `You are a senior short-form video script strategist. Create angle candidates, NOT final scripts. Return ONLY valid JSON {"candidates":[...]}.`
  const user = `${isEs ? 'Creá' : 'Create'} ${needed} ${isEs ? 'candidatos de ángulo únicos' : 'unique angle candidates'}.

${isEs ? 'REGLAS' : 'RULES'}:
- ${isEs ? 'Usá solo hechos del perfil; nunca inventes claims.' : 'Use only facts from the profile; never invent claims.'}
- ${isEs ? 'Cada candidato debe variar hookMechanism, buyerStage, coreDoubt y proofToUse cuando sea posible.' : 'Each candidate must vary hookMechanism, buyerStage, coreDoubt and proofToUse where possible.'}
- ${isEs ? 'Si faltan datos, omití ese hecho — no inventes ni uses placeholders entre corchetes.' : 'If facts are missing, omit that fact — do not invent or use bracket placeholders.'}
- ${isEs ? 'Cubrí estos tipos solicitados' : 'Cover these requested types'}: ${requested.join(', ')}.
- ${isEs ? 'No reutilices estos briefs recientes' : 'Do not reuse these recent briefs'}: ${(input.recentBriefs || []).join(' | ') || 'none'}.

${isEs ? 'LENTE DE CATEGORÍA' : 'CATEGORY LENS'}:
${input.categoryLens}

${isEs ? 'PERFIL' : 'PROFILE'}:
${compactJson(compactProfileForAngles(input.profile))}

${memory ? `${isEs ? 'MEMORIA' : 'MEMORY'}:\n${memory}` : ''}
${templates ? `${isEs ? 'PLANTILLAS' : 'TEMPLATES'}:\n${templates}` : ''}

Campos por candidato: id, scriptType, hookMechanism, buyerStage (cold|warm|hot), audienceSegment, coreDoubt, proofToUse[], logisticsToUse[], hookDraft, whyItCouldWin, score (1-10).
hookMechanism ejemplos: direct_offer | alternative_invalidation | checklist | hidden_cost | use_case_split | myth_busting | process_certainty | social_proof | price_location | story_scene | options_menu | proof_milestone | logistics_risk_reversal`

  let text = ''
  try {
    // Planning uses efficient model already in-repo (grok-4.5) — draft stays on flagship.
    text = await callGrokJson(input.apiKey, GROK_TEXT_MODEL_EFFICIENT, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], 0.7, ANGLE_MAX_TOKENS)
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
    .map((candidate, index) => normalizeCandidate(candidate, index, (requested[index % requested.length] || 'venta_directa') as AngleCandidate['scriptType']))
}
