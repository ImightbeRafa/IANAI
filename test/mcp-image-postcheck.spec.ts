import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { checkGeneratedProductFidelity, runMcpImageQa } from '../api/lib/mcp/image-postcheck'

type Rect = { x: number; y: number; w: number; h: number; c: string }

async function svgPng(w: number, h: number, bg: string, body: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfd8c2"/><stop offset="1" stop-color="#6b7a5c"/></linearGradient></defs><rect width="${w}" height="${h}" fill="${bg === 'scene' ? 'url(#g)' : bg}"/>${body}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
const rects = (rs: Rect[]) => rs.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" fill="${r.c}"/>`).join('')
const url = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`

// Reference: studio photo, a red body + a blue cap + a yellow band (3 parts) on white.
const PRODUCT: Rect[] = [
  { x: 130, y: 120, w: 140, h: 200, c: '#c0392b' },
  { x: 150, y: 70, w: 100, h: 50, c: '#1f4e9c' },
  { x: 130, y: 320, w: 140, h: 40, c: '#e5b81f' },
]
// The same product placed in a new scene (smaller, off-centre, a slightly different light).
const placed = (rs: Rect[], dx = 90, dy = 150, k = 0.55) =>
  rs.map((r) => ({ ...r, x: dx + (r.x - 130) * k, y: dy + (r.y - 70) * k, w: r.w * k, h: r.h * k }))

describe('MCP fidelity post-check (warning only, free, local)', () => {
  it('a faithful product in a new scene passes with no warning', async () => {
    const ref = await svgPng(400, 400, '#ffffff', rects(PRODUCT))
    const gen = await svgPng(300, 400, 'scene', rects(placed(PRODUCT)))
    const res = await checkGeneratedProductFidelity({ referenceDataUrls: [url(ref)], generatedDataUrl: url(gen) })
    expect(res.status).toBe('ok')
  })

  it('a changed colour yields fidelity_warning with reason and score', async () => {
    const ref = await svgPng(400, 400, '#ffffff', rects(PRODUCT))
    const changed = PRODUCT.map((r, i) => (i === 0 ? { ...r, c: '#2e9e4f' } : r))
    const gen = await svgPng(300, 400, 'scene', rects(placed(changed)))
    const res = await checkGeneratedProductFidelity({ referenceDataUrls: [url(ref)], generatedDataUrl: url(gen) })
    expect(res.status).toBe('warning')
    if (res.status === 'warning') {
      expect(res.warning.code).toBe('fidelity_warning')
      expect(res.warning.reason).toMatch(/colour|shape|part/)
      expect(res.warning.score).toBeLessThan(0.9)
    }
  })

  it('a changed shape yields a warning', async () => {
    const ref = await svgPng(400, 400, '#ffffff', rects(PRODUCT))
    const wide: Rect[] = [
      { x: 60, y: 160, w: 280, h: 90, c: '#c0392b' },
      { x: 150, y: 110, w: 100, h: 50, c: '#1f4e9c' },
      { x: 130, y: 250, w: 140, h: 40, c: '#e5b81f' },
    ]
    const gen = await svgPng(300, 400, 'scene', rects(placed(wide, 70, 150, 0.6)))
    const res = await checkGeneratedProductFidelity({ referenceDataUrls: [url(ref)], generatedDataUrl: url(gen) })
    expect(res.status).toBe('warning')
  })

  it('a missing part (part count changed) yields a warning', async () => {
    const ref = await svgPng(400, 400, '#ffffff', rects(PRODUCT))
    const gen = await svgPng(300, 400, 'scene', rects(placed(PRODUCT.slice(0, 2))))
    const res = await checkGeneratedProductFidelity({ referenceDataUrls: [url(ref)], generatedDataUrl: url(gen) })
    expect(res.status).toBe('warning')
    if (res.status === 'warning') expect(res.warning.reason).toMatch(/part|shape|colour/)
  })

  it('skips (no warning) when the reference backdrop is not uniform', async () => {
    const ref = await svgPng(400, 400, 'scene', rects(PRODUCT))
    const gen = await svgPng(300, 400, 'scene', rects(placed(PRODUCT)))
    const res = await checkGeneratedProductFidelity({ referenceDataUrls: [url(ref)], generatedDataUrl: url(gen) })
    expect(res.status).toBe('skipped')
  })

  it('safety-net QA flags a wrong ratio and a missing logo, never throws', async () => {
    const gen = await svgPng(300, 300, 'scene', rects(placed(PRODUCT)))
    const qa = await runMcpImageQa({ generatedDataUrl: url(gen), requestedRatio: '9:16', copyRequested: false, logoAttached: false, logoExpected: true })
    expect(qa.ratioOk).toBe(false)
    expect(qa.logo).toBe('none')
    expect(qa.warnings.length).toBeGreaterThanOrEqual(2)
  })
})
