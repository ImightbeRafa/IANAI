import { describe, expect, it } from 'vitest'
import { buildUniqueProductRefFilename } from '../src/utils/imageCompression'

describe('buildUniqueProductRefFilename', () => {
  it('timestamp-only when no original name', () => {
    const name = buildUniqueProductRefFilename()
    expect(name).toMatch(/^\d+\.webp$/)
  })

  it('prefixes timestamp so tiny.png re-upload never collides', () => {
    const name = buildUniqueProductRefFilename('tiny.png')
    expect(name).toMatch(/^\d+-tiny\.webp$/)
    expect(name).not.toBe('tiny.png')
  })

  it('sanitizes odd names', () => {
    const name = buildUniqueProductRefFilename('../../weird name!!.JPG')
    expect(name).toMatch(/^\d+-weird_name\.webp$/)
    expect(name.includes('..')).toBe(false)
  })
})
