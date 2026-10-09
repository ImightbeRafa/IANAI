import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from '../api/lib/adpack/render/color'
import { compositeBrandLayers, freeBands } from '../api/lib/mcp/composite-ad'
import { runMcpImageQa } from '../api/lib/mcp/image-postcheck'
import { buildMcpPromptRules } from '../api/lib/web-post-image'

const F = (name: string) => readFileSync(new URL(`./fixtures/round5b/${name}`, import.meta.url))
const durl = (b: Buffer) => `data:image/jpeg;base64,${b.toString('base64')}`
const PALETTE = { primary: '#15263E', secondary: '#F1EDE5', accent: '#2EC4B6' }
const CTA = 'Escribinos por DM'

async function rgb(bytes: Buffer) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}
/** Mean absolute RGB difference of a box between two same-size images. */
function boxDiff(a: { data: Buffer; w: number }, b: { data: Buffer; w: number }, box: { x: number; y: number; w: number; h: number }) {
  let d = 0, n = 0
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) for (let c = 0; c < 3; c++) { d += Math.abs(a.data[(y * a.w + x) * 3 + c] - b.data[(y * b.w + x) * 3 + c]); n++ }
  return d / n
}
const rowLuma = (img: { data: Buffer; w: number; h: number }, y: number) => {
  let s = 0
  const x1 = Math.round(img.w * 0.12)
  for (let x = 0; x < x1; x++) s += img.data[(y * img.w + x) * 3] * 0.3 + img.data[(y * img.w + x) * 3 + 1] * 0.59 + img.data[(y * img.w + x) * 3 + 2] * 0.11
  return s / x1
}

