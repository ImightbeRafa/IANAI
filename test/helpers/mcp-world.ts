/**
 * In-memory MCP "world" for the 0.11 tools: offers (products + ad_profile), product
 * photos, brand kits, uploads and storage — all owner-scoped like the Supabase impls,
 * and sharing rows with the Ad Pack saved-brand fake so a save is visible to packs.
 *
 * `caps` simulates migration 085: a missing column makes writes fail with the same
 * PostgREST error (PGRST204) the real database returns.
 */
import type { McpBrandKitStore } from '../../api/lib/mcp/brand-kit-tools'
import type { McpOfferStore, McpStoreCapabilities } from '../../api/lib/mcp/offer-tools'
import type { McpDbClient } from '../../api/lib/mcp/user-tools'
import type { BrandKitRowLike } from '../../api/lib/brand-kit-resolve'
import { fakeSavedBrandDb, type FakeSavedDb } from '../adpack/saved-brand-fakes'

type Row = Record<string, unknown>

export const STORAGE_PUBLIC = 'https://proj.supabase.test/storage/v1/object/public/post-images/'

function missingColumn(table: string, column: string) {
  return { code: 'PGRST204', message: `Could not find the '${column}' column of '${table}' in the schema cache` }
}

export interface McpWorld {
  db: FakeSavedDb
  caps: McpStoreCapabilities
  mcpDb: McpDbClient
  offerStore: McpOfferStore & {
    objects: Map<string, { size: number; contentType: string | null; bytes?: Uint8Array }>
    uploads: Map<string, { id: string; userId: string; brandId: string; metadata: Row }>
    removed: string[]
    writes: number
  }
  kitStore: McpBrandKitStore & { writes: number }
}

