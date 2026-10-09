/**
 * End-to-end MCP journey of the "Content" agent (owner feedback 2026-10-08, "Cómo sabemos que
 * funciona"): set up a brand ENTIRELY through MCP and run 2 ads in 4:5 + 9:16.
 *
 *   create_brand → update_brand_kit (Space Grotesk, colors) → import_image logo (Drive, white
 *   background) → create_offer (₡ price, bundle, includes/excludes, verified claims, age,
 *   immutable attributes, allowed props) → import_images (hero / part / box from Drive, incl.
 *   the large-file confirm interstitial; a private Drive file fails clearly) → create_ads
 *   {brandId, offerId, count 2, ratios 4:5 + 9:16} → neutral structured approval →
 *   confirm_execute → create_ads again → poll adpack_status / get_execute_result → deliverable.
 *
 * Only the MCP JSON-RPC entry (`handleMcpJsonRpc`) is called. Everything else is fake and
 * offline: DB (mcp-world), storage (bytes kept in memory), Drive/Dropbox fetch, model gateway.
 * The renderer and the exact-fidelity pipeline are REAL (synthetic product photos).
 * Runs twice: migration 085 applied, and 085 pending (feature-detected fallbacks).
 *
 * Placeholder brand data only ("Marca Demo"): no real customer data.
 */
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as usageLogger from '../api/lib/usage-logger'
import { CREDIT_WEIGHTS } from '../api/lib/credits/catalog'
import { createAdPackService, type AdPackChargeInput } from '../api/lib/adpack/service'
import { createDefaultRenderer } from '../api/lib/adpack/render-adapter'
import { createMemoryPackStore } from '../api/lib/adpack/store-memory'
import type { AdPackStorage } from '../api/lib/adpack/runner-types'
import type { ModelGateway } from '../api/lib/adpack/types'
import { createMemoryMcpApprovalStore } from '../api/lib/mcp/approval'
import { drainBackground, queueBackgroundWork, restoreBackgroundWork } from './adpack/background-queue'
import { handleMcpJsonRpc } from '../api/lib/mcp/protocol'
import type { McpStoreCapabilities } from '../api/lib/mcp/offer-tools'
import type { RemoteFetch } from '../api/lib/mcp/remote-image'
import { createMcpWorld, STORAGE_PUBLIC } from './helpers/mcp-world'

vi.spyOn(usageLogger, 'logApiUsage').mockResolvedValue(undefined as never)

const USER = '00000000-0000-4000-8000-0000000000c7'
const PER_AD = CREDIT_WEIGHTS.image_standard

// ---------------------------------------------------------------------------
// Synthetic images (white studio backgrounds so the real cut-out pipeline works)
// ---------------------------------------------------------------------------

async function svgJpeg(svg: string): Promise<Uint8Array> {
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer())
}

/** Hero: a "paper plane" with white wings outlined in gray, black body, white propellers. */
const heroPhoto = () => svgJpeg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1000">' +
  '<rect width="1400" height="1000" fill="#ffffff"/>' +
  '<polygon points="300,560 1100,420 1100,640" fill="#e5e7eb" stroke="#4b5563" stroke-width="10"/>' +
  '<rect x="560" y="470" width="420" height="120" rx="30" fill="#111827"/>' +
  '<circle cx="1010" cy="530" r="70" fill="#f9fafb" stroke="#374151" stroke-width="8"/>' +
  '<rect x="640" y="500" width="260" height="22" fill="#ef4444"/>' +
  '<rect x="640" y="540" width="260" height="10" fill="#9ca3af"/>' +
  '</svg>',
)
/** Part: a gamepad-style controller. */
const partPhoto = () => svgJpeg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">' +
  '<rect width="1200" height="900" fill="#ffffff"/>' +
  '<rect x="300" y="330" width="600" height="260" rx="120" fill="#1f2937"/>' +
  '<circle cx="450" cy="460" r="50" fill="#6b7280"/><circle cx="760" cy="430" r="26" fill="#22c55e"/>' +
  '<circle cx="820" cy="490" r="26" fill="#3b82f6"/>' +
  '</svg>',
)
/** Box: the kit box. */
const boxPhoto = () => svgJpeg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1000">' +
  '<rect width="1200" height="1000" fill="#ffffff"/>' +
  '<rect x="330" y="220" width="540" height="600" fill="#0ea5e9" stroke="#0c4a6e" stroke-width="12"/>' +
  '<rect x="400" y="300" width="400" height="120" fill="#f8fafc"/>' +
  '</svg>',
)
/** Logo saved as JPEG on a solid white square (the "white box" problem, C5). */
const logoJpeg = () => svgJpeg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">' +
  '<rect width="800" height="800" fill="#ffffff"/>' +
  '<circle cx="400" cy="330" r="170" fill="#7c3aed"/>' +
  '<rect x="180" y="560" width="440" height="80" rx="20" fill="#7c3aed"/>' +
  '</svg>',
)

