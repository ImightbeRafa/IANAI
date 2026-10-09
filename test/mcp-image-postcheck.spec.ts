import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { checkGeneratedProductFidelity, checkSafeZones, findSeparatorLines, runMcpImageQa, tidyCopySeparators } from '../api/lib/mcp/image-postcheck'

/**
 * Round-2 raw outputs of the live 2a7a2d4 flow (downscaled to 640 px) are the fixtures:
 *  - proto-ref / proto-gen : Prototipo hero photo vs the generated ad — the plane was REDRAWN (wing fold, landing gear, tail wheel);
 *  - forge-ref / forge-gen : ForgeCR product photo vs the generated ad — visually faithful (the old global-silhouette check
 *    gave a false positive here).
 * Synthetic faithful / changed variants are built from the same Prototipo photo so the thresholds are exercised both ways.
 */
const F = (name: string) => readFileSync(new URL(`./fixtures/round3/${name}`, import.meta.url))
const url = (b: Buffer, mime = 'image/jpeg') => `data:${mime};base64,${b.toString('base64')}`

/** Product cut out of the studio photo by its difference to the (cream) backdrop. */
async function cutout(ref: Buffer, erase?: { x0: number; y0: number; x1: number; y1: number }): Promise<{ png: Buffer; w: number; h: number }> {
  const { data, info } = await sharp(ref).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const bg = [0, 1, 2].map((c) => (data[c] + data[(w - 1) * 4 + c] + data[(h - 1) * w * 4 + c]) / 3)
  for (let i = 0; i < w * h; i++) {
    const d = Math.max(...[0, 1, 2].map((c) => Math.abs(data[i * 4 + c] - bg[c])))
    data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(((d - 7) / 9) * 255)))
    const x = (i % w) / w
    const y = Math.floor(i / w) / h
    if (erase && x >= erase.x0 && x <= erase.x1 && y >= erase.y0 && y <= erase.y1) data[i * 4 + 3] = 0
  }
  const png = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
  return { png, w, h }
}

/** The cutout (re-lit, slightly softened) placed on the Forge scene, i.e. a product-lock result with the product intact. */
async function placedOnScene(erase?: { x0: number; y0: number; x1: number; y1: number }): Promise<Buffer> {
  const { png, w, h } = await cutout(F('proto-ref.jpg'), erase)
  const scaledW = Math.round(w * 0.85)
  const prod = await sharp(png).resize({ width: scaledW }).modulate({ brightness: 0.88 }).blur(0.5).png().toBuffer()
  const noise = Buffer.alloc(640 * 800 * 3)
  for (let i = 0; i < noise.length; i++) noise[i] = 70 + (((i * 2654435761) >>> 0) >>> 27) * 4
  const scene = await sharp(noise, { raw: { width: 640, height: 800, channels: 3 } }).blur(10).tint({ r: 140, g: 95, b: 60 }).jpeg().toBuffer()
  return sharp(scene).composite([{ input: prod, left: 60, top: 200 }]).jpeg({ quality: 88 }).toBuffer()

}

describe('fidelity post-check — masked product-region comparison (free, local, warning only)', () => {
  it('Round-2 Prototipo redraw (wing fold / landing gear / tail wheel changed) warns, with a reason and score', async () => {
    const res = await checkGeneratedProductFidelity({ referenceDataUrls: [url(F('proto-ref.jpg'))], generatedDataUrl: url(F('proto-gen.jpg')) })
    expect(res.status).toBe('warning')
    if (res.status !== 'warning') return
    expect(res.warning.code).toBe('fidelity_warning')
    expect(res.warning.reason).toMatch(/details differ|redrawn/)
    expect(res.warning.details.method).toBe('features')
    expect(res.warning.details.confident).toBe(true)
    expect(res.warning.details.preserved).toBeLessThan(0.75)
    expect(res.warning.score).toBeLessThan(0.75)
  })

  it('Round-2 ForgeCR faithful output does NOT warn (the old global-silhouette false positive is gone)', async () => {
    const res = await checkGeneratedProductFidelity({ referenceDataUrls: [url(F('forge-ref.jpg'))], generatedDataUrl: url(F('forge-gen.jpg')) })
    expect(res.status).not.toBe('warning')
    // Dark, low-texture product: not locatable by features → honest "unverified" (colour consistent), never a false verdict.
    expect(['ok', 'unverified']).toContain(res.status)
  })

  it('a product that is intact but re-lit and placed in a new scene passes (ok)', async () => {
    const gen = await placedOnScene()
    const res = await checkGeneratedProductFidelity({ referenceDataUrls: [url(F('proto-ref.jpg'))], generatedDataUrl: url(gen) })
    expect(res.status).toBe('ok')
    if (res.status === 'ok') expect(res.details.preserved).toBeGreaterThan(0.8)
  })

  it('the same product with a part removed (landing gear erased) warns', async () => {
    const gen = await placedOnScene({ x0: 0.44, y0: 0.62, x1: 0.78, y1: 0.95 })
    const res = await checkGeneratedProductFidelity({ referenceDataUrls: [url(F('proto-ref.jpg'))], generatedDataUrl: url(gen) })
    expect(res.status).toBe('warning')
  })

  it('an unrelated image does not produce a shape verdict (unverified, no score)', async () => {
    const res = await checkGeneratedProductFidelity({ referenceDataUrls: [url(F('proto-ref.jpg'))], generatedDataUrl: url(F('forge-gen.jpg')) })
    expect(res.status).toBe('unverified')
    expect(res).not.toHaveProperty('score')
  })

  it('a changed colour still warns when the product is not locatable', async () => {
    const ref = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#ffffff' } })
      .composite([{ input: await sharp({ create: { width: 140, height: 200, channels: 3, background: '#c0392b' } }).png().toBuffer(), left: 130, top: 100 }]).png().toBuffer()
    const gen = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#6b7a5c' } })
      .composite([{ input: await sharp({ create: { width: 80, height: 110, channels: 3, background: '#2e9e4f' } }).png().toBuffer(), left: 90, top: 150 }]).jpeg().toBuffer()
    const res = await checkGeneratedProductFidelity({ referenceDataUrls: [url(ref, 'image/png')], generatedDataUrl: url(gen) })
    expect(res.status).toBe('warning')
    if (res.status === 'warning') expect(res.warning.reason).toMatch(/colour/)
  })
})

