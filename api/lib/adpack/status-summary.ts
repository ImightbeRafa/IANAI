/**
 * Ad Pack status → human summary, ETA and finished-pack deliverable.
 *
 * Shared by both doors (web `status`, MCP `adpack_status`) through
 * `toStatusView` in service.ts, so the fields are identical everywhere.
 * Pure (no I/O); sizes are capped so a status payload stays compact.
 */
import { findForbiddenHits } from './check-copy.js'
import type { AdLanguage, AdPhotoRef, AngleCategory, AspectRatio, BrandDna, CopyCheckIssue, FactKey, FidelityMethod, FidelityResult, HookType, LayoutFamily, PackItem, PackItemTimings, PackStatus } from './types.js'

/** The real photo(s) an ad used (P1 #8): exact = its cut-outs' sources, generated = the locked scene photo. */
export function photoViews(item: Pick<PackItem, 'scene'>): { photo?: AdPhotoRef; parts?: AdPhotoRef[] } {
  const cutouts = item.scene?.cutouts ?? []
  const ref = (c: (typeof cutouts)[number]): AdPhotoRef => ({ url: c.sourceUrl, role: c.role, ...(c.productImageId ? { productImageId: c.productImageId } : {}), ...(c.label ? { label: c.label } : {}) })
  if (cutouts.length) return { photo: ref(cutouts[0]), ...(cutouts.length > 1 ? { parts: cutouts.slice(1).map(ref) } : {}) }
  return item.scene?.sourcePhoto ? { photo: item.scene.sourcePhoto } : {}
}

/** Per-ad caption cap in the deliverable (chars). */
export const DELIVERABLE_CAPTION_MAX = 1_200
/** Cap for the pack-level numbered `captionsText` (chars). */
export const DELIVERABLE_CAPTIONS_TEXT_MAX = 12_000
/** Workers advancing one pack in parallel (pack-runner default). */
const ETA_CONCURRENCY = 4
/** Step timings used until the pack has finished ads of its own (ms). */
const DEFAULT_STEP_MS: Required<Record<keyof PackItemTimings, number>> = {
  copyMs: 8_000,
  sceneMs: 25_000,
  sceneCheckMs: 5_000,
  renderMs: 3_000,
  chargeMs: 500,
}

/** Steps still ahead of an item in each status. */
const REMAINING_STEPS: Record<PackItem['status'], Array<keyof PackItemTimings>> = {
  planned: ['copyMs', 'sceneMs', 'sceneCheckMs', 'renderMs', 'chargeMs'],
  copy_ready: ['sceneMs', 'sceneCheckMs', 'renderMs', 'chargeMs'],
  scene_ready: ['renderMs', 'chargeMs'],
  rendered: ['chargeMs'],
  done: [],
  failed: [],
}

export interface AdPackRetryCall {
  tool: 'adpack_regenerate'
  arguments: { packId: string; itemId: string; mode: 'copy' | 'scene' }
  /** The exact call as text, e.g. `adpack_regenerate {"packId":"…","itemId":"…","mode":"scene"}`. */
  call: string
}

/**
 * One copy-check problem, exactly located (P0 #2c): field ("caption", "bullets[2]"), the sentence,
 * the tokens that broke the rule, the nearest confirmed fact and the rule (+ limit / actual).
 */
export interface AdPackIssueView {
  field: string
  rule: CopyCheckIssue['code']
  sentence?: string
  offendingTokens: string[]
  nearestFactKey?: FactKey
  nearestFact?: string
  limit?: number
  actual?: number
  detail: string
}

export function issueView(i: CopyCheckIssue): AdPackIssueView {
  return {
    field: i.path ?? i.field,
    rule: i.code,
    ...(i.sentence ? { sentence: i.sentence } : {}),
    offendingTokens: i.offendingTokens?.length ? i.offendingTokens : i.token ? [i.token] : [],
    ...(i.nearestFactKey ? { nearestFactKey: i.nearestFactKey } : {}),
    ...(i.nearestFact ? { nearestFact: i.nearestFact } : {}),
    ...(i.limit !== undefined ? { limit: i.limit } : {}),
    ...(i.actual !== undefined ? { actual: i.actual } : {}),
    detail: i.detail.slice(0, 300),
  }
}

