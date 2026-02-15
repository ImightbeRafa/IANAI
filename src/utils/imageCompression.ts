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
