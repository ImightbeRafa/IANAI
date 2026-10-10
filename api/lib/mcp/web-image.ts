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
import { checkExtraObjects, findUnlistedObjects, labelMatchesAllowed, type ExtraObjectsFinding, type UnlistedObject } from './extra-objects.js'
import { checkGeneratedProductFidelity, locateLogoBox, qaSeverity, runMcpImageQa, tidyCopySeparators, type FidelityCheckResult, type FidelityWarning, type McpImageQa } from './image-postcheck.js'
import { enforceSafeZones, type SafeZoneFix } from './safe-zone-fix.js'
import { prepareAndLayout } from './compose-scene.js'
import { splitCopyBlocks, type AdLayoutReport } from './layout-ad.js'
import { freeBands } from './safe-zones.js'
import type { ScenePrepReport } from './compose-scene.js'
import { fetchPublicImageDetailed } from '../fetch-image-data-url.js'
import type { McpBrandContext } from './user-tools.js'

/** Round 7 thresholds. Text below 80 % of its nominal size is always warned; below 75 % (or on the product) it counts in the severity so the retry fires. */
const TEXT_SCALE_WARN = 0.8
const TEXT_SCALE_LOW = 0.75
/** A hero-product fidelity score below this raises the severity (and triggers the one retry). */
const FIDELITY_RETRY_BELOW = 0.75

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
   * Legacy flow (compositeLayers:false) default true: if the QA finds the logo / CTA / text inside the Instagram UI margins, FIX it in code
   * (scale the picture into a safe canvas of the same pixel size with edge-matched padding, re-stamp the real logo if it was clipped).
   * Composite flow (default): NEVER by default — the layout places everything inside the safe zones, the picture is never shrunk or framed;
   * only an explicit `true` allows this scale-in as a last resort, and the QA then reports it as a defect (never 'pass').
   */
  enforceSafeZones?: boolean
  /** Real offer photos (box / contents / parts) NOT attached: when their object shows up in the scene without being in allowedProps it is flagged (warning only). */
  libraryPhotos?: Array<{ imageUrl: string; label: string }>
  /**
   * Default true (MCP rules on, round 6): Grok is asked for the SCENE ONLY (no text, logo or button; empty top / bottom bands). Afterwards the REAL
   * kit logo, the headline, the price line, the facts line and ONE CTA with the exact `copy` text are composited in code inside the safe zones
   * (brand fonts + colours, layout from the real text boxes, no overlaps, ≥ 1.5 % of the height between elements, text contrast ≥ 4.5:1, same pixel size,
   * no shrink / frame). No logo asset → no logo (qa.logoUnavailable), never a text chip. false = the legacy flow where Grok draws all the text.
   */
  compositeLayers?: boolean
  /**
   * Default true: MCP-only prompt rules (binding scene, strict lock / no invented props, safe zones, separator hygiene).
   * false = the legacy web prompt (scene as factual context) — used by the web⇄MCP parity test to prove the shared
   * builder is byte-identical to the web route.
   */
  mcpRules?: boolean
  /** Optional free text appended to the product lock (e.g. "propeller is light grey, wing is one smooth sheet"). Echoed in the tool args. */
  productNotes?: string
  /** Default true: when the text would land on the product / shrink below 80 %, move the picture down by extending the background above it (no model call). */
  makeRoom?: boolean
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
  autoRetry: { requested: boolean; attempted: boolean; reason?: string; kept?: 'first' | 'retry'; keptReason?: string; firstSeverity?: number; retrySeverity?: number; factors?: { first: Record<string, number>; retry: Record<string, number> }; firstQa?: { safeZones: McpImageQa['safeZones']; textPresent: McpImageQa['textPresent']; issues: string[] } }
  references: { used: WebPostGrokImageResult['referencesUsed']; warnings: WebPostGrokImageResult['referenceWarnings'] }
  /** What was allowed in the scene. Local pixel detection of invented props is not available: prevented at the prompt/reference level. */
  propsPolicy: { forbidExtraProps: boolean; allowed: string[]; accessoryReferences: number; verifiedLocally: boolean; source: 'input' | 'none'; check?: ExtraObjectsFinding; unlisted?: Array<{ label: string; inliers: number }> }
  /** Warning only: colours next to the product that no reference explains (possible invented props). */
  props_warning?: { code: 'props_warning'; reason: string; clusters: ExtraObjectsFinding['clusters']; unlisted?: Array<{ label: string; inliers: number }> }
  /** Round 7: what the free scene prep did (flat strips blended away, picture moved down to make room for the text). */
  scenePrep?: ScenePrepReport
  /** Round 7: set when the fidelity warning survived (the one retry included): the real-pixels path is the way out. */
  suggestedFallback?: { productFidelity: 'exact'; reason: string }
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
  compositeLayers?: AdLayoutReport
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

