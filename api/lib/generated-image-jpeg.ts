/**
 * Encode AI-generated images as high-quality JPEG for Storage (5 MiB bucket limit).
 * Generated ads/social must be JPEG only — never WebP/PNG blobs in job results.
 */

import sharp from 'sharp'
import { assertPublicHttpUrl } from './url-safety.js'

export const GENERATED_JPEG_QUALITY = 92
export const GENERATED_JPEG_CONTENT_TYPE = 'image/jpeg' as const
export const GENERATED_JPEG_EXTENSION = 'jpg' as const

export type GeneratedJpeg = {
  bytes: Buffer
  contentType: typeof GENERATED_JPEG_CONTENT_TYPE
  extension: typeof GENERATED_JPEG_EXTENSION
  width?: number
  height?: number
}

function parseDataUrl(dataUrl: string): Buffer {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) throw new Error('Expected image data URL')
  return Buffer.from(match[2], 'base64')
}

async function loadImageBytes(source: string): Promise<Buffer> {
  const trimmed = source.trim()
  if (/^data:/i.test(trimmed)) return parseDataUrl(trimmed)
  const parsed = assertPublicHttpUrl(trimmed)
  if (parsed.protocol !== 'https:') throw new Error('Only https image URLs are allowed')
  const response = await fetch(parsed.toString())
  if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`)
  return Buffer.from(await response.arrayBuffer())
}

/** Transcode provider PNG/WebP/JPEG (data URL or https) to JPEG q92. */
export async function encodeGeneratedImageJpeg(source: string | Buffer): Promise<GeneratedJpeg> {
  const input = typeof source === 'string' ? await loadImageBytes(source) : source
  const pipeline = sharp(input, { failOn: 'none' }).rotate()
  const meta = await pipeline.metadata()
  const bytes = await pipeline
    .jpeg({
      quality: GENERATED_JPEG_QUALITY,
      mozjpeg: true,
      chromaSubsampling: '4:4:4',
    })
    .toBuffer()
  return {
    bytes,
    contentType: GENERATED_JPEG_CONTENT_TYPE,
    extension: GENERATED_JPEG_EXTENSION,
    width: meta.width,
    height: meta.height,
  }
}
