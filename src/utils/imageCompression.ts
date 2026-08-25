import { supabase } from '../lib/supabase'
import { CANONICAL_IMAGE_BUCKET, ensureCanonicalImageBucket, isMissingImageBucketError } from '../services/imageStorage'

/**
 * Compress an image to JPEG (generated ads/social — no WebP).
 */
export async function compressImageToJpeg(
  imageSource: string,
  quality: number = 0.92
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }

      // White background so transparent PNG sources don't get black fills in JPEG.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Failed to create JPEG blob'))
        },
        'image/jpeg',
        quality
      )
    }

    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = imageSource
  })
}

/**
 * Compress an image to WebP format with specified quality
 * Reduces file size by ~60-80% with minimal visible quality loss
 * (product/style reference uploads only — not generated ads)
 */
async function compressImageToWebP(
  imageSource: string,
  quality: number = 0.95
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      
      ctx.drawImage(img, 0, 0)
      
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Failed to create blob'))
          }
        },
        'image/webp',
        quality
      )
    }
    
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = imageSource
  })
}

/**
 * Sanitize a path segment to prevent path traversal attacks
 */
function sanitizePathSegment(segment: string): string {
  return segment
    .replace(/\.\./g, '')
    .replace(/[\/\\]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '')
}

/**
 * Unique storage object name for product-refs.
 * Always timestamp-prefixed so re-uploads INSERT a new object and never
 * depend on storage UPDATE (upsert overwrite) RLS.
 */
export function buildUniqueProductRefFilename(original?: string): string {
  const ts = Date.now()
  const raw = (original || '').trim()
  if (!raw) return `${ts}.webp`
  const base = raw
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return base ? `${ts}-${base}.webp` : `${ts}.webp`
}

/**
 * Upload an AI-generated image WITHOUT compression.
 * Preserves the original PNG quality from Gemini output.
 * Use this for AI-generated post images to avoid quality loss.
 */
export async function uploadPostImageOriginal(
  userId: string,
  productId: string,
  imageSource: string,
  filename?: string
): Promise<string> {
  // Convert base64 data URL to Blob without re-encoding
  const base64Match = imageSource.match(/^data:([^;]+);base64,(.+)$/)
  if (!base64Match) {
    throw new Error('Invalid image source — expected base64 data URL')
  }

  const mimeType = base64Match[1]
  const base64Data = base64Match[2]
  const byteChars = atob(base64Data)
  const byteArray = new Uint8Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) {
    byteArray[i] = byteChars.charCodeAt(i)
  }
  const blob = new Blob([byteArray], { type: mimeType })

  // Determine extension from mime type
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg'

  const timestamp = Date.now()
  const rawName = filename || `${timestamp}.${ext}`
  const safeUserId = sanitizePathSegment(userId)
  const safeProductId = sanitizePathSegment(productId)
  const safeFileName = sanitizePathSegment(rawName)

  if (!safeUserId || !safeProductId || !safeFileName) {
    throw new Error('Invalid file path parameters')
  }

  const filePath = `${safeUserId}/${safeProductId}/${safeFileName}`

  const upload = () => supabase.storage.from(CANONICAL_IMAGE_BUCKET).upload(filePath, blob, {
      contentType: mimeType,
      upsert: true
    })
  let { data, error } = await upload()
  if (error && isMissingImageBucketError(error)) {
    await ensureCanonicalImageBucket()
    ;({ data, error } = await upload())
  }

  if (error) {
    console.error('Upload error:', error)
    throw error
  }
  if (!data) throw new Error('Storage upload returned no file')

  const { data: { publicUrl } } = supabase.storage
    .from(CANONICAL_IMAGE_BUCKET)
    .getPublicUrl(data.path)

  return publicUrl
}

/**
 * Upload an AI-generated image as high-quality JPEG (ads/social).
 * Never WebP/PNG for generated creatives — keeps Storage under the 5 MiB limit.
 */
