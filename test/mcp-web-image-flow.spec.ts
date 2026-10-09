/**
 * execute_image_generate end to end (approval → job → get_execute_result), mocked xAI:
 * the MCP image now goes through the web Grok flow (api/lib/web-post-image.ts) by default and the
 * result carries the free local `fidelity_warning` (warning only: same credits, same job status).
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
import { approveMcpApprovalRequest, createMemoryMcpApprovalStore } from '../api/lib/mcp/approval'
import { mcpExecuteImageGenerate } from '../api/lib/mcp/execute-tools'
import { getMcpExecuteResult, setMcpExecuteScheduler } from '../api/lib/mcp/execute-job'
import type { McpArtifactStore } from '../api/lib/mcp/artifact-store'
import type { McpDbClient } from '../api/lib/mcp/user-tools'

type Rect = { x: number; y: number; w: number; h: number; c: string }
const rects = (rs: Rect[]) => rs.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" fill="${r.c}"/>`).join('')
async function png(w: number, h: number, bg: string, body: string, fmt: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfd8c2"/><stop offset="1" stop-color="#6b7a5c"/></linearGradient></defs><rect width="${w}" height="${h}" fill="${bg === 'scene' ? 'url(#g)' : bg}"/>${body}</svg>`
  const s = sharp(Buffer.from(svg))
  return fmt === 'png' ? s.png().toBuffer() : s.jpeg({ quality: 95 }).toBuffer()
}
const PRODUCT: Rect[] = [
  { x: 130, y: 120, w: 140, h: 200, c: '#c0392b' },
  { x: 150, y: 70, w: 100, h: 50, c: '#1f4e9c' },
  { x: 130, y: 320, w: 140, h: 40, c: '#e5b81f' },
]
const placed = (rs: Rect[]) => rs.map((r) => ({ ...r, x: 90 + (r.x - 130) * 0.55, y: 150 + (r.y - 70) * 0.55, w: r.w * 0.55, h: r.h * 0.55 }))
const dataUrl = (b: Buffer, mime = 'image/png') => `data:${mime};base64,${b.toString('base64')}`

let xai: Array<{ url: string; body: Record<string, any> }> = []
let generated: Buffer

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function setup() {
  const ref1 = dataUrl(await png(400, 400, '#ffffff', rects(PRODUCT)))
  const ref2 = dataUrl(await png(400, 400, '#fdfdfd', rects(PRODUCT)), 'image/png')
  const kitRef = dataUrl(await png(400, 400, '#fbfbfb', rects(PRODUCT)))
  const db: McpDbClient = {
    async listBusinessesForUser() { return [{ id: 'b1', name: 'Prototipo' }] },
    async getBusinessForUser(userId, brandId) { return userId === 'u1' && brandId === 'b1' ? { id: 'b1', name: 'Prototipo', userId: 'u1' } : null },
    async listOffersForBrand() {
      return [{ id: 'o1', name: 'Avión Prototipo', price: '₡14.900', productDescription: 'Avión de papel con motores', technicalSpecs: 'Silueta: planeador blanco con hélices rojas', type: 'juguete' }]
    },
    async getBrandKitForBrand() {
      return { id: 'k1', name: 'Prototipo', primaryColor: '#0b3d91', logoUrl: LOGO, brandVoice: 'cercano', visualStyleNotes: 'luz natural', referenceImages: [kitRef] }
    },
  }
  const images: Record<string, { id: string; kind: string; label: string; imageUrl: string }> = {
    p1: { id: 'p1', kind: 'product', label: 'hero', imageUrl: ref1 },
    p2: { id: 'p2', kind: 'product', label: 'part', imageUrl: ref2 },
  }
  const saved: Array<Record<string, unknown>> = []
  const artifactStore = {
    async ensureExecuteSession() { return { sessionId: 's1' } },
    async listOwnedAssets() { return Object.values(images) },
    async getOwnedProductImage(o: { imageId: string }) { return images[o.imageId] ?? null },
    async saveImageArtifact(o: Record<string, unknown>) { saved.push(o); return { messageId: 'm1', productImageId: 'img-new', imageUrl: 'https://cdn.example/new.jpg' } },
  } as unknown as McpArtifactStore
  return { db, artifactStore, saved }
}

async function runJob(args: Record<string, unknown>, offerStore?: unknown) {
  const { db, artifactStore, saved } = await setup()
  const approvalStore = createMemoryMcpApprovalStore()
  const work: Array<() => Promise<void>> = []
  setMcpExecuteScheduler((w) => { work.push(w) })
  const base = { db, approvalStore, artifactStore, user: { id: 'u1' }, offerStore: offerStore as never }
  const first = await mcpExecuteImageGenerate({ ...base, args: { brandId: 'b1', offerId: 'o1', aspectRatio: '4:5', referenceImageIds: ['p1', 'p2'], productImageId: 'p1', ...args } })
  const approvalRequestId = String(first.approvalRequestId)
  await approveMcpApprovalRequest(approvalStore, { approvalRequestId, userId: 'u1' })
  const started = await mcpExecuteImageGenerate({ ...base, args: { brandId: 'b1', offerId: 'o1', aspectRatio: '4:5', referenceImageIds: ['p1', 'p2'], productImageId: 'p1', ...args, approvalRequestId } })
  expect(started.status).toBe('running')
  for (const w of work) await w()
  const status = await getMcpExecuteResult({ approvalStore, userId: 'u1', jobId: approvalRequestId })
  return { status, saved }
}

beforeEach(async () => {
  xai = []
  process.env.XAI_API_KEY = 'test-key'
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    xai.push({ url, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ data: [{ b64_json: generated.toString('base64') }] }), { status: 200 })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('execute_image_generate = web flow by default', () => {
  it('faithful product: web prompt + both photos + kit ref + logo in ONE xAI call, no fidelity_warning, credits unchanged', async () => {
    generated = await png(600, 800, 'scene', rects(placed(PRODUCT)), 'jpeg')
    const { status, saved } = await runJob({ copy: 'Papel arriba. Motores abajo.', textDensity: 'hard', immutableAttributes: ['hélices rojas'] })
    expect(xai).toHaveLength(1)
    expect(xai[0].url).toContain('/images/edits')
    expect(xai[0].body.aspect_ratio).toBe('3:4')
    expect(xai[0].body.images).toHaveLength(3) // 3-ref budget: 2 product photos (+kit ref trimmed) … logo kept as style ref
    const prompt = String(xai[0].body.prompt)
    expect(prompt).toContain('Papel arriba. Motores abajo.')
    expect(prompt).toContain('₡14.900')
    expect(prompt).toContain('hélices rojas')
    expect(prompt).toMatch(/logo/i)
    expect(status.status).toBe('completed')
    expect(status.productFidelity).toBe('generated')
    expect(status.grokMode).toBe('product_lock_scene')
    if (status.fidelity_warning) throw new Error(JSON.stringify(status.fidelity_warning))
    expect(status.fidelity_warning).toBeUndefined()
    // Flat synthetic shapes have no texture to locate: colour consistent, shape not verified (never a warning).
    expect(['ok', 'unverified']).toContain((status.fidelityCheck as { status: string }).status)
    expect(status.chargedCredits).toBe(6)
    expect(status.appliedAspectRatio).toBe('4:5')
    expect(saved[0].metadata).toMatchObject({ aspectRatio: '4:5', lockApplied: true })
  })

  it('changed product colour: fidelity_warning with reason + score in the execute result AND get_execute_result; still completed and charged the same', async () => {
    const changed = PRODUCT.map((r, i) => (i === 0 ? { ...r, c: '#2e9e4f' } : r))
    generated = await png(600, 800, 'scene', rects(placed(changed)), 'jpeg')
    const { status, saved } = await runJob({ copy: 'Armalo vos' })
    expect(status.status).toBe('completed')
    expect(status.chargedCredits).toBe(6)
    const w = status.fidelity_warning as { code: string; reason: string; score: number }
    expect(w.code).toBe('fidelity_warning')
    expect(w.reason).toMatch(/colour|shape|part/)
    expect(typeof w.score).toBe('number')
    expect(saved[0].metadata).toHaveProperty('fidelity_warning')
  })

  it('productFidelity "exact" stays opt-in: it does not call the web Grok flow', async () => {
    generated = await png(600, 800, 'scene', rects(placed(PRODUCT)), 'jpeg')
    const { db, artifactStore } = await setup()
    const approvalStore = createMemoryMcpApprovalStore()
    const r = await mcpExecuteImageGenerate({ db, approvalStore, artifactStore, user: { id: 'u1' }, args: { brandId: 'b1', offerId: 'o1', productFidelity: 'exact', referenceImageIds: ['p1'], productImageId: 'p1' } })
    const rec = await approvalStore.findById(String(r.approvalRequestId))
    expect(rec?.inputJson).toMatchObject({ productFidelity: 'exact' })
    expect(xai).toHaveLength(0)
  })

  it('reads the offer lock from ad_profile via the offer store', async () => {
    generated = await png(600, 800, 'scene', rects(placed(PRODUCT)), 'jpeg')
    const offerStore = { getOffer: vi.fn(async () => ({ id: 'o1', ad_profile: { lockProductAppearance: true, immutableAttributes: ['cuerpo blanco'] } })) }
    await runJob({ copy: 'Hola' }, offerStore)
    expect(offerStore.getOffer).toHaveBeenCalled()
    expect(String(xai[0].body.prompt)).toContain('cuerpo blanco')
  })

  it('a Grok prompt-length rejection is retried once with the clamp (MCP path)', async () => {
    generated = await png(600, 800, 'scene', rects(placed(PRODUCT)), 'jpeg')
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      xai.push({ url, body: JSON.parse(init.body) })
      if (n++ === 0) return new Response('prompt length exceeds the maximum allowed length of 8000', { status: 400 })
      return new Response(JSON.stringify({ data: [{ b64_json: generated.toString('base64') }] }), { status: 200 })
    }))
    const { status } = await runJob({ copy: 'x'.repeat(1100) })
    expect(xai).toHaveLength(2)
    expect(status.status).toBe('completed')
    expect(status.retriedWithClamp).toBe(true)
  })
})

describe('round 3: safe zones, QA auto-retry (single charge), scene, props, accessories', () => {
  async function ad(buttonBottomGap: number): Promise<Buffer> {
    const noise = Buffer.alloc(800 * 1000 * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = 90 + ((i * 2654435761) >>> 28) * 3
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect x="250" y="${1000 - buttonBottomGap - 90}" width="300" height="90" rx="14" fill="#2ec4b6"/><text x="400" y="${1000 - buttonBottomGap - 32}" font-size="38" font-family="sans-serif" text-anchor="middle" fill="#0b1a2a">Escribinos por DM</text><text x="60" y="250" font-size="64" font-family="sans-serif" fill="#ffffff">Un regalo que armas</text></svg>`)
    return sharp(noise, { raw: { width: 800, height: 1000, channels: 3 } }).blur(14).composite([{ input: label }]).jpeg({ quality: 90 }).toBuffer()
  }
  function sequence(images: Buffer[]) {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      xai.push({ url, body: JSON.parse(init.body) })
      const img = images[Math.min(n++, images.length - 1)]
      return new Response(JSON.stringify({ data: [{ b64_json: img.toString('base64') }] }), { status: 200 })
    }))
  }

  it('qa.safeZones flags a CTA that touches the bottom edge (no retry unless asked): status fail, credits unchanged', async () => {
    sequence([await ad(6)])
    vi.mocked(incrementUsage).mockClear()
    const { status } = await runJob({ copy: 'Un regalo que armás\nEscribinos por DM' })
    expect(xai).toHaveLength(1)
    const qa = status.qa as { safeZones: string; status: string; safeZoneIssues: Array<{ edge: string }> }
    expect(qa.safeZones).toBe('violation')
    expect(qa.status).toBe('fail')
    expect(qa.safeZoneIssues.some((i) => i.edge === 'bottom')).toBe(true)
    expect((status.autoRetry as { attempted: boolean }).attempted).toBe(false)
    expect(status.chargedCredits).toBe(6)
    expect(vi.mocked(incrementUsage)).toHaveBeenCalledTimes(1)
  })

  it('autoRetry:true regenerates ONCE with a corrective hint, keeps the better image and charges once', async () => {
    sequence([await ad(6), await ad(190)])
    vi.mocked(incrementUsage).mockClear()
    const { status } = await runJob({ copy: 'Un regalo que armás\nEscribinos por DM', autoRetry: true })
    expect(xai).toHaveLength(2)
    expect(String(xai[0].body.prompt)).not.toContain('CORRECCIÓN')
    expect(String(xai[1].body.prompt)).toMatch(/CORRECCIÓN.*CTA/s)
    const ar = status.autoRetry as { attempted: boolean; kept: string; reason: string }
    expect(ar).toMatchObject({ attempted: true, kept: 'retry' })
    expect((status.qa as { safeZones: string }).safeZones).toBe('ok')
    expect(status.status).toBe('completed')
    expect(status.chargedCredits).toBe(6)
    expect(vi.mocked(incrementUsage)).toHaveBeenCalledTimes(1) // one charge for two model calls
  })

  it('autoRetry keeps the first image when the retry is no better, and never retries a second time', async () => {
    sequence([await ad(6), await ad(6), await ad(190)])
    const { status } = await runJob({ copy: 'Hola', autoRetry: true })
    expect(xai).toHaveLength(2)
    expect((status.autoRetry as { kept: string }).kept).toBe('first')
  })

  it('a clean first image never triggers the retry', async () => {
    sequence([await ad(190)])
    const { status } = await runJob({ copy: 'Hola', autoRetry: true })
    expect(xai).toHaveLength(1)
    expect((status.autoRetry as { attempted: boolean }).attempted).toBe(false)
  })

  it('scene is a binding instruction (not "Contexto factual"), props are forbidden, safe zones are in the prompt', async () => {
    sequence([await ad(190)])
    await runJob({ copy: 'Hola', scene: 'Gimnasio oscuro, banco de madera, luz lateral fría' })
    const prompt = String(xai[0].body.prompt)
    expect(prompt).toContain('ESCENA OBLIGATORIA DEL PEDIDO')
    expect(prompt).toContain('Gimnasio oscuro, banco de madera, luz lateral fría')
    const factual = prompt.split('Contexto factual (NO renderizar):')[1] || ''
    expect(factual).not.toContain('Gimnasio')
    expect(prompt).not.toContain('mesada / estante de uso real') // generic niche recipe replaced
    expect(prompt).toMatch(/NO alteres forma, partes, ruedas, tren de aterrizaje, cola, pliegues/)
    expect(prompt).toMatch(/PROHIBIDO añadir objetos que no estén en las fotos de referencia/)
    // Round 4: the 8 % margin rule opens the prompt (the clamp trims the tail, never the opening instructions).
    expect(prompt.startsWith('REGLA 1 — MÁRGENES')).toBe(true)
    expect(prompt).toMatch(/FUERA del 8% superior.*FUERA del 8% inferior/s)
    expect(prompt).toMatch(/≥ 11% del borde de abajo/)
  })

  it('the copy is normalised so no orphan "·" can be drawn, and the change is reported in qa', async () => {
    sequence([await ad(190)])
    const { status } = await runJob({ copy: 'Un regalo\nPapel y 3 pilas AA no incluidos · Desde 8 años con supervisión de un adulto' })
    const prompt = String(xai[0].body.prompt)
    expect(prompt).toContain('Papel y 3 pilas AA no incluidos\nDesde 8 años con supervisión de un adulto')
    expect((status.qa as { copyNormalised: string[] }).copyNormalised.length).toBe(1)
  })
})

describe('round 4: allowedProps, one CTA, layout cap, better-of-two retry, capacity backoff', () => {
  async function ad(buttonBottomGap: number, headlineY = 250): Promise<Buffer> {
    const noise = Buffer.alloc(800 * 1000 * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = 90 + ((i * 2654435761) >>> 28) * 3
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect x="250" y="${1000 - buttonBottomGap - 90}" width="300" height="90" rx="14" fill="#2ec4b6"/><text x="400" y="${1000 - buttonBottomGap - 32}" font-size="38" font-family="sans-serif" text-anchor="middle" fill="#0b1a2a">Escribinos por DM</text><text x="60" y="${headlineY}" font-size="64" font-family="sans-serif" fill="#ffffff">Un regalo que armas</text></svg>`)
    return sharp(noise, { raw: { width: 800, height: 1000, channels: 3 } }).blur(14).composite([{ input: label }]).jpeg({ quality: 90 }).toBuffer()
  }
  function sequence(images: Array<Buffer | { status: number; text: string }>) {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      xai.push({ url, body: JSON.parse(init.body) })
      const item = images[Math.min(n++, images.length - 1)]
      if (!Buffer.isBuffer(item)) return new Response(item.text, { status: item.status })
      return new Response(JSON.stringify({ data: [{ b64_json: item.toString('base64') }] }), { status: 200 })
    }))
  }

  it('allowedProps input is honoured; the offer ad_profile list no longer widens it (default = no props)', async () => {
    sequence([await ad(190)])
    const offerStore = { getOffer: vi.fn(async () => ({ id: 'o1', ad_profile: { lockProductAppearance: true, allowedProps: ['Cable USB', 'Destornillador'] } })) }
    const first = await runJob({ copy: 'Hola', allowedProps: ['Hoja de papel blanca'] }, offerStore)
    const prompt = String(xai[0].body.prompt)
    expect(prompt).toContain('Únicos extras permitidos: Hoja de papel blanca')
    expect(prompt).not.toContain('Cable USB')
    expect(prompt).not.toContain('Destornillador')
    expect((first.status.propsPolicy as { allowed: string[]; source: string })).toMatchObject({ allowed: ['Hoja de papel blanca'], source: 'input' })
    xai = []
    sequence([await ad(190)])
    const second = await runJob({ copy: 'Hola' }, offerStore)
    expect(String(xai[0].body.prompt)).toContain('No hay extras permitidos')
    expect(String(xai[0].body.prompt)).not.toContain('Cable USB')
    expect((second.status.propsPolicy as { allowed: string[]; source: string })).toMatchObject({ allowed: [], source: 'none' })
  })

  it('ONE CTA: the prompt pins the exact copy CTA and forbids extra buttons; layout cap is in the prompt', async () => {
    sequence([await ad(190)])
    await runJob({ copy: 'Un regalo que armás\n₡14.900\nEscribinos por DM' })
    const prompt = String(xai[0].body.prompt)
    expect(prompt).toMatch(/UN SOLO CTA: el único botón\/llamado a la acción dice EXACTAMENTE «Escribinos por DM»/)
    expect(prompt).toMatch(/PROHIBIDO un segundo botón/)
    expect(prompt).toMatch(/COMPOSICIÓN LIMPIA: como máximo estos bloques/)
  })

  it('layout cap: a long copy keeps headline + 1 price + 1 facts + 1 CTA on the image; the rest comes back as copyOverflow (caption)', async () => {
    sequence([await ad(190)])
    const copy = ['Un regalo que armás con papel', 'Kit HM939 con control 2.4GHz', '₡14.900', '2 kits por ₡29.800', 'Envío gratis llevando 2 kits o más', 'Papel y 3 pilas AA no incluidos', 'Desde 8 años con supervisión de un adulto', 'Escribinos por DM'].join('\n')
    const { status } = await runJob({ copy })
    const prompt = String(xai[0].body.prompt)
    expect(prompt).toContain('Un regalo que armás con papel')
    expect(prompt).toContain('₡14.900')
    expect(prompt).toContain('Escribinos por DM')
    expect(prompt).not.toContain('Envío gratis llevando 2 kits o más')
    expect(status.copyOverflow).toEqual(expect.arrayContaining(['2 kits por ₡29.800', 'Envío gratis llevando 2 kits o más', 'Papel y 3 pilas AA no incluidos', 'Desde 8 años con supervisión de un adulto']))
    // opt-out
    xai = []
    sequence([await ad(190)])
    await runJob({ copy, layoutCap: false })
    expect(String(xai[0].body.prompt)).toContain('Envío gratis llevando 2 kits o más')
  })

  it('autoRetry KEEPS THE BETTER image by QA severity (not the first): the retry with fewer defects wins; single charge', async () => {
    // first: CTA touching the bottom edge AND headline in the top band; retry: only a milder defect
    sequence([await ad(6, 40), await ad(190, 40)])
    vi.mocked(incrementUsage).mockClear()
    const { status } = await runJob({ copy: 'Un regalo que armás\nEscribinos por DM', autoRetry: true })
    const ar = status.autoRetry as { kept: string; firstSeverity: number; retrySeverity: number; keptReason: string }
    expect(ar.kept).toBe('retry')
    expect(ar.retrySeverity).toBeLessThan(ar.firstSeverity)
    expect(ar.keptReason).toMatch(/not|<|severity/)
    expect(status.chargedCredits).toBe(6)
    expect(vi.mocked(incrementUsage)).toHaveBeenCalledTimes(1)
  })

  it('autoRetry keeps the first when the retry is WORSE (never delivers the worse image)', async () => {
    sequence([await ad(190, 40), await ad(6, 40)]) // first only has the headline in the band; retry adds a CTA touching the edge
    const { status } = await runJob({ copy: 'Un regalo que armás\nEscribinos por DM', autoRetry: true })
    const ar = status.autoRetry as { kept: string; firstSeverity: number; retrySeverity: number }
    expect(ar.kept).toBe('first')
    expect(ar.retrySeverity).toBeGreaterThan(ar.firstSeverity)
  })

  it('"temporarily at capacity" / 5xx are retried with backoff inside the job: not surfaced, charged ONCE', async () => {
    const ok = await ad(190)
    sequence([{ status: 503, text: JSON.stringify({ error: 'The service is temporarily at capacity. Please retry your request shortly.' }) }, { status: 500, text: 'upstream error' }, ok])
    vi.mocked(incrementUsage).mockClear()
    const { status } = await runJob({ copy: 'Hola' })
    expect(xai).toHaveLength(3)
    expect(status.status).toBe('completed')
    expect(status.chargedCredits).toBe(6)
    expect(status.providerRetries).toBe(2)
    expect(vi.mocked(incrementUsage)).toHaveBeenCalledTimes(1)
  })

  it('a non-transient provider error is NOT retried; a permanent capacity outage fails the job with no charge', async () => {
    sequence([{ status: 400, text: JSON.stringify({ error: 'invalid image' }) }])
    vi.mocked(incrementUsage).mockClear()
    const bad = await runJob({ copy: 'Hola' })
    expect(xai).toHaveLength(1)
    expect(bad.status.status).toBe('failed')
    expect(vi.mocked(incrementUsage)).not.toHaveBeenCalled()
    xai = []
    sequence([{ status: 503, text: JSON.stringify({ error: 'The service is temporarily at capacity.' }) }])
    const down = await runJob({ copy: 'Hola' })
    expect(xai).toHaveLength(4) // 1 + 3 retries, then the job fails
    expect(down.status.status).toBe('failed')
    expect(vi.mocked(incrementUsage)).not.toHaveBeenCalled()
  })
})
