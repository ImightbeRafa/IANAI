/**
 * Download an image an agent points at (Google Drive share link, Dropbox, any public https URL)
 * so it can be copied into Advance storage. Used by `import_image(s)` (strict: errors are
 * answers) and by the C2 rehoster (lenient: keeps the original link with a warning).
 *
 * Google Drive: every common share shape (`/file/d/<id>/view`, `open?id=`, `uc?id=`,
 * `drive.usercontent.google.com/download?id=`, `docs.google.com/uc?id=`) → direct download.
 * Large files answer with the "can't scan for viruses" page: its confirm form (confirm / uuid
 * inputs, or a legacy `confirm=` link / `download_warning` cookie) is followed once. Any other
 * HTML (login / "request access") means the file is not public → DRIVE_NOT_PUBLIC.
 *
 * Safety: http(s) public hosts only (assertPublicHttpUrl; the default fetch also checks DNS on
 * every redirect), size cap enforced while streaming, time cap, magic-byte sniff (never trusts
 * the declared content-type).
 */
import { sniffImageMime } from '../fetch-image-data-url.js'
import { assertPublicHttpUrl, fetchPublicUrl } from '../url-safety.js'

export type RemoteFetch = (url: string, init: { timeoutMs: number }) => Promise<Response>

export type RemoteImageErrorCode =
  | 'BAD_URL'
  | 'DRIVE_NOT_PUBLIC'
  | 'DRIVE_FOLDER'
  | 'NOT_AN_IMAGE'
  | 'UNSUPPORTED_IMAGE_TYPE'
  | 'TOO_LARGE'
  | 'EMPTY_FILE'
  | 'DOWNLOAD_FAILED'

export class RemoteImageError extends Error {
  readonly code: RemoteImageErrorCode
  constructor(code: RemoteImageErrorCode, message: string) {
    super(message)
    this.name = 'RemoteImageError'
    this.code = code
  }
}

export type RemoteProvider = 'google_drive' | 'dropbox' | 'https'

export const REMOTE_IMAGE_TIMEOUT_MS = 20_000
export const REMOTE_IMAGE_MAX_BYTES = 15 * 1024 * 1024
const RASTER_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export const DRIVE_NOT_PUBLIC_MESSAGE =
  'El archivo de Drive no es público: compartilo como "Cualquier persona con el enlace" (lector) y volvé a intentar. ' +
  '(Google Drive returned a web page instead of the file: share it as "Anyone with the link".)'

const DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com'])

/** Drive file id from any common share link; `folder` for folder links; null when not a Drive file link. */
export function parseDriveLink(raw: string): { id: string } | { folder: true } | { doc: true } | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  if (!DRIVE_HOSTS.has(host)) return null
  if (/\/drive\/(?:u\/\d+\/)?folders\//.test(u.pathname) || /\/folderview/.test(u.pathname)) return { folder: true }
  const byPath = u.pathname.match(/\/file\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/)
  if (byPath) return { id: byPath[1] }
  if (host === 'docs.google.com' && /\/(document|spreadsheets|presentation|forms)\//.test(u.pathname)) return { doc: true }
  const byQuery = u.searchParams.get('id')
  if (byQuery && /^[A-Za-z0-9_-]+$/.test(byQuery)) return { id: byQuery }
  return null
}

export function driveDownloadUrl(id: string): string {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`
}

/** Share link → direct download link + provider (other https URLs unchanged). */
export function resolveDownloadUrl(raw: string): { url: string; provider: RemoteProvider; driveId?: string } {
  const drive = parseDriveLink(raw)
  if (drive && 'id' in drive) return { url: driveDownloadUrl(drive.id), provider: 'google_drive', driveId: drive.id }
  try {
    const u = new URL(raw)
    if (/(^|\.)dropbox\.com$/i.test(u.hostname) && !/^dl\./i.test(u.hostname)) {
      u.searchParams.delete('raw')
      u.searchParams.set('dl', '1')
      return { url: u.toString(), provider: 'dropbox' }
    }
    if (/(^|\.)dropboxusercontent\.com$/i.test(u.hostname)) return { url: raw, provider: 'dropbox' }
  } catch {
    // fall through
  }
  return { url: raw, provider: 'https' }
}

const decodeHtml = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x3D;/gi, '=').replace(/&#61;/g, '=')

/**
 * Drive "can't scan this file for viruses" interstitial → the confirmed download URL.
 * Null when the page is not that interstitial (login / request-access / error page).
 */
export function driveConfirmUrl(html: string, driveId: string, setCookie?: string | null): string | null {
  const form = html.match(/<form[^>]*id=["']download-form["'][^>]*>([\s\S]*?)<\/form>/i) ?? html.match(/<form[^>]*action=["'][^"']*\/download[^"']*["'][^>]*>([\s\S]*?)<\/form>/i)
  if (form) {
    const action = decodeHtml((form[0].match(/action=["']([^"']+)["']/i) ?? [])[1] ?? 'https://drive.usercontent.google.com/download')
    const params = new URLSearchParams()
    for (const input of form[1].matchAll(/<input[^>]*>/gi)) {
      const name = (input[0].match(/name=["']([^"']+)["']/i) ?? [])[1]
      const value = (input[0].match(/value=["']([^"']*)["']/i) ?? [])[1] ?? ''
      if (name) params.set(name, decodeHtml(value))
    }
    if (!params.get('id')) params.set('id', driveId)
    if (params.get('confirm')) {
      try {
        const target = new URL(action, 'https://drive.usercontent.google.com')
        target.search = params.toString()
        return target.toString()
      } catch {
        return null
      }
    }
  }
  const legacy = html.match(/[?&;]confirm=([0-9A-Za-z_-]+)/)
  if (legacy) return `https://drive.google.com/uc?export=download&confirm=${legacy[1]}&id=${encodeURIComponent(driveId)}`
  const cookie = setCookie?.match(/download_warning[^=]*=([^;]+)/)
  if (cookie) return `https://drive.google.com/uc?export=download&confirm=${encodeURIComponent(cookie[1])}&id=${encodeURIComponent(driveId)}`
  return null
}

function looksLikeHtml(bytes: Uint8Array, contentType: string): boolean {
  if (/text\/html|application\/xhtml/i.test(contentType)) return true
  const head = Buffer.from(bytes.subarray(0, 256)).toString('utf8').trimStart().toLowerCase()
  return head.startsWith('<!doctype html') || head.startsWith('<html') || (head.startsWith('<') && head.includes('<head'))
}

export function isSvgBytes(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 512)).toString('utf8').trimStart().toLowerCase()
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))
}