/** Retry hint for the composited (scene-only) flow: the only retry-worthy defects are text / objects in the free bands, drawn buttons / logos, separators. */
function retryHintComposite(qa: McpImageQa, language: 'es' | 'en', ratio: string): string {
  const es = language !== 'en'
  const bands = freeBands(ratio)
  const top = `${Math.round(bands.top * 100)}%`
  const bot = `${Math.round(bands.bottom * 100)}%`
  const bits: string[] = []
  if (qa.safeZoneIssues.length) bits.push(es ? `había texto u objetos en el ${top} superior o el ${bot} inferior: dejá esas franjas LIBRES (solo fondo), generá la escena SIN NINGÚN TEXTO y poné el producto más abajo` : `text or objects sat in the top ${top} or the bottom ${bot}: leave those bands FREE (background only), generate the scene with NO TEXT at all and move the product lower`)
  if (qa.ctaButtons > 0) bits.push(es ? 'se dibujó un botón o logo: NO dibujes botones, CTA ni logo (se agregan por código)' : 'a button or logo was drawn: do NOT draw buttons, CTAs or a logo (they are added in code)')
  const f = qa.severityFactors ?? {}
  if (f.seam) bits.push(es ? 'NO pintes franjas, barras ni bloques planos arriba o abajo (efecto letterbox): la pared y la mesa continúan hasta el borde de la imagen' : 'do NOT paint flat strips, bars or blocks at the top or bottom (letterbox look): the wall and the table run to the edge of the picture')
  if (f.textOverProduct || f.textScale) bits.push(es ? 'el producto debe EMPEZAR por debajo del 38% desde arriba: dejá arriba un fondo calmo y continuo (sin objetos) para el titular; producto y objetos en el 60–65% inferior' : 'the product must START below 38% from the top: leave a calm, continuous, object-free background up top for the headline; product and objects in the lower 60–65%')
  if (f.fidelity) bits.push(es ? 'reproducí el producto EXACTAMENTE como en la foto de referencia: misma forma de ala, mismas piezas (ni aletas ni solapas de más), mismos colores y materiales de cada pieza, misma cantidad de ruedas y hélices' : 'reproduce the product EXACTLY as in the reference photo: same wing shape, same parts (no extra fins or tabs), same colour and material of every part, same number of wheels and propellers')
  if (f.props) bits.push(es ? 'sin objetos que no estén en las fotos de referencia ni en los extras permitidos (cables, cajas, controles, herramientas)' : 'no objects that are not in the reference photos or in the allowed extras (cables, boxes, controllers, tools)')
  if (qa.separatorLines.length) bits.push(es ? 'sin separadores sueltos al inicio o final de línea' : 'no dangling separators at the start or end of a line')
  return bits.join('; ')
}

/**
 * Auto-retry selection. QA severity is a DEFECT score: LOWER is better (0 = clean). The retry replaces the first image only when its score is
 * strictly lower; a tie keeps the first (same price, no change). Exported so the rule is unit-tested on the real round-5c numbers.
 */
export function pickBetterBySeverity(first: number, retry: number): 'first' | 'retry' {
  return retry < first ? 'retry' : 'first'
}

