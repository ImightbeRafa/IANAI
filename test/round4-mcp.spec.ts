import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { capCopyBlocks, findCtaLine } from '../api/lib/mcp/copy-layout'
import { generateExactWebStyleAd, mapCopyToRenderFields } from '../api/lib/mcp/exact-flow'
import { checkExtraObjects } from '../api/lib/mcp/extra-objects'
import { countCtaButtons, qaSeverity, runMcpImageQa } from '../api/lib/mcp/image-postcheck'
import { isTransientProviderError, withProviderRetry } from '../api/lib/mcp/provider-retry'
import { measureHalo, HALO_LIMITS } from '../api/lib/adpack/fidelity/halo'
import type { ExactImageResult } from '../api/lib/adpack/fidelity/pipeline'
import { MCP_SERVER_INFO, MCP_VERSION, buildServerInfo } from '../api/lib/mcp/server-info'

const F = (name: string) => readFileSync(new URL(`./fixtures/round3/${name}`, import.meta.url))
const durl = (b: Buffer, mime = 'image/jpeg') => `data:${mime};base64,${b.toString('base64')}`

describe('provider retry (capacity / 5xx) with exponential backoff', () => {
  it('classifies transient errors', () => {
    expect(isTransientProviderError(new Error('The service is temporarily at capacity. Please retry your request shortly.'))).toBe(true)
    expect(isTransientProviderError(Object.assign(new Error('boom'), { status: 502 }))).toBe(true)
    expect(isTransientProviderError(Object.assign(new Error('bad'), { status: 400 }))).toBe(false)
    expect(isTransientProviderError(new Error('invalid image'))).toBe(false)
  })
  it('waits 2s, 4s, 8s (exponential), then gives up; non-transient errors fail at once', async () => {
    const waits: number[] = []
    let calls = 0
    await expect(withProviderRetry(async () => { calls++; throw new Error('temporarily at capacity') }, { baseMs: 2000, sleep: async (ms) => { waits.push(ms) } })).rejects.toThrow(/capacity/)
    expect(calls).toBe(4)
    expect(waits).toEqual([2000, 4000, 8000])
    calls = 0
    await expect(withProviderRetry(async () => { calls++; throw new Error('invalid') })).rejects.toThrow('invalid')
    expect(calls).toBe(1)
    const ok = await withProviderRetry(async (n) => { if (n < 3) throw new Error('503 service unavailable'); return 'fine' }, { baseMs: 0 })
    expect(ok.value).toBe('fine')
    expect(ok.trace.retries).toHaveLength(2)
  })
})

describe('copy layout cap', () => {
  const long = ['Un regalo que armás con papel', 'Kit HM939 con control 2.4GHz', '₡14.900', '2 kits por ₡29.800', 'Envío gratis llevando 2 kits o más', 'Papel y 3 pilas AA no incluidos', 'Escribinos por DM'].join('\n')
  it('keeps headline + ONE price + ONE facts + ONE CTA, in the original order; overflow is returned', () => {
    const r = capCopyBlocks(long)
    expect(r.capped).toBe(true)
    expect(r.onImage.split('\n')).toEqual(['Un regalo que armás con papel', 'Kit HM939 con control 2.4GHz', '₡14.900', 'Escribinos por DM'])
    expect(r.overflow).toEqual(['2 kits por ₡29.800', 'Envío gratis llevando 2 kits o más', 'Papel y 3 pilas AA no incluidos'])
    expect(r.cta).toBe('Escribinos por DM')
  })
  it('a short copy is untouched', () => {
    const r = capCopyBlocks('Hola\n₡9.900\nEscribinos por DM')
    expect(r.capped).toBe(false)
    expect(findCtaLine(['Hola', 'Escribinos por DM'])).toBe('Escribinos por DM')
  })
  it('maps to renderer fields (one price line, one facts line, one CTA)', () => {
    const f = mapCopyToRenderFields('Un regalo\nKit con control\n₡14.900\nEscribinos por DM', 'Escribinos por DM')
    expect(f).toMatchObject({ headline: 'Un regalo', subline: 'Kit con control', offerLine: '₡14.900', cta: 'Escribinos por DM', overflow: [] })
  })
})