/** The blocking copy issues of a failed item: the ones its `copy_check_failed: code(path)…` error names. */
export function failureIssues(item: Pick<PackItem, 'error' | 'copyCheck'>): AdPackIssueView[] {
  const e = item.error ?? ''
  if (!e.startsWith('copy_check_failed') || !item.copyCheck) return []
  const named = new Set([...e.matchAll(/([a-z_]+)\(([^)]*)\)/g)].map((m) => `${m[1]}|${m[2]}`))
  return item.copyCheck.issues.filter((i) => named.has(`${i.code}|${i.path ?? i.field}`)).slice(0, 12).map(issueView)
}

export interface AdPackFailureView {
  itemId: string
  /** 1-based ad number (matches the deliverable / captionsText numbering). */
  index: number
  /** Plain-language reason in the pack language. */
  reason: string
  /** Paid (one ad of credits, needs in-chat approval) retry of just this ad. */
  retry: AdPackRetryCall
  /** Measured product fidelity when the ad failed on it (fidelity_failed). */
  fidelity?: AdPackFidelitySummary
  /** Copy failures: every blocking issue with field, sentence, offending tokens and the nearest fact. */
  issues?: AdPackIssueView[]
}

/** One downloadable image: stable public storage URL (never a signed/expiring link). */
export interface AdPackDeliverableFile {
  ratio: AspectRatio
  /** Full-res PNG, stable public storage URL. */
  url: string
  /** Same image as full-res JPG (stable public URL), when available. */
  jpgUrl?: string
  width: number
  height: number
  format: 'png'
  /** "feed" (4:5), "story" (9:16), "square" (1:1), "landscape" (16:9). */
  placement: 'feed' | 'story' | 'square' | 'landscape'
  /** Product fidelity of this file (exact mode: detail SSIM, silhouette IoU, hue shift vs the real cut-out). */
  fidelity?: AdPackFidelitySummary
}

/**
 * Product fidelity (A4) so an agent can reject without guessing. Light may change, the product
 * may not: ssimDetail (structure), silhouetteIoU (shape) and hueShift (identity color, after
 * removing the relight gradient). method: harmonized (deterministic relight), relit (+ AI pass),
 * composite (plain cut-out), generated (model-drawn; vision verdict only).
 */
export interface AdPackFidelitySummary {
  score: number
  passed: boolean
  method: FidelityMethod
  ssimDetail?: number
  silhouetteIoU?: number
  hueShift?: number
  diffImageUrl?: string
  /** Cut-out recall vs the source photo (0–1, P0 #4). */
  recall?: number
}

/** A ratio not delivered (product changed there) + the FREE call that regenerates only it (P0 #3). */
export interface AdPackRejectedRatioSummary {
  ratio: AspectRatio
  reason: string
  fidelity: AdPackFidelitySummary
  retry: { tool: 'adpack_regenerate'; arguments: { packId: string; itemId: string; ratio: AspectRatio }; call: string }
}

export interface AdPackDeliverableAd {
  itemId: string
  /** 1-based ad number. */
  index: number
  format: string
  /** Shared catalog angle id, category, hook type and the short "why this angle" (H1). */
  angleId: string
  category?: AngleCategory
  hookType: HookType
  rationale?: string
  layoutFamily?: LayoutFamily
  /** 0-based variation of the same angle (variations > 1). */
  variation?: number
  headline: string
  caption: string
  links: Partial<Record<AspectRatio, string>>
  /** Full-res files per ratio with explicit size and format (G4). */
  files: AdPackDeliverableFile[]
  /** Brand forbidden phrases/claims found in the copy (verified empty for a shipped ad). */
  forbiddenHits: Array<{ phrase: string; field: string }>
  /** Product fidelity (A4), worst ratio of the ad. */
  fidelity?: AdPackFidelitySummary
  /** The real product photo this ad used (P1 #8) and the part photos next to it. */
  photo?: AdPhotoRef
  parts?: AdPhotoRef[]
  /** Ratios not delivered (the product changed there), each with its free regenerate call (P0 #3). */
  rejectedRatios?: AdPackRejectedRatioSummary[]
}

