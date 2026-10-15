/**
 * Shared MCP helpers: product-reference gates + price/placeholder utilities for EXECUTE, and (0.26.0) the reference ASSET gate
 * (gateReferences / REFERENCE_GATE_CONFIG) evaluated before any charge.
 */

import { createHash } from 'node:crypto'
import sharp, { type Metadata } from 'sharp'
import { GROK_NATIVE_ASPECT_RATIOS, resolveGrokAspectRatio } from '../grok-image-edit.js'
import { fetchPublicImageDetailed } from '../fetch-image-data-url.js'

export { GROK_NATIVE_ASPECT_RATIOS, resolveGrokAspectRatio }

/** Ratios chat-shell asks for that Grok Imagine does not natively support. */
export const GROK_UNSUPPORTED_SHELL_RATIOS = ['4:5', '5:4'] as const

export type McpReferenceMode = 'use' | 'none'

export function parseReferenceMode(value: unknown): McpReferenceMode | undefined {
  if (value === 'use' || value === 'none') return value
  return undefined
}

/** Hard gate before image/post/pack/carousel EXECUTE when product fidelity is required. */
export function assertProductReferenceGate(options: {
  productRefCount: number
  referenceMode?: McpReferenceMode
  referenceImageIds?: string[]
  productImageId?: string | null
  requireProduct?: boolean
  /**
   * Bulk/campaign historically use all offer product URLs without per-id confirm.
   * When true and the offer already has product refs, omitting ids is OK.
   */
  allowImplicitOfferRefs?: boolean
  toolName: string
}): void {
  const requireProduct = options.requireProduct !== false
  if (!requireProduct) return
  if (options.referenceMode === 'none') {
    throw new Error(
      `${options.toolName}: referenceMode "none" skips product fidelity. ` +
        'For ads/posts that show the product, set referenceMode "use" and confirm product image ids from list_assets (kind=product).'
    )
  }
  const hasExplicitIds =
    (options.referenceImageIds && options.referenceImageIds.length > 0) ||
    Boolean(options.productImageId)
  if (options.productRefCount <= 0 && !hasExplicitIds) {
    throw new Error(
      `${options.toolName}: no product reference images on this offer. ` +
        'Call list_assets(kind=product). If empty, ask the user to attach a product shot ' +
        '(workspace_save_artifact kind=product + https URL, or /chat intake=asset), then pass productImageId / referenceImageIds.'
    )
  }
  if (options.productRefCount <= 0 && hasExplicitIds) {
    return
  }
  if (!hasExplicitIds && options.productRefCount > 0) {
    if (options.allowImplicitOfferRefs) return
    throw new Error(
      `${options.toolName}: product images exist but none were confirmed. ` +
        'List them with list_assets(kind=product), ask the user which to use (and optional scene/style context refs), ' +
        'then retry with productImageId and/or referenceImageIds (max 4).'
    )
  }
}

export function mapPriceRangeLabel(priceRange: string | null | undefined, language: 'es' | 'en' = 'es'): string | null {
  if (!priceRange) return null
  const key = priceRange.trim().toLowerCase()
  const map: Record<string, { es: string; en: string }> = {
    economico: {
      es: 'rango de precio accesible (valor por dinero) — no digas "opción económica" ni el enum',
      en: 'affordable price positioning (value for money) — never print the enum key',
    },
    medio: {
      es: 'rango de precio medio (equilibrio calidad/precio)',
      en: 'mid-range price positioning (quality/price balance)',
    },
    premium: {
      es: 'rango de precio premium (exclusividad y calidad superior)',
      en: 'premium price positioning (exclusivity and higher quality)',
    },
  }
  const hit = map[key]
  if (!hit) return null
  return language === 'en' ? hit.en : hit.es
}

/** True when a token looks like an unresolved script placeholder. */
export function hasUnresolvedScriptPlaceholder(text: string): boolean {
  return /\[[A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 _./-]{1,60}\]/.test(text)
}

export function listUnresolvedScriptPlaceholders(text: string): string[] {
  const matches = text.match(/\[[A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 _./-]{1,60}\]/g) || []
  return [...new Set(matches)]
}

export function looksLikeExactPrice(value: string | null | undefined): boolean {
  if (!value) return false
  const t = value.trim()
  if (!t) return false
  if (/^(economico|medio|premium)$/i.test(t)) return false
  return /[₡$€]|^\d|\d[.,]\d/.test(t)
}

