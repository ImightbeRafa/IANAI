import { supabase } from '../lib/supabase'

/**
 * Compress an image to WebP format with specified quality
 * Reduces file size by ~60-80% with minimal visible quality loss
 */
export async function compressImageToWebP(
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
 * Upload a compressed image to Supabase Storage
 * Returns the public URL of the uploaded image
 */
/**
 * Sanitize a path segment to prevent path traversal attacks
 */
function sanitizePathSegment(segment: string): string {
  return segment
    .replace(/\.\./g, '')
    .replace(/[\/\\]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '')
}

export async function uploadPostImage(
  userId: string,
  productId: string,
  imageSource: string,
  filename?: string
): Promise<string> {
  // Compress to WebP
  const compressedBlob = await compressImageToWebP(imageSource)
  
  // Generate unique filename with sanitization
  const timestamp = Date.now()
  const rawName = filename || `${timestamp}.webp`
  const safeUserId = sanitizePathSegment(userId)
  const safeProductId = sanitizePathSegment(productId)
  const safeFileName = sanitizePathSegment(rawName)
  
  if (!safeUserId || !safeProductId || !safeFileName) {
    throw new Error('Invalid file path parameters')
  }
  
  const filePath = `${safeUserId}/${safeProductId}/${safeFileName}`
  
  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from('post-images')
    .upload(filePath, compressedBlob, {
      contentType: 'image/webp',
      upsert: true
    })
  
  if (error) {
    console.error('Upload error:', error)
    throw error
  }
  
  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('post-images')
    .getPublicUrl(data.path)
  
  return publicUrl
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

  const timestamp = Date.now()
  const rawName = filename || `${timestamp}.webp`
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

/**
 * Delete a post image from storage
 */
export async function deletePostImage(imagePath: string): Promise<void> {
  // Extract path from full URL
  const pathMatch = imagePath.match(/post-images\/(.+)$/)
  if (!pathMatch) return
  
  const { error } = await supabase.storage
    .from('post-images')
    .remove([pathMatch[1]])
  
  if (error) {
    console.error('Delete error:', error)
  }
}