describe('QA: extra CTA risk, severity', () => {
  async function withButtons(n: number): Promise<Buffer> {
    const noise = Buffer.alloc(800 * 1000 * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = 90 + ((i * 2654435761) >>> 28) * 3
    const btn = (y: number, c: string, t: string) => `<rect x="250" y="${y}" width="300" height="84" rx="16" fill="${c}"/><text x="400" y="${y + 54}" font-size="34" font-family="sans-serif" text-anchor="middle" fill="#0b1a2a">${t}</text>`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">${btn(780, '#2ec4b6', 'Escribinos por DM')}${n > 1 ? btn(630, '#f4b400', 'Pedí acá') : ''}</svg>`
    return sharp(noise, { raw: { width: 800, height: 1000, channels: 3 } }).blur(14).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 90 }).toBuffer()
  }
  it('one button = no risk; two buttons (an invented "Pedí acá") = extraCtaRisk + status fail + higher severity', async () => {
    const one = await runMcpImageQa({ generatedDataUrl: durl(await withButtons(1)), requestedRatio: '4:5', copyRequested: true, logoAttached: true, logoExpected: true })
    const two = await runMcpImageQa({ generatedDataUrl: durl(await withButtons(2)), requestedRatio: '4:5', copyRequested: true, logoAttached: true, logoExpected: true })
    expect(await countCtaButtons(await withButtons(1))).toBe(1)
    expect(one.extraCtaRisk).toBe(false)
    expect(two.ctaButtons).toBe(2)
    expect(two.extraCtaRisk).toBe(true)
    expect(two.status).toBe('fail')
    expect(two.severity).toBeGreaterThan(one.severity)
    expect(two.warnings.join(' ')).toMatch(/second button/)
  })
  it('severity weights: edge-touching CTA > band text > clean', () => {
    const base = { textPresent: 'yes' as const, separatorLines: [], ctaButtons: 1 }
    expect(qaSeverity({ ...base, safeZoneIssues: [] })).toBe(0)
    expect(qaSeverity({ ...base, safeZoneIssues: [{ edge: 'bottom', kind: 'block_touches_edge', detail: '', amount: 1 }] })).toBeGreaterThan(qaSeverity({ ...base, safeZoneIssues: [{ edge: 'top', kind: 'text_in_unsafe_band', detail: '', amount: 0.05 }] }))
  })
})

describe('props not in the references (colour novelty, warning only)', () => {
  async function scene(extra: string): Promise<Buffer> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#8a6a4a"/><rect x="120" y="150" width="160" height="200" rx="10" fill="#e8e8e8"/>${extra}</svg>`
    return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer()
  }
  const refPhoto = async () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#ffffff"/><rect x="70" y="60" width="160" height="180" rx="10" fill="#e8e8e8"/></svg>')).jpeg().toBuffer()
  it('flags a vivid object that no reference explains, not a scene with only the product', async () => {
    const clean = await checkExtraObjects({ generated: await scene(''), references: [await refPhoto()], productBox: { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 }, allowedCount: 0 })
    expect(clean.suspected).toBe(false)
    const blue = await checkExtraObjects({ generated: await scene('<rect x="40" y="380" width="90" height="40" rx="8" fill="#1e63d6"/>'), references: [await refPhoto()], productBox: { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 }, allowedCount: 0 })
    expect(blue.suspected).toBe(true)
    expect(blue.clusters[0].hue).toMatch(/blue/)
    // the same blue object IS in a reference (a real accessory photo) → explained
    const accessory = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#fff"/><rect x="40" y="70" width="120" height="60" fill="#1e63d6"/></svg>')).jpeg().toBuffer()
    const explained = await checkExtraObjects({ generated: await scene('<rect x="40" y="380" width="90" height="40" rx="8" fill="#1e63d6"/>'), references: [await refPhoto(), accessory], productBox: { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 }, allowedCount: 0 })
    expect(explained.suspected).toBe(false)
  })
  it('real Round-2 image with the invented kraft box is flagged; the faithful Round-3 pouch is not', async () => {
    const r2 = await checkExtraObjects({ generated: F('proto-gen.jpg'), references: [F('proto-ref.jpg')], allowedCount: 0 })
    expect(r2.suspected).toBe(true)
    const pouch = await checkExtraObjects({ generated: F('patch-gen.jpg'), references: [F('patch-ref.jpg')], allowedCount: 0 })
    expect(pouch.suspected).toBe(false)
  })
})

