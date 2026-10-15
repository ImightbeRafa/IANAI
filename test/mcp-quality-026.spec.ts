/**
 * MCP 0.26.0 part A (docs/mcp-quality.md): web parity by default — the model designs the WHOLE ad.
 *  - default prompt = copy rendered by the model + logo as a reference + PRODUCT LOCK; no "SOLO ESCENA" / bands / 60–65 % rules
 *  - no forced retry (fidelity / pack print); at most ONE retry, only with an explicit autoRetry:true, disclosed in the approval
 *  - no generated → exact fallback; the kit's reference images are never added as product refs
 *  - every paid call is logged at its own cost
 *  - printed packs: the real pack pixels are swapped in deterministically (no extra generation)
 *  - the product lock survives the prompt clamp
 * xAI is mocked; no paid call anywhere.
 */
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/lib/auth.js', () => ({
  checkUsageLimit: vi.fn(async () => ({ allowed: true })),
  incrementUsage: vi.fn(async () => ({ creditsCharged: 6 })),
  deductBonusImage: vi.fn(async () => undefined),
  quoteLegacyActionCredits: vi.fn(() => 6),
}))
vi.mock('../api/lib/usage-logger.js', () => ({
  logApiUsage: vi.fn(async () => undefined),
  estimateTokens: vi.fn(() => 1),
}))

import { incrementUsage } from '../api/lib/auth.js'
import { logApiUsage } from '../api/lib/usage-logger.js'
import { approveMcpApprovalRequest, createMemoryMcpApprovalStore } from '../api/lib/mcp/approval'
import { mcpExecuteImageGenerate, parseWebPostArgs } from '../api/lib/mcp/execute-tools'
import { getMcpExecuteResult, setMcpExecuteScheduler } from '../api/lib/mcp/execute-job'
import { generateWebStyleImage, logoNeedsStamp } from '../api/lib/mcp/web-image'
import { swapRealPackPixels } from '../api/lib/mcp/pack-swap'
import { runWebPostGrokImage } from '../api/lib/web-post-image'
import { prepareGrokImagePrompt } from '../api/lib/grok-image-prompt'
import type { McpArtifactStore } from '../api/lib/mcp/artifact-store'
import type { McpDbClient } from '../api/lib/mcp/user-tools'
import { productOnWhite } from './adpack/fidelity-fixtures'

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const durl = (b: Buffer, m = 'image/png') => `data:${m};base64,${b.toString('base64')}`
type Rect = { x: number; y: number; w: number; h: number; c: string }
const rects = (rs: Rect[]) => rs.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" fill="${r.c}"/>`).join('')
const PRODUCT: Rect[] = [{ x: 130, y: 120, w: 140, h: 200, c: '#c0392b' }, { x: 150, y: 70, w: 100, h: 50, c: '#1f4e9c' }, { x: 130, y: 320, w: 140, h: 40, c: '#e5b81f' }]
async function png(w: number, h: number, bg: string, body: string, fmt: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const s = sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`))
  return fmt === 'png' ? s.png().toBuffer() : s.jpeg({ quality: 95 }).toBuffer()
}
/** An ad the model "drew": blurred noise + headline + a CTA pill `gap` px above the bottom edge (6 = touching the edge → QA defect). */
async function ad(gap: number): Promise<Buffer> {
  const noise = Buffer.alloc(800 * 1000 * 3)
  for (let i = 0; i < noise.length; i++) noise[i] = 90 + ((i * 2654435761) >>> 28) * 3
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect x="250" y="${1000 - gap - 90}" width="300" height="90" rx="14" fill="#2ec4b6"/><text x="400" y="${1000 - gap - 32}" font-size="38" font-family="sans-serif" text-anchor="middle" fill="#0b1a2a">Escribinos por DM</text><text x="60" y="250" font-size="64" font-family="sans-serif" fill="#ffffff">Un regalo que armas</text></svg>`)
  return sharp(noise, { raw: { width: 800, height: 1000, channels: 3 } }).blur(14).composite([{ input: label }]).jpeg({ quality: 90 }).toBuffer()
}