const productBoxOf = (f: FidelityCheckResult): { x0: number; y0: number; x1: number; y1: number } | undefined =>
  f.status === 'ok' || f.status === 'unverified' ? f.details.productBox : f.status === 'warning' ? f.warning.details.productBox : undefined

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
  const allowedList = (input.lock?.allowedProps || []).map((a) => a.trim()).filter(Boolean)
  const accessoryCandidates = useKitRefs ? (input.accessories || []).filter((a) => a.imageUrl) : []
  // allowedProps governs (default = no props): an accessory photo that the allowed list does not name is NOT attached (attaching it while the prompt
  // says "only these extras" made Grok draw the TOPGT box / the controller anyway). Add it to allowedProps to include it.
  const accessories = withRules && allowedList.length ? accessoryCandidates.filter((a) => labelMatchesAllowed(a.label, allowedList)) : accessoryCandidates
  const droppedAccessories = accessoryCandidates.filter((a) => !accessories.includes(a))
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
    ...(input.productNotes?.trim() ? { productNotes: input.productNotes.trim().slice(0, 400) } : {}),
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
  const qaScene = (imageDataUrl: string, excludeBoxes?: Array<{ x0: number; y0: number; x1: number; y1: number }>) =>
    runMcpImageQa({ generatedDataUrl: imageDataUrl, requestedRatio: ratioPlan.requested, copyRequested: false, logoAttached: true, logoExpected: false, copy: promptCopy, copyChanges: tidied.changes, sceneOnly: { bands: freeBands(ratioPlan.requested), ...(excludeBoxes?.length ? { excludeBoxes } : {}) } })
  const check = (url: string, logoDataUrl?: string | null) => (composite ? qaScene(url) : qaFor(url, logoDataUrl))
  const hint = (q: McpImageQa) => (composite ? retryHintComposite(q, language, ratioPlan.requested) : retryHintFor(q, language))

  type GrokRun = Awaited<ReturnType<typeof runWebPostGrokImage>>
  type Framed = { imageDataUrl: string; aspectRatio: string }
  const decode = (url: string) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
  /** Everything after one generation: scene QA → seam blend / room → fidelity + props → code layers → final verdict. Run for the first image and, when it is retry-worthy, for the retry. */
  const finishAttempt = async (grok: GrokRun, framed: Framed) => {
    let qa = await check(framed.imageDataUrl, grok.logoDataUrl)
    const preSeverity = effSeverity(qa)
    let imageDataUrl = framed.imageDataUrl
    // Fidelity / props checks look at the picture exactly as Grok drew it (before any code layer).
    const preFixImageDataUrl = imageDataUrl
    let scenePrep: WebStyleImageOutput['scenePrep']
      let safeZoneFix: SafeZoneFix | undefined
      let qaBeforeFix: WebStyleImageOutput['qaBeforeFix']
      let layers: AdLayoutReport | undefined
      const fixBySquash = async (logo: Buffer | null) => {
        if (!(composite ? input.enforceSafeZones === true : enforce) || !qa.safeZoneIssues.length || !imageDataUrl.startsWith('data:')) return
        try {
          const fixed = await enforceSafeZones({ bytes: decode(imageDataUrl), ratio: ratioPlan.requested, logo, issues: qa.safeZoneIssues })
          if (fixed.fix.applied) {
            const fixedUrl = `data:image/jpeg;base64,${fixed.bytes.toString('base64')}`
            const fixedQa = await check(fixedUrl, grok.logoDataUrl)
            qaBeforeFix = { safeZones: qa.safeZones, severity: qa.severity, issues: qa.warnings.slice(0, 6) }
            safeZoneFix = fixed.fix
            imageDataUrl = fixedUrl
            qa = fixedQa
            qa.scaleInUsed = true
          }
        } catch (err) {
          safeZoneFix = { method: 'scale_in_fallback', applied: false, scale: 1, padTop: 0, padBottom: 0, attempts: 0, logoRestored: false, before: qa.safeZoneIssues, after: qa.safeZoneIssues, note: `safe-zone fix unavailable: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}` }
        }
      }

      // Free local fidelity post-check — warning only, on the image we keep.
      const fidelityCheck = grok.lockApplied
        ? await checkGeneratedProductFidelity({ referenceDataUrls: grok.productReferenceDataUrls, generatedDataUrl: preFixImageDataUrl })
        : ({ status: 'skipped', reason: 'no product reference attached' } as FidelityCheckResult)
      // Free local props check (colour novelty vs every reference sent + real offer photos that are not allowed): warning only.
      let propsCheck: ExtraObjectsFinding | undefined
      let unlisted: UnlistedObject[] = []
      const productBox = productBoxOf(fidelityCheck)
      const accessoryRefCount = grok.referencesUsed.filter((k) => k === 'accessory').length
      try {
        const imgBytes = Buffer.from(preFixImageDataUrl.slice(preFixImageDataUrl.indexOf(',') + 1), 'base64')
        const refBytes = grok.allReferenceDataUrls.filter((u) => u.startsWith('data:')).map((u) => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64'))
        if (preFixImageDataUrl.startsWith('data:') && refBytes.length) {
          // The allowed props explain colours only when they have no photo of their own: the budget is the listed props without an attached accessory photo (≤ 2).
          propsCheck = await checkExtraObjects({ generated: imgBytes, references: refBytes, productBox: productBox ?? null, allowedCount: Math.min(2, Math.max(0, allowedList.length - accessoryRefCount)), mode: composite ? 'scene' : 'strict' })
        }
        // Real photos of objects the allowed list does NOT name (dropped accessories + the offer's other box / contents photos): do they show up in the scene?
        const lib = [...droppedAccessories, ...(input.libraryPhotos || []).filter((p) => p.imageUrl && !labelMatchesAllowed(p.label, allowedList))].slice(0, 3)
        if (withRules && lib.length && preFixImageDataUrl.startsWith('data:')) {
          const objects: Array<{ label: string; bytes: Buffer }> = []
          for (const o of lib) {
            const got = await fetchPublicImageDetailed(o.imageUrl).catch(() => null)
            if (got && 'dataUrl' in got) objects.push({ label: o.label, bytes: Buffer.from(got.dataUrl.slice(got.dataUrl.indexOf(',') + 1), 'base64') })
          }
          unlisted = await findUnlistedObjects({ generated: imgBytes, objects })
        }
      } catch { /* heuristic only */ }
      const propsFlagged = Boolean(propsCheck?.suspected) || unlisted.length > 0
      const propsReason = [
        propsCheck?.suspected ? propsCheck.note : '',
        unlisted.length ? `real photo(s) of ${unlisted.map((u) => `"${u.label}"`).join(', ')} show up in the scene but the allowed props do not name them (invented / unlisted prop)` : '',
      ].filter(Boolean).join('; ')

      if (composite && imageDataUrl.startsWith('data:')) {
        // Explicit opt-in only (enforceSafeZones:true): scale the scene in when text is still inside the free bands after the retry. Never the default.
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
        // Where the located things are (fractions): the product, unlisted objects, and the attached real accessories (box / controller) — the CTA and the text stay off them.
        let accessoryBoxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
        if (accessories.length && imageDataUrl.startsWith('data:')) {
          try {
            const objs: Array<{ label: string; bytes: Buffer }> = []
            for (const o of accessories.slice(0, 2)) {
              const got = await fetchPublicImageDetailed(o.imageUrl).catch(() => null)
              if (got && 'dataUrl' in got) objs.push({ label: o.label, bytes: decode(got.dataUrl) })
            }
            accessoryBoxes = (await findUnlistedObjects({ generated: decode(imageDataUrl), objects: objs })).map((u) => u.box)
          } catch { /* best effort */ }
        }
        // compact colour-cluster boxes (a prop the colour check located) are kept off too; a cluster spread over most of the picture (a thin cable) says nothing about where to stay away from
        const clusterBoxes = (propsCheck?.clusters ?? []).map((c) => c.box).filter((b): b is NonNullable<typeof b> => Boolean(b) && (b!.x1 - b!.x0) * (b!.y1 - b!.y0) <= 0.2)
        const avoid = [...(productBox ? [productBox] : []), ...unlisted.map((u) => u.box), ...accessoryBoxes, ...clusterBoxes]
        try {
          const blocks = splitCopyBlocks(copy, ctaText)
          // ---- Round 7 (free, local): flat strips → continued from the scene; text never on the product (picture moved down when the top is occupied) ----
      const done = await prepareAndLayout({
        bytes: decode(imageDataUrl),
        ratio: ratioPlan.requested,
        logo: logoBytes,
        blocks,
        palette: { primary: kit?.primaryColor, secondary: kit?.secondaryColor, accent: kit?.accentColor },
        fonts: { headingFont: kit?.fontPrimary ?? null, bodyFont: null },
        // Where the located product / unlisted objects are (fractions): text and the CTA are kept off them.
        avoid,
        makeRoom: input.makeRoom,
      })
      const sceneBytes = done.sceneBytes
      const sceneAvoid = done.sceneAvoid
      scenePrep = done.scenePrep
      const sceneUrl = `data:image/jpeg;base64,${sceneBytes.toString('base64')}`
          layers = done.report
          if (layers.logo.status === 'unavailable' && logoNote) layers.logo.reason = logoNote
          imageDataUrl = `data:image/jpeg;base64,${done.bytes.toString('base64')}`
          // QA of the SCENE (what Grok drew: any text / button in the free bands, separators) + the layout report of what the code drew.
          const sceneQa = await qaScene(sceneUrl, sceneAvoid[0] && productBox ? [sceneAvoid[0]] : undefined)
          const r = done.report
          const drewText = r.text.drawn
          const wantsText = Boolean(blocks.headline || blocks.price || blocks.facts?.length)
          const layoutIssues: string[] = []
          if (r.layout.overlaps.length) layoutIssues.push(`layout overlap: ${r.layout.overlaps.join(', ')}`)
          if (!r.text.fits) layoutIssues.push('some text did not fit its box')
          if (r.text.lowContrast) layoutIssues.push('text contrast below 4.5:1')
          if (!r.layout.insideSafeZones) layoutIssues.push('an element sits outside the safe zones')
          qa = {
            ...sceneQa,
            textLayers: 'code',
            textPresent: wantsText ? (drewText ? 'yes' : 'no') : 'not_requested',
            logo: r.logo.status === 'drawn' ? 'attached' : 'none',
            // The count comes from the compositor's own layer report (our ONE pill) + anything button-like Grok drew in the free bands.
            ctaButtons: (r.cta.status === 'drawn' ? 1 : 0) + sceneQa.ctaButtons,
            extraCtaRisk: sceneQa.ctaButtons > 0,
            safeZones: sceneQa.safeZoneIssues.length || !r.layout.insideSafeZones ? 'violation' : 'ok',
            warnings: [...sceneQa.warnings.filter((w) => !w.startsWith('the brand kit has no logo')), ...layoutIssues],
          }
          if (r.logo.status === 'unavailable') qa.logoUnavailable = true
          if (scenePrep) {
            const sm = scenePrep.seams
            qa.seams = { found: sm.found.length, blended: sm.found.length > 0 && (sm.remaining ?? sm.found.length) === 0, remaining: sm.found.length ? (sm.remaining ?? sm.found.length) : 0, details: sm.found.map((s) => ({ edge: s.edge, share: s.stripShare, step: s.step })) }
            if (sm.found.length && qa.seams.blended) qa.warnings.push(`the scene had flat ${sm.found.map((s) => `${s.edge} ${Math.round(s.stripShare * 100)}%`).join(' + ')} strip(s) (letterbox look): continued from the scene in code, no visible band edge left (scenePrep.seams)`)
            if (qa.seams.remaining) qa.warnings.push(`seam: ${qa.seams.remaining} flat strip(s) / visible band edge(s) remain after blending (letterbox look)`)
            if (scenePrep.room?.applied) qa.warnings.push(`scene prep: ${scenePrep.room.note}`)
          }
          qa.textScale = r.text.drawn ? r.text.scale : undefined
          if (r.text.drawn && r.text.scale < TEXT_SCALE_WARN) qa.warnings.push(`text scaled to ${Math.round(r.text.scale * 100)}% of its nominal size (< ${Math.round(TEXT_SCALE_WARN * 100)}%): ${r.text.textOverProduct ? 'the scene left no calm corridor for the text' : 'the calm corridor above the product is short'} — small type reads poorly; regenerate with the product lower in the frame`)
          if (r.cta.busy) {
            qa.ctaBusy = true
            qa.warnings.push('the CTA button sits on a busy area / the product: every slot of the bottom band was busy (compositeLayers.cta.busy)')
          }
          if (r.text.textOverProduct) qa.warnings.push('text over the product: the scene left no calm area for the text, so it was laid over the top of the objects on a soft scrim (compositeLayers.text.textOverProduct) — defect, regenerate with the product lower in the frame')
          if (r.cta.seam) qa.warnings.push('the CTA straddles a hard edge of the scene (table edge / band seam) in every slot (compositeLayers.cta.seam)')
          if (!ctaText) qa.warnings.push('the copy has no CTA line: no button was drawn')
          else if (r.cta.fits === false) qa.warnings.push('the CTA text is long: the button text was shrunk to fit')
          qa.severity = qaSeverity({ ...qa, safeZoneIssues: sceneQa.safeZoneIssues }) + (r.layout.overlaps.length ? 3 : 0) + (r.text.lowContrast ? 2 : 0) + (!r.text.fits ? 2 : 0)
        } catch (err) {
          qa.warnings.push(`layout compositor unavailable: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}`)
          qa.textPresent = 'no'
          qa.status = 'fail'
        }
      } else {
        // Legacy flow (Grok draws logo + CTA): deterministic scale-in fix as before, with the real logo re-stamped if it was clipped.
        const logoBytes = grok.logoDataUrl?.startsWith('data:') ? decode(grok.logoDataUrl) : null
        await fixBySquash(logoBytes)
      }

      // ---- final verdict: defects fail, flagged-but-usable results warn, scale-in is never a 'pass' ---------------------------------
      if (safeZoneFix?.applied) {
        qa.scaleInUsed = true
        qa.warnings.push(`scale-in fallback used: the picture was shrunk to ${Math.round(safeZoneFix.scale * 100)}% inside a padded canvas (visible frame) — treat as a defect and regenerate`)
        qa.severity = Math.max(qa.severity, 5) + 5
      }
      if (composite && layers) {
        const r = layers
        const layoutBad = r.layout.overlaps.length > 0 || !r.text.fits || r.text.lowContrast || !r.layout.insideSafeZones
        qa.status = qa.safeZones === 'violation' || qa.separatorLines.length > 0 || qa.textPresent === 'no' || qa.extraCtaRisk || layoutBad || qa.scaleInUsed || r.text.textOverProduct || (qa.seams?.remaining ?? 0) > 0 ? 'fail' : 'pass'
      } else if (qa.scaleInUsed) qa.status = 'fail'
      if (droppedAccessories.length) qa.warnings.push(`accessory photo(s) not attached (not named in allowedProps): ${droppedAccessories.map((a) => '"' + a.label + '"').join(', ')} - add them to allowedProps to include them`)
      if (propsFlagged) qa.warnings.push(`props: ${propsReason}`)
      if (fidelityCheck.status === 'warning') qa.warnings.push(`fidelity: ${fidelityCheck.warning.reason}`)
      // Round 7 severity factors: the things that used to hide behind severity 0 / 'warning' now count, so the single auto-retry fires and the better result is kept.
      const factors: Record<string, number> = {}
      if (composite && layers) {
        if ((qa.seams?.remaining ?? 0) > 0) factors.seam = 3 * (qa.seams?.remaining ?? 0)
        if (layers.text.textOverProduct) factors.textOverProduct = 4
        if (layers.text.drawn && layers.text.scale < TEXT_SCALE_LOW) factors.textScale = 3
        else if (layers.text.drawn && layers.text.scale < TEXT_SCALE_WARN) factors.textScale = 1.5
        if (layers.cta.seam) factors.ctaSeam = 1
      }
      if (fidelityCheck.status === 'warning') factors.fidelity = fidelityCheck.warning.score < FIDELITY_RETRY_BELOW ? 4 : 1.5
      if (propsFlagged) factors.props = 2 + unlisted.length
      if (Object.keys(factors).length) {
        qa.severityFactors = factors
        if (composite) qa.severity = Math.round((qa.severity + Object.values(factors).reduce((a, b) => a + b, 0)) * 100) / 100
      }
      if (qa.status === 'pass' && (propsFlagged || fidelityCheck.status === 'warning' || qa.ctaBusy || layers?.text.textOverProduct || (layers?.text.scale ?? 1) < TEXT_SCALE_WARN)) qa.status = 'warning'

    
    return { grok, framed, qa, imageDataUrl, fidelityCheck, propsCheck, unlisted, propsFlagged, propsReason, safeZoneFix, qaBeforeFix, layers, scenePrep, aspectRatio: framed.aspectRatio, decisionSeverity: composite && layers ? qa.severity : preSeverity }
  }
  type Attempt = Awaited<ReturnType<typeof finishAttempt>>

  const autoRetry: WebStyleImageOutput['autoRetry'] = { requested: input.autoRetry === true, attempted: false }
  const firstGrok = await runWebPostGrokImage({ ...baseOptions, ...(withRules ? { mcp: mcpRules() } : {}) })
  let totalCost = firstGrok.estimatedCostUsd
  let kept: Attempt = await finishAttempt(firstGrok, await reframe(firstGrok.imageDataUrl, firstGrok.aspectRatio))
  if (input.autoRetry === true && kept.decisionSeverity > 0) {
    // One corrective regeneration inside the same job: no second approval, no second charge (the caller charges once).
    autoRetry.attempted = true
    autoRetry.reason = hint(kept.qa)
    autoRetry.firstQa = { safeZones: kept.qa.safeZones, textPresent: kept.qa.textPresent, issues: kept.qa.warnings.slice(0, 6) }
    try {
      const second = await runWebPostGrokImage({ ...baseOptions, ...(withRules ? { mcp: mcpRules(autoRetry.reason) } : {}) })
      totalCost += second.estimatedCostUsd
      const secondAttempt = await finishAttempt(second, await reframe(second.imageDataUrl, second.aspectRatio))
      autoRetry.firstSeverity = kept.decisionSeverity
      autoRetry.retrySeverity = secondAttempt.decisionSeverity
      if (kept.qa.severityFactors || secondAttempt.qa.severityFactors) autoRetry.factors = { first: kept.qa.severityFactors ?? {}, retry: secondAttempt.qa.severityFactors ?? {} }
      // Keep the BETTER image by QA result (lower weighted defect score, now including seam / text-over-product / text scale / fidelity / props); a tie keeps the first.
      if (pickBetterBySeverity(kept.decisionSeverity, secondAttempt.decisionSeverity) === 'retry') {
        autoRetry.kept = 'retry'
        autoRetry.keptReason = `retry QA severity ${autoRetry.retrySeverity} < first ${autoRetry.firstSeverity} (lower = fewer defects)`
        kept = secondAttempt
      } else {
        autoRetry.kept = 'first'
        autoRetry.keptReason = `retry QA severity ${autoRetry.retrySeverity} was not lower than the first ${autoRetry.firstSeverity} (lower = fewer defects)`
      }
    } catch (err) {
      autoRetry.kept = 'first'
      autoRetry.reason = `${autoRetry.reason}; retry failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`
    }
  }
  const { grok, framed, qa, imageDataUrl, fidelityCheck, propsCheck, unlisted, propsFlagged, propsReason, safeZoneFix, qaBeforeFix, layers, scenePrep, aspectRatio } = kept
  // The fidelity warning survived the (single) retry: say what to do — the real-pixels path with the same code layers (productFidelity "exact").
  const suggestedFallback: WebStyleImageOutput['suggestedFallback'] = fidelityCheck.status === 'warning' && fidelityCheck.warning.score < FIDELITY_RETRY_BELOW
    ? { productFidelity: 'exact', reason: `the product still differs from the reference photo (fidelity ${fidelityCheck.warning.score} < ${FIDELITY_RETRY_BELOW})${autoRetry.attempted ? ' after the one automatic retry' : ''}: re-run with productFidelity:"exact" (real product pixels + the same logo / text / CTA layers) — it is not run automatically because it is a second paid generation` }
    : undefined
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
      ...(unlisted.length ? { unlisted: unlisted.map((u) => ({ label: u.label, inliers: u.inliers })) } : {}),
    },
    ...(propsFlagged ? { props_warning: { code: 'props_warning' as const, reason: propsReason, clusters: propsCheck?.clusters ?? [], ...(unlisted.length ? { unlisted: unlisted.map((u) => ({ label: u.label, inliers: u.inliers })) } : {}) } } : {}),
    ...(scenePrep ? { scenePrep } : {}),
    ...(suggestedFallback ? { suggestedFallback } : {}),
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
export function postCheckSummary(out: Pick<WebStyleImageOutput, 'fidelityCheck' | 'fidelity_warning' | 'qa' | 'copySource' | 'referenceCount' | 'retriedWithClamp' | 'autoRetry' | 'references' | 'propsPolicy' | 'copyNormalised'> & Partial<Pick<WebStyleImageOutput, 'props_warning' | 'copyOverflow' | 'providerRetries' | 'safeZoneFix' | 'qaBeforeFix' | 'caption' | 'compositeLayers' | 'scenePrep' | 'suggestedFallback'>>): Record<string, unknown> {
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
    ...(out.scenePrep ? { scenePrep: out.scenePrep } : {}),
    ...(out.suggestedFallback ? { suggestedFallback: out.suggestedFallback } : {}),
    ...(out.qaBeforeFix ? { qaBeforeFix: out.qaBeforeFix } : {}),
    ...(out.caption ? { caption: out.caption } : {}),
  }
}
