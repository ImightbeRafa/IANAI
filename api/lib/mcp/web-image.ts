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
import { buildCaption, capCopyBlocks } from './copy-layout.js'
import { checkExtraObjects, type ExtraObjectsFinding } from './extra-objects.js'
import { checkGeneratedProductFidelity, locateLogoBox, qaSeverity, runMcpImageQa, tidyCopySeparators, type FidelityCheckResult, type FidelityWarning, type McpImageQa } from './image-postcheck.js'
import { enforceSafeZones, type SafeZoneFix } from './safe-zone-fix.js'
import { compositeBrandLayers, type CompositeReport } from './composite-ad.js'
import { fetchPublicImageDetailed } from '../fetch-image-data-url.js'
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
  options: { excludeIds: string[]; lockText?: string; max?: number; /** Only photos whose role/label/tags match a word of lockText (e.g. the offer's allowedProps). */ onlyMatching?: boolean }
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
    if (options.onlyMatching && hit) continue
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
  /** Default true: condense a long copy to headline + 1 price line + 1 facts line + 1 CTA; the rest comes back as `copyOverflow` for the caption. */
  layoutCap?: boolean
  /**
   * Default true: if the QA finds the logo / CTA / text inside the Instagram UI margins, FIX it in code (scale the picture
   * into a safe canvas of the same pixel size with edge-matched padding, re-stamp the real logo if it was clipped).
   * Free, local, no model call, no extra charge. false = report only (legacy behaviour).
   */
  enforceSafeZones?: boolean
  /**
   * Default true (MCP rules on): Grok is told NOT to draw the logo or any CTA button and to leave the top / bottom bands empty;
   * afterwards the REAL kit logo and ONE button with the exact `copy` CTA text are composited in code inside the safe zones
   * (gradient scrim sampled from the picture, brand palette, text contrast ≥ 4.5:1, same pixel size). No logo asset → no logo
   * (qa.logoUnavailable), never a text chip. false = the legacy flow where Grok draws logo + CTA.
   */
  compositeLayers?: boolean
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
  autoRetry: { requested: boolean; attempted: boolean; reason?: string; kept?: 'first' | 'retry'; keptReason?: string; firstSeverity?: number; retrySeverity?: number; firstQa?: { safeZones: McpImageQa['safeZones']; textPresent: McpImageQa['textPresent']; issues: string[] } }
  references: { used: WebPostGrokImageResult['referencesUsed']; warnings: WebPostGrokImageResult['referenceWarnings'] }
  /** What was allowed in the scene. Local pixel detection of invented props is not available: prevented at the prompt/reference level. */
  propsPolicy: { forbidExtraProps: boolean; allowed: string[]; accessoryReferences: number; verifiedLocally: boolean; source: 'input' | 'none'; check?: ExtraObjectsFinding }
  /** Warning only: colours next to the product that no reference explains (possible invented props). */
  props_warning?: { code: 'props_warning'; reason: string; clusters: ExtraObjectsFinding['clusters'] }
  copyNormalised: string[]
  /** Copy lines moved off the image by the layout cap (put them in the caption). */
  copyOverflow: string[]
  /** Transient provider failures retried inside the job (not an error, not charged). */
  providerRetries: number
  /** Deterministic safe-zone fix applied to the kept image (absent when the image already passed or enforcement is off). */
  safeZoneFix?: SafeZoneFix
  /** The QA verdict of the image as Grok drew it, before the deterministic fix (only when a fix was applied). */
  qaBeforeFix?: { safeZones: McpImageQa['safeZones']; severity: number; issues: string[] }
  /** Round 5b: what the code compositor drew (real logo, exact CTA, scrim) — absent on the legacy flow. */
  compositeLayers?: CompositeReport
  /** Ready-to-paste caption (es-CR, short): headline / price / facts + the lines moved off the image + the CTA. Deterministic. */
  caption: string
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
  if (qa.safeZoneIssues.some((i) => i.kind === 'block_touches_edge')) bits.push(es ? 'el botón CTA tocaba el borde: subilo y dejalo completo con aire (≥ 11% del borde de abajo)' : 'the CTA button touched the edge: move it up and keep it fully visible with air (≥ 11% above the bottom edge)')
  if (qa.safeZoneIssues.some((i) => i.kind === 'text_in_unsafe_band')) bits.push(es ? 'había texto dentro del margen de la UI de Instagram: mové todo el texto hacia dentro (nada en el 8% superior ni inferior)' : 'text sat inside the Instagram UI margin: move all text inward (nothing in the top or bottom 8%)')
  if (qa.textPresent === 'no') bits.push(es ? 'faltaba el texto del copy: dibujalo completo y legible' : 'the copy text was missing: draw it complete and legible')
  if (qa.extraCtaRisk) bits.push(es ? 'había un segundo botón: dejá UN solo CTA con el texto exacto de la copy' : 'there was a second button: keep ONE CTA with the exact copy text')
  return bits.join('; ')
}