describe('safety-net QA — safe zones, ratio, logo, separators', () => {
  async function ad(buttonBottomGap: number): Promise<Buffer> {
    // Photo-like noisy scene 800×1000 (4:5) with a header text strip and a CTA button whose bottom edge is `gap` px above the edge.
    const noise = Buffer.alloc(800 * 1000 * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = 90 + ((i * 2654435761) >>> 28) * 3
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect x="250" y="${1000 - buttonBottomGap - 90}" width="300" height="90" rx="14" fill="#2ec4b6"/><text x="400" y="${1000 - buttonBottomGap - 32}" font-size="38" font-family="sans-serif" text-anchor="middle" fill="#0b1a2a">Escribinos por DM</text><text x="60" y="250" font-size="64" font-family="sans-serif" fill="#ffffff">Un regalo que armas</text></svg>`)
    return sharp(noise, { raw: { width: 800, height: 1000, channels: 3 } }).blur(14).composite([{ input: label }]).jpeg({ quality: 90 }).toBuffer()
  }

  it('flags a CTA button touching the bottom edge and passes one with air', async () => {
    const touching = await checkSafeZones(await ad(6), '4:5')
    expect(touching.some((i) => i.edge === 'bottom')).toBe(true)
    const clean = await checkSafeZones(await ad(190), '4:5')
    expect(clean).toEqual([])
  })

  it('runMcpImageQa reports safeZones violation → status fail; clean → ok/pass', async () => {
    const bad = await runMcpImageQa({ generatedDataUrl: url(await ad(6)), requestedRatio: '4:5', copyRequested: true, logoAttached: true, logoExpected: true })
    expect(bad.safeZones).toBe('violation')
    expect(bad.safeZoneIssues.length).toBeGreaterThan(0)
    expect(bad.status).toBe('fail')
    const good = await runMcpImageQa({ generatedDataUrl: url(await ad(190)), requestedRatio: '4:5', copyRequested: true, logoAttached: true, logoExpected: true })
    expect(good.safeZones).toBe('ok')
    expect(good.status).toBe('pass')
  })

  it('9:16 uses the taller Instagram UI margins', async () => {
    const m = await import('../api/lib/mcp/safe-zones')
    expect(m.safeZoneMargins('9:16').bottom).toBeGreaterThan(m.safeZoneMargins('4:5').bottom)
    expect(m.safeZoneMargins('9:16').top).toBeGreaterThan(m.safeZoneMargins('4:5').top)
  })

  it('flags copy lines that start or end with a separator (the orphan "·")', () => {
    const copy = 'Un regalo que armás con papel\nPapel y 3 pilas AA no incluidos ·\nDesde 8 años\n· suelto'
    const lines = findSeparatorLines(copy)
    expect(lines).toEqual([
      { line: 2, text: 'Papel y 3 pilas AA no incluidos ·', where: 'end' },
      { line: 4, text: '· suelto', where: 'start' },
    ])
    expect(findSeparatorLines('₡14.900 · 2 kits por ₡29.800')).toEqual([])
  })

  it('tidyCopySeparators splits a long "a · b" line so no "·" can be orphaned, and drops stray separators', () => {
    const t = tidyCopySeparators('Un regalo\nPapel y 3 pilas AA no incluidos · Desde 8 años con supervisión de un adulto\n₡14.900 · 2 kits por ₡29.800\nFin ·')
    expect(t.copy.split('\n')).toEqual(['Un regalo', 'Papel y 3 pilas AA no incluidos', 'Desde 8 años con supervisión de un adulto', '₡14.900 · 2 kits por ₡29.800', 'Fin'])
    expect(t.changes.length).toBe(2)
  })

  it('a wrong ratio and a missing logo still warn, and QA never throws', async () => {
    const gen = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#789' } }).jpeg().toBuffer()
    const qa = await runMcpImageQa({ generatedDataUrl: url(gen), requestedRatio: '9:16', copyRequested: false, logoAttached: false, logoExpected: true })
    expect(qa.ratioOk).toBe(false)
    expect(qa.logo).toBe('none')
    expect(qa.warnings.length).toBeGreaterThanOrEqual(2)
  })
})
