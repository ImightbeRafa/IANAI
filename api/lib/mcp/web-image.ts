/**
 * MCP ↔ web image bridge: one function that makes the MCP image tools call the same Grok post
 * flow as the web app (`api/lib/web-post-image.ts`), feeding it the brand kit, the offer and the
 * copy, then running the free local post-checks (fidelity_warning + safety-net QA).
 * Warning only: nothing here blocks a result, retries, or changes credits.
 */
import { readOfferAdProfile } from '../adpack/offer-profile.js'
import { roleFromImageRow, roleFromLabel, stripRolePrefix } from '../adpack/fidelity/photos.js'
import { reframeToRatio, resolveImageRatio } from '../image-ratios.js'
import type { ProductCreativeRow } from '../product-creative-rules.js'
import { runWebPostGrokImage, type WebPostGrokImageResult } from '../web-post-image.js'
import { checkGeneratedProductFidelity, runMcpImageQa, tidyCopySeparators, type FidelityCheckResult, type FidelityWarning, type McpImageQa } from './image-postcheck.js'
import type { McpBrandContext } from './user-tools.js'

export type OfferLock = {
  lockProductAppearance?: boolean
  immutableAttributes?: string[]
  /** Objects the offer explicitly allows next to the product (ad_profile.allowedProps). */
  allowedProps?: string[]
  /**
   * MCP: always true. Nothing may appear that is not the locked product, a reference photo, an allowed prop
   * or named in the scene (no invented boxes, controllers, logos or packaging).
   */
  forbidExtraProps: boolean
}

/** products.ad_profile → product lock (lockProductAppearance / immutableAttributes / allowedProps) + the no-extra-props rule. */
export function offerLockFromRow(row: Record<string, unknown> | null | undefined): OfferLock {
  const profile = readOfferAdProfile(row?.ad_profile)
  if (!profile) return { forbidExtraProps: true }
  return {
    lockProductAppearance: profile.lockProductAppearance === true,
    immutableAttributes: [...(profile.immutableAttributes ?? [])],
    allowedProps: [...(profile.allowedProps ?? [])],
    forbidExtraProps: true,
  }
}

const ACCESSORY_ROLES = new Set(['box', 'contents', 'part'])
const ACCESSORY_PRIORITY: Record<string, number> = { box: 0, contents: 1, part: 2 }

/**
 * Real accessory photos of the offer (box / contents / parts such as the controller) to attach as extra
 * references. Prioritisation inside Grok's 3-slot budget: [hero, best accessory, logo]; with no logo a second
 * accessory fits. Accessory order: a photo whose role/label/tags match a word of the offer lock or the scene
 * (e.g. lock says "Caja TOPGT" → the box photo) first, then box > contents > part, then primary/newest.
 */
export function pickAccessoryPhotos(
  assets: Array<{ id: string; imageUrl: string; label?: string | null; role?: string | null; tags?: string[]; isPrimary?: boolean; kind?: string }>,
  options: { excludeIds: string[]; lockText?: string; max?: number }
): Array<{ id: string; imageUrl: string; role: 'box' | 'contents' | 'part'; label: string }> {
  const lockWords = new Set((options.lockText || '').toLowerCase().split(/[^a-záéíóúñ0-9]+/).filter((w) => w.length >= 4))
  const rows: Array<{ id: string; imageUrl: string; role: 'box' | 'contents' | 'part'; label: string; score: number }> = []
  for (const a of assets) {
    if (!a.imageUrl || options.excludeIds.includes(a.id) || a.isPrimary || a.kind === 'generated' || a.kind === 'context') continue
    const role = roleFromImageRow({ tags: a.tags, is_primary: a.isPrimary }) ?? roleFromLabel(a.label)
    if (!role || !ACCESSORY_ROLES.has(role)) continue
    const label = [stripRolePrefix(a.label), a.role].filter(Boolean).join(' ').trim() || role
    const text = `${label} ${(a.tags || []).join(' ')}`.toLowerCase()
    const hit = [...lockWords].some((w) => text.includes(w)) ? 0 : 1
    rows.push({ id: a.id, imageUrl: a.imageUrl, role: role as 'box' | 'contents' | 'part', label, score: hit * 10 + ACCESSORY_PRIORITY[role] })
  }
  return rows.sort((x, y) => x.score - y.score).slice(0, options.max ?? 2).map(({ score: _s, ...r }) => r)
}