/** Background plate the fake image model returns (no product, soft gradient). */
async function platePng(): Promise<Uint8Array> {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="576" height="1024"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="0.6" stop-color="#93c5fd"/><stop offset="1" stop-color="#a16207"/></linearGradient></defs><rect width="576" height="1024" fill="url(#g)"/></svg>'
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer())
}

// ---------------------------------------------------------------------------
// Fake Google Drive / Dropbox
// ---------------------------------------------------------------------------

const DRIVE = {
  logo: '1LoGoFiLeIdAbCdEfGhIjKlMn',
  hero: '1HeRoFiLeIdLarGeFiLe00001',
  part: '1PaRtFiLeIdAbCdEfGhIjKlMn',
  box: '1BoXfIlEiDaBcDeFgHiJkLmNo',
  private: '1PrIvAtEfIlEiDaBcDeFgHiJk',
}
const SHARE = {
  logo: `https://drive.google.com/file/d/${DRIVE.logo}/view?usp=sharing`,
  hero: `https://drive.google.com/open?id=${DRIVE.hero}`,
  part: `https://drive.google.com/uc?id=${DRIVE.part}&export=download`,
  box: `https://drive.usercontent.google.com/download?id=${DRIVE.box}&export=download&authuser=0`,
  private: `https://drive.google.com/file/d/${DRIVE.private}/view`,
}

const VIRUS_SCAN_PAGE = (id: string) =>
  '<!DOCTYPE html><html><head><title>Google Drive - Virus scan warning</title></head><body>' +
  '<p>Google Drive can\'t scan this file for viruses.</p>' +
  '<form id="download-form" action="https://drive.usercontent.google.com/download" method="get">' +
  '<input type="submit" value="Download anyway"/>' +
  `<input type="hidden" name="id" value="${id}"><input type="hidden" name="export" value="download">` +
  '<input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="5f0c1d2e-uuid">' +
  '</form></body></html>'
const LOGIN_PAGE = '<!DOCTYPE html><html><head><title>Google Drive: Sign-in</title></head><body>Sign in to continue</body></html>'

function fakeDrive(files: Record<string, Uint8Array>) {
  const calls: string[] = []
  const fetchImpl: RemoteFetch = async (url) => {
    calls.push(url)
    const u = new URL(url)
    const id = u.searchParams.get('id') ?? ''
    const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    const file = (bytes: Uint8Array, name: string) =>
      new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${name}"` } })
    if (u.hostname === 'drive.google.com' && u.pathname === '/uc') {
      if (id === DRIVE.private) return html(LOGIN_PAGE)
      if (id === DRIVE.hero) return html(VIRUS_SCAN_PAGE(id)) // large file → confirm interstitial
      if (files[id]) return file(files[id], `${id}.jpg`)
      return new Response('not found', { status: 404 })
    }
    if (u.hostname === 'drive.usercontent.google.com' && u.pathname === '/download') {
      if (id === DRIVE.hero && u.searchParams.get('confirm') === 't' && u.searchParams.get('uuid')) return file(files[id], 'avion-hero.jpg')
      if (id === DRIVE.hero) return html(VIRUS_SCAN_PAGE(id))
      if (files[id]) return file(files[id], `${id}.jpg`)
    }
    return new Response('not found', { status: 404 })
  }
  return { fetchImpl, calls }
}