/** Retry hint for the composited flow: the only retry-worthy defects are text in the bands / drawn buttons / separators. */
function retryHintComposite(qa: McpImageQa, language: 'es' | 'en'): string {
  const es = language !== 'en'
  const bits: string[] = []
  if (qa.safeZoneIssues.length) bits.push(es ? 'había texto u objetos en el 10% superior o el 12% inferior: dejá esas franjas VACÍAS y poné el titular y el precio en la franja del medio' : 'text or objects sat in the top 10% or the bottom 12%: leave those bands EMPTY and put the headline and price in the middle band')
  if (qa.ctaButtons > 0) bits.push(es ? 'se dibujó un botón o logo: NO dibujes botones, CTA ni logo (se agregan por código)' : 'a button or logo was drawn: do NOT draw buttons, CTAs or a logo (they are added in code)')
  if (qa.separatorLines.length) bits.push(es ? 'sin separadores sueltos al inicio o final de línea' : 'no dangling separators at the start or end of a line')
  return bits.join('; ')
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
  // Layout cap: headline + one price line + one facts line + one CTA; the overflow goes to the caption.
  const capped = input.layoutCap === false ? null : capCopyBlocks(copy)
  if (capped?.capped) copy = capped.onImage
  const ctaText = capped?.cta ?? capCopyBlocks(copy).cta
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

  // Round 5b: logo + CTA are composited in code (MCP rules on only; the web-parity path keeps the legacy prompt).
  const composite = withRules && input.compositeLayers !== false
  const promptCopy = composite && ctaText ? copy.split(/\r?\n/).filter((l) => l.trim() !== ctaText.trim()).join('\n').trim() || copy : copy
  const useKitRefs = input.referenceMode !== 'none'
  const accessories = useKitRefs ? (input.accessories || []).filter((a) => a.imageUrl) : []
  const baseOptions = {
    apiKey: input.apiKey,
    aspectRatio: ratioPlan.generateAt,
    language: language as 'es' | 'en',
    postStyle: input.postStyle || 'venta-directa',
    textDensity: input.textDensity || 'hard',
    ctaStrength: composite ? 'none' : input.ctaStrength,
    copy: promptCopy,
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
    // composite: the logo is stamped in code from the asset, so it is not sent to Grok as a reference (it would redraw it).
    logoUrl: composite ? null : kit?.logoUrl || null,
    lockProductAppearance: input.lock?.lockProductAppearance,
    immutableAttributes: input.lock?.immutableAttributes,
  }
  const mcpRules = (retryHint?: string) => ({
    scene: input.scene?.trim() || undefined,
    strict: input.lock?.forbidExtraProps !== false,
    allowedProps: input.lock?.allowedProps,
    requestedRatio: ratioPlan.requested,
    ...(ctaText ? { ctaText } : {}),
    layoutCap: input.layoutCap !== false,
    ...(composite ? { compositeLayers: true } : {}),
    accessoryLabels: accessories.map((a) => a.label),
    // xAI /images/edits takes up to 5 references: hero + 2nd product photo + the real box / controller + logo.
    ...(accessories.length ? { refBudget: 5 } : {}),
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
  const qaFor = async (imageDataUrl: string, logoDataUrl?: string | null) => {
    let logoBox: Awaited<ReturnType<typeof locateLogoBox>> = null
    if (logoDataUrl?.startsWith('data:') && imageDataUrl.startsWith('data:')) {
      logoBox = await locateLogoBox(Buffer.from(logoDataUrl.slice(logoDataUrl.indexOf(',') + 1), 'base64'), Buffer.from(imageDataUrl.slice(imageDataUrl.indexOf(',') + 1), 'base64'))
    }
    return runMcpImageQa({
    logoBox,
    generatedDataUrl: imageDataUrl,
    requestedRatio: ratioPlan.requested,
    copyRequested: Boolean(copy),
    logoAttached: Boolean(kit?.logoUrl),
    logoExpected: Boolean(kit),
    copy,
    copyChanges: tidied.changes,
    })
  }
  const enforce = input.enforceSafeZones !== false
  // Legacy flow only: safe-zone defects fixed in code (scale-in) so they do not justify a second paid generation.
  const effSeverity = (q: McpImageQa) => {
    if (composite) return qaSeverity({ ...q, ctaButtons: q.ctaButtons > 0 ? q.ctaButtons + 1 : 0 })
    return enforce ? qaSeverity({ ...q, safeZoneIssues: [] }) : q.severity
  }
  const retryWorthy = (q: McpImageQa) => effSeverity(q) > 0
  // Composited flow: the scene as Grok drew it has no logo / CTA / copy-band text yet, so the QA only checks bands, buttons, separators.
  const qaScene = (imageDataUrl: string) =>
    runMcpImageQa({ generatedDataUrl: imageDataUrl, requestedRatio: ratioPlan.requested, copyRequested: false, logoAttached: true, logoExpected: false, copy: promptCopy, copyChanges: tidied.changes })
  const check = (url: string, logoDataUrl?: string | null) => (composite ? qaScene(url) : qaFor(url, logoDataUrl))
  const hint = (q: McpImageQa) => (composite ? retryHintComposite(q, language) : retryHintFor(q, language))

  let grok = await runWebPostGrokImage({ ...baseOptions, ...(withRules ? { mcp: mcpRules() } : {}) })
  let framed = await reframe(grok.imageDataUrl, grok.aspectRatio)
  let qa = await check(framed.imageDataUrl, grok.logoDataUrl)
  const autoRetry: WebStyleImageOutput['autoRetry'] = { requested: input.autoRetry === true, attempted: false }
  let totalCost = grok.estimatedCostUsd
  if (input.autoRetry === true && retryWorthy(qa)) {
    // One corrective regeneration inside the same job: no second approval, no second charge (the caller charges once).
    autoRetry.attempted = true
    autoRetry.reason = hint(qa)
    autoRetry.firstQa = { safeZones: qa.safeZones, textPresent: qa.textPresent, issues: qa.warnings.slice(0, 6) }
    try {
      const second = await runWebPostGrokImage({ ...baseOptions, ...(withRules ? { mcp: mcpRules(autoRetry.reason) } : {}) })
      totalCost += second.estimatedCostUsd
      const secondFramed = await reframe(second.imageDataUrl, second.aspectRatio)
      const secondQa = await check(secondFramed.imageDataUrl, second.logoDataUrl)
      autoRetry.firstSeverity = effSeverity(qa)
      autoRetry.retrySeverity = effSeverity(secondQa)
      // Keep the BETTER image by QA result (lower weighted defect score); a tie keeps the first (no change for the same price).
      if (effSeverity(secondQa) < effSeverity(qa)) {
        grok = second
        framed = secondFramed
        qa = secondQa
        autoRetry.kept = 'retry'
        autoRetry.keptReason = `retry QA severity ${autoRetry.retrySeverity} < first ${autoRetry.firstSeverity}`
      } else {
        autoRetry.kept = 'first'
        autoRetry.keptReason = `retry QA severity ${autoRetry.retrySeverity} was not better than the first ${autoRetry.firstSeverity}`
      }
    } catch (err) {
      autoRetry.kept = 'first'
      autoRetry.reason = `${autoRetry.reason}; retry failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`
    }
  }
  const { aspectRatio } = framed
  let imageDataUrl = framed.imageDataUrl
  // Fidelity / props checks look at the picture exactly as Grok drew it (before any code layer).
  const preFixImageDataUrl = imageDataUrl

  let safeZoneFix: SafeZoneFix | undefined
  let qaBeforeFix: WebStyleImageOutput['qaBeforeFix']
  let layers: CompositeReport | undefined
  const decode = (url: string) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
  const fixBySquash = async (logo: Buffer | null) => {
    if (!enforce || !qa.safeZoneIssues.length || !imageDataUrl.startsWith('data:')) return
    try {
      const fixed = await enforceSafeZones({ bytes: decode(imageDataUrl), ratio: ratioPlan.requested, logo, issues: qa.safeZoneIssues })
      if (fixed.fix.applied) {
        const fixedUrl = `data:image/jpeg;base64,${fixed.bytes.toString('base64')}`
        const fixedQa = await check(fixedUrl, grok.logoDataUrl)
        qaBeforeFix = { safeZones: qa.safeZones, severity: qa.severity, issues: qa.warnings.slice(0, 6) }
        safeZoneFix = fixed.fix
        imageDataUrl = fixedUrl
        qa = fixedQa
      }
    } catch (err) {
      safeZoneFix = { method: 'scale_in_fallback', applied: false, scale: 1, padTop: 0, padBottom: 0, attempts: 0, logoRestored: false, before: qa.safeZoneIssues, after: qa.safeZoneIssues, note: `safe-zone fix unavailable: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}` }
    }
  }

  if (composite && imageDataUrl.startsWith('data:')) {
    // LAST RESORT (never the default): headline / price text still inside the bands after the retry → scale the scene in, THEN add the logo + CTA.
    await fixBySquash(null)
    let logoBytes: Buffer | null = null
    let logoNote = ''
    if (kit?.logoUrl) {
      try {
        const fetched = await fetchPublicImageDetailed(kit.logoUrl)
        if ('dataUrl' in fetched) logoBytes = decode(fetched.dataUrl)
        else logoNote = `logo asset not loaded: ${fetched.failure.url} → ${fetched.failure.status ? `HTTP ${fetched.failure.status}` : fetched.failure.reason}`
      } catch (err) {
        logoNote = `logo asset not loaded: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}`
      }
    }
    try {
      const done = await compositeBrandLayers({
        bytes: decode(imageDataUrl),
        ratio: ratioPlan.requested,
        logo: logoBytes,
        ...(ctaText ? { ctaText } : {}),
        palette: { primary: kit?.primaryColor, secondary: kit?.secondaryColor, accent: kit?.accentColor },
      })
      layers = done.report
      if (layers.logo.status === 'unavailable' && logoNote) layers.logo.reason = logoNote
      imageDataUrl = `data:image/jpeg;base64,${done.bytes.toString('base64')}`
      const w = done.report.width
      const h = done.report.height
      const lb = done.report.logo.box
      qa = await runMcpImageQa({
        generatedDataUrl: imageDataUrl,
        requestedRatio: ratioPlan.requested,
        copyRequested: Boolean(copy),
        logoAttached: done.report.logo.status === 'drawn',
        logoExpected: Boolean(kit),
        copy,
        copyChanges: tidied.changes,
        logoBox: lb ? { x0: lb.x / w, y0: lb.y / h, x1: (lb.x + lb.w) / w, y1: (lb.y + lb.h) / h } : null,
      })
      if (done.report.logo.status === 'unavailable') qa.logoUnavailable = true
      if (!ctaText) qa.warnings.push('the copy has no CTA line: no button was drawn')
      else if (done.report.cta.fits === false) qa.warnings.push('the CTA text is long: the button text was shrunk to fit')
    } catch (err) {
      qa.warnings.push(`logo / CTA compositor unavailable: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}`)
    }
  } else {
    // Legacy flow (Grok draws logo + CTA): deterministic scale-in fix as before, with the real logo re-stamped if it was clipped.
    const logoBytes = grok.logoDataUrl?.startsWith('data:') ? decode(grok.logoDataUrl) : null
    await fixBySquash(logoBytes)
  }

  // Free local fidelity post-check — warning only, on the image we keep.
  const fidelityCheck = grok.lockApplied
    ? await checkGeneratedProductFidelity({ referenceDataUrls: grok.productReferenceDataUrls, generatedDataUrl: preFixImageDataUrl })
    : ({ status: 'skipped', reason: 'no product reference attached' } as FidelityCheckResult)
  // Free local props check (colour novelty vs every reference sent): warning only.
  let propsCheck: ExtraObjectsFinding | undefined
  try {
    const imgBytes = Buffer.from(preFixImageDataUrl.slice(preFixImageDataUrl.indexOf(',') + 1), 'base64')
    const refBytes = grok.allReferenceDataUrls.filter((u) => u.startsWith('data:')).map((u) => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64'))
    const box = fidelityCheck.status === 'ok' || fidelityCheck.status === 'unverified' ? fidelityCheck.details.productBox : fidelityCheck.status === 'warning' ? fidelityCheck.warning.details.productBox : undefined
    if (preFixImageDataUrl.startsWith('data:') && refBytes.length) propsCheck = await checkExtraObjects({ generated: imgBytes, references: refBytes, productBox: box ?? null, allowedCount: (input.lock?.allowedProps || []).length })
  } catch { /* heuristic only */ }
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
      verifiedLocally: Boolean(propsCheck),
      source: (input.lock?.allowedProps || []).length ? 'input' : 'none',
      ...(propsCheck ? { check: propsCheck } : {}),
    },
    ...(propsCheck?.suspected ? { props_warning: { code: 'props_warning' as const, reason: propsCheck.note, clusters: propsCheck.clusters } } : {}),
    copyNormalised: tidied.changes,
    copyOverflow: capped?.overflow ?? [],
    providerRetries: grok.providerRetries,
    ...(safeZoneFix ? { safeZoneFix } : {}),
    ...(qaBeforeFix ? { qaBeforeFix } : {}),
    ...(layers ? { compositeLayers: layers } : {}),
    caption: buildCaption({ onImage: copy, overflow: capped?.overflow ?? [], cta: ctaText, language }),
  }
}

/** Compact, result-safe summary of the post-check (no image bytes). */
export function postCheckSummary(out: Pick<WebStyleImageOutput, 'fidelityCheck' | 'fidelity_warning' | 'qa' | 'copySource' | 'referenceCount' | 'retriedWithClamp' | 'autoRetry' | 'references' | 'propsPolicy' | 'copyNormalised'> & Partial<Pick<WebStyleImageOutput, 'props_warning' | 'copyOverflow' | 'providerRetries' | 'safeZoneFix' | 'qaBeforeFix' | 'caption' | 'compositeLayers'>>): Record<string, unknown> {
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
    ...(out.props_warning ? { props_warning: out.props_warning } : {}),
    ...(out.copyNormalised.length ? { copyNormalised: out.copyNormalised } : {}),
    ...(out.copyOverflow?.length ? { copyOverflow: out.copyOverflow } : {}),
    ...(out.providerRetries ? { providerRetries: out.providerRetries } : {}),
    ...(out.safeZoneFix ? { safeZoneFix: out.safeZoneFix } : {}),
    ...(out.compositeLayers ? { compositeLayers: out.compositeLayers } : {}),
    ...(out.qaBeforeFix ? { qaBeforeFix: out.qaBeforeFix } : {}),
    ...(out.caption ? { caption: out.caption } : {}),
  }
}
