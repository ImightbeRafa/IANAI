/**
 * import_image / import_images (Drive / Dropbox / https → Advance storage, roles, quality, logo
 * cleanup), create_brand, and the immutable-attributes wiring (items 1, 2, 3, 8).
 * Offline: fake fetch, in-memory world (mcp-world), no model calls.
 */
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import * as usageLogger from '../api/lib/usage-logger'
import {
  DRIVE_NOT_PUBLIC_MESSAGE,
  downloadRemoteImage,
  driveConfirmUrl,
  parseDriveLink,
  resolveDownloadUrl,
  type RemoteFetch,
} from '../api/lib/mcp/remote-image'
import { handleMcpJsonRpc } from '../api/lib/mcp/protocol'
import type { McpStoreCapabilities } from '../api/lib/mcp/offer-tools'
import { buildDnaFromSavedBrand } from '../api/lib/adpack/saved-brand'
import { resolveRenderOptions } from '../api/lib/adpack/service'
import { buildPlateCheckPrompt, buildPlatePrompt } from '../api/lib/adpack/fidelity/plate'
import { relightPrompt } from '../api/lib/adpack/fidelity/relight'
import { labelWithRole, roleFromLabel, stripRolePrefix } from '../api/lib/adpack/fidelity/photos'
import { prepareProductCutouts } from '../api/lib/adpack/fidelity/pipeline'
import { buildScenePrompt } from '../api/lib/adpack/scene'
import { buildSceneCheckPrompt } from '../api/lib/adpack/check-scene'
import type { AdAngle, AdCopy } from '../api/lib/adpack/types'
import { createMcpWorld, STORAGE_PUBLIC } from './helpers/mcp-world'
import { BIZ_A, PROD_A, PROD_A_BUCKET } from './adpack/saved-brand-fakes'
import { USER_A, USER_B } from './adpack/door-harness'
import { caseById } from './adpack/helpers'

vi.spyOn(usageLogger, 'logApiUsage').mockResolvedValue(undefined as never)

const jpeg = async (w = 1200, h = 1000, fill = '#0f766e') =>
  new Uint8Array(await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#ffffff"/><rect x="${w * 0.3}" y="${h * 0.25}" width="${w * 0.4}" height="${h * 0.5}" rx="30" fill="${fill}"/><rect x="${w * 0.35}" y="${h * 0.45}" width="${w * 0.3}" height="${h * 0.06}" fill="#f59e0b"/></svg>`)).jpeg({ quality: 92 }).toBuffer())

const ok = (bytes: Uint8Array, headers: Record<string, string> = {}) => new Response(bytes, { status: 200, headers })
const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })

describe('Drive / Dropbox link parsing', () => {
  it('turns every common Drive share shape into a direct download', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'
    const direct = `https://drive.google.com/uc?export=download&id=${id}`
    for (const link of [
      `https://drive.google.com/file/d/${id}/view?usp=sharing`,
      `https://drive.google.com/file/d/${id}/view`,
      `https://drive.google.com/file/d/${id}/edit`,
      `https://drive.google.com/file/u/0/d/${id}/view`,
      `https://drive.google.com/open?id=${id}`,
      `https://drive.google.com/uc?id=${id}&export=download`,
      `https://drive.google.com/uc?export=view&id=${id}`,
      `https://drive.usercontent.google.com/download?id=${id}&export=download&authuser=0`,
      `https://docs.google.com/uc?export=download&id=${id}`,
    ]) {
      expect(resolveDownloadUrl(link)).toEqual({ url: direct, provider: 'google_drive', driveId: id })
    }
    expect(parseDriveLink('https://drive.google.com/drive/folders/1Folder123')).toEqual({ folder: true })
    expect(parseDriveLink('https://docs.google.com/document/d/1Doc/edit')).toEqual({ doc: true })
    expect(parseDriveLink('https://cdn.example/a.png')).toBeNull()
  })

  it('Dropbox: dl=0 / no dl / raw=1 → dl=1; generic https unchanged', () => {
    expect(resolveDownloadUrl('https://www.dropbox.com/s/abc/p.png?dl=0')).toEqual({ url: 'https://www.dropbox.com/s/abc/p.png?dl=1', provider: 'dropbox' })
    expect(resolveDownloadUrl('https://www.dropbox.com/scl/fi/xyz/p.jpg?rlkey=k1').url).toBe('https://www.dropbox.com/scl/fi/xyz/p.jpg?rlkey=k1&dl=1')
    expect(resolveDownloadUrl('https://www.dropbox.com/s/abc/p.png?raw=1').url).toBe('https://www.dropbox.com/s/abc/p.png?dl=1')
    expect(resolveDownloadUrl('https://cdn.example/a.png')).toEqual({ url: 'https://cdn.example/a.png', provider: 'https' })
  })

  it('reads the large-file "virus scan" confirm form, a legacy confirm link or the warning cookie', () => {
    const form = '<form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="FID"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="u-1"></form>'
    expect(driveConfirmUrl(form, 'FID')).toBe('https://drive.usercontent.google.com/download?id=FID&export=download&confirm=t&uuid=u-1')
    expect(driveConfirmUrl('<a href="/uc?export=download&amp;confirm=AbC1&amp;id=FID">Download</a>', 'FID')).toBe('https://drive.google.com/uc?export=download&confirm=AbC1&id=FID')
    expect(driveConfirmUrl('<html>warning</html>', 'FID', 'download_warning_123=Tok9; Path=/')).toBe('https://drive.google.com/uc?export=download&confirm=Tok9&id=FID')
    expect(driveConfirmUrl('<html><title>Sign in</title></html>', 'FID')).toBeNull()
  })
})