// ---------------------------------------------------------------------------
// Fake model gateway (copy from the confirmed facts in the prompt; product-free plates)
// ---------------------------------------------------------------------------

const KNOWN_FACTS = ['Envío gratis desde 2 kits', 'Edad 8+']
const HEADLINES = ['Tu tarde de parque despega', 'Un avión que armás vos', 'Volá en el patio de casa']
const SUBLINES = ['Avión de papel con motor y control', 'Control tipo gamepad incluido en la caja', 'Para jugar al aire libre en familia']

function journeyGateway(plate: Uint8Array) {
  const sceneCalls: Array<{ prompt: string; refs: string[] }> = []
  const visionCalls: Array<{ user: string; images: number }> = []
  const copyPrompts: string[] = []
  let n = 0
  const angleSlot = new Map<string, number>()
  const gw: ModelGateway & { sceneCalls: typeof sceneCalls; visionCalls: typeof visionCalls; copyPrompts: string[] } = {
    sceneCalls,
    visionCalls,
    copyPrompts,
    async json<T>(input: { system: string; user: string }) {
      copyPrompts.push(input.user)
      // One distinct line per angle (catalog ids look like <category>-<hook>-<format>).
      const angle = input.user.match(/\(([a-z_]+-[a-z_]+-[a-z_]+)\)/)?.[1] ?? String(n++)
      if (!angleSlot.has(angle)) angleSlot.set(angle, angleSlot.size)
      const i = angleSlot.get(angle)! % HEADLINES.length
      const facts = KNOWN_FACTS.filter((f) => input.user.includes(f))
      const caption = [
        'Un avión de papel con motor para tardes de parque con la familia.',
        ...facts.map((f) => `${f}.`),
        'Papel no incluido.',
        'Escribinos por WhatsApp y pedí el tuyo.',
      ].join(' ')
      return {
        data: {
          headline: HEADLINES[i],
          subline: SUBLINES[i],
          // how_to_steps needs ≥ 2 steps (exact mode plans no hand-held format without an in-use photo).
          bullets: facts.length >= 2 ? facts.slice(0, 2) : [...facts, 'Llevalo al parque', 'Volalo en familia'].slice(0, 2),
          cta: 'Pedí el tuyo',
          caption,
          script: { hook: 'Mirá cómo vuela este avión de papel.', development: 'Lo llevás al parque y lo hacés volar con el control.', cta: 'Escribinos y pedí el tuyo.' },
          sceneBrief: 'Wooden table by a sunny window, soft warm side light.',
          usedFactKeys: facts.length ? ['shipping'] : [],
        } as T,
        costUsd: 0.001,
        model: 'fake-text',
      }
    },
    async visionJson<T>(input: { user: string; images: string[] }) {
      visionCalls.push({ user: input.user, images: input.images.length })
      return { data: { extraObjects: [], strayText: false, borders: false, placementClear: true, headlineSpace: true, productMatches: true, score: 0.9 } as T, costUsd: 0.0005, model: 'fake-vision' }
    },
    async scene(input) {
      sceneCalls.push({ prompt: input.prompt, refs: input.refs })
      return { bytes: plate, mimeType: 'image/png', costUsd: 0.02, model: 'fake-image', productLocked: false }
    },
  }
  return gw
}

// ---------------------------------------------------------------------------
// World: MCP stores + Ad Pack service sharing one in-memory storage
// ---------------------------------------------------------------------------

