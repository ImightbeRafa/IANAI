/**
 * Round 12 (MCP 0.25.0):
 *  1. mask repair adds back only regions connected to the product; leftover backdrop pockets are cut (A plane)
 *  2. exact plate: strict props in the plate prompt
 *  3. CTA blocked → the picture shrinks down to 60 %
 *  4. asset role from the role column / tags / label (0.26.0: not from the request text)
 *  5. fidelity vs the photo survives the cut-out cache (PNG metadata), also for a flat lay (SP)
 *  6. the bundle offer line stays on the image; a framed badge logo is self-plated
 */
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { segmentProduct } from '../api/lib/adpack/fidelity/segment'
import { LEFTOVER_BG_MAX, SPAN_FILL_MIN_MISSED } from '../api/lib/adpack/fidelity/mask-coverage'
import { readCutoutMeta, writeCutoutMeta } from '../api/lib/adpack/fidelity/cutout-meta'
import { inferAssetRole } from '../api/lib/adpack/fidelity/photos'
import { buildPlatePrompt } from '../api/lib/adpack/fidelity/plate'
import { capCopyBlocks } from '../api/lib/mcp/copy-layout'
import { EXTEND_CTA_MIN } from '../api/lib/mcp/compose-scene'
import { layoutAdLayers, splitCopyBlocks } from '../api/lib/mcp/layout-ad'
import { MCP_VERSION } from '../api/lib/mcp/server-info'

vi.setConfig({ testTimeout: 90_000 })
const fx = (p: string) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url))
const dna = { version: 1, brandName: 'B', category: 'other', language: 'es', register: 'voseo', facts: [], visual: {}, gaps: [], sources: [] } as never

describe('round 12 — 0.25.0', () => {
  it('version', () => expect(MCP_VERSION).toBe('0.26.0'))

  it('A plane (frame product, light wall): no backdrop patches added between the legs; leftover backdrop ≤ 1.5 %', async () => {
    const r = await segmentProduct({ bytes: fx('round7/hero998.jpg'), role: 'front' as never })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.backgroundLeak ?? 0).toBeLessThanOrEqual(LEFTOVER_BG_MAX)
    expect(r.maskCoverage?.repaired ?? false).toBe(false)
    // the frame stays open: the cut-out is far from a filled rectangle
    const { data, info } = await sharp(r.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let opaque = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 128) opaque++
    expect(opaque / (info.width * info.height)).toBeLessThan(0.6)
  })

  it('PH pouch: the large light-panel miss is still repaired (span fill only above 25 %), IoU vs the photo ≥ 0.97', async () => {
    expect(SPAN_FILL_MIN_MISSED).toBe(0.25)
    const r = await segmentProduct({ bytes: fx('round11/ph-energy.jpg'), role: 'front' as never })
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.maskCoverage?.repaired).toBe(true); expect(r.photoIoU!).toBeGreaterThanOrEqual(0.97) }
  })

  it('SP flat lay: fidelity is measured vs the photo too (photoIoU present)', async () => {
    const r = await segmentProduct({ bytes: fx('round11/sp-sleep02.jpg'), role: 'front' as never, allowMulti: true } as never)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.photoIoU!).toBeGreaterThan(0.9)
  })

  it('cut-out metadata rides inside the PNG (cache hit keeps photoIoU / maskRepaired) and the PNG still decodes', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer()
    const tagged = writeCutoutMeta(png, { photoIoU: 0.9971, maskRepaired: true })
    expect(readCutoutMeta(tagged)).toEqual({ photoIoU: 0.9971, maskRepaired: true })
    expect(readCutoutMeta(writeCutoutMeta(tagged, { photoIoU: 0.5 }))).toEqual({ photoIoU: 0.5 })
    expect((await sharp(tagged).metadata()).width).toBe(8)
    expect(readCutoutMeta(png)).toBeNull()
  })

  it('asset role: role column / free tags / label (0.26.0: never from the request text)', () => {
    expect(inferAssetRole({ role: 'control negro tipo gamepad' })).toBe('part')
    expect(inferAssetRole({ tags: ['controller'] })).toBe('part')
    expect(inferAssetRole({ label: 'Mando' })).toBe('part')
    expect(inferAssetRole({ tags: ['caja'] })).toBe('box')
    expect(inferAssetRole({ isPrimary: true })).toBe('hero')
    expect(inferAssetRole({})).toBeUndefined()
  })

  it('exact plate with a strict lock: no plants / fabric as ambient props', () => {
    const base = { format: 'offer_graphic' as const, dna, offer: { name: 'Kit', facts: [], productImageUrls: [] }, placement: { x0: 0.2, y0: 0.4, x1: 0.8, y1: 0.85 }, light: 'left' as const, allowedProps: ['lámpara de escritorio'] }
    const strict = buildPlatePrompt({ ...base, strictProps: true })
    expect(strict).toMatch(/lámpara de escritorio/)
    expect(strict).not.toMatch(/: table, plants, fabric/)
    expect(strict).toMatch(/no plants/)
    expect(buildPlatePrompt(base)).toMatch(/plants/)
  })

  it('the CTA may shrink the picture down to 60 %', () => expect(EXTEND_CTA_MIN).toBe(0.6))

  it('A copy: "2 kits por ₡29.800" stays on the image (the shipping note goes to the caption)', () => {
    const c = capCopyBlocks('Tu escritorio, ahora con un hangar\n₡14.900 el kit\nEnvío gratis llevando 2 kits o más\nEscribinos por DM\n2 kits por ₡29.800\nDesde 8 años con supervisión de un adulto\nPapel y 3 pilas AA no incluidos')
    expect(c.onImage).toContain('2 kits por ₡29.800')
    expect(c.overflow).toContain('Envío gratis llevando 2 kits o más')
  })

  it('the framed Prototipo badge (transparent rounded corners, thin frame line) is self-plated: no second plate', async () => {
    const out = await layoutAdLayers({ bytes: fx('round7/scene-A.jpg'), ratio: '4:5', blocks: splitCopyBlocks('Hola\n₡1\nEscribinos por DM', 'Escribinos por DM'), logo: fx('round5b/kit-logo-prototipo.png'), palette: { primary: '#15263E', secondary: '#F1EDE5', accent: '#2EC4B6' }, avoid: [] })
    expect(out.report.logo.selfPlated).toBeTruthy()
    expect(out.report.logo.plate).toBeFalsy()
  })
})
