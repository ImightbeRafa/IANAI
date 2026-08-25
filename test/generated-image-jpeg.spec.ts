import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { encodeGeneratedImageJpeg, GENERATED_JPEG_QUALITY } from '../api/lib/generated-image-jpeg'

describe('encodeGeneratedImageJpeg', () => {
  it('transcodes PNG data URLs to real JPEG under the 5 MiB storage cap', async () => {
    const png = await sharp({
      create: {
        width: 1080,
        height: 1080,
        channels: 3,
        background: { r: 20, g: 40, b: 80 },
      },
    })
      .png()
      .toBuffer()

    const dataUrl = `data:image/png;base64,${png.toString('base64')}`
    const jpeg = await encodeGeneratedImageJpeg(dataUrl)

    expect(jpeg.contentType).toBe('image/jpeg')
    expect(jpeg.extension).toBe('jpg')
    expect(jpeg.bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true)
    expect(jpeg.bytes.byteLength).toBeLessThan(5_242_880)
    expect(jpeg.width).toBe(1080)
    expect(jpeg.height).toBe(1080)
    expect(GENERATED_JPEG_QUALITY).toBeGreaterThanOrEqual(90)

    const meta = await sharp(jpeg.bytes).metadata()
    expect(meta.format).toBe('jpeg')
  })

  it('transcodes WebP buffers to JPEG', async () => {
    const webp = await sharp({
      create: {
        width: 640,
        height: 800,
        channels: 3,
        background: { r: 200, g: 100, b: 50 },
      },
    })
      .webp()
      .toBuffer()

    const jpeg = await encodeGeneratedImageJpeg(webp)
    expect(jpeg.contentType).toBe('image/jpeg')
    const meta = await sharp(jpeg.bytes).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(640)
    expect(meta.height).toBe(800)
  })
})