let xai: Array<{ url: string; body: Record<string, any> }> = []
let images: Buffer[] = []
beforeEach(() => {
  xai = []
  process.env.XAI_API_KEY = 'test-key'
  vi.mocked(incrementUsage).mockClear()
  vi.mocked(logApiUsage).mockClear()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    xai.push({ url, body: JSON.parse(init.body) })
    const img = images[Math.min(xai.length - 1, images.length - 1)]
    return new Response(JSON.stringify({ data: [{ b64_json: img.toString('base64') }] }), { status: 200 })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

async function ctxWith(offer: Record<string, unknown> = {}, kit: Record<string, unknown> = {}) {
  const kitRef = durl(await png(400, 400, '#fbfbfb', rects(PRODUCT)))
  return {
    brand: { id: 'b1', name: 'Prototipo' },
    offers: [{ id: 'o1', name: 'Avión Prototipo', price: '₡14.900', productDescription: 'Avión de papel con motores', technicalSpecs: 'planeador blanco', type: 'juguete', ...offer }],
    brandKit: { id: 'k1', name: 'Prototipo', primaryColor: '#0b3d91', logoUrl: LOGO, brandVoice: 'cercano', visualStyleNotes: 'luz natural', referenceImages: [kitRef], forbiddenPhrases: [], ...kit },
    brandKits: [], latestGuideIntake: null,
  } as never
}

describe('default = the model designs the whole ad (web parity)', () => {
  it('prompt carries the copy + ONE CTA + margins + PRODUCT LOCK; no scene-only / bands / 60–65 % rules; the logo rides as a reference; kit refs are never added', async () => {
    images = [await ad(190)]
    const hero = durl(await png(400, 400, '#ffffff', rects(PRODUCT)))
    const out = await generateWebStyleImage({ apiKey: 'k', ctx: await ctxWith(), offerId: 'o1', aspectRatio: '4:5', copy: 'Un regalo que armás\n₡14.900\nEscribinos por DM', productUrls: [hero] })
    expect(xai).toHaveLength(1)
    const prompt = String(xai[0].body.prompt)
    expect(prompt).toContain('Un regalo que armás')
    expect(prompt).toContain('COPY DEL USUARIO')
    expect(prompt).toMatch(/UN SOLO CTA: .*«Escribinos por DM»/)
    expect(prompt).toContain('REGLA 1 — MÁRGENES')
    expect(prompt).toMatch(/PRODUCTO BLOQUEADO|PRODUCT LOCK/)
    expect(prompt).not.toMatch(/SOLO ESCENA|SIN FRANJAS|60–65%|18% superior|ESCENA SIN TEXTO/)
    // hero + logo only: the kit's referenceImages are NOT appended as product refs
    expect(xai[0].body.images).toHaveLength(2)
    expect(out.references.used).toEqual(['product', 'logo'])
    expect(out.compositeLayers).toBeUndefined()
    expect(out.paidCalls).toEqual([{ purpose: 'generate', provider: 'xai', model: out.generated.providerModel, costUsd: out.generated.estimatedCostUsd }])
  })

  it('parseWebPostArgs: compositeLayers / stampLogo / stampPrice / autoRetry default false', () => {
    expect(parseWebPostArgs({})).toMatchObject({ compositeLayers: false, stampLogo: false, stampPrice: false, autoRetry: false })
    expect(parseWebPostArgs({ compositeLayers: true, stampLogo: true }).compositeLayers).toBe(true)
  })

  it('a vector kit logo cannot be a reference: it is stamped in code and not sent to the model', () => {
    expect(logoNeedsStamp('https://cdn.test/logo.svg')).toBe(true)
    expect(logoNeedsStamp('data:image/svg+xml;base64,AAA')).toBe(true)
    expect(logoNeedsStamp('https://cdn.test/logo.png')).toBe(false)
  })

  it('stampPrice: the price line is NOT given to the model and is stamped exactly by code', async () => {
    images = [await ad(190)]
    const out = await generateWebStyleImage({ apiKey: 'k', ctx: await ctxWith(), offerId: 'o1', aspectRatio: '1:1', copy: 'Un regalo que armás\n₡14.900\nEscribinos por DM', productUrls: [durl(await png(400, 400, '#ffffff', rects(PRODUCT)))], stampPrice: true })
    expect(String(xai[0].body.prompt).split('COPY DEL USUARIO')[1]).not.toContain('₡14.900')
    expect(out.stamped).toMatchObject({ price: '₡14.900' })
  })
})

describe('retries: none forced, at most one and only when asked', () => {
  it('a redrawn product (fidelity warning) never forces a regeneration: one call, warning only', async () => {
    const changed = PRODUCT.map((r, i) => (i === 0 ? { ...r, c: '#2e9e4f' } : r))
    images = [await png(600, 800, '#8a9a7a', rects(changed.map((r) => ({ ...r, x: 90 + (r.x - 130) * 0.55, y: 150 + (r.y - 70) * 0.55, w: r.w * 0.55, h: r.h * 0.55 }))), 'jpeg')]
    const out = await generateWebStyleImage({ apiKey: 'k', ctx: await ctxWith(), offerId: 'o1', aspectRatio: '4:5', copy: 'Hola', productUrls: [durl(await png(400, 400, '#ffffff', rects(PRODUCT)))] })
    expect(xai).toHaveLength(1)
    expect(out.autoRetry).toMatchObject({ requested: false, attempted: false })
    expect(out.qa.severityFactors?.fidelity).toBeUndefined()
  })

  it('a QA defect without autoRetry: one call; with autoRetry:true exactly ONE retry, never a third call', async () => {
    images = [await ad(6), await ad(6), await ad(6)]
    const hero = durl(await png(400, 400, '#ffffff', rects(PRODUCT)))
    const noRetry = await generateWebStyleImage({ apiKey: 'k', ctx: await ctxWith(), offerId: 'o1', aspectRatio: '4:5', copy: 'Un regalo\nEscribinos por DM', productUrls: [hero] })
    expect(xai).toHaveLength(1)
    expect(noRetry.qa.safeZones).toBe('violation')
    xai = []
    const withRetry = await generateWebStyleImage({ apiKey: 'k', ctx: await ctxWith(), offerId: 'o1', aspectRatio: '4:5', copy: 'Un regalo\nEscribinos por DM', productUrls: [hero], autoRetry: true })
    expect(xai).toHaveLength(2)
    expect(withRetry.autoRetry.attempted).toBe(true)
    expect(withRetry.paidCalls.map((c) => c.purpose)).toEqual(['generate', 'auto_retry'])
    expect(withRetry.generated.estimatedCostUsd).toBeCloseTo(withRetry.paidCalls[0].costUsd + withRetry.paidCalls[1].costUsd, 4)
  })
})

describe('execute_image_generate end to end', () => {
  async function setup(offer: Record<string, unknown> = {}) {
    const ref1 = durl(await png(400, 400, '#ffffff', rects(PRODUCT)))
    const db: McpDbClient = {
      async listBusinessesForUser() { return [{ id: 'b1', name: 'Prototipo' }] },
      async getBusinessForUser(userId, brandId) { return userId === 'u1' && brandId === 'b1' ? { id: 'b1', name: 'Prototipo', userId: 'u1' } : null },
      async listOffersForBrand() { return [{ id: 'o1', name: 'Avión Prototipo', price: '₡14.900', productDescription: 'Avión de papel con motores', technicalSpecs: 'planeador', type: 'juguete', ...offer }] },
      async getBrandKitForBrand() { return { id: 'k1', name: 'Prototipo', primaryColor: '#0b3d91', logoUrl: LOGO, referenceImages: [durl(await png(300, 300, '#fafafa', rects(PRODUCT)))] } },
    }
    const imgs: Record<string, { id: string; kind: string; label: string; imageUrl: string; isPrimary?: boolean }> = { p1: { id: 'p1', kind: 'product', label: 'foto', imageUrl: ref1 } }
    const artifactStore = {
      async ensureExecuteSession() { return { sessionId: 's1' } },
      async listOwnedAssets() { return Object.values(imgs) },
      async getOwnedProductImage(o: { imageId: string }) { return imgs[o.imageId] ?? null },
      async saveImageArtifact() { return { messageId: 'm1', productImageId: 'img-new', imageUrl: 'https://cdn.example/new.jpg' } },
    } as unknown as McpArtifactStore
    return { db, artifactStore }
  }
  async function run(args: Record<string, unknown>, offer?: Record<string, unknown>) {
    const { db, artifactStore } = await setup(offer)
    const approvalStore = createMemoryMcpApprovalStore()
    const work: Array<() => Promise<void>> = []
    setMcpExecuteScheduler((w) => { work.push(w) })
    const base = { db, approvalStore, artifactStore, user: { id: 'u1' } }
    const a = { brandId: 'b1', offerId: 'o1', aspectRatio: '4:5', productImageId: 'p1', ...args }
    const first = await mcpExecuteImageGenerate({ ...base, args: a })
    const approvalRequestId = String(first.approvalRequestId)
    await approveMcpApprovalRequest(approvalStore, { approvalRequestId, userId: 'u1' })
    await mcpExecuteImageGenerate({ ...base, args: { ...a, approvalRequestId } })
    for (const w of work) await w()
    return { first, status: await getMcpExecuteResult({ approvalStore, userId: 'u1', jobId: approvalRequestId }) }
  }

  it('no generated → exact fallback: a redrawn product stays on the web path (one xAI call, no exact plate), warning only, one charge', async () => {
    const changed = PRODUCT.map((r, i) => (i === 0 ? { ...r, c: '#2e9e4f' } : r))
    images = [await png(600, 800, '#8a9a7a', rects(changed), 'jpeg')]
    const { status } = await run({ copy: 'Hola' })
    expect(status.status).toBe('completed')
    expect(xai).toHaveLength(1)
    expect(status.grokMode).toBe('product_lock_scene')
    expect(status.productFidelity).toBe('generated')
    expect(status).not.toHaveProperty('fidelityFallback')
    expect(status).not.toHaveProperty('packFallback')
    expect(vi.mocked(incrementUsage)).toHaveBeenCalledTimes(1)
  })

  it('autoRetry:true is disclosed in the approval; every paid call gets its own usage row with its own cost', async () => {
    images = [await ad(6), await ad(6)]
    const { first, status } = await run({ copy: 'Un regalo\nEscribinos por DM', autoRetry: true })
    expect(String(first.userPrompt)).toMatch(/autoRetry/)
    expect(first.possibleExtraGeneration).toMatchObject({ count: 1 })
    expect(xai).toHaveLength(2)
    const rows = vi.mocked(logApiUsage).mock.calls.map((c) => c[0])
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => (r.metadata as { paidCall: { purpose: string } }).paidCall.purpose)).toEqual(['generate', 'auto_retry'])
    for (const r of rows) expect(typeof r.costOverrideUsd).toBe('number')
    expect((status.paidCalls as unknown[]).length).toBe(2)
    expect(vi.mocked(incrementUsage)).toHaveBeenCalledTimes(1)
  })

  it('productNotes naming an accessory ("hélice", "cable") never turn an untagged hero into a part', async () => {
    images = [await ad(190)]
    await run({ copy: 'Hola', productNotes: 'hélice gris claro, cable rojo corto' })
    expect(String(xai[0].body.prompt)).not.toMatch(/mostrá SOLO ese objeto/)
  })

  it('printed pack: productFidelity "exact" is ignored (deprecated) — generated + real-pixel swap path, ONE generation, no extra charge', async () => {
    images = [await ad(190)]
    const { status } = await run({ copy: 'Dormí mejor\nEscribinos por DM', productFidelity: 'exact' }, { name: 'Sleeping Patches', productDescription: 'bolsa de 30 parches', technicalSpecs: 'bolsa', type: 'producto' })
    expect(status.status).toBe('completed')
    expect(status.productFidelity).toBe('generated')
    expect(String(status.productFidelityNote)).toMatch(/deprecated and ignored/)
    expect(xai).toHaveLength(1)
    expect(xai[0].url).toContain('/images/')
    expect(status.packSwap).toBeDefined()
    expect(vi.mocked(incrementUsage)).toHaveBeenCalledTimes(1)
  })
})