describe('downloadRemoteImage', () => {
  it('follows the Drive confirm interstitial once and returns real image bytes', async () => {
    const bytes = await jpeg()
    const calls: string[] = []
    const fetchImpl: RemoteFetch = async (url) => {
      calls.push(url)
      return url.includes('confirm=t') ? ok(bytes, { 'content-disposition': 'attachment; filename="avion.jpg"' }) : html('<form id="download-form" action="https://drive.usercontent.google.com/download"><input name="id" value="BIG"><input name="confirm" value="t"><input name="uuid" value="x"></form>')
    }
    const got = await downloadRemoteImage('https://drive.google.com/file/d/BIG/view', { fetchImpl })
    expect(got).toMatchObject({ mime: 'image/jpeg', provider: 'google_drive', driveConfirmed: true, filename: 'avion.jpg' })
    expect(calls).toEqual(['https://drive.google.com/uc?export=download&id=BIG', 'https://drive.usercontent.google.com/download?id=BIG&confirm=t&uuid=x'])
  })

  it('answers clear, coded errors', async () => {
    const png = await jpeg(64, 64)
    const login: RemoteFetch = async () => html('<html><title>Sign in - Google Accounts</title></html>')
    await expect(downloadRemoteImage('https://drive.google.com/file/d/PRIV/view', { fetchImpl: login })).rejects.toMatchObject({ code: 'DRIVE_NOT_PUBLIC', message: DRIVE_NOT_PUBLIC_MESSAGE })
    const denied: RemoteFetch = async () => new Response('no', { status: 403 })
    await expect(downloadRemoteImage('https://drive.google.com/open?id=PRIV', { fetchImpl: denied })).rejects.toMatchObject({ code: 'DRIVE_NOT_PUBLIC' })
    await expect(downloadRemoteImage('https://cdn.example/page', { fetchImpl: async () => html('<!doctype html><html></html>') })).rejects.toMatchObject({ code: 'NOT_AN_IMAGE' })
    await expect(downloadRemoteImage('https://cdn.example/x.png', { fetchImpl: denied })).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED', message: expect.stringContaining('HTTP 403') })
    const never = vi.fn()
    await expect(downloadRemoteImage('http://127.0.0.1/admin.png', { fetchImpl: never })).rejects.toMatchObject({ code: 'BAD_URL' })
    await expect(downloadRemoteImage('data:image/png;base64,AAAA', { fetchImpl: never })).rejects.toMatchObject({ code: 'BAD_URL' })
    await expect(downloadRemoteImage('https://drive.google.com/drive/folders/1F', { fetchImpl: never })).rejects.toMatchObject({ code: 'DRIVE_FOLDER' })
    expect(never).not.toHaveBeenCalled()
    // Size cap while streaming (no content-length) and from the declared length.
    const big = new Uint8Array(2048)
    big.set(png.subarray(0, 4))
    await expect(downloadRemoteImage('https://cdn.example/big.jpg', { fetchImpl: async () => new Response(new ReadableStream({ start(c) { c.enqueue(big); c.enqueue(big); c.close() } })), maxBytes: 3000 })).rejects.toMatchObject({ code: 'TOO_LARGE' })
    await expect(downloadRemoteImage('https://cdn.example/big.jpg', { fetchImpl: async () => ok(png, { 'content-length': String(99 * 1024 * 1024) }) })).rejects.toMatchObject({ code: 'TOO_LARGE' })
    // HEIC from a phone, GIF, SVG outside logos.
    const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])
    await expect(downloadRemoteImage('https://cdn.example/p.heic', { fetchImpl: async () => ok(heic) })).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_TYPE' })
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
    await expect(downloadRemoteImage('https://cdn.example/l.svg', { fetchImpl: async () => ok(svg) })).rejects.toMatchObject({ code: 'NOT_AN_IMAGE' })
    expect((await downloadRemoteImage('https://cdn.example/l.svg', { fetchImpl: async () => ok(svg), allowSvg: true })).mime).toBe('image/svg+xml')
  })
})

