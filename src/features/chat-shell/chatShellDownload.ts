import { supabase } from '../../lib/supabase'

export function imageExtensionFromMime(mime: string, url = ''): string {
  const type = mime.toLowerCase()
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg'
  if (type.includes('png')) return 'png'
  if (type.includes('webp')) return 'webp'
  if (type.includes('gif')) return 'gif'
  if (type.includes('avif')) return 'avif'
  const fromUrl = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() || ''
  if (fromUrl === 'jpeg') return 'jpg'
  if (/^(png|webp|jpg|gif|avif)$/.test(fromUrl)) return fromUrl
  return 'jpg'
}

export function filenameForShellImage(options: {
  productName?: string | null
  label?: string | null
  mime?: string
  url?: string
}): string {
  const raw = (options.productName || options.label || 'image').trim()
  const base = raw
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'image'
  return `${base}.${imageExtensionFromMime(options.mime || '', options.url || '')}`
}

function triggerDownload(href: string, filename: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => {
    link.remove()
  }, 250)
}

function parseSupabaseStoragePublicUrl(url: string): { bucket: string; path: string } | null {
  try {
    const parsed = new URL(url)
    const match = parsed.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)/)
    if (!match) return null
    return {
      bucket: match[1],
      path: decodeURIComponent(match[2]),
    }
  } catch {
    return null
  }
}

async function downloadBlobViaSupabaseClient(url: string): Promise<Blob | null> {
  const ref = parseSupabaseStoragePublicUrl(url)
  if (!ref) return null
  const { data, error } = await supabase.storage.from(ref.bucket).download(ref.path)
  if (error || !data) return null
  return data
}

async function downloadBlobViaFetch(url: string): Promise<Blob | null> {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' })
  if (!response.ok) return null
  return response.blob()
}

/** Download the stored file bytes. Do not re-encode. Falls back to Supabase client download. */
export async function downloadShellImage(url: string, filename: string): Promise<void> {
  if (!url) return

  if (url.startsWith('data:')) {
    const mime = url.slice(5, url.indexOf(';')) || ''
    triggerDownload(
      url,
      filename.includes('.') ? filename : filenameForShellImage({ label: filename, mime, url })
    )
    return
  }

  const named = filename.includes('.')
    ? filename
    : filenameForShellImage({ label: filename, url })

  let blob: Blob | null = null
  try {
    blob = await downloadBlobViaFetch(url)
  } catch {
    blob = null
  }

  if (!blob) {
    try {
      blob = await downloadBlobViaSupabaseClient(url)
    } catch {
      blob = null
    }
  }

  if (!blob) {
    throw new Error('Download failed')
  }

  const finalName = named.includes('.')
    ? named
    : filenameForShellImage({ label: named, mime: blob.type, url })
  const objectUrl = URL.createObjectURL(blob)
  triggerDownload(objectUrl, finalName)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}