export interface AdPackDeliverable {
  ads: AdPackDeliverableAd[]
  /** All captions numbered, ready to paste. */
  captionsText: string
  deepLink?: string
}

export interface AdPackStatusExtras {
  language: AdLanguage
  /** One short human line, e.g. "7/10 listos · 1 falló (producto no coincidía) · ~40 s restantes". */
  summary: string
  /** Seconds until the pack should finish (only while work remains). */
  etaSeconds?: number
  failures?: AdPackFailureView[]
  /** Present once the pack is finished (done / partial, no more work). */
  deliverable?: AdPackDeliverable
}

const PLACEMENT: Record<AspectRatio, AdPackDeliverableFile['placement']> = { '4:5': 'feed', '9:16': 'story', '1:1': 'square', '16:9': 'landscape' }

function fidelitySummary(f: FidelityResult): AdPackFidelitySummary {
  const ssimDetail = f.ssimDetail ?? f.ssim
  return {
    score: f.score,
    passed: f.passed,
    method: f.method,
    ...(typeof ssimDetail === 'number' ? { ssimDetail } : {}),
    ...(typeof f.silhouetteIoU === 'number' ? { silhouetteIoU: f.silhouetteIoU } : {}),
    ...(typeof f.hueShift === 'number' ? { hueShift: f.hueShift } : {}),
    ...(f.diffImageUrl ? { diffImageUrl: f.diffImageUrl } : {}),
    ...(typeof f.recall === 'number' ? { recall: f.recall } : {}),
  }
}