describe('halo / leftover-background detector (exact mode)', () => {
  async function build(fringe: boolean) {
    const W = 600
    const H = 700
    const plate = await sharp({ create: { width: W, height: H, channels: 3, background: '#7a5a3c' } }).png().toBuffer()
    const prod = '<ellipse cx="200" cy="120" rx="180" ry="100" fill="#2b2b33"/>'
    const placed = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240">${prod}</svg>`)).png().toBuffer()
    const ring = fringe ? '<ellipse cx="200" cy="120" rx="196" ry="116" fill="none" stroke="#d8d4cc" stroke-width="12"/>' : ''
    const compSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240">${ring}${prod}</svg>`
    const composite = await sharp(plate).composite([{ input: Buffer.from(compSvg), left: 100, top: 300 }]).png().toBuffer()
    const background = await sharp(plate).extract({ left: 100, top: 300, width: 400, height: 240 }).png().toBuffer()
    return { composite, placed, background, box: { x: 100, y: 300, w: 400, h: 240 } }
  }
  it('a clean composite is not flagged; a pale fringe around the product is', async () => {
    const clean = await build(false)
    const r1 = await measureHalo({ ...clean, leak: 0 })
    expect(r1.flagged).toBe(false)
    expect(r1.haze).toBeLessThan(HALO_LIMITS.haze)
    const bad = await build(true)
    const r2 = await measureHalo({ ...bad, leak: 0 })
    expect(r2.haze).toBeGreaterThan(HALO_LIMITS.haze)
    expect(r2.flagged).toBe(true)
  })
  it('the leftover-backdrop share from the segmenter flags a cut-out the old 0.965 score passed (Prototipo: 2.6 %)', async () => {
    const clean = await build(false)
    const r = await measureHalo({ ...clean, leak: 0.026 })
    expect(r.flagged).toBe(true)
    expect(r.reasons.join(' ')).toMatch(/leftover photo backdrop/)
  })
})

