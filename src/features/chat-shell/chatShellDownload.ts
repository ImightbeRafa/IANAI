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
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** Download the stored file bytes. Do not re-encode. Falls back to opening the original URL. */
export async function downloadShellImage(url: string, filename: string): Promise<void> {
  if (!url) return
  if (url.startsWith('data:')) {
    const mime = url.slice(5, url.indexOf(';')) || ''
    triggerDownload(url, filename.includes('.') ? filename : filenameForShellImage({ label: filename, mime, url }))
    return
  }
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' })
    if (!response.ok) throw new Error(`Download failed (${response.status})`)
    const blob = await response.blob()
    const named = filename.includes('.')
      ? filename
      : filenameForShellImage({ label: filename, mime: blob.type, url })
    const objectUrl = URL.createObjectURL(blob)
    triggerDownload(objectUrl, named)
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