// ---------------------------------------------------------------------------
// 0.26.0 — reference asset gate (docs/mcp-quality.md). Evaluated BEFORE any charge.
//
// Owner rule (final): low-quality photos are ACCEPTED with a clear warning (low resolution, heavy compression,
// screenshot, burned-in text / logo, AI render with fake text); low-resolution refs are upscaled for free
// (deterministic Lanczos + unsharp, never redrawn) before generation. Hard errors ONLY for an unreachable URL
// (404 / network) and for bytes that are not an image. Duplicates (same content hash or a dHash near-duplicate
// within one request) are silently dropped. Quality issues lower the preflight score but never block on their own.
// ---------------------------------------------------------------------------

/** ONE place for every gate threshold (change the 1600 rule here). */
export const REFERENCE_GATE_CONFIG = {
  /** Long side (px) for a full reference-quality score. Below it: accepted, warned, upscaled for free before generation. */
  MIN_LONG_SIDE: 1600,
  /** Below this long side the warning is stronger and the preflight penalty bigger (still accepted, still upscaled). */
  VERY_LOW_LONG_SIDE: 1080,
  /** Heavy compression: JPEG quality estimated from the quantization table below this… */
  JPEG_MIN_QUALITY: 60,
  /** …or fewer compressed bytes per pixel than this (JPEG / WebP). */
  JPEG_MIN_BPP: 0.06,
  WEBP_MIN_BPP: 0.03,
  /**
   * dHash (64-bit) Hamming distance at or below which two refs of one request are the same photo (silently deduped). Very strict (≤ 1):
   * a real second angle must never be dropped; identical bytes (same sha256) are always duplicates. The first ref (hero) and any
   * `protect`ed ref are never dropped.
   */
  DHASH_NEAR_DUP_BITS: 1,
  /** Preflight penalties of the reference-quality component (points, per photo; the component is capped). */
  PENALTY: { lowRes: 2, veryLowRes: 4, compression: 2, screenshot: 3, burnedInText: 3, aiRender: 3 },
  /** Preflight: execute tools / adpack_start refuse below this score. Only missing essentials can push a run below it. */
  PREFLIGHT_MIN_SCORE: 70,
} as const

export type ReferenceIssueCode =
  | 'unreachable' | 'not_an_image'
  | 'low_resolution' | 'very_low_resolution' | 'heavy_compression' | 'screenshot' | 'burned_in_text' | 'ai_render'
/** source 'vision' = from the (paid, cached, best-effort) classifier — never used to RANK refs, so the selection is deterministic. */
export type ReferenceIssue = { code: ReferenceIssueCode; severity: 'error' | 'warning'; es: string; en: string; detail?: Record<string, unknown>; source?: 'local' | 'vision' }

/** Cached vision verdict, stored in product_images.quality.gate keyed by content hash (never paid twice). */
export type ReferenceVisionVerdict = { burnedInText: boolean; aiRender: boolean; screenshot?: boolean; note?: string; model?: string; at?: string }

export type ReferenceVerdict = {
  id?: string
  url: string
  /** false only for a hard error (unreachable / not an image). */
  ok: boolean
  issues: ReferenceIssue[]
  width?: number
  height?: number
  bytes?: number
  format?: string
  /** sha256 of the bytes. */
  contentHash?: string
  /** 64-bit dHash (hex) for near-duplicate detection. */
  dhash?: string
  jpegQuality?: number
  bytesPerPixel?: number
  /** Below MIN_LONG_SIDE: the free deterministic upscale runs before generation. */
  upscale: boolean
  vision?: ReferenceVisionVerdict
}

const LOW_QUALITY_ES = 'Foto de baja calidad: los resultados pueden salir peores. Subí una foto más grande y nítida para mejores anuncios.'
const LOW_QUALITY_EN = 'Low-quality photo: results may come out worse. Upload a larger, sharper photo for better ads.'

/** Standard JPEG luminance quantization table (Annex K) — the libjpeg quality scale is relative to it. */
const STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99]

