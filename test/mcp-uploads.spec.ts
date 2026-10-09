import { describe, expect, it, vi } from 'vitest'
import * as usageLogger from '../api/lib/usage-logger'
import { createRehoster, directDownloadUrl, isOwnedStorageUrl, safeFilename } from '../api/lib/mcp/asset-rehost'
import { mcpCreateUploadUrl, mcpFinalizeUpload } from '../api/lib/mcp/upload-tools'
import { mcpWorkspaceSaveArtifact } from '../api/lib/mcp/workspace-ops'
import type { McpArtifactStore } from '../api/lib/mcp/artifact-store'
import { BIZ_A, KIT_A, PROD_A, PROD_B } from './adpack/saved-brand-fakes'
import { USER_A, USER_B } from './adpack/door-harness'
import { STORAGE_PUBLIC, createMcpWorld } from './helpers/mcp-world'

vi.spyOn(usageLogger, 'logApiUsage').mockResolvedValue(undefined as never)

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const user = { id: USER_A }

async function upload(world: ReturnType<typeof createMcpWorld>, args: Record<string, unknown>) {
  return mcpCreateUploadUrl({ db: world.mcpDb, store: world.offerStore, user, args: { brandId: BIZ_A, ...args }, newId: () => 'fixed-uuid' })
}