describe('pack real-pixel swap (deterministic)', () => {
  it('swaps the real cut-out into a confidently located box; keeps the generated image when not confident or the shape differs', async () => {
    const photo = await productOnWhite()
    const scene = await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#5d6b7a' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="190" height="400"><rect width="190" height="400" fill="#999999"/></svg>'), left: 305, top: 400 }]).jpeg().toBuffer()
    const box = { x0: 305 / 800, y0: 400 / 1000, x1: 495 / 800, y1: 800 / 1000 } // the redrawn pack, same aspect as the real one (≈ 0.46)
    const ok = await swapRealPackPixels({ generated: scene, referenceDataUrl: durl(photo, 'image/jpeg'), productBox: box, confident: true })
    expect(ok.report.applied).toBe(true)
    expect(ok.bytes.equals(scene)).toBe(false)
    const meta = await sharp(ok.bytes).metadata()
    expect([meta.width, meta.height]).toEqual([800, 1000])
    const no = await swapRealPackPixels({ generated: scene, referenceDataUrl: durl(photo, 'image/jpeg'), productBox: box, confident: false })
    expect(no.report.applied).toBe(false)
    expect(no.bytes.equals(scene)).toBe(true)
    const wide = await swapRealPackPixels({ generated: scene, referenceDataUrl: durl(photo, 'image/jpeg'), productBox: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.75 }, confident: true })
    expect(wide.report.applied).toBe(false)
    expect(wide.report.reason).toMatch(/different shapes/)
  })
})

