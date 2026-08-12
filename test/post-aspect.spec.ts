import { describe, expect, it } from 'vitest'
import { resolvePostModeAspect } from '../api/lib/post-aspect'

describe('resolvePostModeAspect', () => {
  it('keeps layout off 9:16 when shell requests 1:1', () => {
    const resolved = resolvePostModeAspect({
      aspectRatio: '1:1',
      isProductMode: false,
      isLogoMode: false,
      hasSessionId: true,
    })
    expect(resolved.canvas).toBe('1:1')
    expect(resolved.shellSquare).toBe(true)
    expect(resolved.layout).toBe('3:4')
    expect(resolved.layout).not.toBe('9:16')
  })

  it('uses 1:1 canvas + non-9:16 layout for product mode square', () => {
    const resolved = resolvePostModeAspect({
      aspectRatio: '1:1',
      isProductMode: true,
      isLogoMode: false,
      hasSessionId: false,
    })
    expect(resolved.canvas).toBe('1:1')
    expect(resolved.layout).toBe('3:4')
  })

  it('defaults to 9:16 canvas+layout', () => {
    expect(
      resolvePostModeAspect({
        aspectRatio: '9:16',
        isProductMode: false,
        isLogoMode: false,
        hasSessionId: true,
      })
    ).toEqual({ canvas: '9:16', layout: '9:16', shellSquare: false })
  })

  it('honors 3:4', () => {
    expect(
      resolvePostModeAspect({
        aspectRatio: '3:4',
        isProductMode: false,
        isLogoMode: false,
        hasSessionId: true,
      })
    ).toEqual({ canvas: '3:4', layout: '3:4', shellSquare: false })
  })
})