export function createMcpWorld(options: { caps?: Partial<McpStoreCapabilities>; db?: FakeSavedDb } = {}): McpWorld {
  const db = options.db ?? fakeSavedBrandDb()
  const caps: McpStoreCapabilities = { adProfile: true, imageMeta: true, archive: true, brandProfile: true, ...options.caps }
  let seq = 0
  // UUID-shaped like the real tables (the Ad Pack validates brandId / offerId as UUIDs).
  const KIND_CODE: Record<string, string> = { brand: 'b', offer: 'f', img: 'e', kit: 'c' }
  const nextId = (prefix: string) => `${(KIND_CODE[prefix] ?? 'a').repeat(8)}-0000-4000-8000-${String(++seq).padStart(12, '0')}`

  const IMAGE_META = ['is_primary', 'tags', 'role', 'quality', 'source_url']
  const checkImagePatch = (patch: Row) => {
    if (!caps.imageMeta) for (const k of IMAGE_META) if (k in patch) throw missingColumn('product_images', k)
  }

  const objects = new Map<string, { size: number; contentType: string | null; bytes?: Uint8Array }>()
  const uploads = new Map<string, { id: string; userId: string; brandId: string; metadata: Row }>()
  const offerStore: McpWorld['offerStore'] = {
    objects,
    uploads,
    removed: [],
    writes: 0,
    async capabilities() {
      return { ...caps }
    },
    async getOffer({ userId, brandId, offerId }) {
      return db.products.find((p) => p.id === offerId && p.business_id === brandId && p.owner_id === userId) ?? null
    },
    async getOfferById({ userId, offerId }) {
      return db.products.find((p) => p.id === offerId && p.owner_id === userId) ?? null
    },
    async insertOffer({ userId, brandId, row }) {
      if (!caps.adProfile && 'ad_profile' in row) throw missingColumn('products', 'ad_profile')
      offerStore.writes++
      const full = { ...row, id: nextId('offer'), owner_id: userId, business_id: brandId, created_at: new Date().toISOString() }
      db.products.unshift(full)
      return { ...full }
    },
    async updateOffer({ userId, brandId, offerId, patch }) {
      if (!caps.adProfile && 'ad_profile' in patch) throw missingColumn('products', 'ad_profile')
      const row = db.products.find((p) => p.id === offerId && p.business_id === brandId && p.owner_id === userId)
      if (!row) throw new Error('Offer not found for this brand')
      offerStore.writes++
      Object.assign(row, patch)
      return { ...row }
    },
    async getProductImage({ userId, imageId }) {
      return db.images.find((i) => i.id === imageId && i.user_id === userId) ?? null
    },
    async updateProductImage({ userId, imageId, patch }) {
      checkImagePatch(patch)
      const row = db.images.find((i) => i.id === imageId && i.user_id === userId)
      if (!row) throw new Error('Product image not found')
      Object.assign(row, patch)
      return { ...row }
    },
    async clearPrimaryImages({ userId, offerId, exceptImageId }) {
      if (!caps.imageMeta) throw missingColumn('product_images', 'is_primary')
      for (const i of db.images) if (i.product_id === offerId && i.user_id === userId && i.id !== exceptImageId) i.is_primary = false
    },
    async insertProductImage({ userId, offerId, row }) {
      checkImagePatch(row)
      if (!db.products.some((p) => p.id === offerId && p.owner_id === userId)) throw new Error('Offer not found')
      const full = { ...row, id: nextId('img'), product_id: offerId, user_id: userId, created_at: new Date().toISOString() }
      db.images.push(full)
      return { ...full }
    },
    async createSignedUpload({ path }) {
      return { signedUrl: `https://proj.supabase.test/storage/v1/object/upload/sign/post-images/${path}?token=t`, token: 't', path }
    },
    async statObject({ path }) {
      return objects.get(path) ?? null
    },
    async removeObject({ path }) {
      objects.delete(path)
      offerStore.removed.push(path)
    },
    publicUrl(path) {
      return `${STORAGE_PUBLIC}${path}`
    },
    async uploadBytes({ path, bytes, contentType }) {
      objects.set(path, { size: bytes.length, contentType, bytes })
      return `${STORAGE_PUBLIC}${path}`
    },
    async downloadObject({ path }) {
      return objects.get(path)?.bytes ?? null
    },
    async updateBusiness({ userId, brandId, patch }) {
      const row = db.businesses.find((b) => b.id === brandId && b.owner_id === userId)
      if (!row) return null
      Object.assign(row, patch)
      return { ...row }
    },
    async insertBusiness({ userId, row }) {
      const full = { ...row, id: nextId('brand'), owner_id: userId, created_at: new Date().toISOString() }
      db.businesses.push(full)
      return { ...full }
    },
    async insertUploadRecord({ userId, brandId, metadata }) {
      const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
      uploads.set(id, { id, userId, brandId, metadata })
      return { id }
    },
    async getUploadRecord({ userId, uploadId }) {
      const rec = uploads.get(uploadId)
      return rec && rec.userId === userId ? { id: rec.id, brandId: rec.brandId, metadata: { ...rec.metadata } } : null
    },
    async updateUploadRecord({ userId, uploadId, metadata }) {
      const rec = uploads.get(uploadId)
      if (rec && rec.userId === userId) rec.metadata = metadata
    },
  }

  const kitStore: McpWorld['kitStore'] = {
    writes: 0,
    async listKits({ userId, brandId, includeInactive }) {
      return db.kits
        .filter((k) => k.user_id === userId && (!brandId || k.business_id === brandId) && (includeInactive || k.is_active !== false))
        .map((k) => ({ ...k }) as unknown as BrandKitRowLike)
    },
    async getKit({ userId, kitId }) {
      const row = db.kits.find((k) => k.id === kitId && k.user_id === userId)
      return row ? ({ ...row } as unknown as BrandKitRowLike) : null
    },
    async countKits(userId) {
      return db.kits.filter((k) => k.user_id === userId).length
    },
    async insertKit({ userId, row }) {
      if (!caps.brandProfile && 'brand_profile' in row) throw missingColumn('brand_kits', 'brand_profile')
      kitStore.writes++
      const full = { ...row, id: nextId('kit'), user_id: userId }
      db.kits.push(full)
      return { ...full } as unknown as BrandKitRowLike
    },
    async updateKit({ userId, kitId, patch }) {
      if (!caps.brandProfile && 'brand_profile' in patch) throw missingColumn('brand_kits', 'brand_profile')
      const row = db.kits.find((k) => k.id === kitId && k.user_id === userId)
      if (!row) throw new Error('Brand kit not found')
      kitStore.writes++
      Object.assign(row, patch)
      return { ...row } as unknown as BrandKitRowLike
    },
    async clearPrimaryForBusiness({ userId, businessId, exceptKitId }) {
      for (const k of db.kits) if (k.user_id === userId && k.business_id === businessId && k.id !== exceptKitId) k.is_primary_for_business = false
    },
    async deleteKit({ userId, kitId }) {
      const i = db.kits.findIndex((k) => k.id === kitId && k.user_id === userId)
      if (i < 0) throw new Error('Brand kit was not deleted')
      db.kits.splice(i, 1)
    },
    async assertOwnsBrand(userId, brandId) {
      return db.businesses.some((b) => b.id === brandId && b.owner_id === userId)
    },
    async hasBrandProfile() {
      return caps.brandProfile
    },
  }

  const mcpDb: McpDbClient = {
    async listBusinessesForUser(userId, opts) {
      return db.businesses
        .filter((b) => b.owner_id === userId)
        .map((b) => ({ id: String(b.id), name: String(b.name), type: null, archived: Boolean(b.archived_at) }))
        .filter((b) => opts?.includeArchived || !b.archived)
    },
    async getBusinessForUser(userId, brandId) {
      const b = db.businesses.find((x) => x.id === brandId && x.owner_id === userId)
      return b ? { id: String(b.id), name: String(b.name), type: null, userId } : null
    },
    async listOffersForBrand(userId, brandId) {
      return db.products.filter((p) => p.business_id === brandId && p.owner_id === userId).map((p) => ({ id: String(p.id), name: String(p.name) }))
    },
    async getBrandKitForBrand() {
      return null
    },
  }

  return { db, caps, mcpDb, offerStore, kitStore }
}