describe('round 5b: logo + CTA composited in code over the scene Grok draws (round-5 picture, badge + button removed)', () => {
  it('4:5: REAL kit logo whole (pixel-compared to the asset), exact CTA text, both inside the safe zones, same pixel size, no frame / blur band', async () => {
    const scene = F('proto-scene-no-logo-cta-4x5.jpg')
    const logo = F('kit-logo-prototipo.png')
    const { bytes, report } = await compositeBrandLayers({ bytes: scene, ratio: '4:5', logo, ctaText: CTA, palette: PALETTE })
    const before = await rgb(scene)
    const after = await rgb(bytes)
    expect(after.w).toBe(before.w) // pixel size unchanged
    expect(after.h).toBe(before.h)
    expect(report.width).toBe(before.w)

    // LOGO: the exact asset, whole, not a text chip. Compare against the asset resized the same way, composited over the same background.
    const lb = report.logo.box!
    expect(report.logo.status).toBe('drawn')
    expect(lb.y).toBeGreaterThanOrEqual(Math.round(before.h * 0.08)) // inside the top safe zone
    expect(lb.y + lb.h).toBeLessThan(before.h * 0.2)
    expect(lb.x + lb.w).toBeLessThanOrEqual(before.w * 0.96)
    const lm = await sharp(logo).metadata()
    expect(Math.abs(lb.w / lb.h - lm.width! / lm.height!)).toBeLessThan(0.02) // aspect untouched: whole badge, not cropped / squashed
    const expected = await sharp(logo).ensureAlpha().resize(lb.w, lb.h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer()
    const expRaw = await sharp(expected).raw().toBuffer({ resolveWithObject: true })
    const sceneBox = await sharp(scene).extract({ left: lb.x, top: lb.y, width: lb.w, height: lb.h }).removeAlpha().raw().toBuffer()
    let diff = 0, n = 0
    for (let y = 0; y < lb.h; y++) for (let x = 0; x < lb.w; x++) {
      const i = (y * lb.w + x) * 4
      const a = expRaw.data[i + 3] / 255
      for (let c = 0; c < 3; c++) {
        const want = expRaw.data[i + c] * a + sceneBox[(y * lb.w + x) * 3 + c] * (1 - a)
        diff += Math.abs(after.data[((lb.y + y) * after.w + lb.x + x) * 3 + c] - want); n++
      }
    }
    expect(diff / n).toBeLessThan(4) // JPEG-level difference only
    // the Prototipo badge is navy with the teal plane + cream wordmark: those exact colours are present in the output box
    const sample = await sharp(bytes).extract({ left: lb.x, top: lb.y, width: lb.w, height: lb.h }).removeAlpha().raw().toBuffer()
    let teal = 0, cream = 0
    for (let i = 0; i < sample.length; i += 3) { if (sample[i] < 90 && sample[i + 1] > 150 && sample[i + 2] > 140) teal++; if (sample[i] > 225 && sample[i + 1] > 220 && sample[i + 2] > 205) cream++ }
    expect(teal).toBeGreaterThan(8)
    expect(cream).toBeGreaterThan(40)

    // CTA: exact copy text, inside the bottom safe zone, brand palette, contrast >= 4.5
    expect(report.cta.status).toBe('drawn')
    expect(report.cta.text).toBe(CTA)
    const cb = report.cta.box!
    expect(cb.y + cb.h).toBeLessThanOrEqual(Math.round(before.h * (1 - 0.08)))
    expect(cb.y).toBeGreaterThan(before.h * 0.8)
    expect(cb.x).toBeGreaterThan(before.w * 0.05)
    expect(cb.x + cb.w).toBeLessThan(before.w * 0.95)
    expect(report.cta.contrast!).toBeGreaterThanOrEqual(4.5)
    expect(report.cta.fits).toBe(true)
    expect(parseColor(PALETTE.accent)).toBeTruthy()
    expect([PALETTE.accent, PALETTE.primary, PALETTE.secondary].map((c) => c.toLowerCase())).toContain(report.cta.fill)
    const btn = await sharp(bytes).extract({ left: cb.x, top: cb.y, width: cb.w, height: cb.h }).removeAlpha().raw().toBuffer()
    const fillRgb = parseColor(report.cta.fill)!
    const inkRgb = parseColor(report.cta.textColor)!
    let fillPx = 0, inkPx = 0
    for (let i = 0; i < btn.length; i += 3) {
      const px = { r: btn[i], g: btn[i + 1], b: btn[i + 2] }
      if (Math.hypot(px.r - fillRgb.r, px.g - fillRgb.g, px.b - fillRgb.b) < 40) fillPx++
      if (Math.hypot(px.r - inkRgb.r, px.g - inkRgb.g, px.b - inkRgb.b) < 60) inkPx++
    }
    expect(fillPx / (btn.length / 3)).toBeGreaterThan(0.5) // a solid button...
    expect(inkPx / (btn.length / 3)).toBeGreaterThan(0.04) // ...with the label drawn on it
    expect(contrastRatio(fillRgb, inkRgb)).toBeGreaterThanOrEqual(4.5)

    // NO frame, NO blur band, NO shrink: everything outside the layers is the picture as Grok drew it.
    expect(boxDiff(before, after, { x: 0, y: 0, w: before.w, h: Math.round(before.h * 0.08) })).toBeLessThan(3) // top safe band untouched
    expect(boxDiff(before, after, { x: 0, y: Math.round(before.h * 0.2), w: before.w, h: Math.round(before.h * 0.55) })).toBeLessThan(3) // the whole middle (plane, box, headline) untouched
    // the scrim is a smooth gradient (checked on the left strip, away from the button): no row-to-row luminance jump; a hard band would jump
    let maxJump = 0
    for (let y = Math.round(before.h * 0.7); y < before.h - 1; y++) maxJump = Math.max(maxJump, Math.abs(rowLuma(after, y + 1) - rowLuma(after, y)))
    let sceneJump = 0
    for (let y = Math.round(before.h * 0.7); y < before.h - 1; y++) sceneJump = Math.max(sceneJump, Math.abs(rowLuma(before, y + 1) - rowLuma(before, y)))
    expect(maxJump).toBeLessThan(sceneJump + 14)

    // and the QA agrees: safe zones ok, exactly ONE button-like block (the CTA; the logo plate is excluded)
    const qa = await runMcpImageQa({ generatedDataUrl: durl(bytes), requestedRatio: '4:5', copyRequested: true, logoAttached: true, logoExpected: true, copy: `Titular\n${CTA}`, logoBox: { x0: lb.x / after.w, y0: lb.y / after.h, x1: (lb.x + lb.w) / after.w, y1: (lb.y + lb.h) / after.h } })
    expect(qa.safeZones).toBe('ok')
    expect(qa.ctaButtons).toBe(1)
    expect(qa.status).toBe('pass')
  })

  it('9:16 (story): same layers inside the larger IG UI zones, same pixel size', async () => {
    const scene = await sharp(F('proto-scene-no-logo-cta-4x5.jpg')).resize(1080, 1920, { fit: 'cover', position: 'centre' }).jpeg({ quality: 92 }).toBuffer()
    const { bytes, report } = await compositeBrandLayers({ bytes: scene, ratio: '9:16', logo: F('kit-logo-prototipo.png'), ctaText: 'Escribinos por DM', palette: PALETTE })
    const m = await sharp(bytes).metadata()
    expect([m.width, m.height]).toEqual([1080, 1920])
    expect(report.logo.box!.y).toBeGreaterThanOrEqual(Math.round(1920 * 0.14))
    expect(report.cta.box!.y + report.cta.box!.h).toBeLessThanOrEqual(Math.round(1920 * (1 - 0.2)))
    expect(report.cta.text).toBe('Escribinos por DM')
    const qa = await runMcpImageQa({ generatedDataUrl: durl(bytes), requestedRatio: '9:16', copyRequested: true, logoAttached: true, logoExpected: true, copy: 'Titular\nEscribinos por DM' })
    expect(qa.safeZones).toBe('ok')
    expect(freeBands('9:16').top).toBeGreaterThan(freeBands('4:5').top)
  })

  it('missing logo asset: nothing is drawn in its place (no text chip, no brand-name wordmark): the logo area is identical to the scene, logo reported unavailable', async () => {
    const scene = F('proto-scene-no-logo-cta-4x5.jpg')
    const { bytes, report } = await compositeBrandLayers({ bytes: scene, ratio: '4:5', logo: null, ctaText: CTA, palette: PALETTE })
    expect(report.logo.status).toBe('unavailable')
    expect(report.logo.box).toBeUndefined()
    expect(report.cta.status).toBe('drawn') // the CTA is still composited
    const before = await rgb(scene)
    const after = await rgb(bytes)
    expect(boxDiff(before, after, { x: 0, y: 0, w: before.w, h: Math.round(before.h * 0.24) })).toBeLessThan(3) // the whole top (where the badge goes) is untouched
    // a corrupt asset behaves the same: reported, never faked
    const bad = await compositeBrandLayers({ bytes: scene, ratio: '4:5', logo: Buffer.from('not an image'), ctaText: CTA, palette: PALETTE })
    expect(bad.report.logo.status).toBe('unavailable')
    expect(bad.report.logo.reason).toMatch(/logo asset could not be drawn/)
    expect(boxDiff(before, await rgb(bad.bytes), { x: 0, y: 0, w: before.w, h: Math.round(before.h * 0.24) })).toBeLessThan(3)
  })

  it('the badge goes where the picture is calm: over free wall on the right by default, on the left when the model put text there; never over text', async () => {
    const mk = async (x: number) => {
      const bg = await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#15263e' } }).jpeg().toBuffer()
      const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><text x="${x}" y="150" font-size="70" font-family="sans-serif" font-weight="700" fill="#f1ede5">TITULAR GRANDE</text></svg>`)
      return sharp(bg).composite([{ input: text }]).jpeg({ quality: 92 }).toBuffer()
    }
    const logo = F('kit-logo-prototipo.png')
    const right = await compositeBrandLayers({ bytes: await mk(40), ratio: '4:5', logo, palette: PALETTE })
    const rb = right.report.logo.box!
    expect(rb.x + rb.w / 2).toBeGreaterThan(400) // calm wall on the right → default top-right
    expect(rb.y).toBeGreaterThanOrEqual(80)
    const left = await compositeBrandLayers({ bytes: await mk(400), ratio: '4:5', logo, palette: PALETTE })
    const lb = left.report.logo.box!
    expect(lb.x + lb.w).toBeLessThan(420) // text on the right half → badge moves to the free left
    // the logo is never smaller than 4.5 % of the height and never cropped (whole asset)
    expect(lb.h).toBeGreaterThanOrEqual(1000 * 0.04)
  })

  it('no CTA in the copy → no button; a long CTA is shrunk to fit the width; a low-contrast brand colour never yields text below 4.5:1', async () => {
    const scene = F('proto-scene-no-logo-cta-4x5.jpg')
    const none = await compositeBrandLayers({ bytes: scene, ratio: '4:5', logo: F('kit-logo-prototipo.png'), palette: PALETTE })
    expect(none.report.cta.status).toBe('none')
    expect(none.report.scrim).toBeNull()
    const long = await compositeBrandLayers({ bytes: scene, ratio: '4:5', ctaText: 'Escribinos por DM y te armamos la compra de tu primer kit hoy mismo', palette: PALETTE })
    expect(long.report.cta.box!.w).toBeLessThanOrEqual(Math.round(888 * 0.84) + 1)
    const mid = await compositeBrandLayers({ bytes: scene, ratio: '4:5', ctaText: CTA, palette: { accent: '#8a8a8a', primary: '#777777' } })
    expect(mid.report.cta.contrast!).toBeGreaterThanOrEqual(4.5)
  })
})

describe('round 5b: the MCP prompt tells Grok NOT to draw the logo or any button, and to keep the bands free', () => {
  it('compositeLayers rules: free top 10% / bottom 12%, no logo / no button, no CTA block in the layout cap; the legacy rules are unchanged without the flag', () => {
    const on = buildMcpPromptRules('es', { requestedRatio: '4:5', ctaText: CTA, layoutCap: true, compositeLayers: true }, { hasProductRefs: true })
    expect(on).toContain('el 10% superior y el 12% inferior')
    expect(on).toContain('VACÍOS')
    expect(on).toContain('NO dibujes el logo de la marca, ni ningún botón')
    expect(on).toContain('franja del medio')
    expect(on).not.toContain('UN CTA')
    expect(on).not.toContain('UN SOLO CTA')
    expect(on).not.toContain(CTA) // the CTA text is not given to the image model at all
    const story = buildMcpPromptRules('es', { requestedRatio: '9:16', compositeLayers: true }, { hasProductRefs: false })
    expect(story).toContain('16% superior')
    expect(story).toContain('22% inferior')
    const off = buildMcpPromptRules('es', { requestedRatio: '4:5', ctaText: CTA, layoutCap: true }, { hasProductRefs: true })
    expect(off).toContain('UN SOLO CTA')
    expect(off).toContain(`«${CTA}»`)
    const en = buildMcpPromptRules('en', { requestedRatio: '4:5', compositeLayers: true }, { hasProductRefs: false })
    expect(en).toContain('do NOT draw the brand logo, nor any button')
  })
})