/** Estimated JPEG quality (1–100) from the first (luminance) DQT table; undefined when not a baseline-readable JPEG. */
export function estimateJpegQuality(bytes: Uint8Array): number | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let i = 2
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) return undefined
    const marker = bytes[i + 1]
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    if (marker === 0xdb) {
      const pq = bytes[i + 4] >> 4
      const table: number[] = []
      for (let k = 0; k < 64; k++) table.push(pq ? (bytes[i + 5 + 2 * k] << 8) | bytes[i + 6 + 2 * k] : bytes[i + 5 + k])
      if (table.some((v) => !Number.isFinite(v))) return undefined
      const scale = (table.reduce((a, b) => a + b, 0) / STD_LUMA.reduce((a, b) => a + b, 0)) * 100
      const q = scale <= 100 ? (200 - scale) / 2 : 5000 / scale
      return Math.max(1, Math.min(100, Math.round(q)))
    }
    if (marker === 0xda) return undefined
    i += 2 + len
  }
  return undefined
}

/** 64-bit difference hash (9×8 grayscale, left < right). */
export async function dHash(bytes: Uint8Array): Promise<string> {
  const { data } = await sharp(bytes).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  let out = 0n
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out = (out << 1n) | (data[y * 9 + x] < data[y * 9 + x + 1] ? 1n : 0n)
  return out.toString(16).padStart(16, '0')
}

export function hammingHex(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
  let n = 0
  while (x) { n += Number(x & 1n); x >>= 1n }
  return n
}

const PHONE_WIDTHS = new Set([640, 720, 750, 828, 1080, 1125, 1170, 1179, 1242, 1284, 1290, 1440])
const DESKTOP_WIDTHS = new Set([1280, 1366, 1440, 1536, 1600, 1680, 1920, 2560, 2880, 3024, 3840])

/** Screenshot heuristic: screen-sized canvas + a flat status bar / browser chrome / uniform top-bottom bars. */
export async function looksLikeScreenshot(bytes: Uint8Array, width: number, height: number): Promise<{ screenshot: boolean; reasons: string[] }> {
  const reasons: string[] = []
  const tall = height / Math.max(1, width)
  const wide = width / Math.max(1, height)
  const phone = PHONE_WIDTHS.has(width) && tall >= 1.75
  const desktop = DESKTOP_WIDTHS.has(width) && (Math.abs(wide - 16 / 9) < 0.02 || Math.abs(wide - 16 / 10) < 0.02)
  if (phone) reasons.push(`phone-screen size ${width}×${height}`)
  if (desktop) reasons.push(`desktop-screen size ${width}×${height}`)
  const W = 120
  const H = Math.max(40, Math.round((W * height) / Math.max(1, width)))
  const { data } = await sharp(bytes).rotate().greyscale().resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  const band = (y0: number, y1: number) => {
    let s = 0, s2 = 0, n = 0
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) { const v = data[y * W + x]; s += v; s2 += v * v; n++ }
    const mean = s / Math.max(1, n)
    return { mean, sd: Math.sqrt(Math.max(0, s2 / Math.max(1, n) - mean * mean)) }
  }
  const bar = Math.max(2, Math.round(H * 0.035))
  const top = band(0, bar)
  const belowTop = band(bar, bar * 3)
  const bottom = band(H - bar, H)
  const aboveBottom = band(H - bar * 3, H - bar)
  // A flat bar that differs from the content next to it (status bar, browser chrome, nav bar).
  const flatBar = (b: { mean: number; sd: number }, next: { mean: number; sd: number }) => b.sd < 14 && Math.abs(b.mean - next.mean) > 18
  if (flatBar(top, belowTop)) reasons.push('flat bar at the top (status bar / browser chrome)')
  if (flatBar(bottom, aboveBottom)) reasons.push('flat bar at the bottom (navigation bar)')
  const bars = reasons.filter((r) => r.startsWith('flat bar')).length
  return { screenshot: ((phone || desktop) && bars >= 1) || bars >= 2, reasons }
}

