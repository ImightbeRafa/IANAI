/**
 * In-memory saved brand data (businesses / brand_kits / products / product_images /
 * stored site analysis) + offer library, owner-scoped like the Supabase impls.
 */
import type { AdPackLibrary } from '../../api/lib/adpack/library'
import { libraryLabel } from '../../api/lib/adpack/library'
import type { SavedBrandDb, StoredSiteAnalysis } from '../../api/lib/adpack/saved-brand'
import type { SiteAnalysisResult } from '../../api/lib/site-analysis'
import { USER_A, USER_B } from './door-harness'

type Row = Record<string, unknown>

export const BIZ_A = 'aaaaaaaa-0000-4000-8000-0000000000a1'
export const BIZ_B = 'bbbbbbbb-0000-4000-8000-0000000000b1'
export const KIT_A = 'aaaaaaaa-0000-4000-8000-00000000c0a1'
export const KIT_A_OTHER = 'aaaaaaaa-0000-4000-8000-00000000c0a2'
/** Offer with a concrete price. */
export const PROD_A = 'aaaaaaaa-0000-4000-8000-0000000000f1'
/** Offer with only a price bucket ("medio"). */
export const PROD_A_BUCKET = 'aaaaaaaa-0000-4000-8000-0000000000f2'
export const PROD_B = 'bbbbbbbb-0000-4000-8000-0000000000f1'

export const businessA: Row = {
  id: BIZ_A,
  owner_id: USER_A,
  name: 'Alba Botánica Tica',
  location: 'Heredia, Costa Rica',
  sales_channels: ['website', 'messages'],
  does_shipping: true,
  shipping_method: 'Correos de Costa Rica',
  icp_description: 'Mujeres de 25 a 40 con piel mixta',
  target_audiences: [{ sex: 'female', age_min: 25, age_max: 40, geographic_scope: 'country', has_specific_profession: false }],
}

export const kitA: Row = {
  id: KIT_A,
  user_id: USER_A,
  business_id: BIZ_A,
  name: 'Alba kit',
  is_active: true,
  is_primary_for_business: true,
  primary_color: '#1F6F5C',
  secondary_color: '#F4EDE4',
  accent_color: '#E07A5F',
  logo_url: 'https://cdn.example/alba-logo.png',
  tagline: 'Sérum facial de niacinamida y aloe hecho en Heredia',
  brand_voice: 'cercana, clara, sin exageraciones',
  tone_keywords: ['cálida', 'honesta'],
  must_use_phrases: ['Hecho en Heredia'],
  forbidden_phrases: ['piel perfecta', 'milagro'],
  target_audience: 'Personas que empiezan una rutina facial',
  visual_style_notes: 'luz natural, piedra húmeda, verdes suaves',
  font_primary: 'Playfair Display',
  font_secondary: 'Inter',
  reference_images: ['https://cdn.example/ref-1.jpg'],
  style_dnas: [{ id: 'dna_1', name: 'Feed', kind: 'ads', referenceUrls: ['https://cdn.example/style-1.jpg'], notes: 'fondos cálidos' }],
}

export const kitAOther: Row = { ...kitA, id: KIT_A_OTHER, name: 'Alba kit 2', is_primary_for_business: false, primary_color: '#000000' }

export const productA: Row = {
  id: PROD_A,
  owner_id: USER_A,
  business_id: BIZ_A,
  name: 'Sérum Niacinamida 30 ml',
  type: 'product',
  product_description: 'Sérum facial ligero para piel mixta',
  main_problem: 'poros abiertos que se notan en fotos',
  real_pain: 'brillo en la zona T a media tarde',
  expected_result: 'piel con textura más pareja',
  differentiation: 'Fórmula ligera hecha en Heredia',
  key_objection: 'ya probé sérums y no noté nada',
  shipping_info: 'Envíos a todo Costa Rica por Correos',
  has_guarantee: true,
  guarantee_details: 'Cambio si te da reacción en los primeros 15 días',
  technical_specs: 'Niacinamida 5% y aloe vera',
  svc_process_steps: '2 gotas en la noche sobre piel limpia',
  offer: '2 por ₡22.000',
  re_price: '₡12.900',
  price_range: 'medio',
  product_variations: ['30 ml'],
  stock_limited: false,
  updated_at: '2026-10-05T12:00:00.000Z',
}

export const productABucket: Row = {
  ...productA,
  id: PROD_A_BUCKET,
  name: 'Sérum Noche',
  re_price: null,
  offer: null,
  price_range: 'medio',
}

export const businessB: Row = { id: BIZ_B, owner_id: USER_B, name: 'Otra Marca', sales_channels: [], does_shipping: false }
export const productB: Row = { id: PROD_B, owner_id: USER_B, business_id: BIZ_B, name: 'Producto B', type: 'product', re_price: '₡1.000' }

