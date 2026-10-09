/**
 * P0 #1 — logos: self-contained badges are never recolored (no white rectangle), background
 * removal is an edge-connected flood only (interior pixels identical), kit variants are honoured.
 * Synthetic logos only (no real brands).
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { chooseKitLogo, edgeFloodBackground, pickLogoVariant, prepareLogo } from '../../api/lib/adpack/render/logo'
import { renderAd } from '../../api/lib/adpack/render'
import { goodSerumCopy } from './helpers'
import { navyBadgePng, offWhiteBadgeJpeg } from './v3-fixtures'

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)

/** Text-like wordmark: separate thin strokes (opaque share well under 85%). */
const wordmark = (c: string) => [0, 1, 2, 3, 4].map((i) => `<rect x="${10 + i * 58}" y="20" width="14" height="60" fill="${c}"/><rect x="${10 + i * 58}" y="44" width="44" height="10" fill="${c}"/>`).join('')

const plain = (w: number, h: number, color: string) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer()

async function logoRegion(png: Buffer, box: { x: number; y: number; w: number; h: number }) {
  return sharp(png).extract({ left: box.x, top: box.y, width: box.w, height: box.h }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
}

function stdDev(data: Buffer): number {
  let s = 0
  let s2 = 0
  const n = data.length
  for (let i = 0; i < n; i++) {
    s += data[i]
    s2 += data[i] * data[i]
  }
  return Math.sqrt(s2 / n - (s / n) ** 2)
}

describe('P0 #1 logo: self-contained badges are never recolored', () => {
  it('a navy badge is self-contained: no monochrome variant; dark bg → light chip, light bg → as-is', async () => {
    const v = await prepareLogo(await navyBadgePng())
    expect(v.selfContained).toBe(true)
    expect(v.opaqueShare).toBeGreaterThan(0.85)
    expect(v.onDark).toBeNull()
    const dark = pickLogoVariant(v, 0.01)
    expect(dark.variant).toBe('badge')
    expect(dark.chip).toEqual({ r: 255, g: 255, b: 255 })
    expect(dark.layer).toBe(v.onLight)
    const light = pickLogoVariant(v, 0.92)
    expect(light.variant).toBe('onLight')
    expect(light.selfContained).toBe(true)
  })

  for (const [name, bg] of [['dark', '#101418'], ['light', '#f2efe8']] as const) {
    it(`renders readable on a ${name} ad background — never a solid white rectangle`, async () => {
      const res = await renderAd({ format: 'handheld_overlay', ratio: '1:1', sceneImage: await plain(1080, 1080, bg), copy: goodSerumCopy(), visual: { primaryColor: '#0f766e' }, logo: await navyBadgePng(), language: 'es' })
      const lb = res.layoutReport.logo!
      expect(lb).toBeTruthy()
      expect(res.layoutReport.logoSelfContained).toBe(true)
      expect(res.layoutReport.logoContrast).toBeGreaterThanOrEqual(3)
      const { data } = await logoRegion(res.png, lb)
      // Navy badge + white marks: strong variance inside the logo box (a white box would be ~0).
      expect(stdDev(data)).toBeGreaterThan(40)
      let navy = 0
      for (let i = 0; i < data.length; i += 3) if (data[i + 2] > data[i] + 30 && data[i] < 60) navy++
      expect(navy / (data.length / 3)).toBeGreaterThan(0.3)
    })
  }
})

describe('P0 #1 logo cleanup: edge-connected flood only', () => {
  it('off-white background removed from the border only; off-white text, inner border and dots inside the badge stay identical', async () => {
    const src = await offWhiteBadgeJpeg()
    const res = await edgeFloodBackground(src)
    expect(res && 'png' in res).toBe(true)
    if (!res || !('png' in res)) return
    expect(res.removedPct).toBeGreaterThan(0.4)
    expect(res.removedPct).toBeLessThan(0.65)
    const out = await sharp(res.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const orig = await sharp(src).ensureAlpha().raw().toBuffer()
    const at = (x: number, y: number) => (y * out.info.width + x) * 4
    // Corner removed.
    expect(out.data[at(5, 5) + 3]).toBe(0)
    // Interior off-white "text", inner border and a dot: opaque and bit-identical to the source.
    for (const [x, y] of [[300, 172], [300, 225], [200, 268], [94, 200], [300, 104]]) {
      const i = at(x, y)
      expect(out.data[i + 3], `alpha at ${x},${y}`).toBe(255)
      for (let c = 0; c < 3; c++) expect(out.data[i + c]).toBe(orig[i + c])
    }
    const v = await prepareLogo(src)
    expect(v.method).toBe('edge_flood')
    expect(v.selfContained).toBe(true)
    expect(v.removedPct).toBeGreaterThan(0.4)
    expect(v.warnings.join(' ')).toMatch(/se removió el \d+% de los píxeles/)
  })

  it('refuses (keeps the original + warning) when the flood would eat most of the logo itself', async () => {
    // Thin outline logo: the background leaks inside through a gap → > 60% of its own bbox.
    const body = '<rect width="400" height="400" fill="#ffffff"/><path d="M60 60 H340 V340 H60 Z M64 64 V336 H336 V64 H200 V60" fill="#1e3a8a"/>'
    const src = await sharp(svg(400, 400, body)).jpeg({ quality: 95 }).toBuffer()
    const res = await edgeFloodBackground(src)
    expect(res && 'reason' in res && res.reason).toBe('too_much_removed')
    const v = await prepareLogo(src)
    expect(v.method).toBe('as_is')
    expect(v.backgroundRemoved).toBe(false)
    expect(v.warnings.join(' ')).toMatch(/no se removió el fondo/)
  })
})

describe('P0 #1 kit logo variants', () => {
  it('honours kit variants: the light variant on dark, the primary on light, a badge on a chip when nothing reads', async () => {
    const darkWordmark = await sharp(svg(300, 100, wordmark('#111827'))).png().toBuffer()
    const lightWordmark = await sharp(svg(300, 100, wordmark('#f9fafb'))).png().toBuffer()
    const primary = await prepareLogo(darkWordmark)
    const lightV = await prepareLogo(lightWordmark)
    const badge = await prepareLogo(await navyBadgePng(), { badge: true })
    const kit = [{ kind: 'primary' as const, variants: primary }, { kind: 'light' as const, variants: lightV }, { kind: 'badge' as const, variants: badge }]
    expect(chooseKitLogo(kit, 0.01)?.kind).toBe('light')
    expect(chooseKitLogo(kit, 0.95)?.kind).toBe('primary')
    // Mid-gray background where neither wordmark reads but the badge on its chip does.
    const mid = chooseKitLogo([{ kind: 'primary', variants: { ...primary, onDark: null } }, { kind: 'badge', variants: badge }], 0.12)
    expect(mid?.kind).toBe('badge')
  })

  it('renderer uses dna.visual.logoVariants (data URLs) and reports the source', async () => {
    const darkWordmark = await sharp(svg(300, 100, wordmark('#111827'))).png().toBuffer()
    const lightWordmark = await sharp(svg(300, 100, wordmark('#f9fafb'))).png().toBuffer()
    const url = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`
    const res = await renderAd({
      format: 'handheld_overlay',
      ratio: '1:1',
      sceneImage: await plain(1080, 1080, '#0b0d10'),
      copy: goodSerumCopy(),
      visual: { logoUrl: url(darkWordmark), logoVariants: [{ url: url(darkWordmark), variant: 'primary' }, { url: url(lightWordmark), variant: 'light' }] },
      language: 'es',
    })
    expect(res.layoutReport.logoSource).toBe('light')
    expect(res.layoutReport.logoVariant).toBe('onLight')
  })
})
