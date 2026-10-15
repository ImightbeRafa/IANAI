/**
 * MCP ↔ web image bridge: one function that makes the MCP image tools call the same Grok post
 * flow as the web app (`api/lib/web-post-image.ts`), feeding it the brand kit, the offer and the
 * copy, then running the free local post-checks (fidelity_warning + safety-net QA).
 *
 * 0.26.0 (docs/mcp-quality.md): by DEFAULT the model designs the WHOLE ad (scene, composition, typography, the copy rendered in-image)
 * from the web brief, with the confirmed real product photos as /images/edits references (PRODUCT LOCK) and the kit logo as a
 * reference — web parity. Code adds nothing by default: the real logo / price are stamped only on request (stampLogo / stampPrice)
 * or when the logo cannot be a reference (vector file). Printed packs get their REAL pixels swapped into the located box (pack-swap.ts,
 * deterministic). The fidelity check is a warning only. At most ONE regeneration, and only with an explicit autoRetry:true.
 * compositeLayers:true is the explicit opt-in to the old scene-only + code-layout flow (layout-ad / compose-scene / scene-prep).
 */
import { readOfferAdProfile } from '../adpack/offer-profile.js'
import { roleFromImageRow, roleFromLabel, stripRolePrefix } from '../adpack/fidelity/photos.js'
import { createModelGateway, withCostLedger } from '../adpack/gateway.js'
import type { ModelGateway } from '../adpack/types.js'
import { reframeToRatio, resolveImageRatio } from '../image-ratios.js'
import type { ProductCreativeRow } from '../product-creative-rules.js'
import { cleanBrandBlock, isAccessoryAttribute, runWebPostGrokImage, type WebPostGrokImageResult } from '../web-post-image.js'
import { buildCaption, capCopyBlocks, factRankOf, PRICE_RE, rankFacts } from './copy-layout.js'
import { findThinStructures, type SceneBlob } from './scene-objects.js'
import { checkExtraObjects, findUnlistedObjects, labelMatchesAllowed, type ExtraObjectsFinding, type UnlistedObject } from './extra-objects.js'
import { checkGeneratedProductFidelity, locateLogoBox, qaSeverity, runMcpImageQa, tidyCopySeparators, type FidelityCheckResult, type FidelityWarning, type McpImageQa } from './image-postcheck.js'
import { enforceSafeZones, type SafeZoneFix } from './safe-zone-fix.js'
import { scrubClaims, scrubCopy, uniqueClaims } from './claims-filter.js'
import { isPackProduct, productKindOf } from './product-kind.js'
import { loadAdLogo, logoIconCheck } from './logo-check.js'
import { prepareAndLayout } from './compose-scene.js'
import { layoutAdLayers, splitCopyBlocks, type AdLayoutReport } from './layout-ad.js'
import { freeBands } from './safe-zones.js'
import type { ScenePrepReport } from './compose-scene.js'
import { swapRealPackPixels, type PackSwapReport } from './pack-swap.js'
import { fetchPublicImageDetailed } from '../fetch-image-data-url.js'
import type { McpBrandContext } from './user-tools.js'

/** Round 7 thresholds (compositeLayers opt-in only). Text below 80 % of its nominal size is always warned; below 75 % (or on the product) it counts in the severity. */
const TEXT_SCALE_WARN = 0.8
const TEXT_SCALE_LOW = 0.75

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

/** Round 9: same wording test as web-post-image lockRulesBlock (strict): an attribute naming a separate object (box, controller, cable …). */
const words9 = (t: string) => new Set(t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4))

/**
 * Round 9: scope the offer's immutable attributes to the photo actually selected (MCP path only; the web request is untouched).
 *  - hero = a box / contents / part photo (e.g. the controller): the main product's own attributes ("white paper plane … grey propellers") are dropped, so Grok
 *    does not redraw the plane next to the controller; only the attribute(s) describing the selected object stay;
 *  - accessory attributes (box, controller, USB cable …) stay only when that object is attached as a real photo or IS the selected photo — never listed
 *    otherwise (even a "do not draw the blue USB cable" line made it appear).
 */
export function scopeLockToPhotoRole(attrs: string[] | undefined, opts: { role?: string | null; photoLabel?: string | null; attachedLabels: string[]; /** 0.26.0: printed pack offer — packaging attributes describe the product itself. */ packProduct?: boolean }): { attrs: string[]; dropped: string[] } {
  const list = (attrs || []).map((a) => a.trim()).filter(Boolean)
  const heroIsAccessory = Boolean(opts.role && ACCESSORY_ROLES.has(opts.role))
  const heroWords = words9(`${opts.photoLabel || ''}`)
  const attachedWords = opts.attachedLabels.map((l) => words9(l))
  const hits = (a: string, ws: Set<string>) => { const aw = words9(a); for (const w of ws) if (aw.has(w) || [...aw].some((x) => x.startsWith(w) || w.startsWith(x))) return true; return false }
  const keep: string[] = []
  const dropped: string[] = []
  for (const a of list) {
    const isAccessory = isAccessoryAttribute(a, opts.packProduct)
    const isHero = heroWords.size > 0 && hits(a, heroWords)
    const isAttached = attachedWords.some((ws) => ws.size > 0 && hits(a, ws))
    let ok: boolean
    if (heroIsAccessory) ok = isHero || (isAccessory && isAttached) || (!heroWords.size && isAccessory && opts.role === 'box' && /\b(caja|box|empaque|packaging)\b/i.test(a))
    else ok = !isAccessory || isAttached
    ;(ok ? keep : dropped).push(a)
  }
  return { attrs: keep, dropped }
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
  /** Confirmed product photos (resolved from the ids the user confirmed), hero first. Nothing else is ever added as a product ref. */
  productUrls: string[]
  supportUrls?: string[]
  /** 'none' = no accessory photos either. */
  referenceMode?: 'use' | 'none'
  lock?: Partial<OfferLock>
  /** Real accessory photos (box / controller / contents) attached as extra references. */
  accessories?: Array<{ imageUrl: string; label: string }>
  /** Round 8: role of the product photo used as the reference (hero / box / contents / part …): a box / contents / part photo may be shot from another angle than the ad. */
  productPhotoRole?: string | null
  /** Round 9: label of the selected product photo (e.g. "Control remoto"): scopes the lock attributes to the object actually shown. */
  productPhotoLabel?: string | null
  /**
   * Explicit opt-in only (default false): when the free QA finds a defect, regenerate ONCE with a corrective hint and keep the better
   * image. Never more than one extra paid generation; it is disclosed in the approval and its provider cost is logged.
   */
  autoRetry?: boolean
  /** Default true: condense a long copy to headline + 1 price line + 1 facts line + 1 CTA; the rest comes back as `copyOverflow` for the caption. */
  layoutCap?: boolean
  /** Legacy explicit opt-in (default false): scale the picture into a safe canvas when the QA finds text in the Instagram UI margins. */
  enforceSafeZones?: boolean
  /** Real offer photos (box / contents / parts) NOT attached: flagged when they show up in a compositeLayers scene (warning only). */
  libraryPhotos?: Array<{ imageUrl: string; label: string }>
  /**
   * Default FALSE (0.26.0): the model designs the whole ad. true = explicit opt-in to the scene-only flow (the model draws no text; the
   * real logo, headline, price, facts and ONE CTA are composited in code — layout-ad / compose-scene / scene-prep).
   */
  compositeLayers?: boolean
  /** Default true: MCP prompt rules (binding scene, strict lock / no invented props, safe-zone margins, one CTA). false = the legacy web prompt (parity test). */
  mcpRules?: boolean
  /** Optional free text appended to the product lock (e.g. "propeller is light grey, wing is one smooth sheet"). */
  productNotes?: string
  /** compositeLayers opt-in only: when the text would land on the product, move the picture down by extending the background above it. */
  makeRoom?: boolean
  /** Opt-in (default false): stamp the REAL kit logo in code (the logo is then not sent to the model). Automatic when the logo is a vector file. */
  stampLogo?: boolean
  /** Opt-in (default false): stamp the copy's price line in code (the model then does not draw it). */
  stampPrice?: boolean
  /** Test seam: segmentation gateway for the pack swap (default: the Gemini gateway, used only when the local flood fails). */
  segmentGateway?: Pick<ModelGateway, 'segment'>
}

