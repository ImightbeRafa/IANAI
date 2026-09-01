import { fetchPublicUrl } from './url-safety.js'

const MAX_IMAGE_BYTES = 8_000_000

/** Best-effort MIME from magic bytes when CDNs send octet-stream. */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

/**
 * Server-side fetch of a public image as a data URL (SSRF-safe).
 * Used so the browser never needs connect-src to store/kit hosts.
 */
export async function fetchPublicImageAsDataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:image/')) return url
  try {
    const imgResp = await fetchPublicUrl(url, { timeoutMs: 15000, maxRedirects: 3 })
    if (!imgResp.ok) return null
    const buffer = await imgResp.arrayBuffer()
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null
    const bytes = new Uint8Array(buffer)
    const headerType = (imgResp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const mime = headerType.startsWith('image/') ? (headerType === 'image/jpg' ? 'image/jpeg' : headerType) : sniffImageMime(bytes)
    if (!mime) return null
    const base64 = Buffer.from(buffer).toString('base64')
    return `data:${mime};base64,${base64}`
  } catch (err) {
    console.error('fetchPublicImageAsDataUrl failed', err instanceof Error ? err.message : err)
    return null
  }
}

export async function resolveReferenceImageDataUrls(urls: string[]): Promise<string[]> {
  const out: string[] = []
  for (const url of urls.filter(Boolean)) {
    const dataUrl = url.startsWith('data:') ? url : await fetchPublicImageAsDataUrl(url)
    if (dataUrl) out.push(dataUrl)
  }
  return out
}