describe('roles survive migration 085 pending (label prefix)', () => {
  it('labelWithRole / roleFromLabel / stripRolePrefix', () => {
    expect(labelWithRole('part', 'control tipo gamepad')).toBe('[part] control tipo gamepad')
    expect(roleFromLabel('[part] caja del control')).toBe('part') // explicit prefix wins over "caja"
    expect(roleFromLabel('[in_use]')).toBe('in_use')
    expect(stripRolePrefix('[box] caja')).toBe('caja')
    expect(roleFromLabel('caja')).toBe('box') // free labels keep the old heuristic
  })
})

async function world(caps: Partial<McpStoreCapabilities> = {}, files: Record<string, Uint8Array> = {}) {
  const w = createMcpWorld({ caps })
  const fetchImpl: RemoteFetch = async (url) => {
    const id = new URL(url).searchParams.get('id') ?? url
    return files[id] ? ok(files[id]) : html('<html><title>Sign in</title></html>')
  }
  const rpc = async (name: string, args: Record<string, unknown>, userId = USER_A) => {
    const res = await handleMcpJsonRpc({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      user: { id: userId },
      db: w.mcpDb,
      offerStore: w.offerStore,
      brandKitStore: w.kitStore,
      remoteFetch: fetchImpl,
    })
    const result = res.result as { content: Array<{ text: string }>; isError: boolean }
    return { isError: result.isError, payload: JSON.parse(result.content[0].text) as Record<string, any> }
  }
  return { w, rpc }
}