/** Local (free) checks of one reference's bytes. */
export async function inspectReferenceBytes(bytes: Uint8Array, url: string, id?: string): Promise<ReferenceVerdict> {
  const verdict: ReferenceVerdict = { url, ...(id ? { id } : {}), ok: true, issues: [], upscale: false, bytes: bytes.length }
  let meta: Metadata
  try {
    meta = await sharp(bytes).metadata()
  } catch {
    meta = {} as Metadata
  }
  const width = meta.autoOrient?.width ?? meta.width ?? 0
  const height = meta.autoOrient?.height ?? meta.height ?? 0
  if (!width || !height || !meta.format) {
    verdict.ok = false
    verdict.issues.push({ code: 'not_an_image', severity: 'error', es: 'El archivo no es una imagen válida (JPEG, PNG o WebP). Subí la foto de nuevo.', en: 'The file is not a valid image (JPEG, PNG or WebP). Upload the photo again.' })
    return verdict
  }
  verdict.width = width
  verdict.height = height
  verdict.format = meta.format
  verdict.contentHash = createHash('sha256').update(bytes).digest('hex')
  verdict.dhash = await dHash(bytes)
  const C = REFERENCE_GATE_CONFIG
  const long = Math.max(width, height)
  if (long < C.MIN_LONG_SIDE) {
    verdict.upscale = true
    const very = long < C.VERY_LOW_LONG_SIDE
    verdict.issues.push({
      code: very ? 'very_low_resolution' : 'low_resolution',
      severity: 'warning',
      es: `${LOW_QUALITY_ES} (${width}×${height} px; ideal ≥ ${C.MIN_LONG_SIDE} px en el lado largo — se amplía sin redibujar antes de generar)`,
      en: `${LOW_QUALITY_EN} (${width}×${height} px; ideal ≥ ${C.MIN_LONG_SIDE} px on the long side — upscaled without redrawing before generation)`,
      detail: { width, height, minLongSide: C.MIN_LONG_SIDE },
    })
  }
  const bpp = bytes.length / (width * height)
  verdict.bytesPerPixel = Math.round(bpp * 1000) / 1000
  const q = meta.format === 'jpeg' ? estimateJpegQuality(bytes) : undefined
  if (q !== undefined) verdict.jpegQuality = q
  const heavy = (meta.format === 'jpeg' && ((q !== undefined && q < C.JPEG_MIN_QUALITY) || bpp < C.JPEG_MIN_BPP)) || (meta.format === 'webp' && bpp < C.WEBP_MIN_BPP)
  if (heavy) verdict.issues.push({ code: 'heavy_compression', severity: 'warning', es: `${LOW_QUALITY_ES} (compresión fuerte${q !== undefined ? `, calidad JPEG ≈ ${q}` : ''})`, en: `${LOW_QUALITY_EN} (heavy compression${q !== undefined ? `, JPEG quality ≈ ${q}` : ''})`, detail: { jpegQuality: q, bytesPerPixel: verdict.bytesPerPixel } })
  const shot = await looksLikeScreenshot(bytes, width, height).catch(() => ({ screenshot: false, reasons: [] as string[] }))
  if (shot.screenshot) verdict.issues.push({ code: 'screenshot', severity: 'warning', es: `${LOW_QUALITY_ES} (parece una captura de pantalla: ${shot.reasons.join(', ')})`, en: `${LOW_QUALITY_EN} (looks like a screenshot: ${shot.reasons.join(', ')})` })
  return verdict
}

/** Vision classifier (one cheap Gemini 2.5 Flash call, behind the adpack gateway; faked in tests). */
export type ReferenceVisionClassifier = (dataUrl: string) => Promise<{ verdict: ReferenceVisionVerdict; costUsd: number; model: string }>

export function visionClassifierFromGateway(gateway: { visionJson: <T>(i: { system: string; user: string; images: string[] }) => Promise<{ data: T; costUsd: number; model: string }> }): ReferenceVisionClassifier {
  return async (dataUrl) => {
    const res = await gateway.visionJson<{ burnedInText?: boolean; aiRender?: boolean; screenshot?: boolean; note?: string }>({
      system: 'You check product photos used as references for ads. Answer ONLY JSON: {"burnedInText": boolean, "aiRender": boolean, "screenshot": boolean, "note": string}. burnedInText = promotional text, prices, captions, watermarks or an overlaid brand logo added ON TOP of the photo (printing that is physically on the product or its packaging does NOT count). aiRender = an AI-generated / 3D render with garbled or fake lettering. screenshot = a phone / desktop screen capture.',
      user: 'Classify this reference photo.',
      images: [dataUrl],
    })
    return { verdict: { burnedInText: res.data?.burnedInText === true, aiRender: res.data?.aiRender === true, screenshot: res.data?.screenshot === true, ...(res.data?.note ? { note: String(res.data.note).slice(0, 160) } : {}), model: res.model, at: new Date().toISOString() }, costUsd: res.costUsd, model: res.model }
  }
}

