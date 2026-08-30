/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  downloadShellImage,
  filenameForShellImage,
  imageExtensionFromMime,
} from '../src/features/chat-shell/chatShellDownload'

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        download: vi.fn(async () => ({ data: null, error: new Error('not mocked') })),
      }),
    },
  },
}))

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

  it('defaults unknown mime to jpg for generated downloads', () => {
    expect(imageExtensionFromMime('', 'https://cdn.example/gen.jpg')).toBe('jpg')
    expect(imageExtensionFromMime('image/jpeg', 'https://cdn.example/x')).toBe('jpg')
    expect(imageExtensionFromMime('', '')).toBe('jpg')
    expect(filenameForShellImage({
      productName: 'ForgeCR',
      mime: 'image/jpeg',
      url: 'https://cdn.example/gen.jpg',
    })).toBe('ForgeCR.jpg')
  })

  it('downloads original bytes via blob fetch', async () => {
    const blob = new Blob(['raw-bytes'], { type: 'image/jpeg' })
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

    await downloadShellImage('https://cdn.example/gen.jpg', 'ForgeCR.jpg')
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example/gen.jpg', {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    })
    expect(click).toHaveBeenCalled()
  })

  it('throws when fetch and supabase download both fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('CORS') }))
    await expect(downloadShellImage('https://cdn.example/gen.webp', 'ForgeCR.webp'))
      .rejects.toThrow('Download failed')
  })
})