describe('import_image (product photos)', () => {
  it('085 applied: copies the bytes, stores tags/role/quality/source_url, hero becomes primary, roles reach the pack', async () => {
    const hero = await jpeg(1400, 1000)
    const ctrl = await jpeg(1000, 800, '#1f2937')
    const { w, rpc } = await world({}, { HERO1: hero, CTRL1: ctrl })
    const a = await rpc('import_image', { brandId: BIZ_A, offerId: PROD_A, kind: 'product_photo', role: 'hero', label: 'avión', url: 'https://drive.google.com/file/d/HERO1/view' })
    expect(a.isError).toBe(false)
    expect(a.payload).toMatchObject({ status: 'imported', target: 'product_images', role: 'hero', tags: ['hero'], isPrimary: true, roleStoredAs: 'tags', upscaled: false, sourceUrl: 'https://drive.google.com/file/d/HERO1/view' })
    expect(a.payload.url).toMatch(new RegExp(`^${STORAGE_PUBLIC}${USER_A}/uploads/.*avion\\.jpg$`))
    expect(a.payload.quality).toMatchObject({ width: 1400, height: 1000, lowResolution: false })
    const b = await rpc('import_image', { brandId: BIZ_A, offerId: PROD_A, kind: 'product_photo', role: 'part', label: 'control', url: 'https://drive.google.com/open?id=CTRL1' })
    expect(b.payload).toMatchObject({ role: 'part', tags: ['part'], isPrimary: false })
    const rowA = w.db.images.find((i) => i.id === a.payload.productImageId)!
    expect(rowA).toMatchObject({ kind: 'product', is_primary: true, tags: ['hero'], role: 'avión', source_url: 'https://drive.google.com/file/d/HERO1/view', image_url: a.payload.url })
    expect(rowA.quality).toMatchObject({ width: 1400 })
    const { offer } = await buildDnaFromSavedBrand({ db: w.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
    const roles = Object.fromEntries((offer.productPhotos ?? []).map((p) => [p.url, p.role]))
    expect(roles[a.payload.url]).toBe('hero')
    expect(roles[b.payload.url]).toBe('part')
    expect(offer.productImageUrls[0]).toBe(a.payload.url) // primary first
  })

  it('085 pending: the role travels in the label and still reaches the pack; nothing crashes', async () => {
    const { w, rpc } = await world({ imageMeta: false, adProfile: false, brandProfile: false, archive: false }, { BOX1: await jpeg(), HERO2: await jpeg(1300, 900) })
    const res = await rpc('import_images', {
      brandId: BIZ_A, offerId: PROD_A,
      items: [
        { url: 'https://drive.google.com/uc?id=HERO2&export=download', kind: 'product_photo', role: 'hero' },
        { url: 'https://drive.usercontent.google.com/download?id=BOX1&export=download', kind: 'product_photo', role: 'box', label: 'caja' },
      ],
    })
    expect(res.payload).toMatchObject({ status: 'imported', imported: 2, failed: 0 })
    expect(res.payload.results[0]).toMatchObject({ roleStoredAs: 'label', isPrimary: false, warnings: expect.arrayContaining([expect.stringContaining('085')]) })
    const rows = w.db.images.filter((i) => String(i.label ?? '').startsWith('['))
    expect(rows.map((r) => r.label)).toEqual(['[hero]', '[box] caja'])
    expect(rows.every((r) => !('tags' in r) && !('quality' in r) && !('source_url' in r))).toBe(true)
    const { offer } = await buildDnaFromSavedBrand({ db: w.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
    const photos = Object.fromEntries((offer.productPhotos ?? []).map((p) => [p.url, [p.role, p.label ?? '']]))
    expect(photos[res.payload.results[0].url]).toEqual(['hero', ''])
    expect(photos[res.payload.results[1].url]).toEqual(['box', 'caja'])
  })

  it('offer inference, validation, ownership and per-item errors in a batch', async () => {
    const { w, rpc } = await world({}, { OK1: await jpeg() })
    // BIZ_A has two offers → offerId is required for a product photo.
    const noOffer = await rpc('import_image', { brandId: BIZ_A, kind: 'product_photo', url: 'https://drive.google.com/open?id=OK1' })
    expect(noOffer.payload.error).toMatchObject({ code: 'BAD_INPUT', message: expect.stringContaining(PROD_A_BUCKET) })
    expect((await rpc('import_image', { brandId: BIZ_A, offerId: PROD_A, kind: 'product_photo', role: 'boss', url: 'https://x.example/a.jpg' })).payload.error.code).toBe('BAD_INPUT')
    expect((await rpc('import_image', { brandId: BIZ_A, kind: 'logo', role: 'hero', url: 'https://x.example/a.jpg' })).payload.error.code).toBe('BAD_INPUT')
    expect((await rpc('import_image', { brandId: BIZ_A, offerId: PROD_A, kind: 'product_photo', url: 'https://drive.google.com/open?id=OK1' }, USER_B)).payload.error.message).toBe('Brand not found')
    const before = w.db.images.length
    const batch = await rpc('import_images', {
      brandId: BIZ_A, offerId: PROD_A, kind: 'product_photo',
      items: [{ url: 'https://drive.google.com/open?id=OK1', role: 'detail' }, { url: 'https://drive.google.com/open?id=PRIVATE' }],
    })
    expect(batch.payload).toMatchObject({ status: 'partial', imported: 1, failed: 1 })
    expect(batch.payload.results[1].error).toMatchObject({ code: 'DRIVE_NOT_PUBLIC' })
    expect(w.db.images.length).toBe(before + 1)
  })

  it('reference_ad with an offer → offer context image; winner_ad → kit winners', async () => {
    const { w, rpc } = await world({}, { REF1: await jpeg(), WIN1: await jpeg() })
    const ref = await rpc('import_image', { brandId: BIZ_A, offerId: PROD_A, kind: 'reference_ad', url: 'https://drive.google.com/open?id=REF1' })
    expect(ref.payload).toMatchObject({ target: 'product_images' })
    expect(w.db.images.find((i) => i.id === ref.payload.productImageId)).toMatchObject({ kind: 'context' })
    const win = await rpc('import_image', { brandId: BIZ_A, kind: 'winner_ad', url: 'https://drive.google.com/open?id=WIN1' })
    expect(win.payload).toMatchObject({ target: 'brand_kit' })
    const kit = w.db.kits.find((k) => k.id === win.payload.brandKitId)!
    expect((kit.brand_profile as { winnerAdUrls: string[] }).winnerAdUrls).toContain(win.payload.url)
    // Winners feed a Style DNA the pack accepts as styleDnaId (style reference, not a template).
    expect(win.payload.styleDnaId).toBe('winners')
    expect(kit.style_dnas).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'winners', kind: 'ads', referenceUrls: [win.payload.url] })]))
  })
})