export async function uploadGeneratedImageJpeg(
  userId: string,
  productId: string,
  imageSource: string,
  filename?: string
): Promise<string> {
  const jpegBlob = await compressImageToJpeg(imageSource, 0.92)
  const timestamp = Date.now()
  const rawName = filename?.replace(/\.[^.]+$/, '') || `${timestamp}`
  const safeUserId = sanitizePathSegment(userId)
  const safeProductId = sanitizePathSegment(productId)
  const safeFileName = sanitizePathSegment(`${rawName}.jpg`)

  if (!safeUserId || !safeProductId || !safeFileName) {
    throw new Error('Invalid file path parameters')
  }

  const filePath = `${safeUserId}/${safeProductId}/product-refs/${safeFileName}`

  const upload = () => supabase.storage.from(CANONICAL_IMAGE_BUCKET).upload(filePath, jpegBlob, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  let { data, error } = await upload()
  if (error && isMissingImageBucketError(error)) {
    await ensureCanonicalImageBucket()
    ;({ data, error } = await upload())
  }

  if (error) {
    console.error('Generated JPEG upload error:', error)
    throw error
  }
  if (!data) throw new Error('Storage upload returned no file')

  const { data: { publicUrl } } = supabase.storage
    .from(CANONICAL_IMAGE_BUCKET)
    .getPublicUrl(data.path)

  return publicUrl
}

/**
 * Upload a product reference image (compressed to WebP).
 * Stored under product-images/{userId}/{productId}/{timestamp}.webp
 */
export async function uploadProductImage(
  userId: string,
  productId: string,
  imageSource: string,
  filename?: string
): Promise<string> {
  const compressedBlob = await compressImageToWebP(imageSource, 0.90)

  // Always unique — never reuse file.name (e.g. tiny.png) which forces storage UPDATE via upsert.
  const rawName = buildUniqueProductRefFilename(filename)
  const safeUserId = sanitizePathSegment(userId)
  const safeProductId = sanitizePathSegment(productId)
  const safeFileName = sanitizePathSegment(rawName)

  if (!safeUserId || !safeProductId || !safeFileName) {
    throw new Error('Invalid file path parameters')
  }

  const filePath = `${safeUserId}/${safeProductId}/product-refs/${safeFileName}`

  const upload = () => supabase.storage.from(CANONICAL_IMAGE_BUCKET).upload(filePath, compressedBlob, {
      contentType: 'image/webp',
      upsert: true
    })
  let { data, error } = await upload()
  if (error && isMissingImageBucketError(error)) {
    await ensureCanonicalImageBucket()
    ;({ data, error } = await upload())
  }

  if (error) {
    console.error('Product image upload error:', error)
    throw error
  }
  if (!data) throw new Error('Storage upload returned no file')

  const { data: { publicUrl } } = supabase.storage
    .from(CANONICAL_IMAGE_BUCKET)
    .getPublicUrl(data.path)

  return publicUrl
}

/**
 * Compress and resize an image File for brand kit uploads (logos, reference images).
 * - Logos: max 512px, WebP 0.85 quality (~30-80KB output)
 * - Reference images: max 1024px, WebP 0.80 quality (~80-200KB output)
 * Returns a Blob ready for Supabase Storage upload.
 */
function isSvgFile(file: File): boolean {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
}

function parseSvgSize(svgText: string, fallback: number): { width: number; height: number } {
  const viewBox = svgText.match(/viewBox\s*=\s*["']\s*([0-9.+\-eE\s]+)\s*["']/i)
  if (viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] }
    }
  }
  const width = Number(svgText.match(/\bwidth\s*=\s*["']?([\d.]+)/i)?.[1])
  const height = Number(svgText.match(/\bheight\s*=\s*["']?([\d.]+)/i)?.[1])
  if (width > 0 && height > 0) return { width, height }
  return { width: fallback, height: fallback }
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to compress brand image'))
      },
      'image/webp',
      quality
    )
  })
}

function drawScaledImage(img: HTMLImageElement, maxDim: number): HTMLCanvasElement {
  let { width, height } = img
  if (!width || !height) {
    width = maxDim
    height = maxDim
  }
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context failed')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

async function rasterizeSvgFile(file: File, maxDim: number, quality: number): Promise<Blob> {
  const svgText = await file.text()
  const sized = parseSvgSize(svgText, maxDim)
  const blob = new Blob([svgText], { type: 'image/svg+xml' })
  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Could not read this SVG logo. Export it as PNG or WebP and try again.'))
      image.src = objectUrl
    })
    if (!img.naturalWidth || !img.naturalHeight) {
      img.width = sized.width
      img.height = sized.height
    }
    return canvasToWebp(drawScaledImage(img, maxDim), quality)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * Compress a brand logo or visual reference for Storage + Gemini.
 * SVGs are rasterized to transparent WebP so image models can ingest them.
 */
export async function compressBrandImage(
  file: File,
  maxDim: number = 512,
  quality: number = 0.85
): Promise<Blob> {
  if (isSvgFile(file)) {
    return rasterizeSvgFile(file, maxDim, quality)
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        canvasToWebp(drawScaledImage(img, maxDim), quality).then(resolve, reject)
      }
      img.onerror = () => reject(new Error('Could not read that image. Use PNG, JPG, WebP, or SVG.'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Convert an image URL to a base64 data URL.
 * If the input is already a data URL, returns it as-is.
 */
export async function urlToBase64(url: string): Promise<string> {
  if (url.startsWith('data:')) return url
  const res = await fetch(url)
  const blob = await res.blob()
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

/**
 * Aggressively compress an image for style analysis.
 * Gemini only needs to understand layout, colors, typography and composition —
 * not pixel-perfect detail. This keeps API input token costs very low.
 * Target: 768px max dimension, JPEG quality 0.6, always re-encodes.
 */
export async function compressForStyleAnalysis(
  dataUrl: string,
  maxDim: number = 768,
  quality: number = 0.6
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas context failed')); return }
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

/**
 * Compress a base64 data URL if it exceeds maxBytes (base64 string length).
 * Resizes to fit within maxDim on the longest side and re-encodes as JPEG.
 * Default threshold: ~800 KB base64 string (~600 KB binary).
 */
export async function compressBase64ForApi(
  base64: string,
  maxBytes: number = 800_000,
  maxDim: number = 1280,
  quality: number = 0.78
): Promise<string> {
  if (base64.length <= maxBytes) return base64

  return new Promise<string>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas context failed')); return }
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => reject(new Error('Failed to load image for compression'))
    img.src = base64
  })
}