describe('the product lock survives the prompt clamp', () => {
  it('a very long copy + context: the clamp keeps the copy tail AND the offer lock (placed in the head)', async () => {
    images = [await ad(190)]
    const hero = durl(await png(400, 400, '#ffffff', rects(PRODUCT)))
    const longCopy = Array.from({ length: 40 }, (_, i) => `Línea de copy número ${i} con bastante texto descriptivo`).join('\n')
    const out = await runWebPostGrokImage({ apiKey: 'k', aspectRatio: '3:4', productUrls: [hero], copy: longCopy, businessContext: 'contexto '.repeat(300), brandVoice: 'voz '.repeat(200), lockProductAppearance: true, immutableAttributes: ['hélices rojas de 2 aspas'], mcp: { strict: true, requestedRatio: '4:5', layoutCap: false } })
    expect(out.prompt).toContain('PRODUCTO BLOQUEADO por la oferta')
    expect(out.prompt).toContain('hélices rojas de 2 aspas')
    expect(out.prompt).toContain('Línea de copy número 39')
    const prepared = prepareGrokImagePrompt(out.prompt + '\n\n' + 'x'.repeat(9000), { preferTail: longCopy })
    expect(prepared.prompt).toContain('PRODUCTO BLOQUEADO por la oferta')
  })
})