export function productRowFromOffer(offer: McpBrandContext['offers'][number] | undefined): ProductCreativeRow | null {
  if (!offer) return null
  return {
    name: offer.name,
    product_description: offer.productDescription ?? null,
    technical_specs: offer.technicalSpecs ?? null,
    product_category: offer.type ?? null,
    // The web route locks `products.offer` as the display price; MCP offers expose it as `price`.
    offer: offer.price ?? null,
    price_range: offer.priceRange ?? null,
  }
}

export type WebStyleImageInput = {
  apiKey: string
  ctx: McpBrandContext
  offerId: string
  /** Requested ratio (any supported one; 4:5 is generated at 3:4 and reframed). */
  aspectRatio: string
  language?: 'es' | 'en'
  /** Guion / on-image copy. */
  copy?: string
  scene?: string
  guidePrompt?: string
  /** Extra context lines (e.g. angle niche for bulk). */
  extraContext?: string[]
  postStyle?: string
  textDensity?: string
  ctaStrength?: unknown
  productUrls: string[]
  supportUrls?: string[]
  /** 'none' skips kit reference auto-append (web `referenceMode:'none'`). */
  referenceMode?: 'use' | 'none'
  lock?: Partial<OfferLock>
  /** Real accessory photos (box / controller / contents) attached as extra references. */
  accessories?: Array<{ imageUrl: string; label: string }>
  /**
   * Opt-in: when the safety-net QA fails (safe zones / missing text), regenerate ONCE with a corrective hint and
   * keep the better image. Same job, same approval, same single credit charge — only our xAI cost doubles.
   */
  autoRetry?: boolean
  /**
   * Default true: MCP-only prompt rules (binding scene, strict lock / no invented props, safe zones, separator hygiene).
   * false = the legacy web prompt (scene as factual context) — used by the web⇄MCP parity test to prove the shared
   * builder is byte-identical to the web route.
   */
  mcpRules?: boolean
}

export type WebStyleImageOutput = {
  generated: {
    imageDataUrl: string
    providerModel: string
    estimatedCostUsd: number
    resolution: string
    quality: string
    aspectRatio: string
    mode: string
    lockApplied: boolean
  }
  prompt: string
  request: WebPostGrokImageResult['request']
  referenceCount: number
  retriedWithClamp: boolean
  copySource: 'copy' | 'guidePrompt' | 'offer_default'
  fidelityCheck: FidelityCheckResult
  fidelity_warning?: FidelityWarning
  qa: McpImageQa
  autoRetry: { requested: boolean; attempted: boolean; reason?: string; kept?: 'first' | 'retry'; firstQa?: { safeZones: McpImageQa['safeZones']; textPresent: McpImageQa['textPresent']; issues: string[] } }
  references: { used: WebPostGrokImageResult['referencesUsed']; warnings: WebPostGrokImageResult['referenceWarnings'] }
  /** What was allowed in the scene. Local pixel detection of invented props is not available: prevented at the prompt/reference level. */
  propsPolicy: { forbidExtraProps: boolean; allowed: string[]; accessoryReferences: number; verifiedLocally: false }
  copyNormalised: string[]
}

function cleanCopy(value: string | undefined): string {
  return (value || '').replace(/\s+\n/g, '\n').trim().slice(0, 900)
}

/** The businessContext the web chat sends: scene + offer description/differentiator + extra lines. */
export function buildMcpBusinessContext(input: {
  language: 'es' | 'en'
  scene?: string
  offer?: McpBrandContext['offers'][number]
  extraContext?: string[]
  guidePrompt?: string
  copySource?: 'copy' | 'guidePrompt' | 'offer_default'
}): string {
  const { language, offer } = input
  return [
    input.scene ? `${language === 'en' ? 'Scene' : 'Escena'}: ${input.scene}` : '',
    offer?.productDescription || '',
    offer?.differentiation ? `${language === 'en' ? 'Differentiator' : 'Diferencial'}: ${offer.differentiation}` : '',
    ...(input.extraContext || []),
    input.guidePrompt && input.copySource !== 'guidePrompt' ? `${language === 'en' ? 'Direction' : 'Dirección'}: ${input.guidePrompt}` : '',
  ].filter(Boolean).join('. ').slice(0, 700)
}