describe('create_upload_url (C1)', () => {
  it('returns a signed PUT url under <userId>/uploads/<uuid>-<safe-filename> and records the intent', async () => {
    const world = createMcpWorld()
    const res = await upload(world, { offerId: PROD_A, kind: 'product_photo', role: 'control', filename: 'Foto Avión (1).JPG', contentType: 'image/jpg' })
    expect(res).toMatchObject({ status: 'upload_ready', method: 'PUT', path: `${USER_A}/uploads/fixed-uuid-foto-avion-1.jpg`, headers: { 'content-type': 'image/jpeg' }, nextTool: 'finalize_upload' })
    expect(String(res.uploadUrl)).toMatch(/upload\/sign\/post-images\//)
    const rec = world.offerStore.uploads.get(String(res.uploadId))!
    expect(rec.metadata).toMatchObject({ status: 'pending', kind: 'product_photo', offerId: PROD_A, role: 'control', contentType: 'image/jpeg' })
  })

  it('validates kind, type, size, offer and ownership', async () => {
    const world = createMcpWorld()
    await expect(upload(world, { kind: 'video', filename: 'a.mp4', contentType: 'video/mp4' })).rejects.toThrow(/kind must be one of/)
    await expect(upload(world, { offerId: PROD_A, kind: 'product_photo', filename: 'a.gif', contentType: 'image/gif' })).rejects.toThrow(/contentType for product_photo/)
    await expect(upload(world, { kind: 'document', filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 50 * 1024 * 1024 })).rejects.toThrow(/too large/)
    await expect(upload(world, { kind: 'product_photo', filename: 'a.png', contentType: 'image/png' })).rejects.toThrow(/offerId is required/)
    await expect(upload(world, { offerId: PROD_B, kind: 'product_photo', filename: 'a.png', contentType: 'image/png' })).rejects.toThrow(/Offer not found/)
    await expect(mcpCreateUploadUrl({ db: world.mcpDb, store: world.offerStore, user: { id: USER_B }, args: { brandId: BIZ_A, kind: 'logo', filename: 'l.png', contentType: 'image/png' } })).rejects.toThrow('Brand not found')
    expect(world.offerStore.uploads.size).toBe(0)
  })
})

describe('finalize_upload (C1)', () => {
  it('fails clearly until the bytes are uploaded, then creates the product photo row (idempotent)', async () => {
    const world = createMcpWorld()
    const res = await upload(world, { offerId: PROD_A, kind: 'product_photo', role: 'control', filename: 'control.png', contentType: 'image/png' })
    const uploadId = String(res.uploadId)
    await expect(mcpFinalizeUpload({ store: world.offerStore, brandKitStore: world.kitStore, user, args: { uploadId } })).rejects.toThrow(/PUT the bytes/)
    world.offerStore.objects.set(String(res.path), { size: 2048, contentType: 'image/png' })
    const done = await mcpFinalizeUpload({ store: world.offerStore, brandKitStore: world.kitStore, user, args: { uploadId } })
    expect(done).toMatchObject({ status: 'finalized', target: 'product_images', offerId: PROD_A, url: `${STORAGE_PUBLIC}${res.path}`, role: 'control' })
    const row = world.db.images.find((i) => i.id === done.productImageId)!
    expect(row).toMatchObject({ product_id: PROD_A, user_id: USER_A, kind: 'product', role: 'control', image_url: done.url })
    const again = await mcpFinalizeUpload({ store: world.offerStore, brandKitStore: world.kitStore, user, args: { uploadId } })
    expect(again).toMatchObject({ replayed: true, productImageId: done.productImageId })
    expect(world.db.images.filter((i) => i.image_url === done.url)).toHaveLength(1)
    await expect(mcpFinalizeUpload({ store: world.offerStore, brandKitStore: world.kitStore, user: { id: USER_B }, args: { uploadId } })).rejects.toThrow('Upload not found')
  })

  it('rejects and removes files over the limit or of the wrong type', async () => {
    const world = createMcpWorld()
    const res = await upload(world, { offerId: PROD_A, kind: 'product_photo', filename: 'big.png', contentType: 'image/png' })
    world.offerStore.objects.set(String(res.path), { size: 40 * 1024 * 1024, contentType: 'image/png' })
    await expect(mcpFinalizeUpload({ store: world.offerStore, brandKitStore: world.kitStore, user, args: { uploadId: res.uploadId } })).rejects.toThrow(/Upload rejected: the file is 40.0 MB/)
    expect(world.offerStore.removed).toEqual([res.path])
    await expect(mcpFinalizeUpload({ store: world.offerStore, brandKitStore: world.kitStore, user, args: { uploadId: res.uploadId } })).rejects.toThrow(/was rejected/)

    const exe = await upload(world, { offerId: PROD_A, kind: 'product_photo', filename: 'x.png', contentType: 'image/png' })
    world.offerStore.objects.set(String(exe.path), { size: 100, contentType: 'application/x-msdownload' })
    await expect(mcpFinalizeUpload({ store: world.offerStore, brandKitStore: world.kitStore, user, args: { uploadId: exe.uploadId } })).rejects.toThrow(/not allowed/)
  })

  it('saves logo variants, winner ads and documents on the primary brand kit', async () => {
    const world = createMcpWorld()
    const logo = await upload(world, { kind: 'logo', role: 'dark', filename: 'logo-dark.png', contentType: 'image/png' })
    world.offerStore.objects.set(String(logo.path), { size: 500, contentType: 'image/png' })
    const l = await mcpFinalizeUpload({ store: world.offerStore, brandKitStore: world.kitStore, user, args: { uploadId: logo.uploadId } })
    expect(l).toMatchObject({ target: 'brand_kit', brandKitId: KIT_A, assetKind: 'logo' })
    const kit = world.db.kits.find((k) => k.id === KIT_A)!
    expect(kit.logo_url).toBe('https://cdn.example/alba-logo.png') // existing main logo kept for a dark variant
    expect((kit.brand_profile as { logoVariants: unknown[] }).logoVariants).toEqual([{ url: l.url, variant: 'dark' }])

    const winner = await upload(world, { kind: 'winner_ad', filename: 'winner.jpg', contentType: 'image/jpeg' })
    world.offerStore.objects.set(String(winner.path), { size: 500, contentType: 'image/jpeg' })
    const w = await mcpFinalizeUpload({ store: world.offerStore, brandKitStore: world.kitStore, user, args: { uploadId: winner.uploadId } })
    expect((world.db.kits.find((k) => k.id === KIT_A)!.brand_profile as { winnerAdUrls: string[] }).winnerAdUrls).toEqual([w.url])
  })

  it('degrades before 085: winner ads become style references, with a warning', async () => {
    const world = createMcpWorld({ caps: { brandProfile: false, imageMeta: false } })
    const winner = await upload(world, { kind: 'winner_ad', filename: 'winner.jpg', contentType: 'image/jpeg' })
    world.offerStore.objects.set(String(winner.path), { size: 500, contentType: 'image/jpeg' })
    const w = await mcpFinalizeUpload({ store: world.offerStore, brandKitStore: world.kitStore, user, args: { uploadId: winner.uploadId } })
    expect(world.db.kits.find((k) => k.id === KIT_A)!.reference_images).toContain(w.url)
    expect(String((w.warnings as string[])[0])).toMatch(/085/)
    const photo = await upload(world, { offerId: PROD_A, kind: 'product_photo', role: 'caja', filename: 'caja.png', contentType: 'image/png' })
    world.offerStore.objects.set(String(photo.path), { size: 500, contentType: 'image/png' })
    const p = await mcpFinalizeUpload({ store: world.offerStore, brandKitStore: world.kitStore, user, args: { uploadId: photo.uploadId } })
    expect(p.status).toBe('finalized')
    expect(world.db.images.find((i) => i.id === p.productImageId)!.role).toBeUndefined()
  })
})

describe('rehost external URLs (C2)', () => {
  const okFetch = (bytes: Uint8Array, headers: Record<string, string> = {}) =>
    vi.fn(async () => new Response(bytes, { status: 200, headers }))

  it('helpers: drive links, owned URLs, safe names', () => {
    expect(directDownloadUrl('https://drive.google.com/file/d/AbC_123/view?usp=sharing')).toBe('https://drive.google.com/uc?export=download&id=AbC_123')
    expect(directDownloadUrl('https://www.dropbox.com/s/x/p.png?dl=0')).toBe('https://www.dropbox.com/s/x/p.png?dl=1')
    expect(isOwnedStorageUrl(`https://p.supabase.co/storage/v1/object/public/post-images/${USER_A}/uploads/a.png`, USER_A)).toBe(true)
    expect(isOwnedStorageUrl(`https://p.supabase.co/storage/v1/object/public/post-images/${USER_B}/uploads/a.png`, USER_A)).toBe(false)
    expect(safeFilename('../../etc/passwd')).toBe('etc-passwd')
    expect(safeFilename('Ñandú Logo.PNG')).toBe('nandu-logo.png')
  })

  it('copies a public image into storage and keeps the original link', async () => {
    const uploads: string[] = []
    const fetchImpl = okFetch(PNG)
    const rehost = createRehoster({ upload: async ({ path }) => { uploads.push(path); return `${STORAGE_PUBLIC}${path}` }, fetchImpl, newId: () => 'id1' })
    const res = await rehost({ userId: USER_A, url: 'https://drive.google.com/file/d/abc/view', label: 'logo' })
    expect(res).toEqual({ url: `${STORAGE_PUBLIC}${USER_A}/uploads/id1-logo.png`, sourceUrl: 'https://drive.google.com/file/d/abc/view', rehosted: true })
    expect(fetchImpl).toHaveBeenCalledWith('https://drive.google.com/uc?export=download&id=abc', { timeoutMs: 15000 })
    expect(uploads).toEqual([`${USER_A}/uploads/id1-logo.png`])
  })

  it('keeps the original link with a warning on non-images, oversize, HTTP errors and private hosts', async () => {
    const upload = vi.fn(async () => 'never')
    const html = await createRehoster({ upload, fetchImpl: okFetch(new TextEncoder().encode('<html>login</html>')) })({ userId: USER_A, url: 'https://drive.google.com/file/d/abc/view' })
    expect(html).toMatchObject({ url: 'https://drive.google.com/file/d/abc/view', rehosted: false })
    // Drive answered with a web page (login / request access): the file is not public.
    expect(html.warning).toMatch(/no es público/)
    const big = await createRehoster({ upload, fetchImpl: okFetch(PNG, { 'content-length': String(50 * 1024 * 1024) }) })({ userId: USER_A, url: 'https://cdn.example/big.png' })
    expect(big.warning).toMatch(/larger than 15 MB/)
    const denied = await createRehoster({ upload, fetchImpl: vi.fn(async () => new Response('no', { status: 403 })) })({ userId: USER_A, url: 'https://cdn.example/x.png' })
    expect(denied.warning).toMatch(/HTTP 403/)
    const fetchImpl = vi.fn()
    const local = await createRehoster({ upload, fetchImpl })({ userId: USER_A, url: 'http://127.0.0.1/admin.png' })
    expect(local.warning).toMatch(/not allowed/)
    expect(fetchImpl).not.toHaveBeenCalled()
    const owned = `${STORAGE_PUBLIC}${USER_A}/uploads/a.png`
    expect(await createRehoster({ upload, fetchImpl })({ userId: USER_A, url: owned })).toEqual({ url: owned, rehosted: false })
    expect(upload).not.toHaveBeenCalled()
  })

  it('workspace_save_artifact saves the owned copy (source_url kept); link flows still work without rehost', async () => {
    const world = createMcpWorld()
    const saved: Array<Record<string, unknown>> = []
    const artifactStore = {
      async saveReferenceImageFromPublicUrl(o: Record<string, unknown>) {
        saved.push(o)
        return { productImageId: 'pi-1', imageUrl: String(o.imageUrl) }
      },
    } as unknown as McpArtifactStore
    const rehost = createRehoster({ upload: async ({ path }) => `${STORAGE_PUBLIC}${path}`, fetchImpl: okFetch(PNG), newId: () => 'id2' })
    const res = await mcpWorkspaceSaveArtifact({
      db: world.mcpDb,
      artifactStore,
      user,
      rehost,
      args: { brandId: BIZ_A, offerId: PROD_A, kind: 'product', imageUrl: 'https://drive.google.com/file/d/abc/view', title: 'avion' },
    })
    expect(res).toMatchObject({ status: 'saved', rehosted: true, sourceUrl: 'https://drive.google.com/file/d/abc/view', imageUrl: `${STORAGE_PUBLIC}${USER_A}/uploads/id2-avion.png` })
    expect(saved[0]).toMatchObject({ sourceUrl: 'https://drive.google.com/file/d/abc/view', kind: 'product' })

    const plain = await mcpWorkspaceSaveArtifact({ db: world.mcpDb, artifactStore, user, args: { brandId: BIZ_A, offerId: PROD_A, kind: 'context', imageUrl: 'https://cdn.example/ctx.jpg' } })
    expect(plain).toMatchObject({ status: 'saved', imageUrl: 'https://cdn.example/ctx.jpg' })
    expect(plain.rehosted).toBeUndefined()
  })
})
