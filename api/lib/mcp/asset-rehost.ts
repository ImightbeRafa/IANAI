/**
 * C2 — copy external images (Google Drive, Dropbox, any https link) into Advance
 * storage when an MCP tool saves them, so a permission change on the source can
 * never break a brand/offer asset. The original link is kept as `sourceUrl`.
 *
 * Safety: public http(s) only (assertPublicHttpUrl + DNS check via fetchPublicUrl),
 * size and time caps, real image bytes only (magic-byte sniff). On any failure the
 * caller keeps the original URL and gets a warning — existing link flows keep working.
 */
import { randomUUID } from 'node:crypto'
import { sniffImageMime } from '../fetch-image-data-url.js'
import { assertPublicHttpUrl, fetchPublicUrl } from '../url-safety.js'

export const REHOST_MAX_BYTES = 15 * 1024 * 1024
export const REHOST_TIMEOUT_MS = 15_000
export const UPLOAD_BUCKET = 'post-images'

const REHOST_MIMES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp'])

export interface RehostDeps {
  /** Upload bytes to `post-images/<path>`; returns the public URL. */
  upload: (input: { path: string; bytes: Uint8Array; contentType: string }) => Promise<string>
  /** Defaults to fetchPublicUrl (SSRF-safe). Tests inject a fake. */
  fetchImpl?: (url: string, init: { timeoutMs: number }) => Promise<Response>
  newId?: () => string
}

export interface RehostResult {
  url: string
  /** Original external URL (set when the file was copied). */
  sourceUrl?: string
  rehosted: boolean
  warning?: string
}

export type RehostFn = (input: { userId: string; url: string; label?: string }) => Promise<RehostResult>

/** Already in this user's Advance storage → nothing to copy. */
export function isOwnedStorageUrl(url: string, userId: string): boolean {
  return new RegExp(`/storage/v1/object/(?:public|sign)/${UPLOAD_BUCKET}/${userId.replace(/[^A-Za-z0-9-]/g, '')}/`, 'i').test(url)
}

/** Google Drive share links → direct download link (other URLs unchanged). */
export function directDownloadUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname === 'drive.google.com') {
      const m = u.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/)
      const id = m?.[1] || u.searchParams.get('id')
      if (id) return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`
    }
    if (/(^|\.)dropbox\.com$/.test(u.hostname) && u.searchParams.get('dl') === '0') {
      u.searchParams.set('dl', '1')
      return u.toString()
    }
  } catch {
    // fall through
  }
  return url
}

/** Lowercase, ascii, [a-z0-9._-], ≤ 60 chars, keeps the extension. */
export function safeFilename(name: string, fallback = 'file'): string {
  const base = (name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/-\./g, '.').replace(/^[-.]+|[-.]+$/g, '')
  const trimmed = base.length > 60 ? base.slice(base.length - 60).replace(/^[-.]+/, '') : base
  return trimmed || fallback
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export function uploadPath(userId: string, filename: string, id: string): string {
  return `${userId}/uploads/${id}-${safeFilename(filename)}`
}

export function createRehoster(deps: RehostDeps): RehostFn {
  const fetchImpl = deps.fetchImpl ?? ((url, init) => fetchPublicUrl(url, { timeoutMs: init.timeoutMs }))
  const newId = deps.newId ?? randomUUID
  return async ({ userId, url, label }) => {
    const original = url.trim()
    if (!original) return { url: original, rehosted: false, warning: 'empty URL' }
    if (/^data:/i.test(original)) return { url: original, rehosted: false, warning: 'data URLs are not accepted; send an https link' }
    if (isOwnedStorageUrl(original, userId)) return { url: original, rehosted: false }
    try {
      assertPublicHttpUrl(original)
      const res = await fetchImpl(directDownloadUrl(original), { timeoutMs: REHOST_TIMEOUT_MS })
      if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`)
      const declared = Number(res.headers.get('content-length') || 0)
      if (declared > REHOST_MAX_BYTES) throw new Error(`file is larger than ${REHOST_MAX_BYTES / 1024 / 1024} MB`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (!bytes.length) throw new Error('empty file')
      if (bytes.length > REHOST_MAX_BYTES) throw new Error(`file is larger than ${REHOST_MAX_BYTES / 1024 / 1024} MB`)
      const mime = sniffImageMime(bytes)
      if (!mime || !REHOST_MIMES.has(mime)) {
        throw new Error('not a PNG/JPEG/WebP image (a Drive link must be shared as "anyone with the link")')
      }
      const nameFromUrl = (() => {
        try {
          return decodeURIComponent(new URL(original).pathname.split('/').filter(Boolean).pop() || '')
        } catch {
          return ''
        }
      })()
      const stem = safeFilename(label || nameFromUrl.replace(/\.[a-z0-9]{2,5}$/i, ''), 'image').replace(/\.[a-z0-9]{2,5}$/i, '')
      const path = uploadPath(userId, `${stem}.${EXT[mime]}`, newId())
      const owned = await deps.upload({ path, bytes, contentType: mime })
      return { url: owned, sourceUrl: original, rehosted: true }
    } catch (err) {
      return {
        url: original,
        rehosted: false,
        warning: `Kept the original link (could not copy it into Advance storage: ${err instanceof Error ? err.message : String(err)}). If the link stops working, upload the file with create_upload_url.`.slice(0, 400),
      }
    }
  }
}
