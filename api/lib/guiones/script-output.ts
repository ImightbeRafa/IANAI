import type { GeneratedScript, Language, ScriptBrief, ScriptContextProfile, ScriptFramework } from './types.js'
import { compactJson, draftMaxTokens, safeJsonParse, typeLabel } from './utils.js'
import {
  GROK_API_URL,
  GROK_TEXT_MODEL_EFFICIENT,
  resolveGrokTextModel,
  type GrokTextModelId,
} from '../grok-models.js'
import { getTypeLens } from './script-prompts/type-lenses.js'
import type { CTAStrength } from './types.js'
import { attachSpokenTiming } from './script-timing.js'
import type { CloseLabel, ScriptSectionsDto } from './script-sections-parse.js'

interface DraftScriptsInput {
  apiKey: string
  briefs: ScriptBrief[]
  profile: ScriptContextProfile
  language: Language
  categoryLens: string
  ctaStrength?: CTAStrength
  /** UI/legacy model field — efficient drafts grok-4.5, best drafts grok-4.6. */
  draftModel?: string
}

const ORGANIC_OR_AWARENESS: ScriptFramework[] = [
  'reconocimiento',
  'educativo',
  'storytelling',
  'tendencia',
  'engagement',
]

export function resolveGuionesDraftModel(input?: string | null): GrokTextModelId {
  const resolved = resolveGrokTextModel(input)
  if (resolved === GROK_TEXT_MODEL_EFFICIENT) {
    return resolveGrokTextModel(process.env.GUIONES_DRAFT_MODEL_EFFICIENT, GROK_TEXT_MODEL_EFFICIENT)
  }
  return resolved
}

export function closeSectionLabel(scriptType: ScriptFramework, language: Language): CloseLabel {
  if (ORGANIC_OR_AWARENESS.includes(scriptType)) return language === 'es' ? 'CIERRE' : 'CLOSE'
  return 'CTA'
}

/** Slim profile for drafting — facts the copywriter needs, no empty noise. */
export function compactProfileForDraft(profile: ScriptContextProfile): Record<string, unknown> {
  const slim: Record<string, unknown> = {
    productType: profile.productType,
    productName: profile.productName,
  }
  if (profile.businessName) slim.businessName = profile.businessName
  if (profile.category) slim.category = profile.category
  if (profile.activeSalesChannel) slim.activeSalesChannel = profile.activeSalesChannel
  if (profile.ctaStrength) slim.ctaStrength = profile.ctaStrength
  if (profile.offerFacts?.length) slim.offerFacts = profile.offerFacts.slice(0, 10)
  if (profile.proof?.length) slim.proof = profile.proof.slice(0, 8)
  if (profile.logistics?.length) slim.logistics = profile.logistics.slice(0, 5)
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
  if (profile.sensoryFacts?.length) slim.sensoryFacts = profile.sensoryFacts.slice(0, 4)
  return slim
}

export function compactBriefForDraft(brief: ScriptBrief): Record<string, unknown> {
  return {
    index: brief.index,
    scriptType: brief.scriptType,
    hookMechanism: brief.hookMechanism,
    buyerStage: brief.buyerStage,
    openingPromise: brief.openingPromise,
    developmentBeats: brief.developmentBeats,
    mustIncludeFacts: brief.mustIncludeFacts,
    mustAvoid: brief.mustAvoid.slice(0, 5),
    cta: brief.cta,
    coreDoubt: brief.coreDoubt,
  }
}

export function draftPromptCharEstimate(input: {
  briefs: ScriptBrief[]
  profile: ScriptContextProfile
  language: Language
  categoryLens: string
  ctaStrength?: CTAStrength
}): { userChars: number; maxTokens: number; typeLensChars: number } {
  const isEs = input.language === 'es'
  const typeLenses = Array.from(new Set(input.briefs.map((b) => b.scriptType)))
    .map((type) => getTypeLens(type, input.ctaStrength || input.profile.ctaStrength, input.language))
  const user = `${input.briefs.length}${input.categoryLens}${typeLenses.join('')}${compactJson(compactProfileForDraft(input.profile))}${compactJson(input.briefs.map(compactBriefForDraft))}${isEs ? 'es' : 'en'}`
  return {
    userChars: user.length,
    maxTokens: draftMaxTokens(input.briefs.length),
    typeLensChars: typeLenses.join('').length,
  }
}

async function callDraft(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
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
      temperature: 0.75,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  })
  if (!response.ok) throw new Error(`Grok draft failed: ${response.status} ${await response.text()}`)
  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