describe('exact mode renders the SAME ad layers (copy, one CTA, logo) + QA + halo flags', () => {
  async function fakeExact(leak: number): Promise<ExactImageResult> {
    const W = 1080
    const H = 1350
    const noise = Buffer.alloc(W * H * 3)
    for (let i = 0; i < noise.length; i += 3) { noise[i] = 120 + (((i * 2654435761) >>> 28) * 2); noise[i + 1] = 84; noise[i + 2] = 52 }
    const plate = await sharp(noise, { raw: { width: W, height: H, channels: 3 } }).blur(6).png().toBuffer()
    const raw = await sharp(F('proto-ref.jpg')).resize({ width: 400 }).png().toBuffer()
    const rm = await sharp(raw).metadata()
    const maskSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${rm.width}" height="${rm.height}"><ellipse cx="${(rm.width ?? 0) / 2}" cy="${(rm.height ?? 0) / 2}" rx="${(rm.width ?? 0) / 2 - 2}" ry="${(rm.height ?? 0) / 2 - 2}" fill="#fff"/></svg>`)
    // product pixels only inside the ellipse (no white backdrop left around it = a clean cut-out)
    const prod = await sharp(raw).ensureAlpha().composite([{ input: maskSvg, blend: 'dest-in' }]).png().toBuffer()
    const pm = await sharp(prod).metadata()
    const png = await sharp(plate).composite([{ input: prod, left: 340, top: 760 }]).png().toBuffer()
    const box = { x: 340, y: 760, w: 400, h: pm.height ?? 300 }
    const placed = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}"><ellipse cx="${box.w / 2}" cy="${box.h / 2}" rx="${box.w / 2 - 4}" ry="${box.h / 2 - 4}" fill="#222"/></svg>`)).png().toBuffer()
    const halo = await measureHalo({ composite: png, box, placed, background: await sharp(plate).extract({ left: box.x, top: box.y, width: box.w, height: box.h }).png().toBuffer(), leak })
    return {
      ok: true, png, width: W, height: H, costUsd: 0.04, plateModel: 'grok-imagine', warnings: [],
      fidelity: { score: 0.965, passed: true, method: 'harmonized', ssim: 0.99, deltaE: 3, ratio: '4:5' } as never,
      score: { silhouetteIoU: 0.99, hueShift: 3 } as never,
      cutout: { url: 'x', role: 'hero', method: 'flood', sourceHash: 'h', sourceUrl: 'u' } as never,
      productBox: box, placed, halo,
    }
  }
  const ctx = {
    brand: { id: 'b1', name: 'Prototipo' },
    offers: [{ id: 'o1', name: 'Avión Prototipo', price: '₡14.900' }],
    brandKit: { id: 'k1', name: 'Prototipo', primaryColor: '#0b3d91', accentColor: '#2ec4b6' },
  } as never
  const copy = ['Un regalo que armás con papel', 'Kit HM939 con control 2.4GHz', '₡14.900', 'Envío gratis llevando 2 kits o más', 'Escribinos por DM'].join('\n')

  it('draws the copy with ONE CTA over the real-pixel composite, runs QA, moves overflow to the caption; fails nothing', async () => {
    const out = await generateExactWebStyleAd({ exact: {} as never, ctx, offerId: 'o1', copy, ratio: '4:5', language: 'es', exactRunner: async () => fakeExact(0) })
    expect(out.imageDataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(out.copyOnImage).toMatchObject({ headline: 'Un regalo que armás con papel', offerLine: '₡14.900', cta: 'Escribinos por DM' })
    expect(out.copyOverflow).toEqual(['Envío gratis llevando 2 kits o más'])
    expect(out.qa.textPresent).toBe('yes')
    expect(out.qa.safeZones).not.toBe('not_checked')
    expect(out.layout.allTextFits).toBe(true)
    expect(out.layout.textOverProduct).toBe(false)
    expect(out.halo_warning).toBeUndefined()
    expect(out.fidelity).toMatchObject({ score: 0.965 })
    // the text layer really changed the image (not the bare plate+product)
    const bare = await (await fakeExact(0) as Extract<ExactImageResult, { ok: true }>).png
    const a = await sharp(bare).resize(120, 150).raw().toBuffer()
    const b = await sharp(Buffer.from(out.imageDataUrl.split(',')[1], 'base64')).resize(120, 150).raw().toBuffer()
    let diff = 0
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i])
    expect(diff / a.length).toBeGreaterThan(1)
  })

  it('a haloed cut-out (leak 2.6 %) is flagged halo_warning even though the fidelity score passed 0.965', async () => {
    const out = await generateExactWebStyleAd({ exact: {} as never, ctx, offerId: 'o1', copy, ratio: '4:5', language: 'es', exactRunner: async () => fakeExact(0.026) })
    expect(out.halo.flagged).toBe(true)
    expect(out.halo_warning).toMatchObject({ code: 'halo_warning', leak: 0.026 })
    expect(out.halo_warning?.reason).toMatch(/halo|leftover/)
    expect((out.fidelity as { score: number }).score).toBe(0.965)
  })

  it('capacity errors from the plate step are retried inside the job and never surface', async () => {
    let n = 0
    const out = await generateExactWebStyleAd({
      exact: {} as never, ctx, offerId: 'o1', copy, ratio: '4:5', language: 'es',
      exactRunner: async () => {
        if (n++ < 2) return { ok: false, error: 'scene_failed', costUsd: 0, warnings: ['plate attempt 1 failed: The service is temporarily at capacity. Please retry your request shortly.'] }
        return fakeExact(0)
      },
    })
    expect(n).toBe(3)
    expect(out.providerRetries).toBe(2)
  })
})

describe('server info (version visible in a tool response)', () => {
  it('reports the MCP version, build commit when known, and the feature list', () => {
    const info = buildServerInfo({ commit: 'abc1234' })
    expect(info.version).toBe(MCP_VERSION)
    expect(info.version).toBe('0.19.0')
    expect(info.commit).toBe('abc1234')
    expect(info.features).toEqual(expect.arrayContaining(['generated_web_flow', 'exact_with_text_logo_qa', 'auto_retry_keep_better', 'provider_retry_backoff']))
    expect(MCP_SERVER_INFO.name).toBeTruthy()
    expect(buildServerInfo({}).commit).toBe('unknown')
  })
})