async function setupWorld(caps: Partial<McpStoreCapabilities>) {
  const world = createMcpWorld({ caps })
  const blobs = new Map<string, Uint8Array>()
  const publicUrl = (path: string) => `${STORAGE_PUBLIC}${path}`
  // MCP uploads (import_image) keep their bytes so the pack can load them back.
  const baseUpload = world.offerStore.uploadBytes.bind(world.offerStore)
  world.offerStore.uploadBytes = async (o) => {
    blobs.set(publicUrl(o.path), o.bytes)
    return baseUpload(o)
  }
  let n = 0
  const storageUploads: Array<{ url: string; contentType: string }> = []
  const storage: AdPackStorage = {
    async upload(input) {
      const ext = input.contentType === 'image/png' ? 'png' : 'jpg'
      const url = publicUrl(`${input.userId}/adpack/${input.packId}/${input.itemIndex}-${input.kind}-${++n}.${ext}`)
      blobs.set(url, input.bytes)
      storageUploads.push({ url, contentType: input.contentType })
      return { url }
    },
    async uploadAt(input) {
      const url = publicUrl(input.path)
      blobs.set(url, input.bytes)
      return { url }
    },
    async download(path) {
      const url = publicUrl(path)
      const bytes = blobs.get(url)
      return bytes ? { bytes, url } : null
    },
  }
  const loadImage = async (url: string) => {
    const bytes = blobs.get(url)
    if (!bytes) throw new Error(`not in fake storage: ${url}`)
    return bytes
  }
  const files = {
    [DRIVE.logo]: await logoJpeg(),
    [DRIVE.hero]: await heroPhoto(),
    [DRIVE.part]: await partPhoto(),
    [DRIVE.box]: await boxPhoto(),
  }
  const drive = fakeDrive(files)
  const gateway = journeyGateway(await platePng())
  const charges: AdPackChargeInput[] = []
  const credits = { remaining: 1_000 }
  const packStore = createMemoryPackStore()
  const service = createAdPackService({
    store: packStore,
    gateway,
    renderer: createDefaultRenderer(),
    storage,
    async charge(input) {
      if (charges.some((c) => c.generationId === input.generationId)) return { charged: false }
      charges.push(input)
      credits.remaining -= PER_AD
      return { charged: true, credits: PER_AD }
    },
    async checkCredits({ ads }) {
      return { allowed: credits.remaining >= ads * PER_AD, remaining: credits.remaining, creditsRequired: ads * PER_AD }
    },
    savedBrandDb: world.db,
    loadImage,
  })
  const approvalStore = createMemoryMcpApprovalStore()
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const res = await handleMcpJsonRpc({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      user: { id: USER },
      db: world.mcpDb,
      offerStore: world.offerStore,
      brandKitStore: world.kitStore,
      approvalStore,
      adPackService: service,
      remoteFetch: drive.fetchImpl,
    })
    if (res.error) throw new Error(`rpc error ${res.error.message}`)
    const result = res.result as { content: Array<{ text: string }>; isError: boolean }
    return { isError: result.isError, payload: JSON.parse(result.content[0].text) as Record<string, any> }
  }
  return { world, blobs, storageUploads, drive, gateway, charges, credits, rpc, packStore }
}

const FORBIDDEN = ['armado en minutos', 'el mejor del mundo']

const MODES: Array<{ label: string; caps: Partial<McpStoreCapabilities>; applied: boolean }> = [
  { label: '085 applied', caps: {}, applied: true },
  { label: '085 pending', caps: { adProfile: false, imageMeta: false, archive: false, brandProfile: false }, applied: false },
]

let prevFontFetch: string | undefined
beforeAll(() => {
  prevFontFetch = process.env.ADPACK_FONT_FETCH
  process.env.ADPACK_FONT_FETCH = '0' // brand fonts: bundled / cached only, never the network
  queueBackgroundWork() // background slices run when the test drains them ("time passes")
})
afterAll(() => {
  if (prevFontFetch === undefined) delete process.env.ADPACK_FONT_FETCH
  else process.env.ADPACK_FONT_FETCH = prevFontFetch
  restoreBackgroundWork()
})

