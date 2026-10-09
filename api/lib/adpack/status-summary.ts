/**
 * Ad Pack status → human summary, ETA and finished-pack deliverable.
 *
 * Shared by both doors (web `status`, MCP `adpack_status`) through
 * `toStatusView` in service.ts, so the fields are identical everywhere.
 * Pure (no I/O); sizes are capped so a status payload stays compact.
 */
import { findForbiddenHits } from './check-copy.js'
import type { AdLanguage, AspectRatio, BrandDna, FidelityMethod, FidelityResult, PackItem, PackItemTimings, PackStatus } from './types.js'

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
}

/** One downloadable image: stable public storage URL (never a signed/expiring link). */
export interface AdPackDeliverableFile {
  ratio: AspectRatio
  url: string
  width: number
  height: number
  format: 'png'
  /** "feed" (4:5), "story" (9:16), "square" (1:1), "landscape" (16:9). */
  placement: 'feed' | 'story' | 'square' | 'landscape'
  /** Product fidelity of this file (exact mode: masked SSIM/ΔE vs the real cut-out). */
  fidelity?: AdPackFidelitySummary
}

/** Product fidelity (A4) so an agent can reject without guessing. */
export interface AdPackFidelitySummary {
  score: number
  passed: boolean
  method: FidelityMethod
  diffImageUrl?: string
}

export interface AdPackDeliverableAd {
  itemId: string
  /** 1-based ad number. */
  index: number
  format: string
  headline: string
  caption: string
  links: Partial<Record<AspectRatio, string>>
  /** Full-res files per ratio with explicit size and format (G4). */
  files: AdPackDeliverableFile[]
  /** Brand forbidden phrases/claims found in the copy (verified empty for a shipped ad). */
  forbiddenHits: Array<{ phrase: string; field: string }>
  /** Product fidelity (A4), worst ratio of the ad. */
  fidelity?: AdPackFidelitySummary
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
  return { score: f.score, passed: f.passed, method: f.method, ...(f.diffImageUrl ? { diffImageUrl: f.diffImageUrl } : {}) }
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

/** Plain-language reason for a runner error code (`scene_product_mismatch after 3 attempts`, …). */
export function failureReason(error: string | undefined, language: AdLanguage): string {
  const e = error ?? ''
  const es = language === 'es'
  if (e.startsWith('scene_product_mismatch')) return es ? 'producto no coincidía' : "product didn't match"
  if (e.startsWith('copy_check_failed') && e.includes('forbidden_phrase')) return es ? 'el texto usaba una frase prohibida de la marca' : 'copy used a forbidden brand phrase'
  if (e.startsWith('copy_check_failed') && e.includes('locale_register')) return es ? 'el texto no respetó el trato del idioma (locale)' : 'copy broke the locale register rule'
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
        headline: clip(i.copy?.headline ?? '', 200),
        caption: clip(i.copy?.caption ?? '', DELIVERABLE_CAPTION_MAX),
        links: Object.fromEntries(i.renders.map((r) => [r.ratio, r.imageUrl])) as Partial<Record<AspectRatio, string>>,
        files: i.renders.map((r) => ({
          ratio: r.ratio,
          url: r.imageUrl,
          width: r.width,
          height: r.height,
          format: 'png' as const,
          placement: PLACEMENT[r.ratio],
          ...(r.fidelity ? { fidelity: fidelitySummary(r.fidelity) } : {}),
        })),
        forbiddenHits: input.dna ? findForbiddenHits(i.copy, input.dna).map((h) => ({ phrase: h.phrase, field: h.field })) : [],
        ...(i.fidelity ? { fidelity: fidelitySummary(i.fidelity) } : {}),
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
