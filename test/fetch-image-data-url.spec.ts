import { describe, expect, it } from 'vitest'
import { sniffImageMime } from '../api/lib/fetch-image-data-url'

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

describe('sniffImageMime', () => {
  it('detects jpeg / png / gif / webp magic', () => {
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(sniffImageMime(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif')
    const webp = new Uint8Array(12)
    webp.set([0x52, 0x49, 0x46, 0x46], 0)
    webp.set([0x57, 0x45, 0x42, 0x50], 8)
    expect(sniffImageMime(webp)).toBe('image/webp')
  })

  it('returns null for non-image bytes', () => {
    expect(sniffImageMime(bytes(0x00, 0x01, 0x02))).toBeNull()
    expect(sniffImageMime(bytes())).toBeNull()
  })
})