/** Retry hint for the single QA auto-retry. */
function retryHintFor(qa: McpImageQa, language: 'es' | 'en'): string {
  const es = language !== 'en'
  const bits: string[] = []
  if (qa.safeZoneIssues.some((i) => i.kind === 'block_touches_edge')) bits.push(es ? 'el botón CTA tocaba el borde: subilo y dejalo completo con aire' : 'the CTA button touched the edge: move it up and keep it fully visible with air')
  if (qa.safeZoneIssues.some((i) => i.kind === 'text_in_unsafe_band')) bits.push(es ? 'había texto dentro del margen de la UI de Instagram: mové todo el texto hacia dentro' : 'text sat inside the Instagram UI margin: move all text inward')
  if (qa.textPresent === 'no') bits.push(es ? 'faltaba el texto del copy: dibujalo completo y legible' : 'the copy text was missing: draw it complete and legible')
  return bits.join('; ')
}

function qaIssueCount(qa: McpImageQa): number {
  return qa.safeZoneIssues.length + (qa.textPresent === 'no' ? 1 : 0)
}

export async function generateWebStyleImage(input: WebStyleImageInput): Promise<WebStyleImageOutput> {
  const { ctx } = input
  const offer = ctx.offers.find((o) => o.id === input.offerId)
  const kit = ctx.brandKit
  const ratioPlan = resolveImageRatio(input.aspectRatio)
  const language = input.language === 'en' ? 'en' : 'es'

  let copy = cleanCopy(input.copy)
  let copySource: WebStyleImageOutput['copySource'] = 'copy'
  if (!copy) {
    copy = cleanCopy(input.guidePrompt)
    copySource = 'guidePrompt'
  }
  if (!copy) {
    copy = [offer?.name, offer?.price].filter(Boolean).join(' — ')
    copySource = 'offer_default'
  }
  // Orphan "·" guard: a long "a · b" line is split at the separator and stray separators are dropped.
  const tidied = tidyCopySeparators(copy)
  copy = tidied.copy
  // The scene is a binding instruction (web-post-image `mcp.scene`), not a "Contexto factual (NO renderizar)" line.
  const withRules = input.mcpRules !== false
  const businessContext = buildMcpBusinessContext({
    language,
    ...(withRules ? {} : { scene: input.scene }),
    offer,
    extraContext: input.extraContext,
    guidePrompt: input.guidePrompt,
    copySource,
  })

  const useKitRefs = input.referenceMode !== 'none'
  const accessories = useKitRefs ? (input.accessories || []).filter((a) => a.imageUrl) : []
  const baseOptions = {
    apiKey: input.apiKey,
    aspectRatio: ratioPlan.generateAt,
    language,
    postStyle: input.postStyle || 'venta-directa',
    textDensity: input.textDensity || 'hard',
    ctaStrength: input.ctaStrength,
    copy,
    businessContext,
    palette: [kit?.primaryColor, kit?.secondaryColor, kit?.accentColor].filter((c): c is string => Boolean(c)),
    brandVoice: kit?.brandVoice,
    brandVisual: kit?.visualStyleNotes,
    brandName: ctx.brand.name,
    brandKitId: kit?.id ?? null,
    offerId: input.offerId,
    productRow: productRowFromOffer(offer),
    productUrls: input.productUrls,
    accessoryUrls: accessories.map((a) => a.imageUrl),
    kitReferenceUrls: useKitRefs ? kit?.referenceImages || [] : [],
    supportUrls: input.supportUrls || [],
    logoUrl: kit?.logoUrl || null,
    lockProductAppearance: input.lock?.lockProductAppearance,
    immutableAttributes: input.lock?.immutableAttributes,
  }
  const mcpRules = (retryHint?: string) => ({
    scene: input.scene?.trim() || undefined,
    strict: input.lock?.forbidExtraProps !== false,
    allowedProps: input.lock?.allowedProps,
    requestedRatio: ratioPlan.requested,
    accessoryLabels: accessories.map((a) => a.label),
    ...(retryHint ? { retryHint } : {}),
  })
  const reframe = async (grokImage: string, grokRatio: string) => {
    if (ratioPlan.needsReframe && grokImage.startsWith('data:')) {
      const bytes = Buffer.from(grokImage.slice(grokImage.indexOf(',') + 1), 'base64')
      const framed = await reframeToRatio(bytes, ratioPlan.requested, { mode: 'cover', format: 'jpeg' })
      return { imageDataUrl: `data:image/jpeg;base64,${framed.bytes.toString('base64')}`, aspectRatio: ratioPlan.requested }
    }
    return { imageDataUrl: grokImage, aspectRatio: grokRatio }
  }
  const qaFor = (imageDataUrl: string) => runMcpImageQa({
    generatedDataUrl: imageDataUrl,
    requestedRatio: ratioPlan.requested,
    copyRequested: Boolean(copy),
    logoAttached: Boolean(kit?.logoUrl),
    logoExpected: Boolean(kit),
    copy,
    copyChanges: tidied.changes,
  })

  let grok = await runWebPostGrokImage({ ...baseOptions, ...(withRules ? { mcp: mcpRules() } : {}) })
  let framed = await reframe(grok.imageDataUrl, grok.aspectRatio)
  let qa = await qaFor(framed.imageDataUrl)
  const autoRetry: WebStyleImageOutput['autoRetry'] = { requested: input.autoRetry === true, attempted: false }
  let totalCost = grok.estimatedCostUsd
  if (input.autoRetry === true && qaIssueCount(qa) > 0) {
    // One corrective regeneration inside the same job: no second approval, no second charge (the caller charges once).
    autoRetry.attempted = true
    autoRetry.reason = retryHintFor(qa, language)
    autoRetry.firstQa = { safeZones: qa.safeZones, textPresent: qa.textPresent, issues: qa.warnings.slice(0, 6) }
    try {
      const second = await runWebPostGrokImage({ ...baseOptions, ...(withRules ? { mcp: mcpRules(autoRetry.reason) } : {}) })
      totalCost += second.estimatedCostUsd
      const secondFramed = await reframe(second.imageDataUrl, second.aspectRatio)
      const secondQa = await qaFor(secondFramed.imageDataUrl)
      if (qaIssueCount(secondQa) < qaIssueCount(qa)) {
        grok = second
        framed = secondFramed
        qa = secondQa
        autoRetry.kept = 'retry'
      } else autoRetry.kept = 'first'
    } catch (err) {
      autoRetry.kept = 'first'
      autoRetry.reason = `${autoRetry.reason}; retry failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`
    }
  }
  const { imageDataUrl, aspectRatio } = framed

  // Free local fidelity post-check — warning only, on the image we keep.
  const fidelityCheck = grok.lockApplied
    ? await checkGeneratedProductFidelity({ referenceDataUrls: grok.productReferenceDataUrls, generatedDataUrl: imageDataUrl })
    : ({ status: 'skipped', reason: 'no product reference attached' } as FidelityCheckResult)
  return {
    generated: {
      imageDataUrl,
      providerModel: grok.providerModel,
      estimatedCostUsd: Math.round(totalCost * 10000) / 10000,
      resolution: grok.resolution,
      quality: grok.quality,
      aspectRatio,
      mode: grok.mode,
      lockApplied: grok.lockApplied,
    },
    prompt: grok.prompt,
    request: grok.request,
    referenceCount: grok.referenceCount,
    retriedWithClamp: grok.retriedWithClamp,
    copySource,
    fidelityCheck,
    ...(fidelityCheck.status === 'warning' ? { fidelity_warning: fidelityCheck.warning } : {}),
    qa,
    autoRetry,
    references: { used: grok.referencesUsed, warnings: grok.referenceWarnings },
    propsPolicy: {
      forbidExtraProps: input.lock?.forbidExtraProps !== false,
      allowed: [...(input.lock?.allowedProps || [])],
      accessoryReferences: grok.referencesUsed.filter((k) => k === 'accessory').length,
      verifiedLocally: false,
    },
    copyNormalised: tidied.changes,
  }
}

/** Compact, result-safe summary of the post-check (no image bytes). */
export function postCheckSummary(out: Pick<WebStyleImageOutput, 'fidelityCheck' | 'fidelity_warning' | 'qa' | 'copySource' | 'referenceCount' | 'retriedWithClamp' | 'autoRetry' | 'references' | 'propsPolicy' | 'copyNormalised'>): Record<string, unknown> {
  return {
    ...(out.fidelity_warning ? { fidelity_warning: out.fidelity_warning } : {}),
    fidelityCheck: out.fidelityCheck.status === 'skipped'
      ? { status: 'skipped', reason: out.fidelityCheck.reason }
      : out.fidelityCheck.status === 'unverified'
        ? { status: 'unverified', reason: out.fidelityCheck.reason }
        : { status: out.fidelityCheck.status, score: out.fidelityCheck.score },
    qa: out.qa,
    copySource: out.copySource,
    referenceCount: out.referenceCount,
    retriedWithClamp: out.retriedWithClamp,
    autoRetry: out.autoRetry,
    references: out.references,
    propsPolicy: out.propsPolicy,
    ...(out.copyNormalised.length ? { copyNormalised: out.copyNormalised } : {}),
  }
}