describe.each(MODES)('Content agent journey via MCP only ($label)', ({ caps, applied }) => {
  it('creates the brand, kit, offer and photos, then ships 2 ads in 4:5 + 9:16', async () => {
    const w = await setupWorld(caps)
    const { rpc } = w

    // 1. Brand from zero (+ primary kit), duplicate-safe.
    const brand = await rpc('create_brand', { name: 'Marca Demo', location: 'San José, Costa Rica', salesChannels: ['website', 'messages'], doesShipping: true })
    expect(brand.isError, JSON.stringify(brand.payload).slice(0, 1500)).toBe(false)
    expect(brand.payload.status).toBe('created')
    const brandId = String(brand.payload.brand.brandId)
    const kitId = String(brand.payload.brandKit.brandKitId)
    expect(kitId).toBeTruthy()
    const again = await rpc('create_brand', { name: 'marca  demo' })
    expect(again.payload).toMatchObject({ status: 'exists', brand: { brandId } })

    // 2. Kit: fonts, colors, locale/register, forbidden phrases.
    const kit = await rpc('update_brand_kit', {
      brandId, kitId,
      fonts: { heading: 'Space Grotesk', body: 'Inter' },
      colors: { primary: '#1E3A8A', secondary: '#F8FAFC', accent: '#F59E0B' },
      locale: 'es-CR', register: 'voseo',
      forbiddenPhrases: FORBIDDEN,
    })
    expect(kit.isError, JSON.stringify(kit.payload).slice(0, 1500)).toBe(false)
    expect(kit.payload.kit).toMatchObject({ fontPrimary: 'Space Grotesk', primaryColor: '#1E3A8A' })

    // 3. Logo from Drive (white background) → cleaned transparent PNG on the kit.
    const logo = await rpc('import_image', { brandId, kind: 'logo', url: SHARE.logo })
    expect(logo.isError, JSON.stringify(logo.payload).slice(0, 1500)).toBe(false)
    expect(logo.payload).toMatchObject({ status: 'imported', kind: 'logo', provider: 'google_drive', sourceUrl: SHARE.logo, target: 'brand_kit', logoUrlSet: true })
    expect(logo.payload.logo).toMatchObject({ backgroundRemoved: true, method: 'edge_flood', transparent: true })
    const kitRow = w.world.db.kits.find((k) => k.id === kitId)!
    expect(String(kitRow.logo_url)).toBe(logo.payload.logo.cleanedUrl)
    expect(String(kitRow.logo_url)).toMatch(new RegExp(`^${STORAGE_PUBLIC}${USER}/uploads/`))
    expect(String(kitRow.logo_url)).not.toContain('drive.google.com')
    const cleanLogo = await sharp(Buffer.from(w.blobs.get(String(kitRow.logo_url))!)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(cleanLogo.data[3]).toBe(0) // top-left corner (was white) is now transparent

    // 4. Offer with every structured fact.
    const offer = await rpc('create_offer', {
      brandId,
      name: 'Avión RC Demo',
      description: 'Avión de papel con motor y control remoto tipo gamepad',
      price: { amount: 14900, currency: 'CRC' },
      bundles: [{ qty: 2, price: 26000, label: '2 kits' }],
      shipping: { text: 'Envío gratis desde 2 kits', freeFromQty: 2 },
      includes: ['Chasis con motor', 'Control tipo gamepad', 'Hélices de repuesto'],
      excludes: ['Papel no incluido'],
      verifiedClaims: [{ claim: 'Envío gratis desde 2 kits', source: 'política de envíos' }],
      forbiddenClaims: ['armado en minutos'],
      ageMin: 8,
      immutableAttributes: ['alas blancas con borde gris', 'chasis negro', 'hélice blanca'],
      allowedProps: ['caja del kit'],
      lockProductAppearance: true,
      locale: 'es-CR',
    })
    expect(offer.isError, JSON.stringify(offer.payload).slice(0, 1500)).toBe(false)
    const offerId = String(offer.payload.offer.offerId)
    expect(offer.payload.adProfileSaved).toBe(applied)
    if (!applied) expect(offer.payload.migrationPending).toBeTruthy()
    const confirmed = (offer.payload.offer.confirmedFacts as Array<{ value: string }>).map((f) => f.value)
    if (applied) expect(confirmed).toEqual(expect.arrayContaining(['₡14.900', 'Envío gratis desde 2 kits', 'Edad 8+']))

    // 5. Product photos with roles from Drive (all share-link shapes; large-file confirm; one private file).
    const photos = await rpc('import_images', {
      brandId, offerId,
      items: [
        { url: SHARE.hero, kind: 'product_photo', role: 'hero', label: 'avión' },
        { url: SHARE.part, kind: 'product_photo', role: 'part', label: 'control tipo gamepad' },
        { url: SHARE.box, kind: 'product_photo', role: 'box', label: 'caja' },
        { url: SHARE.private, kind: 'product_photo', role: 'detail' },
      ],
    })
    expect(photos.isError, JSON.stringify(photos.payload).slice(0, 1500)).toBe(false)
    expect(photos.payload).toMatchObject({ status: 'partial', imported: 3, failed: 1 })
    const results = photos.payload.results as Array<Record<string, any>>
    expect(results[0]).toMatchObject({ status: 'imported', role: 'hero', provider: 'google_drive', driveLargeFileConfirmed: true, sourceUrl: SHARE.hero })
    expect(results[3]).toMatchObject({ status: 'error', error: { code: 'DRIVE_NOT_PUBLIC' } })
    expect(results[3].error.message).toMatch(/no es público/)
    for (const r of results.slice(0, 3)) {
      expect(r.url).toMatch(new RegExp(`^${STORAGE_PUBLIC}${USER}/uploads/`)) // copied, never the Drive link
      expect(r.quality).toMatchObject({ width: expect.any(Number), height: expect.any(Number), sharpness: expect.any(Number), backgroundClean: expect.any(Number) })
      expect(r.roleStoredAs).toBe(applied ? 'tags' : 'label')
    }
    const imported = new Set(results.slice(0, 3).map((r) => String(r.url)))
    const rows = w.world.db.images.filter((i) => i.product_id === offerId)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => !String(r.image_url).includes('google'))).toBe(true)
    if (applied) {
      expect(rows.map((r) => r.tags)).toEqual([['hero'], ['part'], ['caja']])
      expect(rows[0]).toMatchObject({ is_primary: true, source_url: SHARE.hero })
    } else {
      expect(rows.map((r) => String(r.label).slice(0, 6))).toEqual(['[hero]', '[part]', '[box] '])
    }

    // 6. create_ads with only brandId + offerId (+ 085 pending: lock data passed per call, it could not be saved).
    const adsArgs: Record<string, unknown> = { brandId, offerId, count: 2, ratios: ['4:5', '9:16'] }
    if (!applied) Object.assign(adsArgs, { immutableAttributes: ['alas blancas con borde gris', 'chasis negro', 'hélice blanca'], allowedProps: ['caja del kit'], forbiddenClaims: ['armado en minutos'] })
    const prompt = await rpc('create_ads', adsArgs)
    expect(prompt.isError, JSON.stringify(prompt.payload).slice(0, 1500)).toBe(false)
    expect(prompt.payload).toMatchObject({ status: 'approval_required', via: 'create_ads', routedTo: 'adpack_start', nextTool: 'confirm_execute' })
    expect(prompt.payload.approval).toEqual({ items: 2, unitCost: PER_AD, total: 2 * PER_AD, currency: 'credits', expiresAt: expect.any(String), summary: expect.stringContaining('2 anuncios') })
    const shown = `${prompt.payload.userPrompt}\n${prompt.payload.userPromptEn}\n${prompt.payload.message}`
    expect(shown).not.toMatch(/Grok|Yo \(|I \(|https?:\/\//)
    expect(prompt.payload).not.toHaveProperty('webFallbackUrl')
    expect(prompt.payload).not.toHaveProperty('deepLink')
    const approvalRequestId = String(prompt.payload.approvalRequestId)

    const confirm = await rpc('confirm_execute', { approvalRequestId, action: 'approve' })
    expect(confirm.payload.status).toBe('approved')
    const started = await rpc('create_ads', { ...adsArgs, approvalRequestId })
    expect(started.isError, JSON.stringify(started.payload).slice(0, 1500)).toBe(false)
    // #13: running (never "completed") until the pack is terminal.
    expect(started.payload).toMatchObject({ status: 'running', packStatus: 'planned', moreWork: true, packId: approvalRequestId, creativeFreedom: 'high', chargedCredits: 0 })
    expect(started.payload.etaSeconds).toEqual(expect.any(Number))
    expect(started.payload.pollAfterSeconds).toEqual(expect.any(Number))
    const early = await rpc('get_execute_result', { jobId: approvalRequestId })
    expect(early.payload).toMatchObject({ status: 'running', moreWork: true })
    const plan = started.payload.plan as Array<Record<string, unknown>>
    expect(plan).toHaveLength(2)
    for (const p of plan) expect(p).toMatchObject({ angleId: expect.any(String), rationale: expect.any(String), layoutFamily: expect.any(String) })

    // 7. Poll until done (adpack_status; get_execute_result returns the same pack status).
    // The pack advances in background slices without polling; status is a cheap read.
    await drainBackground()
    const status = await rpc('adpack_status', { packId: approvalRequestId })
    expect(status.payload.failures ?? [], JSON.stringify(status.payload).slice(0, 3000)).toEqual([])
    expect(status.payload.moreWork).toBe(false)
    expect(status.payload.status).toBe('done')
    const viaJob = await rpc('get_execute_result', { jobId: approvalRequestId })
    expect(viaJob.payload).toMatchObject({ status: 'completed', packId: approvalRequestId, moreWork: false })
    expect(viaJob.payload.deliverable.ads).toHaveLength(2)

    // 8. Deliverable assertions.
    const ads = status.payload.deliverable.ads as Array<Record<string, any>>
    expect(ads).toHaveLength(2)
    const confirmedNumbers = new Set(['14.900', '26.000', '2', '8'])
    for (const ad of ads) {
      expect(ad).toMatchObject({ angleId: expect.any(String), rationale: expect.any(String), layoutFamily: expect.any(String), category: expect.any(String) })
      // #9: the kit fonts are bundled and reported as actually drawn (no silent Fira Sans swap).
      expect(ad.fontsUsed).toMatchObject({ heading: expect.stringMatching(/^Space Grotesk /), body: expect.stringMatching(/^Inter /) })
      expect(ad.fontsUsed.fallbacks.filter((f: { reason: string }) => !f.reason.startsWith('glyphs'))).toEqual([])
      expect(ad.files.map((f: { ratio: string }) => f.ratio)).toEqual(['4:5', '9:16'])
      for (const f of ad.files) {
        expect(f.url).toMatch(new RegExp(`^${STORAGE_PUBLIC}.*\\.png$`))
        expect(f.jpgUrl).toMatch(new RegExp(`^${STORAGE_PUBLIC}.*\\.jpg$`))
        expect(`${f.url} ${f.jpgUrl}`).not.toMatch(/token=|X-Amz-|\/sign\//)
        expect(f.fidelity).toMatchObject({ passed: true, method: expect.stringMatching(/harmonized|composite|relit/) })
        const png = await sharp(Buffer.from(w.blobs.get(f.url)!)).metadata()
        expect([png.format, png.width, png.height]).toEqual(['png', f.width, f.height])
        const jpg = await sharp(Buffer.from(w.blobs.get(f.jpgUrl)!)).metadata()
        expect([jpg.format, jpg.width, jpg.height]).toEqual(['jpeg', f.width, f.height])
      }
      expect(ad.fidelity).toMatchObject({ passed: true })
      expect(ad.forbiddenHits).toEqual([])
      const text = `${ad.headline} ${ad.caption}`.toLowerCase()
      for (const phrase of FORBIDDEN) expect(text).not.toContain(phrase)
      // No unconfirmed facts: every number in the copy is a confirmed one.
      for (const num of `${ad.headline} ${ad.caption}`.match(/\d+(?:[.,]\d+)*/g) ?? []) expect(confirmedNumbers.has(num)).toBe(true)
    }

    // Exact product: every composited cut-out comes from an imported photo (parts never invented).
    const plateCalls = w.gateway.sceneCalls
    expect(plateCalls.length).toBeGreaterThanOrEqual(2)
    for (const call of plateCalls) {
      expect(call.refs).toEqual([]) // the image model never sees (and never redraws) the product
      expect(call.prompt).toContain('NO product')
      expect(call.prompt).toContain('hélice blanca') // immutable attributes reach the plate prompt
    }
    const plateChecks = w.gateway.visionCalls.filter((c) => c.user.includes('background plate'))
    expect(plateChecks.length).toBeGreaterThanOrEqual(2)
    expect(plateChecks.every((c) => c.user.includes('chasis negro'))).toBe(true)
    // Credits charged = approved total (one charge per finished ad).
    expect(w.charges.length * PER_AD).toBe(prompt.payload.approval.total)
    expect(status.payload.chargedCredits).toBe(prompt.payload.approval.total)

    // Parts only from photos: every composited cut-out (hero + parts) was cut from an imported photo,
    // with the role it was imported with; the pack read the immutable attributes + allowed props.
    const state = await w.packStore.getPack(approvalRequestId, USER)
    expect(state).toBeTruthy()
    const roleOf = new Map(results.slice(0, 3).map((r) => [String(r.url), String(r.role)]))
    expect(state!.pack.render).toMatchObject({ productFidelity: 'exact', immutableAttributes: expect.arrayContaining(['hélice blanca']), allowedProps: ['caja del kit'] })
    expect(state!.pack.offer.productPhotos?.map((p) => [p.url, p.role]).sort()).toEqual([...roleOf.entries()].sort())
    for (const item of state!.items) {
      const cutouts = item.scene?.cutouts ?? []
      expect(cutouts.length).toBeGreaterThanOrEqual(1)
      for (const c of cutouts) {
        expect(imported.has(String(c.sourceUrl))).toBe(true)
        expect(c.role).toBe(roleOf.get(String(c.sourceUrl)))
      }
      expect(cutouts[0].role).toBe('hero')
    }
    // The kit part (controller) is composited from ITS photo in the formats that show parts.
    const partUses = state!.items.flatMap((i) => (i.scene?.cutouts ?? []).filter((c) => c.role === 'part'))
    if (state!.items.some((i) => ['offer_graphic', 'explainer'].includes(i.angle.format))) expect(partUses.length).toBeGreaterThanOrEqual(1)
    // The pack used the CLEANED logo (transparent PNG cached by content hash), never the white square.
    const logoCache = [...w.blobs.keys()].filter((k) => k.includes('/logos/'))
    expect(logoCache.length).toBeGreaterThanOrEqual(1)
    const cachedLogo = await sharp(Buffer.from(w.blobs.get(logoCache[0])!)).metadata()
    expect(cachedLogo.hasAlpha).toBe(true)
  }, 120_000)
})