describe('import_image (logo)', () => {
  it('removes a solid white background and sets the cleaned PNG as the kit logo', async () => {
    const logo = new Uint8Array(await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#ffffff"/><circle cx="300" cy="300" r="180" fill="#dc2626"/></svg>')).jpeg().toBuffer())
    const { w, rpc } = await world({}, { LOGO1: logo })
    const res = await rpc('import_image', { brandId: BIZ_A, kind: 'logo', url: 'https://drive.google.com/file/d/LOGO1/view?usp=drive_link' })
    expect(res.isError).toBe(false)
    expect(res.payload.logo).toMatchObject({ backgroundRemoved: true, method: 'color_key', transparent: true })
    const kit = w.db.kits.find((k) => k.id === res.payload.brandKitId)!
    expect(kit.logo_url).toBe(res.payload.logo.cleanedUrl)
    expect((kit.brand_profile as { logoVariants: Array<Record<string, string>> }).logoVariants).toEqual([{ url: res.payload.logo.cleanedUrl, variant: 'primary', sourceUrl: 'https://drive.google.com/file/d/LOGO1/view?usp=drive_link' }])
    const stored = w.offerStore.objects.get(String(res.payload.logo.cleanedUrl).slice(STORAGE_PUBLIC.length))!
    const raw = await sharp(Buffer.from(stored.bytes!)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(raw.data[3]).toBe(0) // corner is transparent
  })
})

describe('create_brand', () => {
  it('creates the brand + primary kit, refuses duplicates by normalized name, validates input', async () => {
    const { w, rpc } = await world()
    const created = await rpc('create_brand', { name: 'Marca Prueba', location: 'Heredia', salesChannels: ['website'], kit: { fonts: { heading: 'Space Grotesk' }, colors: { primary: '#112233' } } })
    expect(created.payload).toMatchObject({ status: 'created', brand: { name: 'Marca Prueba', salesChannels: ['website'] }, brandKit: { isPrimary: true } })
    const brandId = created.payload.brand.brandId
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/)
    expect(w.db.businesses.find((b) => b.id === brandId)).toMatchObject({ owner_id: USER_A, name: 'Marca Prueba', location: 'Heredia', does_shipping: false })
    const kit = w.db.kits.find((k) => k.id === created.payload.brandKit.brandKitId)!
    expect(kit).toMatchObject({ business_id: brandId, is_primary_for_business: true, font_primary: 'Space Grotesk', primary_color: '#112233' })
    expect((await rpc('create_brand', { name: 'MARCA-prueba' })).payload).toMatchObject({ status: 'exists', brand: { brandId } })
    expect((await rpc('create_brand', { name: 'Marca Prueba', allowDuplicate: true, createKit: false })).payload).toMatchObject({ status: 'created' })
    expect((await rpc('create_brand', { name: 'N/A' })).payload.error.code).toBe('BAD_INPUT')
    expect((await rpc('create_brand', { name: 'X', salesChannels: ['tiktok'] })).payload.error.code).toBe('BAD_INPUT')
    // Another user never sees (or collides with) this brand.
    expect((await rpc('create_brand', { name: 'Marca Prueba' }, USER_B)).payload.status).toBe('created')
  })
})

describe('immutable attributes: offer → pack options → prompts and checks (item 3)', () => {
  const ATTRS = ['hélices blancas', 'chasis negro']
  const serum = caseById('beauty-serum')

  it('update_offer saves them; the saved-brand offer and render options carry them', async () => {
    const { w, rpc } = await world()
    const res = await rpc('update_offer', { brandId: BIZ_A, offerId: PROD_A, immutableAttributes: ATTRS, allowedProps: ['caja del kit'] })
    expect(res.payload.offer.adProfile).toMatchObject({ immutableAttributes: ATTRS, allowedProps: ['caja del kit'] })
    const { offer } = await buildDnaFromSavedBrand({ db: w.db, userId: USER_A, brandId: BIZ_A, offerId: PROD_A })
    expect(offer.immutableAttributes).toEqual(ATTRS)
    expect(resolveRenderOptions({}, offer)).toMatchObject({ productFidelity: 'exact', immutableAttributes: ATTRS, allowedProps: ['caja del kit'] })
    // A per-call value wins (085 pending path: the agent passes them to create_ads).
    expect(resolveRenderOptions({ immutableAttributes: ['ala doblada en V'] }, offer).immutableAttributes).toEqual(['ala doblada en V'])
  })

  it('plate prompt, plate check, relight, generated scene prompt and scene check all state them', () => {
    const dna = serum.dna
    const offer = { ...serum.offer, productImageUrls: ['https://cdn.test/hero.jpg'], immutableAttributes: ATTRS }
    const plate = buildPlatePrompt({ format: 'offer_graphic', dna, offer, placement: { x0: 0.2, y0: 0.4, x1: 0.8, y1: 0.85 }, light: 'left' })
    expect(plate).toContain('hélices blancas; chasis negro')
    expect(plate).toContain('NO product')
    expect(buildPlateCheckPrompt({ refs: [], language: 'es', immutableAttributes: ATTRS }).user).toContain('hélices blancas')
    expect(relightPrompt(ATTRS)).toContain('must stay exactly as they are: hélices blancas; chasis negro')
    const copy = { headline: 'Hola', bullets: [], cta: 'Pedí', caption: 'x', sceneBrief: 'Table by a window.', usedFactKeys: [] } as AdCopy
    const angleRow = { id: 'regalo-desire-offer_graphic', format: 'offer_graphic', hookType: 'desire', category: 'regalo' } as unknown as AdAngle
    const scene = buildScenePrompt({ copy, angle: angleRow, dna, offer })
    expect(scene).toContain('These product attributes must stay exactly as in the photo: hélices blancas; chasis negro.')
    expect(scene).toContain('Show only the product parts that appear in the attached photos')
    expect(buildSceneCheckPrompt(true, 'es', { immutableAttributes: ATTRS }).user).toContain('hélices blancas; chasis negro')
  })
})

describe('parts are never invented (item 2)', () => {
  it('no part photo → no part cut-out; a part photo → its own cut-out only', async () => {
    const hero = await jpeg(1200, 1000)
    const part = await jpeg(1000, 800, '#1f2937')
    const load = async (url: string) => (url.includes('part') ? part : hero)
    const only = await prepareProductCutouts({ photos: [{ url: 'https://s.test/hero.jpg', role: 'hero' }], format: 'offer_graphic', load })
    expect(only.ok && only.parts).toEqual([])
    const both = await prepareProductCutouts({ photos: [{ url: 'https://s.test/hero.jpg', role: 'hero' }, { url: 'https://s.test/part.jpg', role: 'part', label: 'control' }], format: 'offer_graphic', load })
    expect(both.ok).toBe(true)
    if (both.ok) {
      expect(both.hero.stored.sourceUrl).toBe('https://s.test/hero.jpg')
      expect(both.parts.map((p) => [p.stored.sourceUrl, p.stored.role])).toEqual([['https://s.test/part.jpg', 'part']])
    }
  })
})