function rejectedRatioSummaries(packId: string, item: PackItem): AdPackRejectedRatioSummary[] {
  return (item.rejectedRatios ?? []).map((r) => {
    const args = { packId, itemId: item.id, ratio: r.ratio }
    return { ratio: r.ratio, reason: r.reason, fidelity: fidelitySummary(r.fidelity), retry: { tool: 'adpack_regenerate' as const, arguments: args, call: `adpack_regenerate ${JSON.stringify(args)}` } }
  })
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

/** Plain-language reason for a runner error code (`scene_product_mismatch after 3 attempts`, …). */
export function failureReason(error: string | undefined, language: AdLanguage): string {
  const e = error ?? ''
  const es = language === 'es'
  if (e.startsWith('scene_product_mismatch')) return es ? 'producto no coincidía' : "product didn't match"
  if (e.startsWith('copy_check_failed') && e.includes('forbidden_phrase')) return es ? 'el texto usaba una frase prohibida de la marca' : 'copy used a forbidden brand phrase'
  if (e.startsWith('copy_check_failed') && e.includes('locale_register')) return es ? 'el texto no respetó el trato del idioma (locale)' : 'copy broke the locale register rule'
  if (e.startsWith('copy_check_failed') && e.includes('missing_fact')) return es ? 'faltaba un dato obligatorio de la oferta (ver issues)' : 'a required offer fact was missing (see issues)'
  if (e.startsWith('copy_check_failed') && e.includes('unconfirmed_fact')) return es ? 'una frase no coincide con los datos confirmados (ver issues: frase y dato más cercano)' : 'a sentence did not match the confirmed facts (see issues: sentence and nearest fact)'
  if (e.startsWith('copy_check_failed') && e.includes('urgency')) return es ? 'el texto metía presión/urgencia que la marca no usa' : 'copy used urgency the brand does not allow'
  if (e.startsWith('cutout_incomplete')) return es ? 'el recorte perdía piezas del producto (subí la foto con fondo que contraste o un PNG recortado por pieza)' : 'the cut-out dropped product pieces (upload a photo on a contrasting background or a cut-out PNG per piece)'
  if (e.startsWith('cutout_failed')) return es ? 'no se pudo recortar el producto de la foto (subí una foto con fondo limpio)' : 'the product could not be cut out of the photo (upload one on a clean background)'
  if (e.startsWith('fidelity_failed')) return es ? 'el producto no quedó idéntico a la foto' : 'the product did not stay identical to the photo'
  if (e.startsWith('scene_props_failed')) return es ? 'la escena inventaba piezas u objetos del producto' : 'the scene invented product parts or objects'
  if (e.startsWith('copy_check_failed')) return es ? 'el texto no pasó las reglas de datos' : 'copy broke the facts rules'
  if (e.startsWith('copy_failed')) return es ? 'no se pudo escribir el texto' : 'copy could not be written'
  if (e.startsWith('scene_upload_failed')) return es ? 'no se pudo guardar la imagen' : 'image could not be saved'
  if (e.startsWith('scene_failed')) return es ? 'no se pudo generar la imagen' : 'image could not be generated'
  if (e.startsWith('render_failed')) return es ? 'no se pudo componer el anuncio' : 'ad could not be composed'
  if (e.startsWith('charge_failed')) return es ? 'no se pudieron cobrar los créditos' : 'credits could not be charged'
  return es ? 'error inesperado' : 'unexpected error'
}

function retryCall(packId: string, item: PackItem): AdPackRetryCall {
  // Copy failures need new copy; everything else keeps the text and redraws the scene.
  const mode: 'copy' | 'scene' = !item.copy || (item.error ?? '').startsWith('copy') ? 'copy' : 'scene'
  const args = { packId, itemId: item.id, mode }
  return { tool: 'adpack_regenerate', arguments: args, call: `adpack_regenerate ${JSON.stringify(args)}` }
}

/** Remaining wall time: per-step averages of this pack's finished ads (defaults until one finishes) ÷ concurrency. */
export function estimateRemainingSeconds(items: PackItem[]): number {
  const pending = items.filter((i) => i.status !== 'done' && i.status !== 'failed')
  if (!pending.length) return 0
  const avg = { ...DEFAULT_STEP_MS }
  for (const step of Object.keys(DEFAULT_STEP_MS) as Array<keyof PackItemTimings>) {
    const samples = items.filter((i) => i.status === 'done').map((i) => i.timings?.[step]).filter((v): v is number => typeof v === 'number' && v >= 0)
    if (samples.length) avg[step] = samples.reduce((s, v) => s + v, 0) / samples.length
  }
  const totalMs = pending.reduce((s, i) => s + REMAINING_STEPS[i.status].reduce((t, step) => t + avg[step], 0), 0)
  const lanes = Math.min(ETA_CONCURRENCY, pending.length)
  const seconds = totalMs / lanes / 1000
  return Math.max(5, Math.ceil(seconds / 5) * 5)
}

function formatEta(seconds: number, language: AdLanguage): string {
  const es = language === 'es'
  if (seconds < 90) return es ? `~${seconds} s restantes` : `~${seconds} s left`
  const min = Math.round(seconds / 60)
  return es ? `~${min} min restantes` : `~${min} min left`
}

function failurePart(failures: AdPackFailureView[], language: AdLanguage): string {
  const es = language === 'es'
  const n = failures.length
  const reasons = [...new Set(failures.map((f) => f.reason))].slice(0, 2).join(', ')
  const verb = es ? (n === 1 ? 'falló' : 'fallaron') : 'failed'
  return `${n} ${verb} (${reasons})`
}

export function buildStatusExtras(input: {
  packId: string
  status: PackStatus
  items: PackItem[]
  moreWork: boolean
  language: AdLanguage
  deepLink?: string
  /** Brand lists for the forbidden-phrase verification of each shipped ad. */
  dna?: Pick<BrandDna, 'forbiddenPhrases' | 'forbiddenClaims'>
}): AdPackStatusExtras {
  const { items, language } = input
  const es = language === 'es'
  const sorted = [...items].sort((a, b) => a.index - b.index)
  const done = sorted.filter((i) => i.status === 'done')
  const failures: AdPackFailureView[] = sorted
    .filter((i) => i.status === 'failed')
    .map((i) => ({
      itemId: i.id,
      index: i.index + 1,
      reason: failureReason(i.error, language),
      retry: retryCall(input.packId, i),
      ...(i.fidelity ? { fidelity: fidelitySummary(i.fidelity) } : {}),
      ...(failureIssues(i).length ? { issues: failureIssues(i) } : {}),
    }))
  const total = sorted.length

  const parts: string[] = [es ? `${done.length}/${total} listos` : `${done.length}/${total} ready`]
  if (failures.length) parts.push(failurePart(failures, language))
  let etaSeconds: number | undefined
  if (input.status === 'cancelled') parts.push(es ? 'pack cancelado' : 'pack cancelled')
  else if (input.moreWork) {
    etaSeconds = estimateRemainingSeconds(sorted)
    parts.push(formatEta(etaSeconds, language))
  } else parts.push(es ? 'pack terminado' : 'pack finished')

  const finished = !input.moreWork && (input.status === 'done' || input.status === 'partial')
  let deliverable: AdPackDeliverable | undefined
  if (finished) {
    const ads: AdPackDeliverableAd[] = done
      .filter((i) => i.renders.length)
      .map((i) => ({
        itemId: i.id,
        index: i.index + 1,
        format: i.angle.format,
        angleId: i.angle.id,
        ...(i.angle.category ? { category: i.angle.category } : {}),
        hookType: i.angle.hookType,
        ...(i.angle.rationale ? { rationale: clip(i.angle.rationale, 240) } : {}),
        ...(i.angle.layoutFamily ? { layoutFamily: i.angle.layoutFamily } : {}),
        ...(i.angle.variation !== undefined ? { variation: i.angle.variation } : {}),
        headline: clip(i.copy?.headline ?? '', 200),
        caption: clip(i.copy?.caption ?? '', DELIVERABLE_CAPTION_MAX),
        links: Object.fromEntries(i.renders.map((r) => [r.ratio, r.imageUrl])) as Partial<Record<AspectRatio, string>>,
        files: i.renders.map((r) => ({
          ratio: r.ratio,
          url: r.imageUrl,
          ...(r.jpgUrl ? { jpgUrl: r.jpgUrl } : {}),
          width: r.width,
          height: r.height,
          format: 'png' as const,
          placement: PLACEMENT[r.ratio],
          ...(r.fidelity ? { fidelity: fidelitySummary(r.fidelity) } : {}),
        })),
        forbiddenHits: input.dna ? findForbiddenHits(i.copy, input.dna).map((h) => ({ phrase: h.phrase, field: h.field })) : [],
        ...(i.fidelity ? { fidelity: fidelitySummary(i.fidelity) } : {}),
        ...photoViews(i),
        ...(i.rejectedRatios?.length ? { rejectedRatios: rejectedRatioSummaries(input.packId, i) } : {}),
      }))
    const label = es ? 'Anuncio' : 'Ad'
    const captionsText = clip(ads.map((a) => `${a.index}. ${label} ${a.index}${a.headline ? ` — ${a.headline}` : ''}\n${a.caption}`).join('\n\n'), DELIVERABLE_CAPTIONS_TEXT_MAX)
    deliverable = { ads, captionsText, ...(input.deepLink ? { deepLink: input.deepLink } : {}) }
  }

  return {
    language,
    summary: parts.join(' · '),
    ...(etaSeconds !== undefined ? { etaSeconds } : {}),
    ...(failures.length ? { failures } : {}),
    ...(deliverable ? { deliverable } : {}),
  }
}