/** HEIC / AVIF (ISO-BMFF `ftyp` brands) — common from phones, not supported downstream. */
function isHeifFamily(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  const box = Buffer.from(bytes.subarray(4, 12)).toString('latin1')
  return box.startsWith('ftyp') && /heic|heix|hevc|mif1|msf1|avif/i.test(box.slice(4))
}

/** Read the body with a hard byte cap (stops streaming as soon as the cap is crossed). */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new RemoteImageError('TOO_LARGE', `File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`)
  const body = res.body
  if (!body || typeof (body as ReadableStream<Uint8Array>).getReader !== 'function') {
    const all = new Uint8Array(await res.arrayBuffer())
    if (all.length > maxBytes) throw new RemoteImageError('TOO_LARGE', `File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`)
    return all
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.length
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new RemoteImageError('TOO_LARGE', `File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

function filenameFrom(res: Response, url: string): string | undefined {
  const cd = res.headers.get('content-disposition') || ''
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
  const plain = cd.match(/filename="?([^";]+)"?/i)
  const raw = star?.[1] ?? plain?.[1]
  if (raw) {
    try {
      return decodeURIComponent(raw.trim())
    } catch {
      return raw.trim()
    }
  }
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '')
    return /\.[a-z0-9]{2,5}$/i.test(last) ? last : undefined
  } catch {
    return undefined
  }
}

export interface DownloadedImage {
  bytes: Uint8Array
  /** Sniffed from the bytes: image/png | image/jpeg | image/webp | image/svg+xml. */
  mime: string
  provider: RemoteProvider
  /** URL the bytes finally came from (after the Drive confirm step). */
  downloadUrl: string
  filename?: string
  /** True when the Drive large-file confirm interstitial was followed. */
  driveConfirmed?: boolean
}

export const defaultRemoteFetch: RemoteFetch = (url, init) => fetchPublicUrl(url, { timeoutMs: init.timeoutMs, maxRedirects: 5 })

/**
 * Download one image. Throws RemoteImageError with a plain-language message (ES + EN where the
 * user must act) — never returns HTML or a non-image.
 */
export async function downloadRemoteImage(rawUrl: string, options: {
  fetchImpl?: RemoteFetch
  maxBytes?: number
  timeoutMs?: number
  /** Accept SVG (logos only). */
  allowSvg?: boolean
} = {}): Promise<DownloadedImage> {
  const original = String(rawUrl ?? '').trim()
  if (!original) throw new RemoteImageError('BAD_URL', 'url is required (a Google Drive share link, Dropbox link or public https image URL)')
  if (/^data:/i.test(original)) throw new RemoteImageError('BAD_URL', 'data: URLs are not accepted; send a public https link (or use create_upload_url for local files)')
  try {
    assertPublicHttpUrl(original)
  } catch (err) {
    throw new RemoteImageError('BAD_URL', `URL not allowed: ${err instanceof Error ? err.message : String(err)}`)
  }
  const drive = parseDriveLink(original)
  if (drive && 'folder' in drive) throw new RemoteImageError('DRIVE_FOLDER', 'That is a Google Drive folder link: share the link of each image file instead (one import_image per file, or import_images with several).')
  if (drive && 'doc' in drive) throw new RemoteImageError('NOT_AN_IMAGE', 'That is a Google Docs/Sheets/Slides link, not an image file. Share the image file itself.')
  const fetchImpl = options.fetchImpl ?? defaultRemoteFetch
  const timeoutMs = options.timeoutMs ?? REMOTE_IMAGE_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? REMOTE_IMAGE_MAX_BYTES
  const resolved = resolveDownloadUrl(original)
  const isDrive = resolved.provider === 'google_drive'

  const get = async (url: string): Promise<Response> => {
    let res: Response
    try {
      res = await fetchImpl(url, { timeoutMs })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/not allowed/i.test(msg)) throw new RemoteImageError('BAD_URL', `URL not allowed: ${msg}`)
      throw new RemoteImageError('DOWNLOAD_FAILED', `Download failed: ${msg}`.slice(0, 300))
    }
    if (!res.ok) {
      if (isDrive && [401, 403, 404].includes(res.status)) throw new RemoteImageError('DRIVE_NOT_PUBLIC', DRIVE_NOT_PUBLIC_MESSAGE)
      throw new RemoteImageError('DOWNLOAD_FAILED', `Download failed (HTTP ${res.status})`)
    }
    return res
  }

  let downloadUrl = resolved.url
  let res = await get(downloadUrl)
  let bytes = await readCapped(res, maxBytes)
  let driveConfirmed = false
  const contentType = () => res.headers.get('content-type') || ''
  if (looksLikeHtml(bytes, contentType())) {
    if (!isDrive || !resolved.driveId) {
      throw new RemoteImageError('NOT_AN_IMAGE', 'The link returned a web page, not an image file. Use the direct image link (right-click → copy image address) or create_upload_url.')
    }
    const confirm = driveConfirmUrl(Buffer.from(bytes).toString('utf8'), resolved.driveId, res.headers.get('set-cookie'))
    if (!confirm) throw new RemoteImageError('DRIVE_NOT_PUBLIC', DRIVE_NOT_PUBLIC_MESSAGE)
    try {
      assertPublicHttpUrl(confirm)
    } catch {
      throw new RemoteImageError('DRIVE_NOT_PUBLIC', DRIVE_NOT_PUBLIC_MESSAGE)
    }
    downloadUrl = confirm
    res = await get(confirm)
    bytes = await readCapped(res, maxBytes)
    driveConfirmed = true
    if (looksLikeHtml(bytes, contentType())) throw new RemoteImageError('DRIVE_NOT_PUBLIC', DRIVE_NOT_PUBLIC_MESSAGE)
  }
  if (!bytes.length) throw new RemoteImageError('EMPTY_FILE', 'The file is empty')
  let mime = sniffImageMime(bytes)
  if (!mime && options.allowSvg && isSvgBytes(bytes)) mime = 'image/svg+xml'
  if (!mime || !(RASTER_MIMES.has(mime) || (mime === 'image/svg+xml' && options.allowSvg))) {
    if (isHeifFamily(bytes)) throw new RemoteImageError('UNSUPPORTED_IMAGE_TYPE', 'HEIC/AVIF photos are not supported: export the photo as JPG or PNG and share that file.')
    if (mime === 'image/gif') throw new RemoteImageError('UNSUPPORTED_IMAGE_TYPE', 'GIF is not supported: send a PNG, JPEG or WebP image.')
    throw new RemoteImageError('NOT_AN_IMAGE', `Not a PNG/JPEG/WebP${options.allowSvg ? '/SVG' : ''} image (the link must point at the image file itself${isDrive ? '; a Drive link must be shared as "Anyone with the link"' : ''}).`)
  }
  return { bytes, mime, provider: resolved.provider, downloadUrl, ...(filenameFrom(res, original) ? { filename: filenameFrom(res, original) } : {}), ...(driveConfirmed ? { driveConfirmed } : {}) }
}