/** Cached vision verdict for this content hash from product_images.quality.gate. */
export function cachedVisionVerdict(quality: Record<string, unknown> | null | undefined, contentHash: string | undefined): ReferenceVisionVerdict | undefined {
  const gate = quality && typeof quality === 'object' ? (quality as { gate?: { hash?: string; vision?: ReferenceVisionVerdict } }).gate : undefined
  return gate && contentHash && gate.hash === contentHash && gate.vision ? gate.vision : undefined
}

/** protect: never dropped as a duplicate (the hero / primary photo). */
export type GateRef = { id?: string; url: string; quality?: Record<string, unknown> | null; protect?: boolean }
export type GateDeps = {
  /** Default: fetchPublicImageDetailed (data: URLs pass through). */
  load?: (url: string) => Promise<{ dataUrl: string } | { failure: { url: string; status?: number; reason: string } }>
  /** Optional paid classification; only for refs without a cached verdict for the same content hash. */
  classify?: ReferenceVisionClassifier
  /** Persist the new verdict into product_images.quality (merged by the caller). */
  persist?: (ref: GateRef & { id: string }, qualityPatch: Record<string, unknown>) => Promise<void>
  /** Record the cost of each paid classification call. */
  onPaidCall?: (call: { model: string; costUsd: number; refId?: string }) => void
}

export type GateResult = {
  /** Accepted refs in input order (duplicates removed), with their verdicts (warnings inside). */
  accepted: ReferenceVerdict[]
  /** Hard errors (unreachable / not an image). */
  rejected: ReferenceVerdict[]
  /** Silently dropped duplicates (id or url of the dropped ref → the kept one). */
  deduped: Array<{ dropped: string; keptAs: string; distance: number }>
  /** Loaded bytes by url (accepted refs only), so the caller does not fetch twice. */
  bytesByUrl: Map<string, Uint8Array>
}

/** Evaluate references BEFORE any charge: local checks + (optional, cached) vision classification + dedupe. */
export async function gateReferences(refs: GateRef[], deps: GateDeps = {}): Promise<GateResult> {
  const load = deps.load ?? fetchPublicImageDetailed
  const accepted: ReferenceVerdict[] = []
  const rejected: ReferenceVerdict[] = []
  const deduped: GateResult['deduped'] = []
  const bytesByUrl = new Map<string, Uint8Array>()
  for (const ref of refs) {
    const got = await load(ref.url)
    if (!('dataUrl' in got)) {
      const f = got.failure
      const status = f.status ? `HTTP ${f.status}` : f.reason
      const notImage = /not an image/i.test(f.reason)
      rejected.push({ url: ref.url, ...(ref.id ? { id: ref.id } : {}), ok: false, upscale: false, issues: [notImage
        ? { code: 'not_an_image', severity: 'error', es: `El enlace no devuelve una imagen (${status}). Volvé a subir la foto (import_image).`, en: `The link does not return an image (${status}). Upload the photo again (import_image).` }
        : { code: 'unreachable', severity: 'error', es: `No se pudo descargar la foto (${status}). Volvé a importarla a Advance (import_image) y reintentá.`, en: `The photo could not be downloaded (${status}). Re-import it into Advance (import_image) and retry.`, detail: { status: f.status ?? null } }] })
      continue
    }
    const bytes = new Uint8Array(Buffer.from(got.dataUrl.slice(got.dataUrl.indexOf(',') + 1), 'base64'))
    const v = await inspectReferenceBytes(bytes, ref.url, ref.id)
    if (!v.ok) { rejected.push(v); continue }
    const dup = ref.protect ? undefined : accepted.find((a) => a.contentHash === v.contentHash || (a.dhash && v.dhash && hammingHex(a.dhash, v.dhash) <= REFERENCE_GATE_CONFIG.DHASH_NEAR_DUP_BITS))
    if (dup) {
      deduped.push({ dropped: v.id ?? v.url, keptAs: dup.id ?? dup.url, distance: dup.contentHash === v.contentHash ? 0 : hammingHex(dup.dhash!, v.dhash!) })
      continue
    }
    let vision = cachedVisionVerdict(ref.quality, v.contentHash)
    if (!vision && deps.classify) {
      try {
        const c = await deps.classify(got.dataUrl)
        vision = c.verdict
        deps.onPaidCall?.({ model: c.model, costUsd: c.costUsd, ...(ref.id ? { refId: ref.id } : {}) })
        if (ref.id && deps.persist) await deps.persist({ ...ref, id: ref.id }, { gate: { hash: v.contentHash, vision, width: v.width, height: v.height } }).catch(() => undefined)
      } catch { /* classification is best effort: the local verdict stands */ }
    }
    if (vision) {
      v.vision = vision
      if (vision.burnedInText) v.issues.push({ code: 'burned_in_text', source: 'vision', severity: 'warning', es: `${LOW_QUALITY_ES} (tiene texto o logo sobreimpreso: usá la foto limpia del producto)`, en: `${LOW_QUALITY_EN} (it has text or a logo burned in: use the clean product photo)` })
      if (vision.aiRender) v.issues.push({ code: 'ai_render', source: 'vision', severity: 'warning', es: `${LOW_QUALITY_ES} (parece un render de IA con texto falso: usá una foto real)`, en: `${LOW_QUALITY_EN} (looks like an AI render with fake text: use a real photo)` })
      if (vision.screenshot && !v.issues.some((i) => i.code === 'screenshot')) v.issues.push({ code: 'screenshot', source: 'vision', severity: 'warning', es: `${LOW_QUALITY_ES} (parece una captura de pantalla)`, en: `${LOW_QUALITY_EN} (looks like a screenshot)` })
    }
    accepted.push(v)
    bytesByUrl.set(ref.url, bytes)
  }
  return { accepted, rejected, deduped, bytesByUrl }
}

