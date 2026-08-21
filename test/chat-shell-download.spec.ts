/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  downloadShellImage,
  filenameForShellImage,
  imageExtensionFromMime,
} from '../src/features/chat-shell/chatShellDownload'

describe('shell image download', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps the stored mime instead of forcing jpg', () => {
    expect(imageExtensionFromMime('image/webp', 'https://cdn.example/x.png')).toBe('webp')
    expect(imageExtensionFromMime('', 'https://cdn.example/post.png?token=1')).toBe('png')
    expect(filenameForShellImage({
      productName: 'Arnés ForgeCR',
      mime: 'image/webp',
      url: 'https://cdn.example/gen.webp',
    })).toBe('Arnés-ForgeCR.webp')
  })

  it('downloads original bytes via blob and falls back to opening the url', async () => {
    const blob = new Blob(['raw-bytes'], { type: 'image/webp' })
    const fetchMock = vi.fn(async () => new Response(blob, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const createObjectURL = vi.fn(() => 'blob:workspace-image')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.fn()
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag)
      if (tag === 'a') el.click = click
      return el
    })

    await downloadShellImage('https://cdn.example/gen.webp', 'ForgeCR.webp')
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example/gen.webp', {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    })
    expect(click).toHaveBeenCalled()

    fetchMock.mockRejectedValueOnce(new Error('CORS'))
    const open = vi.fn()
    vi.stubGlobal('open', open)
    await downloadShellImage('https://cdn.example/gen.webp', 'ForgeCR.webp')
    expect(open).toHaveBeenCalledWith('https://cdn.example/gen.webp', '_blank', 'noopener,noreferrer')
  })
})
