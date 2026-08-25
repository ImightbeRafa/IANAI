import { generateAngleInventory } from './script-angle-inventory.js'
import { selectScriptBriefs } from './script-briefs.js'
import { buildScriptContextProfile } from './script-context-profile.js'
import { draftScriptsFromBriefs, renderScriptsAsText } from './script-output.js'
import { getCategoryLens } from './script-prompts/category-lenses.js'
import { getTypeLens } from './script-prompts/type-lenses.js'
import { applyQualityScores, evaluateScriptBatch, repairFailedScripts } from './script-quality.js'
import { injectRelevantScriptMemory } from './script-memory.js'
import type {
  BusinessContextLike,
  ContextDocumentData,
  CTAStrength,
  GuionesPipelineResult,
  Language,
  ProductContextLike,
  SalesChannel,
  ScriptSettings,
} from './types.js'
import { getRequestedScriptTypes } from './utils.js'

interface RunPipelineInput {
  apiKey: string
  businessContext?: BusinessContextLike
  productContext?: ProductContextLike
  contextDocuments?: ContextDocumentData[]
  activeSalesChannel?: SalesChannel
  language: Language
  scriptSettings?: ScriptSettings
  styleMemoryPrompt?: string
  scriptTemplatesPrompt?: string
  /** Brand-kit forbidden phrases injected into the quality gate. */
  forbiddenPhrases?: string[]
}

function effectiveCtaStrength(settings: ScriptSettings | undefined, requestedTypes: string[]): CTAStrength {
  if (settings?.ctaStrength) return settings.ctaStrength
  const onlyOrganic = requestedTypes.length > 0 && requestedTypes.every(type => ['educativo', 'storytelling', 'tendencia', 'engagement', 'reconocimiento'].includes(type))
  return onlyOrganic ? 'soft' : 'sales'
}

export async function runGuionesStructuredPipeline(input: RunPipelineInput): Promise<GuionesPipelineResult> {
  const requestedTypes = getRequestedScriptTypes(input.scriptSettings)
  const ctaStrength = effectiveCtaStrength(input.scriptSettings, requestedTypes)
  const contextProfile = buildScriptContextProfile({
    businessContext: input.businessContext,
    productContext: input.productContext,
    contextDocuments: input.contextDocuments,
    activeSalesChannel: input.activeSalesChannel,
    ctaStrength,
  })
  const categoryLens = getCategoryLens(contextProfile.productType, input.language)
  const uniqueTypeLenses = Array.from(new Set(requestedTypes))
    .map(type => getTypeLens(type, ctaStrength, input.language))
  const { memoryPrompt, templatePrompt } = injectRelevantScriptMemory({
    styleMemoryPrompt: input.styleMemoryPrompt,
    scriptTemplatesPrompt: input.scriptTemplatesPrompt,
    productType: contextProfile.productType,
    requestedTypes,
  })

  const angleCandidates = await generateAngleInventory({
    apiKey: input.apiKey,
    profile: contextProfile,
    settings: input.scriptSettings,
    language: input.language,
    categoryLens,
    typeLenses: uniqueTypeLenses,
    memoryPrompt,
    templatePrompt,
    recentBriefs: input.scriptSettings?.forceFreshAngles ? [] : undefined,
  })
  const briefs = selectScriptBriefs(
    angleCandidates,
    input.scriptSettings,
    contextProfile.productType,
    ctaStrength,
    input.activeSalesChannel,
  )
  const drafted = await draftScriptsFromBriefs({
    apiKey: input.apiKey,
    briefs,
    profile: contextProfile,
    language: input.language,
    categoryLens,
    typeLenses: uniqueTypeLenses,
  })
  const firstReports = evaluateScriptBatch(drafted, briefs, {
    forbiddenPhrases: input.forbiddenPhrases,
  })
  const repaired = repairFailedScripts(drafted, firstReports, briefs)
  const qualityReports = evaluateScriptBatch(repaired, briefs, {
    forbiddenPhrases: input.forbiddenPhrases,
  })
  const scripts = applyQualityScores(repaired, qualityReports)
  // Strip any lingering unresolved placeholders before save (fail-soft for callers).
  const cleaned = scripts.map((script) => {
    const strip = (value: string) => value.replace(/\[[A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 _./-]{1,60}\]/g, '').replace(/\s{2,}/g, ' ').trim()
    return {
      ...script,
      spokenScript: {
        hook: strip(script.spokenScript.hook),
        development: strip(script.spokenScript.development),
        ctaOrClose: strip(script.spokenScript.ctaOrClose),
      },
    }
  })
  const content = renderScriptsAsText(cleaned, input.language)
  const promptPreview = [
    categoryLens,
    ...uniqueTypeLenses,
    memoryPrompt ? `MEMORY:\n${memoryPrompt}` : '',
    templatePrompt ? `TEMPLATES:\n${templatePrompt}` : '',
  ].filter(Boolean).join('\n\n')

  return {
    content,
    contextProfile,
    angleCandidates,
    briefs,
    qualityReports,
    scripts: cleaned,
    promptPreview,
  }
}

