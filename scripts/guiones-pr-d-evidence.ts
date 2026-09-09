/**
 * Local evidence harness for PR D — prompt-size before/after + optional live Grok timing.
 * Run: npx tsx scripts/guiones-pr-d-evidence.ts
 * Does not charge user credits (direct pipeline call).
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { buildScriptContextProfile } from '../api/lib/guiones/script-context-profile'
import { selectScriptBriefs } from '../api/lib/guiones/script-briefs'
import { getCategoryLens } from '../api/lib/guiones/script-prompts/category-lenses'
import { getTypeLens } from '../api/lib/guiones/script-prompts/type-lenses'
import { anglePromptCharEstimate, compactProfileForAngles } from '../api/lib/guiones/script-angle-inventory'
import { draftPromptCharEstimate } from '../api/lib/guiones/script-output'
import { runGuionesStructuredPipeline } from '../api/lib/guiones/script-pipeline'
import { angleInventoryNeeded, compactJson } from '../api/lib/guiones/utils'
import type { AngleCandidate, ScriptSettings } from '../api/lib/guiones/types'
import { CREDIT_WEIGHTS } from '../api/lib/credits/catalog'

const settings: ScriptSettings = {
  framework: 'venta_directa',
  variations: 1,
  generationMode: 'mixed',
  useStructuredPipeline: true,
  ctaStrength: 'sales',
}

const profile = buildScriptContextProfile({
  businessContext: {
    name: 'HidrateCR',
    sales_channels: ['messages'],
    does_shipping: true,
    shipping_method: 'envío 48h en GAM',
    location: 'San José',
  },
  productContext: {
    name: 'Smart Bottle Pro',
    type: 'product',
    product_category: 'botella térmica',
    product_description: 'Mantiene el agua fría 24 horas sin condensación',
    technical_specs: 'acero de doble pared 500ml',
    exact_price: '₡9.900',
    current_alternatives: 'botellas de plástico del súper',
    alternatives_disadvantages: 'se calientan en una hora y sudan',
    differentiation: 'tapa hermética + acero + envío 48h',
    has_guarantee: true,
    guarantee_details: 'cambio por filtración en 30 días',
  },
  activeSalesChannel: 'messages',
  ctaStrength: 'sales',
})

const categoryLens = getCategoryLens('product', 'es')
const typeLenses = ['venta_directa', 'desvalidar_alternativas', 'mostrar_servicio']
  .map((t) => getTypeLens(t as 'venta_directa', 'sales', 'es'))

// --- BEFORE (reconstructed master prompt shape) ---
const beforeNeeded = Math.max(1 * 3, 8)
const beforeAngleUser =
  `Create ${beforeNeeded} unique angle candidates.\n` +
  categoryLens + '\n' +
  typeLenses.join('\n\n') + '\n' +
  JSON.stringify(profile, null, 2) + '\n' +
  'MEMORY:\n' + 'x'.repeat(2500) + '\n' +
  'TEMPLATES:\n' + 'y'.repeat(2500)
const beforeDraftUser =
  `Write exactly 1 scripts.\n` +
  categoryLens + '\n' +
  typeLenses.join('\n\n') + '\n' +
  JSON.stringify(profile, null, 2) + '\n' +
  JSON.stringify([{ index: 1, developmentBeats: ['Resolve doubt: x', 'Use proof: y'], cta: { textDirection: 'Drive to send a message/DM with a concrete next step.' } }], null, 2)

const afterAngle = anglePromptCharEstimate({
  language: 'es',
  categoryLens,
  requestedTypes: ['venta_directa'],
  memoryPrompt: 'x'.repeat(800),
  templatePrompt: 'y'.repeat(800),
  profile,
  settings,
})
const stubCandidate: AngleCandidate = {
  id: 'a1',
  scriptType: 'venta_directa',
  hookMechanism: 'price_location',
  buyerStage: 'hot',
  audienceSegment: 'GAM',
  coreDoubt: 'si vale los ₡9.900',
  proofToUse: ['acero de doble pared 500ml', '₡9.900'],
  logisticsToUse: ['envío 48h en GAM'],
  hookDraft: '₡9.900 y llega en 48h',
  whyItCouldWin: 'precio + logística',
  score: 9,
}
const briefs = selectScriptBriefs([stubCandidate], settings, 'product', 'sales', 'messages', 'es')
const afterDraft = draftPromptCharEstimate({
  briefs,
  profile,
  language: 'es',
  categoryLens,
  ctaStrength: 'sales',
})

const sizeReport = {
  creditUnchanged: CREDIT_WEIGHTS.guion_oferta,
  before: {
    angleCandidates: beforeNeeded,
    angleUserChars: beforeAngleUser.length,
    draftUserChars: beforeDraftUser.length,
    angleMaxTokens: 4000,
    draftMaxTokens: 5000,
    angleModel: 'grok-4.6',
    briefsLanguage: 'en scaffold',
  },
  after: {
    angleCandidates: afterAngle.needed,
    angleUserChars: afterAngle.userChars,
    draftUserChars: afterDraft.userChars,
    angleMaxTokens: 1600,
    draftMaxTokens: afterDraft.maxTokens,
    angleModel: 'grok-4.5',
    briefsLanguage: briefs[0].developmentBeats[0],
    compactProfileSample: compactJson(compactProfileForAngles(profile)).slice(0, 200),
  },
  promptCharReduction: {
    angle: beforeAngleUser.length - afterAngle.userChars,
    draft: beforeDraftUser.length - afterDraft.userChars,
    anglePct: Math.round((1 - afterAngle.userChars / beforeAngleUser.length) * 100),
    draftPct: Math.round((1 - afterDraft.userChars / beforeDraftUser.length) * 100),
  },
}

async function liveRun() {
  const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY
  if (!apiKey) {
    return { skipped: true, reason: 'no GROK_API_KEY' }
  }
  const t0 = Date.now()
  const result = await runGuionesStructuredPipeline({
    apiKey,
    businessContext: {
      name: 'HidrateCR',
      sales_channels: ['messages'],
      does_shipping: true,
      shipping_method: 'envío 48h en GAM',
    },
    productContext: {
      name: 'Smart Bottle Pro',
      type: 'product',
      product_category: 'botella térmica',
      product_description: 'Mantiene el agua fría 24 horas sin condensación',
      technical_specs: 'acero de doble pared 500ml',
      exact_price: '₡9.900',
      current_alternatives: 'botellas de plástico del súper',
      alternatives_disadvantages: 'se calientan en una hora y sudan',
      differentiation: 'tapa hermética + acero + envío 48h',
      has_guarantee: true,
      guarantee_details: 'cambio por filtración en 30 días',
    },
    activeSalesChannel: 'messages',
    language: 'es',
    scriptSettings: settings,
  })
  return {
    skipped: false,
    wallMs: Date.now() - t0,
    timings: result.timings,
    sampleScript: result.scripts[0]?.spokenScript,
    contentPreview: result.content.slice(0, 900),
    briefs: result.briefs.map((b) => ({
      beats: b.developmentBeats,
      cta: b.cta.textDirection,
    })),
    quality: result.qualityReports,
  }
}

const live = await liveRun()
const out = { generatedAt: new Date().toISOString(), sizeReport, live, angleInventoryNeeded: angleInventoryNeeded(settings) }
mkdirSync('/opt/cursor/artifacts', { recursive: true })
writeFileSync('/opt/cursor/artifacts/guiones_pr_d_evidence.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