export const imagesA: Row[] = [
  { id: 'img-ctx', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/context.jpg', kind: 'context', message_id: null },
  { id: 'img-gen', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/generated.png', kind: 'generated', message_id: 'm1' },
  { id: 'img-prod', product_id: PROD_A, user_id: USER_A, image_url: 'https://cdn.example/serum.jpg', kind: 'product', message_id: null },
  { id: 'img-prod-http', product_id: PROD_A, user_id: USER_A, image_url: 'http://insecure.example/serum.jpg', kind: 'product', message_id: null },
]

export const storedAnalysisA: StoredSiteAnalysis = {
  sourceUrl: 'https://alba.example',
  completedAt: '2026-10-01T00:00:00.000Z',
  analysis: {
    facts: {
      businessName: 'Alba Botánica',
      re_price: '₡9.900',
      result: 'Reduce poros en 7 días',
      primary_color: '#999999',
    },
    evidence: {
      businessName: { origin: 'web', confidence: 0.9, evidence: ['Alba Botánica'], sourceUrls: ['https://alba.example'] },
      re_price: { origin: 'web', confidence: 0.9, evidence: ['Precio ₡9.900'], sourceUrls: ['https://alba.example'] },
      result: { origin: 'inferred', confidence: 0.5, evidence: [], sourceUrls: [] },
    },
    pages: [{ url: 'https://alba.example', title: 'Alba', ok: true }],
    assets: { logoCandidates: ['https://alba.example/logo-site.png'], faviconCandidates: [], imageCandidates: [], colors: ['#999999'], fonts: [] },
    warnings: [],
  } as SiteAnalysisResult,
}

export interface FakeSavedDb extends SavedBrandDb {
  businesses: Row[]
  kits: Row[]
  products: Row[]
  images: Row[]
  analyses: Map<string, StoredSiteAnalysis>
}

export function fakeSavedBrandDb(): FakeSavedDb {
  const db: FakeSavedDb = {
    businesses: [structuredClone(businessA), structuredClone(businessB)],
    kits: [structuredClone(kitA), structuredClone(kitAOther)],
    products: [structuredClone(productA), structuredClone(productABucket), structuredClone(productB)],
    images: structuredClone(imagesA),
    analyses: new Map([[BIZ_A, structuredClone(storedAnalysisA)]]),
    async getBusiness(userId, businessId) {
      return db.businesses.find((b) => b.id === businessId && b.owner_id === userId) ?? null
    },
    async listBrandKits(userId, businessId) {
      return db.kits.filter((k) => k.business_id === businessId && k.user_id === userId)
    },
    async getProduct(userId, businessId, productId) {
      const owned = db.products.filter((p) => p.business_id === businessId && p.owner_id === userId)
      return (productId ? owned.find((p) => p.id === productId) : owned[0]) ?? null
    },
    async listProductImages(userId, productId) {
      return db.images.filter((i) => i.product_id === productId && i.user_id === userId)
    },
    async getLatestSiteAnalysis(userId, businessId) {
      const biz = db.businesses.find((b) => b.id === businessId && b.owner_id === userId)
      return biz ? db.analyses.get(businessId) ?? null : null
    },
  }
  return db
}

export interface LibraryRow {
  id: string
  productId: string
  userId: string
  imageUrl: string
  kind: 'generated'
  label: string
}

/** product_images (kind 'generated') with the same owner check + per-URL dedupe as the Supabase impl. */
export function fakeLibrary(db: FakeSavedDb): AdPackLibrary & { rows: LibraryRow[]; calls: number } {
  const lib = {
    rows: [] as LibraryRow[],
    calls: 0,
    async saveRenders(input: Parameters<AdPackLibrary['saveRenders']>[0]) {
      lib.calls++
      const product = db.products.find((p) => p.id === input.productId && p.owner_id === input.userId)
      if (!product) throw new Error('adpack_library_failed: offer not found for this user')
      return input.renders.map((r) => {
        let row = lib.rows.find((x) => x.productId === input.productId && x.userId === input.userId && x.imageUrl === r.imageUrl)
        if (!row) {
          row = {
            id: `pi-${lib.rows.length + 1}`,
            productId: input.productId,
            userId: input.userId,
            imageUrl: r.imageUrl,
            kind: 'generated',
            label: libraryLabel({ packId: input.packId, itemIndex: input.itemIndex, ratio: r.ratio, headline: input.headline }),
          }
          lib.rows.push(row)
        }
        return { ratio: r.ratio, imageUrl: r.imageUrl, productImageId: row.id }
      })
    },
  }
  return lib
}