/** Compact, result-safe view of a verdict (list_assets / preflight). */
export function verdictSummary(v: ReferenceVerdict): Record<string, unknown> {
  return {
    ok: v.ok,
    ...(v.width ? { width: v.width, height: v.height } : {}),
    ...(v.format ? { format: v.format } : {}),
    ...(v.jpegQuality !== undefined ? { jpegQuality: v.jpegQuality } : {}),
    upscale: v.upscale,
    issues: v.issues.map((i) => ({ code: i.code, severity: i.severity, es: i.es, en: i.en })),
  }
}

/**
 * list_assets view from STORED data only (no download, no model call): product_images.quality (085 import metrics: width / height)
 * and the cached gate verdict (quality.gate: hash, size, vision flags). Unknown → { checked: false }.
 */
export function storedVerdictSummary(quality: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const q = quality && typeof quality === 'object' ? quality : {}
  const gate = (q as { gate?: { hash?: string; width?: number; height?: number; vision?: ReferenceVisionVerdict } }).gate
  const width = Number(gate?.width ?? (q as { width?: unknown }).width) || 0
  const height = Number(gate?.height ?? (q as { height?: unknown }).height) || 0
  const C = REFERENCE_GATE_CONFIG
  const issues: Array<{ code: ReferenceIssueCode; severity: 'warning'; es: string; en: string }> = []
  if (width && height && Math.max(width, height) < C.MIN_LONG_SIDE) {
    const very = Math.max(width, height) < C.VERY_LOW_LONG_SIDE
    issues.push({ code: very ? 'very_low_resolution' : 'low_resolution', severity: 'warning', es: `${LOW_QUALITY_ES} (${width}×${height} px; ideal ≥ ${C.MIN_LONG_SIDE} px)`, en: `${LOW_QUALITY_EN} (${width}×${height} px; ideal ≥ ${C.MIN_LONG_SIDE} px)` })
  }
  if (gate?.vision?.burnedInText) issues.push({ code: 'burned_in_text', severity: 'warning', es: `${LOW_QUALITY_ES} (texto o logo sobreimpreso)`, en: `${LOW_QUALITY_EN} (burned-in text or logo)` })
  if (gate?.vision?.aiRender) issues.push({ code: 'ai_render', severity: 'warning', es: `${LOW_QUALITY_ES} (render de IA con texto falso)`, en: `${LOW_QUALITY_EN} (AI render with fake text)` })
  if (gate?.vision?.screenshot) issues.push({ code: 'screenshot', severity: 'warning', es: `${LOW_QUALITY_ES} (captura de pantalla)`, en: `${LOW_QUALITY_EN} (screenshot)` })
  if (!width && !gate) return { checked: false, note: 'not checked yet (checked for free before generation; adpack_preflight shows the full verdict)' }
  return { checked: true, source: 'stored', ...(width ? { width, height } : {}), upscale: Boolean(width && Math.max(width, height) < C.MIN_LONG_SIDE), issues, ...(gate?.hash ? { contentHash: gate.hash } : {}) }
}
