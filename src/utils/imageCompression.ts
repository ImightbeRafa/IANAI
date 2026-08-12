import { supabase } from '../lib/supabase'

/**
 * Compress an image to WebP format with specified quality
 * Reduces file size by ~60-80% with minimal visible quality loss
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

  const { data, error } = await supabase.storage
    .from('post-images')
    .upload(filePath, blob, {
      contentType: mimeType,
      upsert: true
    })

  if (error) {
    console.error('Upload error:', error)
    throw error
  }

  const { data: { publicUrl } } = supabase.storage
    .from('post-images')
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

  const { data, error } = await supabase.storage
    .from('post-images')
    .upload(filePath, compressedBlob, {
      contentType: 'image/webp',
      upsert: true
    })

  if (error) {
    console.error('Product image upload error:', error)
    throw error
  }

  const { data: { publicUrl } } = supabase.storage
    .from('post-images')
    .getPublicUrl(data.path)

  return publicUrl
}

/**
 * Compress and resize an image File for brand kit uploads (logos, reference images).
 * - Logos: max 512px, WebP 0.85 quality (~30-80KB output)
 * - Reference images: max 1024px, WebP 0.80 quality (~80-200KB output)
 * Returns a Blob ready for Supabase Storage upload.
 */
export async function compressBrandImage(
  file: File,
  maxDim: number = 512,
  quality: number = 0.85
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img

        // Only downscale, never upscale
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
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob)
            else reject(new Error('Failed to compress brand image'))
          },
          'image/webp',
          quality
        )
      }
      img.onerror = () => reject(new Error('Failed to load image for compression'))
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