function normalizeScript(raw: Partial<GeneratedScript>, brief: ScriptBrief, language: Language): GeneratedScript {
  const hook = raw.spokenScript?.hook || brief.openingPromise || (language === 'es' ? 'Empezá con el dolor o la oferta concreta' : '[HOOK]')
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
  const maxTokens = draftMaxTokens(input.briefs.length)
  const uniqueTypes = Array.from(new Set(input.briefs.map((b) => b.scriptType))) as ScriptFramework[]
  const typeLenses = uniqueTypes.map((type) => getTypeLens(type, input.ctaStrength || input.profile.ctaStrength, input.language))
  const draftModel = resolveGuionesDraftModel(input.draftModel)

  const role = isEs
    ? `Eres un copywriter senior de videos cortos en español centroamericano (voseo natural: vos/elegí/escribí). Escribí guiones hablados desde briefs bloqueados. No cambies la estrategia. Responde SOLO JSON válido {"scripts":[...]}.`
    : `You are a senior short-form video copywriter. Write scripts from locked briefs. Do not change strategy. Return ONLY valid JSON {"scripts":[...]}.`

  const staticRules = `${isEs ? 'REGLAS' : 'RULES'}:
- ${isEs ? 'Cada guion ejecuta su brief bloqueado. No agregues otra idea.' : 'Each script executes its locked brief. Do not add another idea.'}
- ${isEs ? 'Usá mustIncludeFacts cuando existan. Si falta un dato, omitilo — NUNCA escribas placeholders entre corchetes como [PRECIO].' : 'Use mustIncludeFacts when present. If a fact is missing, omit it — NEVER write bracket placeholders like [PRICE].'}
- ${isEs ? 'No repitas hookMechanism ni buyerStage entre guiones si el brief ya los separó.' : 'Do not repeat hookMechanism or buyerStage across scripts if the briefs separated them.'}
- ${isEs ? 'Frases de video corto, habladas, directas, con tensión o deseo concreto. Sin saludos (hola/bienvenidos).' : 'Short-form video spoken lines, direct. No greetings.'}
- ${isEs ? 'No inventes precios, garantías, resultados, cantidades, ubicaciones, platos ni casos.' : 'Do not invent prices, guarantees, outcomes, quantities, locations, dishes, or cases.'}
- ${isEs ? 'No digas enums internos en voz alta: cold/warm/hot, economico, price_range, snake_case de hookMechanism.' : 'Do not speak internal enums aloud: cold/warm/hot, economico, price_range, snake_case hookMechanism.'}
- ${isEs ? 'Español coherente y útil: una idea clara por guion, desarrollo que avance la duda del brief, CTA que coincida con cta.textDirection.' : 'Coherent useful copy: one clear idea per script, development that advances the brief doubt, CTA matching cta.textDirection.'}

${isEs ? 'LENTE CATEGORÍA' : 'CATEGORY LENS'}:
${input.categoryLens}

${isEs ? 'LENTES TIPO (solo los del lote)' : 'TYPE LENSES (batch only)'}:
${typeLenses.join('\n\n')}`

  const system = `${role}

${staticRules}`

  const user = `${isEs ? 'Escribí exactamente' : 'Write exactly'} ${input.briefs.length} ${isEs ? 'guiones' : 'scripts'}.

${isEs ? 'PERFIL' : 'PROFILE'}:
${compactJson(compactProfileForDraft(input.profile))}

${isEs ? 'BRIEFS BLOQUEADOS' : 'LOCKED BRIEFS'}:
${compactJson(input.briefs.map(compactBriefForDraft))}

Campos por script: index, title, scriptType, hookMechanism, buyerStage, spokenScript:{hook,development,ctaOrClose}, qualityScore.`

  const text = await callDraft(input.apiKey, draftModel, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], maxTokens)
  const parsed = safeJsonParse<{ scripts?: Partial<GeneratedScript>[] }>(text)
  if (!Array.isArray(parsed?.scripts) || parsed.scripts.length === 0) {
    throw new Error('Drafting returned no valid scripts')
  }
  return input.briefs.map(brief => normalizeScript(parsed.scripts?.find(script => script.index === brief.index) || {}, brief, input.language))
}

function quoteTitle(title: string): string {
  const cleaned = (title || '').replace(/^["“]|["”]$/g, '').trim()
  return cleaned ? `"${cleaned}"` : ''
}

export function renderOneScriptAsText(script: GeneratedScript, language: Language): string {
  const isEs = language === 'es'
  const type = typeLabel(script.scriptType, language)
  const timed = script.timing || attachSpokenTiming(script, language).timing!
  const hookLabel = isEs ? 'GANCHO' : 'HOOK'
  const devLabel = isEs ? 'DESARROLLO' : 'DEVELOPMENT'
  const ctaLabel = closeSectionLabel(script.scriptType, language)
  const title = quoteTitle(script.title)
  const header = `${isEs ? 'OPCIÓN' : 'OPTION'} #${script.index} — ${type}${title ? ` — ${title}` : ''}`
  return `${header}
[${hookLabel} · ~${timed.hookSeconds} s]
${script.spokenScript.hook}

[${devLabel} · ~${timed.developmentSeconds} s]
${script.spokenScript.development}

[${ctaLabel} · ~${timed.ctaSeconds} s]
${script.spokenScript.ctaOrClose}`
}

export function renderScriptsAsText(scripts: GeneratedScript[], language: Language): string {
  return scripts.map((script) => renderOneScriptAsText(script, language)).join('\n\n')
}

export function toScriptSectionsDto(script: GeneratedScript, language: Language): ScriptSectionsDto {
  const timed = script.timing || attachSpokenTiming(script, language).timing!
  const isEs = language === 'es'
  const closeLabel = closeSectionLabel(script.scriptType, language)
  return {
    index: script.index,
    title: script.title,
    scriptType: script.scriptType,
    scriptTypeLabel: typeLabel(script.scriptType, language),
    hook: {
      label: isEs ? 'GANCHO' : 'HOOK',
      text: script.spokenScript.hook,
      seconds: timed.hookSeconds,
    },
    development: {
      label: isEs ? 'DESARROLLO' : 'DEVELOPMENT',
      text: script.spokenScript.development,
      seconds: timed.developmentSeconds,
    },
    close: {
      label: closeLabel,
      text: script.spokenScript.ctaOrClose,
      seconds: timed.ctaSeconds,
    },
    totalSeconds: timed.totalSeconds,
    content: renderOneScriptAsText(script, language),
  }
}

export function scriptsToSectionsDto(scripts: GeneratedScript[], language: Language): ScriptSectionsDto[] {
  return scripts.map((script) => toScriptSectionsDto(script, language))
}