/** One paid provider call made for this image (logged one row each by the caller). */
export type PaidCall = { purpose: 'generate' | 'auto_retry' | 'segment'; provider: 'xai' | 'gemini'; model: string; costUsd: number }

export type WebStyleImageOutput = {
  /** Round 9: raw generation of the kept attempt (before any code layer). Never put into a tool result as bytes: the caller uploads it and returns the URL. */
  rawScene?: { imageDataUrl: string }
  /** Round 9: offer lock attributes scoped to the selected photo's role (dropped = not sent to the model). */
  lockScope?: { role: string | null; kept: string[]; dropped: string[] }
  generated: {
    imageDataUrl: string
    providerModel: string
    /** Sum of every paid call below. */
    estimatedCostUsd: number
    resolution: string
    quality: string
    aspectRatio: string
    mode: string
    lockApplied: boolean
  }
  /** Every paid call (first generation, the optional retry, a segmentation fallback) with its own cost. */
  paidCalls: PaidCall[]
  prompt: string
  request: WebPostGrokImageResult['request']
  referenceCount: number
  retriedWithClamp: boolean
  copySource: 'copy' | 'guidePrompt' | 'offer_default'
  /** Round 8: claims dropped from the offer text / copy (kit forbiddenPhrases + built-in regulated health claims). */
  removedClaims?: string[]
  /** Warning only: never fails, retries or changes charges. */
  fidelityCheck: FidelityCheckResult
  fidelity_warning?: FidelityWarning
  qa: McpImageQa
  autoRetry: { requested: boolean; attempted: boolean; reason?: string; kept?: 'first' | 'retry'; keptReason?: string; firstSeverity?: number; retrySeverity?: number; factors?: { first: Record<string, number>; retry: Record<string, number> }; firstQa?: { safeZones: McpImageQa['safeZones']; textPresent: McpImageQa['textPresent']; issues: string[] } }
  references: { used: WebPostGrokImageResult['referencesUsed']; warnings: WebPostGrokImageResult['referenceWarnings'] }
  /** What was allowed in the scene. The local props heuristics run only on the compositeLayers opt-in. */
  propsPolicy: { forbidExtraProps: boolean; allowed: string[]; accessoryReferences: number; verifiedLocally: boolean; source: 'input' | 'none'; check?: ExtraObjectsFinding; unlisted?: Array<{ label: string; inliers: number }> }
  /** Warning only (compositeLayers opt-in): colours next to the product that no reference explains (possible invented props). */
  props_warning?: { code: 'props_warning'; reason: string; clusters: ExtraObjectsFinding['clusters']; unlisted?: Array<{ label: string; inliers: number }> }
  /** compositeLayers opt-in: what the free scene prep did. */
  scenePrep?: ScenePrepReport
  /** Printed packs: the real pack pixels swapped into the located box (or why not). */
  packSwap?: PackSwapReport
  /** What code stamped on the model's ad on request (stampLogo / stampPrice / vector logo). */
  stamped?: { logo: boolean; price?: string; reason: string }
  copyNormalised: string[]
  /** Copy lines moved off the image by the layout cap (put them in the caption). */
  copyOverflow: string[]
  /** Transient provider failures retried inside the HTTP call (not an error, not charged). */
  providerRetries: number
  /** Deterministic safe-zone fix applied to the kept image (legacy explicit enforceSafeZones:true only). */
  safeZoneFix?: SafeZoneFix
  /** The QA verdict of the image as Grok drew it, before the deterministic fix (only when a fix was applied). */
  qaBeforeFix?: { safeZones: McpImageQa['safeZones']; severity: number; issues: string[] }
  /** compositeLayers opt-in: what the code compositor drew (real logo, exact CTA, scrim). */
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

/** Retry hint for the single (explicit) QA auto-retry. */
function retryHintFor(qa: McpImageQa, language: 'es' | 'en'): string {
  const es = language !== 'en'
  const bits: string[] = []
  if (qa.safeZoneIssues.some((i) => i.kind === 'block_touches_edge')) bits.push(es ? 'el botón CTA tocaba el borde: subilo y dejalo completo con aire (≥ 11% del borde de abajo)' : 'the CTA button touched the edge: move it up and keep it fully visible with air (≥ 11% above the bottom edge)')
  if (qa.safeZoneIssues.some((i) => i.kind === 'text_in_unsafe_band')) bits.push(es ? 'había texto dentro del margen de la UI de Instagram: mové todo el texto hacia dentro (nada en el 8% superior ni inferior)' : 'text sat inside the Instagram UI margin: move all text inward (nothing in the top or bottom 8%)')
  if (qa.textPresent === 'no') bits.push(es ? 'faltaba el texto del copy: dibujalo completo y legible' : 'the copy text was missing: draw it complete and legible')
  if (qa.extraCtaRisk) bits.push(es ? 'había un segundo botón: dejá UN solo CTA con el texto exacto de la copy' : 'there was a second button: keep ONE CTA with the exact copy text')
  return bits.join('; ')
}

/** Retry hint for the composited (scene-only, opt-in) flow. */
function retryHintComposite(qa: McpImageQa, language: 'es' | 'en', ratio: string, kind: 'plane' | 'generic' = 'generic'): string {
  const es = language !== 'en'
  const bands = freeBands(ratio)
  const top = `${Math.round(bands.top * 100)}%`
  const bot = `${Math.round(bands.bottom * 100)}%`
  const bits: string[] = []
  if (qa.safeZoneIssues.length) bits.push(es ? `había texto u objetos en el ${top} superior o el ${bot} inferior: dejá esas franjas LIBRES (solo fondo), generá la escena SIN NINGÚN TEXTO y poné el producto más abajo` : `text or objects sat in the top ${top} or the bottom ${bot}: leave those bands FREE (background only), generate the scene with NO TEXT at all and move the product lower`)
  if ((qa.sceneButtonLike ?? 0) > 0) bits.push(es ? 'se dibujó un botón o logo: NO dibujes botones, CTA ni logo (se agregan por código)' : 'a button or logo was drawn: do NOT draw buttons, CTAs or a logo (they are added in code)')
  const f = qa.severityFactors ?? {}
  if (f.seam) bits.push(es ? 'NO pintes franjas, barras ni bloques planos arriba o abajo (efecto letterbox): la pared y la mesa continúan hasta el borde de la imagen' : 'do NOT paint flat strips, bars or blocks at the top or bottom (letterbox look): the wall and the table run to the edge of the picture')
  if (f.textOverProduct || f.textScale) bits.push(es ? 'dejá arriba un fondo calmo y continuo (sin objetos) para el titular' : 'leave a calm, continuous, object-free background up top for the headline')
  if (f.ctaBlocked) bits.push(es ? 'dejá el borde inferior libre de producto y accesorios, con fondo calmo' : 'keep the bottom edge free of the product and accessories, with calm background')
  if (f.props) bits.push(kind === 'plane' ? (es ? 'sin objetos que no estén en las fotos de referencia ni en los extras permitidos (cables, cajas, controles, herramientas)' : 'no objects that are not in the reference photos or in the allowed extras (cables, boxes, controllers, tools)') : (es ? 'sin objetos que no estén en las fotos de referencia ni en los extras permitidos' : 'no objects that are not in the reference photos or the allowed extras'))
  if (qa.separatorLines.length) bits.push(es ? 'sin separadores sueltos al inicio o final de línea' : 'no dangling separators at the start or end of a line')
  return bits.join('; ')
}

/**
 * Auto-retry selection. QA severity is a DEFECT score: LOWER is better (0 = clean). The retry replaces the first image only when its score is
 * strictly lower; a tie keeps the first. Exported so the rule is unit-tested on the real round-5c numbers.
 */
export function pickBetterBySeverity(first: number, retry: number): 'first' | 'retry' {
  return retry < first ? 'retry' : 'first'
}

const productBoxOf = (f: FidelityCheckResult): { x0: number; y0: number; x1: number; y1: number } | undefined =>
  f.status === 'ok' || f.status === 'unverified' ? f.details.productBox : f.status === 'warning' ? f.warning.details.productBox : undefined

const locatedConfidently = (f: FidelityCheckResult): boolean =>
  f.status === 'ok' ? f.details.confident : f.status === 'warning' ? f.warning.details.confident : false

/** A kit logo that cannot ride as an /images/edits reference (vector file): stamped in code instead. */
export function logoNeedsStamp(url: string | null | undefined): boolean {
  return Boolean(url && /^data:image\/svg|\.svg(?:[?#]|$)/i.test(url.trim()))
}

export async function generateWebStyleImage(input: WebStyleImageInput): Promise<WebStyleImageOutput> {
  const { ctx } = input
  const offerRaw = ctx.offers.find((o) => o.id === input.offerId)
  const kit = ctx.brandKit
  const ratioPlan = resolveImageRatio(input.aspectRatio)
  const language = input.language === 'en' ? 'en' : 'es'

  // Round 8 (MCP rules only): banned wording (kit forbiddenPhrases + the built-in regulated health claims) never reaches the Grok prompt or the code-rendered copy.
  const withRules = input.mcpRules !== false
  const forbidden = kit?.forbiddenPhrases ?? []
  const removedClaimsAcc: string[] = []
  const scrubCopyIf = (c: string): string => {
    if (!withRules || !c) return c
    const r = scrubCopy(c, forbidden)
    removedClaimsAcc.push(...r.removed)
    return r.text
  }
  const scrubTextIf = (t: string | null | undefined): string | null | undefined => {
    if (!withRules || !t) return t
    const r = scrubClaims(t, forbidden)
    removedClaimsAcc.push(...r.removed)
    return r.text
  }
  const offer = offerRaw && withRules
    ? { ...offerRaw, productDescription: scrubTextIf(offerRaw.productDescription) ?? null, differentiation: scrubTextIf(offerRaw.differentiation) ?? null, technicalSpecs: scrubTextIf(offerRaw.technicalSpecs) ?? null } as typeof offerRaw
    : offerRaw
  const extraContextScrubbed = input.extraContext?.map((c) => scrubTextIf(c) ?? '').filter(Boolean)
  const guidePromptScrubbed = (scrubTextIf(input.guidePrompt) ?? undefined) || undefined
  let copy = scrubCopyIf(cleanCopy(input.copy))
  let copySource: WebStyleImageOutput['copySource'] = 'copy'
  if (!copy) {
    copy = scrubCopyIf(cleanCopy(input.guidePrompt))
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
  const businessContext = buildMcpBusinessContext({
    language,
    // The scene is a binding instruction (web-post-image `mcp.scene`), not a "Contexto factual (NO renderizar)" line.
    ...(withRules ? {} : { scene: input.scene }),
    offer,
    extraContext: extraContextScrubbed,
    guidePrompt: guidePromptScrubbed,
    copySource,
  })

  // 0.26.0: the model designs the whole ad by default; the scene-only + code-layout flow is an explicit opt-in.
  const composite = withRules && input.compositeLayers === true
  const kitLogoUrl = kit?.logoUrl || null
  // Code stamps the real logo only on request, or when the kit logo cannot be a reference (vector file).
  const stampLogo = !composite && Boolean(kitLogoUrl) && (input.stampLogo === true || logoNeedsStamp(kitLogoUrl))
  const copyLines = copy.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const priceLine = !composite && input.stampPrice === true ? copyLines.find((l) => l !== ctaText && PRICE_RE.test(l)) : undefined
  const promptCopy = composite && ctaText
    ? copyLines.filter((l) => l !== ctaText.trim()).join('\n').trim() || copy
    : priceLine ? copyLines.filter((l) => l !== priceLine).join('\n') : copy
  const useAccessoryRefs = input.referenceMode !== 'none'
  const allowedList = (input.lock?.allowedProps || []).map((a) => a.trim()).filter(Boolean)
  const accessoryCandidates = useAccessoryRefs ? (input.accessories || []).filter((a) => a.imageUrl) : []
  // allowedProps governs (default = no props): an accessory photo that the allowed list does not name is NOT attached.
  const accessories = withRules && allowedList.length ? accessoryCandidates.filter((a) => labelMatchesAllowed(a.label, allowedList)) : accessoryCandidates
  const droppedAccessories = accessoryCandidates.filter((a) => !accessories.includes(a))
  const packOffer = isPackProduct([offerRaw?.name, offerRaw?.type, offerRaw?.productDescription, offerRaw?.technicalSpecs, input.productNotes])
  const scopedLock = scopeLockToPhotoRole(input.lock?.immutableAttributes, { role: input.productPhotoRole, photoLabel: input.productPhotoLabel, attachedLabels: accessories.map((a) => a.label), packProduct: packOffer })
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
    // Round 8: clipped cleanly (no 'HECHOS CONFIRMADOS (' cut mid-word) — MCP path only
    brandVoice: cleanBrandBlock(kit?.brandVoice, 340),
    brandVisual: cleanBrandBlock(kit?.visualStyleNotes, 260),
    brandName: ctx.brand.name,
    brandKitId: kit?.id ?? null,
    offerId: input.offerId,
    productRow: productRowFromOffer(offer),
    // Confirmed product photos only (0.26.0: the kit's reference images are never appended as product refs).
    productUrls: input.productUrls,
    accessoryUrls: accessories.map((a) => a.imageUrl),
    supportUrls: input.supportUrls || [],
    // Default: the kit logo rides as a reference and the model places it. composite / stampLogo: code stamps the real asset, so the model gets none.
    logoUrl: composite || stampLogo ? null : kitLogoUrl,
    lockProductAppearance: input.lock?.lockProductAppearance,
    immutableAttributes: withRules ? [...scopedLock.attrs, ...(input.productPhotoRole && ACCESSORY_ROLES.has(input.productPhotoRole) && (scopedLock.dropped.length || scopedLock.attrs.length) ? [language === 'en' ? `the reference photo is the ${input.productPhotoLabel || input.productPhotoRole}: show ONLY that object, do not draw the main product or any other part next to it` : `la foto de referencia es ${input.productPhotoLabel || input.productPhotoRole}: mostrá SOLO ese objeto, no dibujes el producto principal ni otras piezas al lado`] : [])] : input.lock?.immutableAttributes,
  }
  // Round 8: the plane-specific lock wording is only for plane-like products; everything else gets the generic lock.
  const viewMayChange = Boolean(input.productPhotoRole && ['box', 'contents', 'part'].includes(input.productPhotoRole))
  const productKind = productKindOf([offerRaw?.name, offerRaw?.type, offerRaw?.productDescription, offerRaw?.technicalSpecs, input.productNotes])
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
    productKind,
    ...(packOffer ? { packProduct: true } : {}),
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
      copyRequested: Boolean(promptCopy),
      logoAttached: Boolean(kitLogoUrl) && !stampLogo,
      logoExpected: Boolean(kit),
      copy: promptCopy,
      copyChanges: tidied.changes,
    })
  }
  const enforce = input.enforceSafeZones === true
  // Legacy explicit enforceSafeZones: safe-zone defects are fixed in code (scale-in) so they never justify a second paid generation.
  const effSeverity = (q: McpImageQa) => {
    if (composite) return qaSeverity({ ...q, ctaButtons: q.ctaButtons > 0 ? q.ctaButtons + 1 : 0 })
    return enforce ? qaSeverity({ ...q, safeZoneIssues: [] }) : q.severity
  }
  // Composited flow: the scene as Grok drew it has no logo / CTA / copy-band text yet, so the QA only checks bands, buttons, separators.
  const qaScene = (imageDataUrl: string, excludeBoxes?: Array<{ x0: number; y0: number; x1: number; y1: number }>) =>
    runMcpImageQa({ generatedDataUrl: imageDataUrl, requestedRatio: ratioPlan.requested, copyRequested: false, logoAttached: true, logoExpected: false, copy: promptCopy, copyChanges: tidied.changes, sceneOnly: { bands: freeBands(ratioPlan.requested), ...(excludeBoxes?.length ? { excludeBoxes } : {}) } })
  const check = (url: string, logoDataUrl?: string | null) => (composite ? qaScene(url) : qaFor(url, logoDataUrl))
  const hint = (q: McpImageQa) => (composite ? retryHintComposite(q, language, ratioPlan.requested, productKind) : retryHintFor(q, language))

  type GrokRun = Awaited<ReturnType<typeof runWebPostGrokImage>>
  type Framed = { imageDataUrl: string; aspectRatio: string }
  const decode = (url: string) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
  const fetchBytes = async (u: string): Promise<Buffer | { error: string }> => { const f = await fetchPublicImageDetailed(u); return 'dataUrl' in f ? decode(f.dataUrl) : { error: `${f.failure.url} → ${f.failure.status ? `HTTP ${f.failure.status}` : f.failure.reason}` } }

  /** Everything after one generation: free QA + the warning-only fidelity check; on the compositeLayers opt-in, the props checks + code layers. */
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
      // The scale-in canvas never runs for a composited image; only the default flow with an EXPLICIT enforceSafeZones:true may use it.
      if (composite || input.enforceSafeZones !== true || !qa.safeZoneIssues.length || !imageDataUrl.startsWith('data:')) return
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

    // Free local fidelity post-check — WARNING ONLY: never fails, never retries, never changes the charge.
    const fidelityCheck = grok.lockApplied
      ? await checkGeneratedProductFidelity({ referenceDataUrls: grok.productReferenceDataUrls, generatedDataUrl: preFixImageDataUrl, tolerateViewChange: productKind !== 'plane' || viewMayChange })
      : ({ status: 'skipped', reason: 'no product reference attached' } as FidelityCheckResult)
    const productBox = productBoxOf(fidelityCheck)

    // ---- compositeLayers opt-in only: props heuristics + code layout (the default path runs none of this) ----
    let propsCheck: ExtraObjectsFinding | undefined
    let unlisted: UnlistedObject[] = []
    let cables: SceneBlob[] = []
    if (composite && preFixImageDataUrl.startsWith('data:')) {
      const accessoryRefCount = grok.referencesUsed.filter((k) => k === 'accessory').length
      try {
        const imgBytes = decode(preFixImageDataUrl)
        const refBytes = grok.allReferenceDataUrls.filter((u) => u.startsWith('data:')).map(decode)
        if (refBytes.length) propsCheck = await checkExtraObjects({ generated: imgBytes, references: refBytes, productBox: productBox ?? null, allowedCount: Math.min(2, Math.max(0, allowedList.length - accessoryRefCount)), mode: 'scene' })
        const lib = [...droppedAccessories, ...(input.libraryPhotos || []).filter((p) => p.imageUrl && !labelMatchesAllowed(p.label, allowedList))].slice(0, 3)
        if (lib.length) {
          const objects: Array<{ label: string; bytes: Buffer }> = []
          for (const o of lib) {
            const got = await fetchPublicImageDetailed(o.imageUrl).catch(() => null)
            if (got && 'dataUrl' in got) objects.push({ label: o.label, bytes: decode(got.dataUrl) })
          }
          unlisted = await findUnlistedObjects({ generated: imgBytes, objects })
        }
      } catch { /* heuristic only */ }
      try {
        const cableAllowed = /\b(cable|usb|cargador|charger|cord)/i.test([...allowedList, ...accessories.map((a) => a.label)].join(' '))
        if (!cableAllowed) {
          const found = await findThinStructures(decode(preFixImageDataUrl), { ignoreTop: 0.06, ignoreBottom: 0.01 })
          const pb = productBox
          cables = found.cables.filter((c) => !(pb && (c.box.x0 + c.box.x1) / 2 >= pb.x0 && (c.box.x0 + c.box.x1) / 2 <= pb.x1 && (c.box.y0 + c.box.y1) / 2 >= pb.y0 && (c.box.y0 + c.box.y1) / 2 <= pb.y1))
          if (cables.length && propsCheck) propsCheck = { ...propsCheck, suspected: true, cables: cables.map((c) => ({ box: c.box, share: Math.round(c.area * 1000) / 10 })) }
        }
      } catch { /* heuristic only */ }
    }
    const propsFlagged = Boolean(propsCheck?.suspected) || unlisted.length > 0 || cables.length > 0
    const propsReason = [
      cables.length ? `a thin cable-like object (${cables.map((c) => `${Math.round(c.box.x0 * 100)}–${Math.round(c.box.x1 * 100)}% × ${Math.round(c.box.y0 * 100)}–${Math.round(c.box.y1 * 100)}%`).join(', ')}) is in the scene and no allowed prop / attached photo names a cable (invented accessory)` : '',
      propsCheck?.suspected && !(cables.length && propsCheck.count <= propsCheck.budget) ? propsCheck.note : '',
      unlisted.length ? `real photo(s) of ${unlisted.map((u) => `"${u.label}"`).join(', ')} show up in the scene but the allowed props do not name them (invented / unlisted prop)` : '',
    ].filter(Boolean).join('; ')

    if (composite && imageDataUrl.startsWith('data:')) {
      let logoNote = ''
      // Round 9: wordmark / primary variant before the kit logo_url, never a favicon / app icon while a non-icon logo loads
      const pickedLogo = await loadAdLogo(kit, fetchBytes)
      const logoBytes = pickedLogo.bytes
      const logoIcon = pickedLogo.icon
      if (!logoBytes && pickedLogo.notes.length) logoNote = pickedLogo.notes[0]
      if (pickedLogo.skippedIcons.length) qa.warnings.push(`logo: ${pickedLogo.skippedIcons.length} icon / favicon logo(s) of the kit skipped in favour of the wordmark (${pickedLogo.url})`)
      let accessoryBoxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
      if (accessories.length) {
        try {
          const objs: Array<{ label: string; bytes: Buffer }> = []
          for (const o of accessories.slice(0, 2)) {
            const got = await fetchPublicImageDetailed(o.imageUrl).catch(() => null)
            if (got && 'dataUrl' in got) objs.push({ label: o.label, bytes: decode(got.dataUrl) })
          }
          accessoryBoxes = (await findUnlistedObjects({ generated: decode(imageDataUrl), objects: objs })).map((u) => u.box)
        } catch { /* best effort */ }
      }
      const clusterBoxes = (propsCheck?.clusters ?? []).map((c) => c.box).filter((b): b is NonNullable<typeof b> => Boolean(b) && (b!.x1 - b!.x0) * (b!.y1 - b!.y0) <= 0.2)
      const avoid = [...(productBox ? [productBox] : []), ...unlisted.map((u) => u.box), ...accessoryBoxes, ...clusterBoxes, ...cables.map((c) => c.box)]
      try {
        const blocks = splitCopyBlocks(copy, ctaText)
        const done = await prepareAndLayout({
          bytes: decode(imageDataUrl),
          ratio: ratioPlan.requested,
          logo: logoBytes,
          blocks,
          palette: { primary: kit?.primaryColor, secondary: kit?.secondaryColor, accent: kit?.accentColor },
          fonts: { headingFont: kit?.fontPrimary ?? null, bodyFont: null },
          avoid,
          makeRoom: input.makeRoom,
          optionalFacts: rankFacts((capped?.overflow ?? []).filter((l) => factRankOf(l) <= 2)).slice(0, 1),
        })
        scenePrep = done.scenePrep
        const sceneUrl = `data:image/jpeg;base64,${done.sceneBytes.toString('base64')}`
        layers = done.report
        if (layers.logo.status === 'unavailable' && logoNote) layers.logo.reason = logoNote
        imageDataUrl = `data:image/jpeg;base64,${done.bytes.toString('base64')}`
        const sceneQa = await qaScene(sceneUrl, done.sceneAvoid[0] && productBox ? [done.sceneAvoid[0]] : undefined)
        const r = done.report
        const wantsText = Boolean(blocks.headline || blocks.price || blocks.facts?.length)
        const layoutIssues: string[] = []
        if (r.layout.overlaps.length) layoutIssues.push(`layout overlap: ${r.layout.overlaps.join(', ')}`)
        if (!r.text.fits) layoutIssues.push('some text did not fit its box')
        if (r.text.lowContrast) layoutIssues.push('text contrast below 4.5:1')
        if (!r.layout.insideSafeZones) layoutIssues.push('an element sits outside the safe zones')
        qa = {
          ...sceneQa,
          textLayers: 'code',
          textPresent: wantsText ? (r.text.drawn ? 'yes' : 'no') : 'not_requested',
          logo: r.logo.status === 'drawn' ? 'attached' : 'none',
          // The count comes ONLY from the compositor's own layer report (our one pill); scene button-like blocks are informational.
          ctaButtons: r.cta.status === 'drawn' ? 1 : 0,
          extraCtaRisk: false,
          sceneButtonLike: sceneQa.ctaButtons,
          safeZones: r.layout.insideSafeZones ? 'ok' : 'violation',
          warnings: [...sceneQa.warnings.filter((w) => !w.startsWith('the brand kit has no logo')), ...layoutIssues],
        }
        if (r.logo.status === 'unavailable') qa.logoUnavailable = true
        if (logoIcon?.looksLikeIcon) {
          qa.logoLooksLikeIcon = true
          qa.warnings.push(`the kit logo looks like a favicon / app icon, not the wordmark (${logoIcon.reason}): it is placed as it is — upload the real wordmark logo to the brand kit (qa.logoLooksLikeIcon)`)
        }
        if (scenePrep) {
          const sm = scenePrep.seams
          qa.seams = { found: sm.found.length, blended: sm.found.length > 0 && (sm.remaining ?? sm.found.length) === 0, remaining: sm.found.length ? (sm.remaining ?? sm.found.length) : 0, details: sm.found.map((s) => ({ edge: s.edge, share: s.stripShare, step: s.step })) }
          if (sm.cropZoom?.applied) qa.warnings.push(`the scene had flat ${sm.found.map((x) => `${x.edge} ${Math.round(x.stripShare * 100)}%`).join(' + ')} strip(s): cut off and the picture zoomed ${Math.round(((sm.cropZoom.zoom ?? 1) - 1) * 1000) / 10}% (qa.seams.cropZoom)`)
          else if (sm.found.length && qa.seams.blended) qa.warnings.push(`the scene had flat ${sm.found.map((s) => `${s.edge} ${Math.round(s.stripShare * 100)}%`).join(' + ')} strip(s): continued from the scene in code (scenePrep.seams)`)
          if (sm.skipped?.length) {
            qa.seamBlendSkipped = true
            qa.warnings.push(`seam blend skipped: ${sm.skipped.map((k) => `${k.edge} strip next to detailed content (${Math.round(k.detail * 100)}%)`).join(', ')} (qa.seamBlendSkipped)`)
          }
          if (qa.seams.remaining) qa.warnings.push(`seam: ${qa.seams.remaining} flat strip(s) / visible band edge(s) remain after blending (letterbox look)`)
          if (scenePrep.room?.applied) qa.warnings.push(`scene prep: ${scenePrep.room.note}`)
          if (scenePrep.roomBelow?.attempted) qa.warnings.push(`scene prep (bottom): ${scenePrep.roomBelow.note}`)
          if (scenePrep.extended) qa.warnings.push(`scene prep: ${scenePrep.extended.note}`)
          if (sm.cropZoom?.applied) qa.seams.cropZoom = { zoom: sm.cropZoom.zoom ?? 1, cropTopPx: sm.cropZoom.cropTopPx ?? 0, cropBottomPx: sm.cropZoom.cropBottomPx ?? 0 }
        }
        qa.textScale = r.text.drawn ? r.text.scale : undefined
        if (r.text.drawn && r.text.scale < TEXT_SCALE_WARN) qa.warnings.push(`text scaled to ${Math.round(r.text.scale * 100)}% of its nominal size (< ${Math.round(TEXT_SCALE_WARN * 100)}%)`)
        if (scenePrep?.ctaBlocked || (r.cta.status === 'drawn' && r.cta.blocked)) {
          qa.ctaBlocked = true
          qa.warnings.push('the CTA button touches the located product / an accessory in every slot of the bottom band: drawn on the least bad slot (qa.ctaBlocked)')
        }
        if (r.logo.status === 'drawn' && r.logo.plate) qa.warnings.push(`the logo sat on a similar-tone / busy area (contrast ${r.logo.contrastBefore}): it was put on a solid ${r.logo.plate.fill} plate (contrast now ${r.logo.contrast})`)
        if (r.cta.busy) {
          qa.ctaBusy = true
          qa.warnings.push('the CTA button sits on a busy area / the product: every slot of the bottom band was busy (compositeLayers.cta.busy)')
        }
        if (r.text.textOverProduct) qa.warnings.push('text over the product: the scene left no calm area for the text (compositeLayers.text.textOverProduct)')
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
      // Default flow (the model drew the whole ad): only the legacy explicit scale-in, with the real logo re-stamped if it was clipped.
      const logoBytes = grok.logoDataUrl?.startsWith('data:') ? decode(grok.logoDataUrl) : null
      await fixBySquash(logoBytes)
    }

    // ---- final verdict: defects fail, flagged-but-usable results warn, scale-in is never a 'pass' ----
    if (composite && input.enforceSafeZones === true) qa.warnings.push('enforceSafeZones ignored: with compositeLayers the scale-in canvas never runs')
    if (safeZoneFix?.applied) {
      qa.scaleInUsed = true
      qa.warnings.push(`scale-in fallback used: the picture was shrunk to ${Math.round(safeZoneFix.scale * 100)}% inside a padded canvas (visible frame) — treat as a defect`)
      qa.severity = Math.max(qa.severity, 5) + 5
    }
    if (composite && layers) {
      const r = layers
      const layoutBad = r.layout.overlaps.length > 0 || !r.text.fits || r.text.lowContrast || !r.layout.insideSafeZones
      qa.status = qa.safeZones === 'violation' || qa.separatorLines.length > 0 || qa.textPresent === 'no' || qa.extraCtaRisk || Boolean(qa.ctaBlocked) || layoutBad || qa.scaleInUsed || r.text.textOverProduct || (qa.seams?.remaining ?? 0) > 0 ? 'fail' : 'pass'
    } else if (qa.scaleInUsed) qa.status = 'fail'
    if (droppedAccessories.length) qa.warnings.push(`accessory photo(s) not attached (not named in allowedProps): ${droppedAccessories.map((a) => '"' + a.label + '"').join(', ')} - add them to allowedProps to include them`)
    if (propsFlagged) qa.warnings.push(`props: ${propsReason}`)
    if (fidelityCheck.status === 'warning') qa.warnings.push(`fidelity (warning only): ${fidelityCheck.warning.reason}`)
    // compositeLayers opt-in severity factors (they only matter with an explicit autoRetry). Fidelity is never a factor (warning only).
    const factors: Record<string, number> = {}
    if (composite && layers) {
      if ((qa.seams?.remaining ?? 0) > 0) factors.seam = 3 * (qa.seams?.remaining ?? 0)
      if (layers.text.textOverProduct) factors.textOverProduct = 4
      if (layers.text.drawn && layers.text.scale < TEXT_SCALE_LOW) factors.textScale = 3
      else if (layers.text.drawn && layers.text.scale < TEXT_SCALE_WARN) factors.textScale = 1.5
      if (layers.cta.seam) factors.ctaSeam = 1
      if (qa.ctaBlocked) factors.ctaBlocked = 8
      else if (qa.ctaBusy) factors.ctaBusy = 2
      if (propsFlagged) factors.props = 2 + unlisted.length + 2 * cables.length
    }
    if (Object.keys(factors).length) {
      qa.severityFactors = factors
      qa.severity = Math.round((qa.severity + Object.values(factors).reduce((a, b) => a + b, 0)) * 100) / 100
    }
    if (qa.status === 'pass' && (propsFlagged || qa.sceneText === 'text_in_bands' || qa.logoLooksLikeIcon || fidelityCheck.status === 'warning' || qa.ctaBusy || layers?.text.textOverProduct || (layers?.text.scale ?? 1) < TEXT_SCALE_WARN)) qa.status = 'warning'

    return { grok, framed, qa, imageDataUrl, fidelityCheck, propsCheck, unlisted, propsFlagged, propsReason, safeZoneFix, qaBeforeFix, layers, scenePrep, aspectRatio: framed.aspectRatio, decisionSeverity: composite && layers ? qa.severity : preSeverity }
  }
  type Attempt = Awaited<ReturnType<typeof finishAttempt>>

  const paidCalls: PaidCall[] = []
  const autoRetry: WebStyleImageOutput['autoRetry'] = { requested: input.autoRetry === true, attempted: false }
  const firstGrok = await runWebPostGrokImage({ ...baseOptions, ...(withRules ? { mcp: mcpRules() } : {}) })
  paidCalls.push({ purpose: 'generate', provider: 'xai', model: firstGrok.providerModel, costUsd: firstGrok.estimatedCostUsd })
  let kept: Attempt = await finishAttempt(firstGrok, await reframe(firstGrok.imageDataUrl, firstGrok.aspectRatio))
  // At most ONE regeneration, and ONLY when the caller passed autoRetry:true explicitly (it is disclosed in the approval). Nothing forces one.
  if (input.autoRetry === true && kept.decisionSeverity > 0) {
    autoRetry.attempted = true
    autoRetry.reason = hint(kept.qa)
    autoRetry.firstQa = { safeZones: kept.qa.safeZones, textPresent: kept.qa.textPresent, issues: kept.qa.warnings.slice(0, 6) }
    try {
      const second = await runWebPostGrokImage({ ...baseOptions, ...(withRules ? { mcp: mcpRules(autoRetry.reason) } : {}) })
      paidCalls.push({ purpose: 'auto_retry', provider: 'xai', model: second.providerModel, costUsd: second.estimatedCostUsd })
      const secondAttempt = await finishAttempt(second, await reframe(second.imageDataUrl, second.aspectRatio))
      autoRetry.firstSeverity = kept.decisionSeverity
      autoRetry.retrySeverity = secondAttempt.decisionSeverity
      if (kept.qa.severityFactors || secondAttempt.qa.severityFactors) autoRetry.factors = { first: kept.qa.severityFactors ?? {}, retry: secondAttempt.qa.severityFactors ?? {} }
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
  const { grok, qa, propsCheck, unlisted, propsFlagged, propsReason, safeZoneFix, qaBeforeFix, layers, scenePrep, aspectRatio } = kept
  let { imageDataUrl, fidelityCheck } = kept

  // ---- printed packs: swap the REAL pack pixels into the located box (deterministic; never another generation) ----
  let packSwap: PackSwapReport | undefined
  if (packOffer && !composite && !viewMayChange && grok.lockApplied && imageDataUrl.startsWith('data:')) {
    const refIndex = fidelityCheck.status === 'ok' ? fidelityCheck.details.referenceIndex : fidelityCheck.status === 'warning' ? fidelityCheck.warning.details.referenceIndex : 0
    const reference = grok.productReferenceDataUrls[refIndex] ?? grok.productReferenceDataUrls[0]
    // One Gemini segmentation only when the local flood cannot cut the photo (no gateway configured → flood only).
    const ledger = input.segmentGateway ? null : (() => { try { return withCostLedger(createModelGateway()) } catch { return null } })()
    try {
      const swapped = await swapRealPackPixels({ generated: decode(imageDataUrl), referenceDataUrl: reference ?? '', productBox: productBoxOf(fidelityCheck), confident: locatedConfidently(fidelityCheck), gateway: input.segmentGateway ?? ledger ?? undefined })
      packSwap = swapped.report
      if (swapped.report.applied) {
        const before = fidelityCheck.status === 'ok' || fidelityCheck.status === 'warning' ? fidelityCheck.score : undefined
        imageDataUrl = `data:image/jpeg;base64,${swapped.bytes.toString('base64')}`
        fidelityCheck = await checkGeneratedProductFidelity({ referenceDataUrls: grok.productReferenceDataUrls, generatedDataUrl: imageDataUrl, tolerateViewChange: true })
        if (typeof before === 'number') packSwap.reason += ` (fidelity ${before} before the swap)`
      } else qa.warnings.push(`pack swap skipped: ${swapped.report.reason}`)
    } catch (err) {
      packSwap = { applied: false, reason: `pack swap unavailable: ${err instanceof Error ? err.message.slice(0, 120) : 'error'} — the generated image is kept` }
      qa.warnings.push(packSwap.reason)
    }
    for (const e of ledger?.ledger ?? []) if (e.ok && e.costUsd > 0) paidCalls.push({ purpose: 'segment', provider: 'gemini', model: e.model, costUsd: e.costUsd })
  }

  // ---- explicit stamps on the model's ad (stampLogo / stampPrice / vector logo): real asset + exact price, nothing else ----
  let stamped: WebStyleImageOutput['stamped']
  if ((stampLogo || priceLine) && imageDataUrl.startsWith('data:')) {
    const picked = stampLogo ? await loadAdLogo(kit, fetchBytes) : null
    try {
      const out = await layoutAdLayers({
        bytes: decode(imageDataUrl),
        ratio: ratioPlan.requested,
        logo: picked?.bytes ?? null,
        blocks: priceLine ? { price: priceLine } : {},
        palette: { primary: kit?.primaryColor, secondary: kit?.secondaryColor, accent: kit?.accentColor },
        fonts: { headingFont: kit?.fontPrimary ?? null, bodyFont: null },
        avoid: productBoxOf(fidelityCheck) ? [productBoxOf(fidelityCheck)!] : [],
      })
      imageDataUrl = `data:image/jpeg;base64,${out.bytes.toString('base64')}`
      stamped = { logo: out.report.logo.status === 'drawn', ...(priceLine ? { price: priceLine } : {}), reason: input.stampLogo === true || input.stampPrice === true ? 'requested (stampLogo / stampPrice)' : 'the kit logo is a vector file and cannot be a model reference' }
      if (stampLogo && out.report.logo.status !== 'drawn') qa.warnings.push(`logo stamp: ${out.report.logo.reason ?? picked?.notes[0] ?? 'logo not drawn'}`)
    } catch (err) {
      qa.warnings.push(`stamp unavailable: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}`)
    }
  }

  // Round 8: a facts line that fitted on the image is not repeated as overflow
  const extraFact = scenePrep?.extraFactUsed
  const overflowFinal = (capped?.overflow ?? []).filter((l) => l !== extraFact)
  const onImageFinal = extraFact ? `${copy}\n${extraFact}` : copy
  const removedClaims = uniqueClaims(removedClaimsAcc)
  if (removedClaims.length) {
    qa.removedClaims = removedClaims
    qa.warnings.push(`removed claim(s) the brand kit / platform forbids from the offer text and the copy (never sent to the model or drawn): ${removedClaims.map((c) => `"${c}"`).join(', ')} (qa.removedClaims)`)
  }
  const totalCost = paidCalls.reduce((s, c) => s + c.costUsd, 0)
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
    paidCalls,
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
    ...(packSwap ? { packSwap } : {}),
    ...(stamped ? { stamped } : {}),
    copyNormalised: tidied.changes,
    ...(removedClaims.length ? { removedClaims } : {}),
    copyOverflow: overflowFinal,
    providerRetries: grok.providerRetries,
    ...(safeZoneFix ? { safeZoneFix } : {}),
    ...(qaBeforeFix ? { qaBeforeFix } : {}),
    ...(layers ? { compositeLayers: layers } : {}),
    caption: buildCaption({ onImage: onImageFinal, overflow: overflowFinal, cta: ctaText, language }),
    // Round 9: the raw generation (before any reframe / swap / stamp / compositing) of the kept attempt — the caller stores it next to the final.
    rawScene: { imageDataUrl: grok.imageDataUrl },
    ...(withRules && scopedLock.dropped.length ? { lockScope: { role: input.productPhotoRole ?? null, kept: scopedLock.attrs, dropped: scopedLock.dropped } } : {}),
  }
}

/** Compact, result-safe summary of the post-check (no image bytes). */
export function postCheckSummary(out: Pick<WebStyleImageOutput, 'fidelityCheck' | 'fidelity_warning' | 'qa' | 'copySource' | 'referenceCount' | 'retriedWithClamp' | 'autoRetry' | 'references' | 'propsPolicy' | 'copyNormalised'> & Partial<Pick<WebStyleImageOutput, 'props_warning' | 'copyOverflow' | 'providerRetries' | 'safeZoneFix' | 'qaBeforeFix' | 'caption' | 'compositeLayers' | 'scenePrep' | 'packSwap' | 'stamped' | 'paidCalls'>>): Record<string, unknown> {
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
    ...(out.packSwap ? { packSwap: out.packSwap } : {}),
    ...(out.stamped ? { stamped: out.stamped } : {}),
    ...(out.paidCalls ? { paidCalls: out.paidCalls } : {}),
    ...(out.qaBeforeFix ? { qaBeforeFix: out.qaBeforeFix } : {}),
    ...(out.caption ? { caption: out.caption } : {}),
  }
}
