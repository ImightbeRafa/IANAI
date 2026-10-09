/**
 * Minimal MCP JSON-RPC host for Grok Custom Connector.
 */

import { sectionsFromStoredContent } from '../guiones/script-sections-parse.js'
import { listEnabledMcpTools, getMcpTool } from './tool-registry.js'
import {
  dispatchAdminTool,
  isAdminToolName,
  type McpAdminStore,
} from './admin-tools.js'
import {
  mcpGetBrandContext,
  mcpListBrandsWithDuplicates,
  type McpAuthUser,
  type McpDbClient,
} from './user-tools.js'
import {
  mcpCreateOffer,
  mcpSetPrimaryProductImage,
  mcpTagProductImage,
  mcpUpdateOffer,
  type McpOfferStore,
} from './offer-tools.js'
import { mcpCreateUploadUrl, mcpFinalizeUpload, LOGO_VARIANTS, UPLOAD_KINDS } from './upload-tools.js'
import { IMPORT_BATCH_MAX, IMPORT_KINDS, IMPORT_ROLES, mcpImportImage, mcpImportImages } from './import-image-tools.js'
import { mcpCreateBrand, SALES_CHANNELS } from './brand-tools.js'
import type { RemoteFetch } from './remote-image.js'
import { createRehoster, type RehostFn } from './asset-rehost.js'
import { PRODUCT_IMAGE_TAGS } from '../product-image-order.js'
import { getMcpUrlContextStatus, saveMcpUrlContext, type McpUrlIntakeStore } from './url-intake.js'
import { CreateAdsInputError, routeCreateAds } from './create-ads.js'
import {
  mcpGuideBrandPack,
  mcpGuideImage,
  mcpGuideScript,
} from './guide-packs.js'
import {
  mcpWorkspaceImportAsset,
  mcpWorkspaceIngestFile,
  mcpWorkspaceNoteGeneratedOutside,
  mcpWorkspaceSaveArtifact,
  type McpWorkspaceStore,
} from './workspace-ops.js'
import {
  mcpExecuteCarouselGenerate,
  mcpExecuteImageEdit,
  mcpExecuteImageEnhance,
  mcpExecuteImageGenerate,
  mcpExecuteScriptGenerate,
} from './execute-tools.js'
import {
  mcpExecuteBulkPosts,
  mcpExecuteBulkScripts,
  mcpExecuteCampaignPack,
  resumeMcpCampaignPack,
  mcpGuideBulkAngles,
  mcpListStyleDnas,
  mcpSetStyleDna,
} from './bulk-tools.js'
import type { McpApprovalStore } from './approval.js'
import type { McpArtifactStore } from './artifact-store.js'
import { buildExecuteStatusMessage, getMcpExecuteResult, scheduleMcpExecuteWork } from './execute-job.js'
import {
  mcpArchiveBrand,
  mcpDeleteAsset,
  mcpDeleteBrand,
  mcpDeleteOffer,
  type McpDeleteStore,
} from './delete-tools.js'
import { mcpConfirmExecute } from './confirm-execute.js'
import {
  mcpCreateBrandKit,
  mcpDeleteBrandKit,
  mcpGetBrandKit,
  mcpLinkBrandKit,
  mcpListBrandKits,
  mcpSetPrimaryBrandKit,
  mcpUpdateBrandKit,
  type McpBrandKitStore,
} from './brand-kit-tools.js'
import { auditMcpToolCall } from './tool-audit.js'
import { isAdPackMcpTool } from './adpack-tool-names.js'
import type { AdPackService } from '../adpack/service.js'

export const MCP_PROTOCOL_VERSION = '2025-03-26'
export const MCP_SERVER_INFO = {
  name: 'advance-ai',
  version: '0.13.0',
  title: 'Advance AI',
  websiteUrl: 'https://advanceai.studio',
  icons: [{ src: 'https://advanceai.studio/brand/advance-mark.png', mimeType: 'image/png', sizes: ['74x73'] }],
}

/** Prefer Error.message; also accept PostgREST-style `{ message, code }` objects. */
export function formatMcpToolErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message
  if (err && typeof err === 'object') {
    const row = err as { message?: unknown; error?: unknown; details?: unknown }
    if (typeof row.message === 'string' && row.message.trim()) return row.message
    if (typeof row.error === 'string' && row.error.trim()) return row.error
    if (typeof row.details === 'string' && row.details.trim()) return row.details
  }
  if (typeof err === 'string' && err.trim()) return err
  return 'Tool failed'
}

export function formatMcpToolErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const row = err as { code?: unknown; status?: unknown }
    if (typeof row.code === 'string' && row.code.trim()) return row.code
    if (typeof row.code === 'number') return String(row.code)
    if (typeof row.status === 'string' && row.status.trim()) return row.status
    if (typeof row.status === 'number') return String(row.status)
  }
  return undefined
}

/** Structured error details (AdPackError.details) spread into the error body; plain objects only. */
export function formatMcpToolErrorDetails(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') return {}
  const details = (err as { details?: unknown }).details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(details as Record<string, unknown>)) {
    if (k === 'message' || k === 'code') continue
    out[k] = v
  }
  return out
}

export type McpJsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export type McpJsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function ok(id: string | number | null | undefined, result: unknown): McpJsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function fail(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown
): McpJsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } }
}

function toolInputSchema(name: string): Record<string, unknown> {
  const brand = { brandId: { type: 'string' } }
  const kitWritable = {
    name: { type: 'string' },
    logoUrl: { type: 'string' },
    primaryColor: { type: 'string' },
    secondaryColor: { type: 'string' },
    accentColor: { type: 'string' },
    fontPrimary: { type: 'string' },
    fontSecondary: { type: 'string' },
    tagline: { type: 'string' },
    industry: { type: 'string' },
    targetAudience: { type: 'string' },
    brandVoice: { type: 'string' },
    visualStyleNotes: { type: 'string' },
    toneKeywords: { type: 'array', items: { type: 'string' } },
    mustUsePhrases: { type: 'array', items: { type: 'string' } },
    forbiddenPhrases: { type: 'array', items: { type: 'string' } },
    referenceImageUrls: { type: 'array', items: { type: 'string' } },
    isActive: { type: 'boolean' },
    isDefault: { type: 'boolean' },
    setAsPrimary: { type: 'boolean' },
    fonts: {
      type: 'object',
      description: 'Alias of fontPrimary/fontSecondary: { heading, body } (e.g. { heading: "Space Grotesk", body: "Inter" }).',
      properties: { heading: { type: 'string' }, body: { type: 'string' } },
      additionalProperties: false,
    },
    colors: {
      type: 'object',
      description: 'Alias of primaryColor/secondaryColor/accentColor; hex values like #1F6F5C.',
      properties: { primary: { type: 'string' }, secondary: { type: 'string' }, accent: { type: 'string' } },
      additionalProperties: false,
    },
    audiences: {
      type: 'array',
      maxItems: 8,
      description: 'Real audience segments. Placeholders like "country", "todo el país", "Personas 18–65" are rejected.',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, ageMin: { type: 'integer' }, ageMax: { type: 'integer' }, geo: { type: 'string' } },
        required: ['label'],
        additionalProperties: false,
      },
    },
    locale: { type: 'string', description: 'e.g. "es-CR". Sets the ad language.' },
    register: { type: 'string', enum: ['voseo', 'tuteo', 'usted'], description: 'HARD rule for Spanish copy (not just a tone note).' },
    do: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Style/voice rules to follow.' },
    dont: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Things the brand never says/does (become forbidden phrases).' },
    logoVariants: {
      type: 'array',
      maxItems: 8,
      description: 'https logo files per variant; external links are copied into Advance storage.',
      items: {
        type: 'object',
        properties: { url: { type: 'string' }, variant: { type: 'string', enum: ['primary', 'light', 'dark', 'badge', 'wordmark', 'icon'] } },
        required: ['url', 'variant'],
        additionalProperties: false,
      },
    },
    styleDnaIds: { type: 'array', items: { type: 'string' }, description: 'Style DNA ids (list_style_dnas) this brand uses by default.' },
  }
  const money = {
    type: 'object',
    description: 'Exact amount as a number + currency, e.g. { amount: 14900, currency: "CRC" } → "₡14.900".',
    properties: { amount: { type: 'number' }, currency: { type: 'string', enum: ['CRC', 'USD'] } },
    required: ['amount', 'currency'],
    additionalProperties: false,
  }
  const strList = (description: string) => ({ type: 'array', items: { type: 'string' }, maxItems: 20, description })
  const offerFields: Record<string, unknown> = {
    name: { type: 'string', description: 'Real product name (not the brand name).' },
    type: { type: 'string', enum: ['product', 'service', 'restaurant', 'real_estate', 'indumentaria'] },
    description: { type: 'string' },
    differentiation: { type: 'string' },
    keyObjection: { type: 'string' },
    guarantee: { type: 'string' },
    mainProblem: { type: 'string' },
    realPain: { type: 'string' },
    expectedResult: { type: 'string' },
    result: { type: 'string' },
    bestCustomers: { type: 'string' },
    targetAudience: { type: 'string' },
    purchaseReason: { type: 'string' },
    shippingInfo: { type: 'string' },
    technicalSpecs: { type: 'string' },
    utility: { type: 'string' },
    offerText: { type: 'string' },
    callToAction: { type: 'string' },
    productCategory: { type: 'string' },
    price: money,
    compareAtPrice: { ...money, description: '"Before" price (must be higher than price).' },
    bundles: {
      type: 'array',
      maxItems: 6,
      description: 'Bundle prices, e.g. [{ qty: 2, price: 29800, label: "2 kits" }] → "2 kits por ₡29.800".',
      items: {
        type: 'object',
        properties: { qty: { type: 'integer', minimum: 2 }, price: { type: 'number' }, label: { type: 'string' } },
        required: ['qty', 'price'],
        additionalProperties: false,
      },
    },
    shipping: {
      type: 'object',
      description: 'Exact shipping sentence + rule, e.g. { text: "Envío gratis desde 2 kits", freeFromQty: 2 }.',
      properties: { text: { type: 'string' }, freeFromQty: { type: 'integer' }, freeFromAmount: { type: 'number' } },
      additionalProperties: false,
    },
    includes: strList('What the offer includes (exact).'),
    excludes: strList('What is NOT included, e.g. "Papel no incluido". Copy may never say it is included.'),
    allowedClaims: strList('Claims the owner allows (used verbatim).'),
    forbiddenClaims: strList('Claims that must never appear (e.g. "armado en minutos").'),
    verifiedClaims: {
      type: 'array',
      maxItems: 20,
      description: 'Verified claims bank: when present, only claims traceable to a confirmed fact or one of these ship.',
      items: {
        type: 'object',
        properties: { claim: { type: 'string' }, source: { type: 'string' } },
        required: ['claim', 'source'],
        additionalProperties: false,
      },
    },
    cta: {
      type: 'object',
      properties: { text: { type: 'string' }, channels: { type: 'array', items: { type: 'string', enum: ['web', 'whatsapp', 'dm'] } } },
      additionalProperties: false,
    },
    ageMin: { type: 'integer', minimum: 0, maximum: 99, description: 'Recommended minimum age → fact "Edad 8+".' },
    immutableAttributes: strList('Product attributes image tools must never change (e.g. "hélices blancas").'),
    lockProductAppearance: { type: 'boolean', description: 'Never redraw the product (respected by image tools).' },
    allowedProps: strList('Kit parts/props allowed in scenes besides the reference photo.'),
    locale: { type: 'string', description: 'e.g. "es-CR".' },
  }
  const productImageIdsProp = {
    type: 'array',
    items: { type: 'string' },
    maxItems: 8,
    description: 'productImageId values (list_assets) to use as the product photo pool, in order (first = hero). Default: primary → hero tag → sharpest → newest.',
  }
  const productImageIdsByAdProp = {
    type: 'object',
    description: 'Per-ad photos: { "1": ["<productImageId>"], "3": [...] } (ad numbers as in adpack_status).',
    additionalProperties: { type: 'array', items: { type: 'string' }, maxItems: 4 },
  }
  const adpackDna = {
    type: 'object',
    description: 'BrandDna object exactly as returned by adpack_dna_ingest / adpack_dna_confirm (version 1).',
  }
  const adpackOffer = {
    type: 'object',
    description: 'Offer: { name, facts: [{ key, value, source, confirmed }], productImageUrls: [https URLs, first = hero], productId? }',
    properties: {
      name: { type: 'string' },
      productId: { type: 'string' },
      facts: { type: 'array', items: { type: 'object' } },
      productImageUrls: { type: 'array', items: { type: 'string' } },
      productCutoutUrl: { type: 'string' },
      productPhotos: {
        type: 'array',
        maxItems: 8,
        description: 'Real photos with a role, one per part of a multi-part product (e.g. the plane = hero, the gamepad controller = part, the box = box). Parts are never invented.',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            role: { type: 'string', enum: ['hero', 'part', 'contents', 'box', 'in_use', 'detail'] },
            label: { type: 'string' },
          },
          required: ['url', 'role'],
        },
      },
      allowedProps: { type: 'array', items: { type: 'string' }, description: 'Kit objects allowed in scenes besides the product.' },
      immutableAttributes: { type: 'array', items: { type: 'string' }, description: 'Appearance facts that must never change (e.g. "hélices blancas").' },
    },
    required: ['name'],
  }
  const adpackSize = { type: 'number', minimum: 1, maximum: 20, description: 'Ads in the pack (default 10). The approval shows exactly this many; the pack never runs fewer.' }
  const adpackRatios = {
    type: 'array',
    items: { type: 'string', enum: ['1:1', '4:5', '9:16', '16:9'] },
    description: 'Default ["4:5","9:16"] (feed + story). Add "1:1" / "16:9" if needed, or later for free with adpack_resize.',
  }
  const adpackLanguageRules = {
    locale: { type: 'string', description: 'e.g. "es-CR". Makes the register a HARD rule (copy in another register is rejected/repaired). es-CR/es-AR/… default to voseo.' },
    register: { type: 'string', enum: ['voseo', 'tuteo', 'usted'], description: 'Spanish register; with locale it is enforced, not just a tone note.' },
    forbiddenPhrases: { type: 'array', items: { type: 'string' }, description: 'Extra phrases the ads must never contain (merged with the brand kit list). Checked on image text, caption and script.' },
    forbiddenClaims: { type: 'array', items: { type: 'string' }, description: 'Claims the ads must never make (e.g. "armado en minutos"). Checked like forbiddenPhrases.' },
  }
  const productFidelityProps = {
    productFidelity: {
      type: 'string',
      enum: ['exact', 'generated'],
      description: 'exact (default when a product photo exists; forced when the offer locks the product appearance) = the real product photo pixels are cut out and composited into a generated scene, with a fidelity score; generated = the image model redraws the product from the reference. Same price either way.',
    },
    relight: {
      type: 'string',
      enum: ['auto', 'ai'],
      description: 'exact mode relighting, always included and free (never changes the quote): "auto" (default) = deterministic photographic harmonization of the real product into the scene (light direction, shading, white balance + shared grade, light wrap, contact/cast shadows, reflection on glossy surfaces, grain) without redrawing product pixels; "ai" = the same plus an image-edit relight pass kept only if the product still matches (fidelity). Older boolean values are still accepted (true = "ai").',
    },
    allowedProps: { type: 'array', items: { type: 'string' }, maxItems: 12, description: 'Kit objects that may appear besides the product (ambient props like table/plants/fabric are always allowed). Defaults to the offer ad_profile.' },
    immutableAttributes: { type: 'array', items: { type: 'string' }, maxItems: 12, description: 'Product appearance facts that must never change, used in prompts and checks. Defaults to the offer ad_profile.' },
  }
  const adpackPackId = { type: 'string', description: 'packId returned by adpack_start' }
  const adpackSelection = {
    angleIds: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string' },
      description: 'Optional angles to make: ids from adpack_angles (any board size) OR shared catalog ids "<category>-<hookType>-<format>" (e.g. guide_bulk_angles adpackAngleId "regalo-desire-handheld_overlay"); legacy "aNN-…" ids parse too. The pack runs exactly these (× variations); an id the offer cannot honor is rejected before approval (BAD_INPUT rejectedAngles), never silently dropped.',
    },
    angles: {
      type: 'array',
      maxItems: 20,
      items: { type: 'object' },
      description: 'Optional adpackAngle objects copied from guide_bulk_angles (keeps the full hook). Rebuilt against the offer\'s confirmed facts.',
    },
    variations: { type: 'number', minimum: 1, maximum: 3, description: 'Ads per angle (1–3): same angle and copy, different scene, composition and layout family. Credits = ads × variations.' },
    creativeFreedom: { type: 'string', enum: ['high', 'guided'], description: 'high (default when you only give brand/offer): Advance chooses angle, hook, format, layout family and scene. guided: keep your angle picks exactly.' },
    layoutFamily: {
      type: 'string',
      enum: ['bold_pill', 'editorial_minimal', 'split_panel', 'full_bleed_type', 'badge_corner', 'framed_card', 'ugc_native'],
      description: 'Optional: force one visual layout family (default: Style DNA, else a rotation of ≤ 2 ads per family per 10).',
    },
  }
  const adpackSavedBrand = {
    brandId: { type: 'string', description: 'Brand id from list_brands. Use INSTEAD of dna + offer: the server builds them from the saved brand, kit and offer.' },
    offerId: { type: 'string', description: 'Offer id from list_offers / get_brand_context (optional; default = the brand\'s most recent offer).' },
    brandKitId: { type: 'string', description: 'Optional linked brand kit id (default = primary kit).' },
    productImageIds: productImageIdsProp,
    productImageIdsByAd: productImageIdsByAdProp,
  }
  const correctionProps = {
    saveToOffer: { type: 'boolean', description: 'Persist offerPatch into the saved offer (same as update_offer) before building the pack.' },
    offerPatch: { type: 'object', description: 'Corrected offer fields (same as update_offer, e.g. { price: { amount: 14900, currency: "CRC" }, excludes: ["Papel no incluido"] }).', properties: offerFields, additionalProperties: false },
    saveToBrandKit: { type: 'boolean', description: 'Persist brandKitPatch into the primary (or brandKitId) kit (same as update_brand_kit).' },
    brandKitPatch: { type: 'object', description: 'Corrected kit fields (same as update_brand_kit).', properties: kitWritable, additionalProperties: false },
    includeDna: { type: 'boolean', description: 'Echo the full Brand DNA (default false: compact dnaSummary).' },
  }
  switch (name) {
    case 'adpack_from_brand':
      return {
        type: 'object',
        properties: {
          ...adpackSavedBrand,
          ...correctionProps,
          refresh: { type: 'boolean', description: 'Re-read the stored website live (slower). Default false: use saved data only.' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'adpack_dna_ingest':
      return {
        type: 'object',
        properties: {
          websiteUrl: { type: 'string' },
          instagramUrl: { type: 'string', description: 'Instagram profile URL or @handle' },
          uploads: {
            type: 'array',
            maxItems: 12,
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['product_photo', 'logo', 'reference_ad', 'review_screenshot', 'document'] },
                url: { type: 'string', description: 'https URL (no base64 from chat)' },
                text: { type: 'string' },
                name: { type: 'string' },
              },
              required: ['kind'],
            },
          },
          offerForm: {
            type: 'object',
            description: '{ name?, brandName?, facts?: { price: "9900 CRC", ... }, productImageUrls? }',
          },
          userFacts: {
            type: 'array',
            items: {
              type: 'object',
              properties: { key: { type: 'string' }, value: { type: 'string' }, evidence: { type: 'string' } },
              required: ['key', 'value'],
            },
          },
          language: { type: 'string', enum: ['es', 'en'] },
        },
        additionalProperties: false,
      }
    case 'adpack_dna_confirm':
      return {
        type: 'object',
        properties: {
          dna: adpackDna,
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                op: { type: 'string', enum: ['confirm', 'edit', 'add', 'remove'] },
                key: { type: 'string' },
                value: { type: 'string' },
                previousValue: { type: 'string' },
                evidence: { type: 'string' },
              },
              required: ['op', 'key'],
            },
          },
        },
        required: ['dna', 'edits'],
        additionalProperties: false,
      }
    case 'adpack_angles':
      return {
        type: 'object',
        properties: { ...adpackSavedBrand, dna: adpackDna, offer: adpackOffer, size: adpackSize, brief: { type: 'string', maxLength: 500 } },
        additionalProperties: false,
      }
    case 'adpack_quote':
      return {
        type: 'object',
        properties: {
          ...adpackSavedBrand,
          size: adpackSize,
          dna: adpackDna,
          offer: adpackOffer,
          brief: { type: 'string', maxLength: 500 },
          ...adpackSelection,
          productFidelity: productFidelityProps.productFidelity,
          relight: productFidelityProps.relight,
        },
        additionalProperties: false,
      }
    case 'adpack_start':
      return {
        type: 'object',
        properties: {
          ...adpackSavedBrand,
          ...correctionProps,
          brief: {
            type: 'string',
            maxLength: 500,
            description: 'Optional campaign context from the user, e.g. "Black Friday, focus on bundles". Steers theme/emphasis only; never used as a fact, price or promise.',
          },
          dna: adpackDna,
          offer: adpackOffer,
          size: adpackSize,
          ...adpackSelection,
          styleDnaId: { type: 'string', description: 'Optional Style DNA id from list_style_dnas (winner/reference ads): layout family, copy density and type weight follow it as a quality floor. Needs brandId.' },
          ratios: adpackRatios,
          ...adpackLanguageRules,
          businessId: { type: 'string', description: 'dna/offer path only: brand folder to link the pack to.' },
          ...productFidelityProps,
          approvalRequestId: {
            type: 'string',
            description: 'After in-chat confirm_execute approve. Do not invent. Retry with the exact same arguments.',
          },
        },
        // Either brandId (+ offerId) or dna + offer; the service validates which one was sent.
        additionalProperties: false,
      }
    case 'adpack_status':
      return {
        type: 'object',
        properties: { packId: adpackPackId, language: { type: 'string', enum: ['es', 'en'] } },
        required: ['packId'],
        additionalProperties: false,
      }
    case 'adpack_edit_text':
      return {
        type: 'object',
        properties: {
          packId: adpackPackId,
          itemId: { type: 'string' },
          copy: {
            type: 'object',
            properties: {
              headline: { type: 'string' },
              subline: { type: 'string' },
              bullets: { type: 'array', items: { type: 'string' }, maxItems: 4 },
              offerLine: { type: 'string' },
              cta: { type: 'string' },
              caption: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        required: ['packId', 'itemId', 'copy'],
        additionalProperties: false,
      }
    case 'adpack_resize':
      return {
        type: 'object',
        properties: {
          packId: adpackPackId,
          itemId: { type: 'string', description: 'itemId of a finished ad (from adpack_status / deliverable)' },
          ratios: {
            type: 'array',
            items: { type: 'string', enum: ['1:1', '4:5', '9:16', '16:9'] },
            minItems: 1,
            description: 'Ratios to add, e.g. ["1:1"]. Exact-mode ads re-composite the same real-product cut-out (fidelity re-checked, text kept off the product).',
          },
        },
        required: ['packId', 'itemId', 'ratios'],
        additionalProperties: false,
      }
    case 'create_ads':
      return {
        type: 'object',
        properties: {
          brandId: { type: 'string', description: 'Brand id from list_brands.' },
          offerId: { type: 'string', description: 'Offer id from list_offers (optional; default = most recent offer).' },
          mode: { type: 'string', enum: ['pack', 'single', 'carousel', 'edit'], description: 'pack (default) = N static ads; single = 1 static ad; carousel = slides from a script; edit = change one existing image.' },
          count: { type: 'number', minimum: 1, maximum: 20, description: 'pack: ads (default 10); carousel: slides (2-5); single/edit: 1.' },
          ratios: { type: 'array', items: { type: 'string', enum: ['1:1', '4:5', '9:16', '16:9', '3:4'] }, description: 'pack/single default ["4:5","9:16"] (16:9 available); carousel/edit: one ratio.' },
          brief: { type: 'string', maxLength: 500, description: 'pack/single: campaign context (never a fact); carousel: design direction; edit: the change (if editPrompt is not given).' },
          // pack/single: same creative controls as adpack_start (angleIds, angles, variations, creativeFreedom, layoutFamily).
          ...adpackSelection,
          styleDnaId: { type: 'string', description: 'pack/single: Style DNA id from list_style_dnas; layouts follow the winning ads of the brand.' },
          brandKitId: { type: 'string' },
          ...adpackLanguageRules,
          productImageIds: productImageIdsProp,
          productImageIdsByAd: productImageIdsByAdProp,
          ...correctionProps,
          ...productFidelityProps,
          scriptId: { type: 'string', description: 'carousel: script to turn into slides.' },
          scriptContent: { type: 'string', description: 'carousel: script text (instead of scriptId).' },
          subtype: { type: 'string', enum: ['educational-list', 'how-to-steps', 'before-after', 'myth-vs-fact'] },
          editPrompt: { type: 'string', description: 'edit: what to change.' },
          productImageId: { type: 'string', description: 'edit: image to change (from list_assets); carousel: product reference.' },
          imageUrl: { type: 'string', description: 'edit: https URL of the image to change.' },
          referenceImageIds: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          language: { type: 'string', enum: ['es', 'en'] },
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string', description: 'After in-chat confirm_execute approve. Do not invent. Retry with the exact same arguments.' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'workspace_url_context_status':
      return {
        type: 'object',
        properties: {
          intakeId: { type: 'string', description: 'id / jobId returned by workspace_save_url_context' },
        },
        required: ['intakeId'],
        additionalProperties: false,
      }
    case 'adpack_regenerate':
      return {
        type: 'object',
        properties: {
          packId: adpackPackId,
          itemId: { type: 'string' },
          mode: { type: 'string', enum: ['copy', 'scene'], description: 'copy = new copy + image; scene = keep text, new image (default)' },
          approvalRequestId: { type: 'string', description: 'After in-chat confirm_execute approve. Do not invent.' },
        },
        required: ['packId', 'itemId'],
        additionalProperties: false,
      }
    case 'get_brand_context':
      return {
        type: 'object',
        properties: {
          ...brand,
          brandKitId: {
            type: 'string',
            description: 'Optional linked kit id; otherwise primary/default resolution.',
          },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'create_brand':
      return {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Real brand name.' },
          location: { type: 'string' },
          salesChannels: { type: 'array', items: { type: 'string', enum: [...SALES_CHANNELS] } },
          doesShipping: { type: 'boolean' },
          shippingMethod: { type: 'string' },
          icpDescription: { type: 'string', description: 'Who buys (ideal customer), in the owner\'s words.' },
          createKit: { type: 'boolean', description: 'Create the primary brand kit too (default true).' },
          kit: { type: 'object', description: 'Optional kit fields now (same as update_brand_kit).', properties: kitWritable, additionalProperties: false },
          allowDuplicate: { type: 'boolean', description: 'Create even if a brand with the same name exists (default false: the existing brand is returned).' },
        },
        required: ['name'],
        additionalProperties: false,
      }
    case 'import_image':
    case 'import_images': {
      const item = {
        url: { type: 'string', description: 'Google Drive share link (any shape), Dropbox link or public https image URL.' },
        kind: { type: 'string', enum: [...IMPORT_KINDS] },
        role: { type: 'string', enum: [...IMPORT_ROLES], description: 'product_photo: what the photo shows — hero (the product), part (a separate kit part, e.g. the controller), box, contents (everything in the kit), in_use, detail.' },
        label: { type: 'string', maxLength: 80, description: 'Short name of what is shown, e.g. "control tipo gamepad".' },
        variant: { type: 'string', enum: [...LOGO_VARIANTS], description: 'logo only (default primary).' },
        offerId: { type: 'string', description: 'Offer to attach a product photo / reference to (required for product_photo when the brand has several offers).' },
        setPrimary: { type: 'boolean', description: 'product_photo role hero: make it the primary photo (default true).' },
      }
      if (name === 'import_image') {
        return {
          type: 'object',
          properties: { ...brand, brandKitId: { type: 'string' }, ...item },
          required: ['brandId', 'url', 'kind'],
          additionalProperties: false,
        }
      }
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: item.offerId,
          kind: { ...item.kind, description: 'Default kind for items without one.' },
          brandKitId: { type: 'string' },
          items: {
            type: 'array',
            minItems: 1,
            maxItems: IMPORT_BATCH_MAX,
            items: { type: 'object', properties: item, required: ['url'], additionalProperties: false },
          },
        },
        required: ['brandId', 'items'],
        additionalProperties: false,
      }
    }
    case 'list_offers':
    case 'guide_brand_pack':
      return { type: 'object', properties: brand, required: ['brandId'], additionalProperties: false }
    case 'list_brands':
      return {
        type: 'object',
        properties: {
          includeIncomplete: {
            type: 'boolean',
            description: 'When true, include brands without a ready brand kit. Default false.',
          },
          includeArchived: {
            type: 'boolean',
            description: 'When true, also list archived brands (archived: true). Default false.',
          },
        },
        additionalProperties: false,
      }
    case 'create_offer':
      return {
        type: 'object',
        properties: { ...brand, ...offerFields },
        required: ['brandId', 'name'],
        additionalProperties: false,
      }
    case 'update_offer':
      return {
        type: 'object',
        properties: { ...brand, offerId: { type: 'string' }, ...offerFields },
        required: ['brandId', 'offerId'],
        additionalProperties: false,
      }
    case 'set_primary_brand_kit':
      return {
        type: 'object',
        properties: { ...brand, brandKitId: { type: 'string', description: 'Kit id from list_brand_kits.' } },
        required: ['brandId', 'brandKitId'],
        additionalProperties: false,
      }
    case 'set_primary_product_image':
      return {
        type: 'object',
        properties: {
          offerId: { type: 'string' },
          productImageId: { type: 'string', description: 'productImageId from list_assets (kind product).' },
          brandId: { type: 'string' },
        },
        required: ['offerId', 'productImageId'],
        additionalProperties: false,
      }
    case 'tag_product_image':
      return {
        type: 'object',
        properties: {
          productImageId: { type: 'string' },
          tags: { type: 'array', items: { type: 'string', enum: [...PRODUCT_IMAGE_TAGS] }, maxItems: PRODUCT_IMAGE_TAGS.length },
          role: { type: 'string', description: 'Kit part shown, e.g. "control", "caja" (max 60 chars).' },
          offerId: { type: 'string' },
          brandId: { type: 'string' },
        },
        required: ['productImageId', 'tags'],
        additionalProperties: false,
      }
    case 'create_upload_url':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string', description: 'Required for product_photo.' },
          kind: { type: 'string', enum: [...UPLOAD_KINDS] },
          role: { type: 'string', description: 'product_photo: kit part ("control", "caja"); logo: variant (primary|light|dark|badge|wordmark|icon).' },
          filename: { type: 'string' },
          contentType: { type: 'string', description: 'image/png | image/jpeg | image/webp (logo also image/svg+xml; document application/pdf).' },
          sizeBytes: { type: 'number' },
        },
        required: ['brandId', 'kind', 'filename', 'contentType'],
        additionalProperties: false,
      }
    case 'finalize_upload':
      return {
        type: 'object',
        properties: { uploadId: { type: 'string', description: 'uploadId from create_upload_url.' } },
        required: ['uploadId'],
        additionalProperties: false,
      }
    case 'list_assets':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          kind: { type: 'string', enum: ['product', 'context', 'generated'] },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'list_scripts':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          sessionId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'list_brand_kits':
      return {
        type: 'object',
        properties: {
          brandId: { type: 'string' },
          includeInactive: { type: 'boolean' },
        },
        additionalProperties: false,
      }
    case 'get_brand_kit':
      return {
        type: 'object',
        properties: {
          kitId: { type: 'string' },
          brandId: { type: 'string', description: 'When kitId is omitted, resolves the primary kit for this brand.' },
        },
        additionalProperties: false,
      }
    case 'create_brand_kit':
      return {
        type: 'object',
        properties: {
          ...brand,
          ...kitWritable,
        },
        required: ['brandId', 'name'],
        additionalProperties: false,
      }
    case 'update_brand_kit':
      return {
        type: 'object',
        properties: {
          ...brand,
          kitId: { type: 'string' },
          ...kitWritable,
        },
        required: ['brandId', 'kitId'],
        additionalProperties: false,
      }
    case 'link_brand_kit':
      return {
        type: 'object',
        properties: {
          ...brand,
          kitId: { type: 'string' },
          setAsPrimary: { type: 'boolean' },
        },
        required: ['brandId', 'kitId'],
        additionalProperties: false,
      }
    case 'delete_brand_kit':
      return {
        type: 'object',
        properties: {
          kitId: { type: 'string' },
          confirm: { type: 'string', description: 'Type the exact kit name.' },
          approvalRequestId: { type: 'string' },
        },
        required: ['kitId', 'confirm'],
        additionalProperties: false,
      }
    case 'guide_script':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          goal: { type: 'string' },
          language: { type: 'string', enum: ['es', 'en'] },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'guide_image':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          scene: { type: 'string' },
          aspectRatio: { type: 'string' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'execute_image_generate':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          scene: { type: 'string' },
          aspectRatio: { type: 'string', description: '1:1, 4:5, 9:16 or 16:9 (default 9:16). Ratios Grok lacks (4:5) are generated at the nearest native ratio and reframed.' },
          aspectRatioFallback: {
            type: 'boolean',
            description: 'Deprecated (no longer needed): every supported ratio works.',
          },
          imageModel: { type: 'string', enum: ['grok-imagine'] },
          ...productFidelityProps,
          productImageId: { type: 'string' },
          referenceImageIds: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          referenceMode: { type: 'string', enum: ['use', 'none'] },
          guidePrompt: { type: 'string' },
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'execute_script_generate':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          goal: { type: 'string' },
          language: { type: 'string', enum: ['es', 'en'] },
          framework: {
            type: 'string',
            enum: ['venta_directa', 'desvalidar_alternativas', 'mostrar_servicio', 'variedad_productos', 'paso_a_paso', 'reconocimiento', 'educativo', 'storytelling', 'tendencia', 'engagement'],
          },
          variations: { type: 'number', minimum: 1, maximum: 10 },
          generationMode: { type: 'string', enum: ['mixed', 'by_type'] },
          scriptTypeConfig: { type: 'object' },
          ctaStrength: { type: 'string', enum: ['none', 'soft', 'brand_mention', 'sales'] },
          forceFreshAngles: { type: 'boolean' },
          buyerStage: { type: 'string', enum: ['cold', 'warm', 'hot'] },
          guidePrompt: { type: 'string' },
          sessionId: { type: 'string' },
          approvalRequestId: {
            type: 'string',
            description: 'After in-chat confirm_execute approve. Do not invent. Do not ask the user to open a URL.',
          },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'confirm_execute':
      return {
        type: 'object',
        properties: {
          approvalRequestId: {
            type: 'string',
            description: 'UUID from the previous approval_required response',
          },
          action: {
            type: 'string',
            enum: ['approve', 'deny'],
            description: 'approve after the user clearly says yes in this chat; deny if they cancel',
          },
          decision: {
            type: 'string',
            description: 'Alias for action (approve|deny|yes|no|sí|cancelar)',
          },
        },
        required: ['approvalRequestId'],
        additionalProperties: false,
      }
    case 'get_execute_result':
      return {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            description: 'Job id returned by execute_* (same as approvalRequestId)',
          },
          approvalRequestId: {
            type: 'string',
            description: 'Alias for jobId',
          },
        },
        required: [],
        additionalProperties: false,
      }
    case 'guide_bulk_angles':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          count: { type: 'number' },
          language: { type: 'string', enum: ['es', 'en'] },
          refresh: { type: 'boolean', description: 'Skip the 1 h cache and build a fresh board.' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'list_style_dnas':
      return { type: 'object', properties: brand, required: ['brandId'], additionalProperties: false }
    case 'set_style_dna':
      return {
        type: 'object',
        properties: {
          ...brand,
          id: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['organic', 'ads'] },
          referenceUrls: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['brandId', 'name'],
        additionalProperties: false,
      }
    case 'execute_bulk_scripts':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          count: { type: 'number', maximum: 10 },
          language: { type: 'string', enum: ['es', 'en'] },
          angleIds: { type: 'array', items: { type: 'string' } },
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string' },
          guidePrompt: { type: 'string' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'execute_bulk_posts':
    case 'execute_campaign_pack':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          count: { type: 'number', maximum: 10 },
          language: { type: 'string', enum: ['es', 'en'] },
          angleIds: { type: 'array', items: { type: 'string' } },
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string' },
          imageModel: { type: 'string' },
          styleDnaId: { type: 'string' },
          aspectRatio: { type: 'string', enum: ['1:1', '4:5', '9:16', '16:9', '3:4'] },
          aspectRatioFallback: {
            type: 'boolean',
            description: 'Deprecated (no longer needed): every supported ratio works.',
          },
          ...productFidelityProps,
          scene: { type: 'string' },
          guidePrompt: { type: 'string' },
          productImageId: { type: 'string' },
          productImageIds: { ...productImageIdsProp, maxItems: 5, description: 'Product photo pool (first = hero, rest = extra refs). Alias of productImageId + referenceImageIds.' },
          referenceImageIds: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          referenceMode: { type: 'string', enum: ['use', 'none'] },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'workspace_save_url_context':
      return {
        type: 'object',
        properties: {
          ...brand,
          url: { type: 'string' },
          wait: { type: 'boolean', description: 'Default true: analyze now (up to ~25 s) and return the result, or a jobId to poll. false = only queue it.' },
        },
        required: ['brandId', 'url'],
        additionalProperties: false,
      }
    case 'workspace_ingest_file':
      return {
        type: 'object',
        properties: {
          ...brand,
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                mimeType: { type: 'string' },
                sizeBytes: { type: 'number' },
              },
              required: ['mimeType'],
            },
          },
        },
        required: ['brandId', 'files'],
        additionalProperties: false,
      }
    case 'workspace_note_generated_outside':
      return {
        type: 'object',
        properties: {
          ...brand,
          kind: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'workspace_import_asset':
      return {
        type: 'object',
        properties: brand,
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'workspace_save_artifact':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          kind: { type: 'string', enum: ['script', 'image', 'product', 'context'] },
          title: { type: 'string' },
          content: { type: 'string', description: 'Script text. Do not send huge payloads.' },
          imageUrl: { type: 'string', description: 'https URL only — no base64 data URLs.' },
          productImageId: { type: 'string' },
          scriptId: { type: 'string' },
          sessionId: { type: 'string' },
        },
        required: ['brandId', 'kind'],
        additionalProperties: false,
      }
    case 'execute_image_edit':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          productImageId: { type: 'string' },
          imageUrl: { type: 'string', description: 'https URL of an already-in-workspace or public image. No base64.' },
          editPrompt: { type: 'string' },
          aspectRatio: { type: 'string' },
          guidePrompt: { type: 'string' },
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId', 'editPrompt'],
        additionalProperties: false,
      }
    case 'execute_image_enhance':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          productImageId: { type: 'string', description: 'Optional; defaults to the latest generated image for the offer.' },
          imageUrl: { type: 'string', description: 'Optional https URL. Defaults to the latest generated image for the offer. No base64.' },
          enhanceTier: { type: 'string', enum: ['polish', 'modernize', 'rebuild'] },
          instruction: { type: 'string' },
          aspectRatio: { type: 'string' },
          language: { type: 'string', enum: ['es', 'en'] },
          guidePrompt: { type: 'string' },
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId'],
        additionalProperties: false,
      }
    case 'execute_carousel_generate':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          scriptId: { type: 'string' },
          scriptContent: { type: 'string' },
          subtype: { type: 'string', enum: ['educational-list', 'how-to-steps', 'before-after', 'myth-vs-fact'] },
          slideCount: { type: 'number', minimum: 2, maximum: 5 },
          aspectRatio: { type: 'string', enum: ['1:1', '4:5', '9:16', '3:4'] },
          language: { type: 'string', enum: ['es', 'en'] },
          designDirection: { type: 'string' },
          slideDetails: { type: 'string' },
          productImageId: { type: 'string' },
          referenceImageIds: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          guidePrompt: { type: 'string' },
          previewFirstSlideOnly: { type: 'boolean' },
          sessionId: { type: 'string' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId'],
        anyOf: [{ required: ['scriptId'] }, { required: ['scriptContent'] }],
        additionalProperties: false,
      }
    case 'archive_brand':
      return {
        type: 'object',
        properties: {
          ...brand,
          confirm: { type: 'string', description: 'Type the exact brand name.' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId', 'confirm'],
        additionalProperties: false,
      }
    case 'delete_offer':
      return {
        type: 'object',
        properties: {
          ...brand,
          offerId: { type: 'string' },
          confirm: { type: 'string', description: 'Type the exact offer name.' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId', 'offerId', 'confirm'],
        additionalProperties: false,
      }
    case 'delete_brand':
      return {
        type: 'object',
        properties: {
          ...brand,
          confirm: { type: 'string', description: 'Type the exact brand name. Permanent. No recovery.' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId', 'confirm'],
        additionalProperties: false,
      }
    case 'delete_asset':
      return {
        type: 'object',
        properties: {
          ...brand,
          assetId: { type: 'string' },
          productImageId: { type: 'string' },
          confirm: { type: 'string', description: 'Must be DELETE.' },
          approvalRequestId: { type: 'string' },
        },
        required: ['brandId', 'confirm'],
        additionalProperties: false,
      }
    case 'admin_list_tickets':
      return {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] },
          limit: { type: 'number' },
        },
        additionalProperties: false,
      }
    case 'admin_get_ticket':
    case 'admin_request_cursor_fix':
      return {
        type: 'object',
        properties: { ticketId: { type: 'string' } },
        required: ['ticketId'],
        additionalProperties: false,
      }
    case 'admin_update_ticket':
      return {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] },
          comment: { type: 'string' },
        },
        required: ['ticketId'],
        additionalProperties: false,
      }
    case 'admin_get_usage':
      return {
        type: 'object',
        properties: {
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          source: { type: 'string', enum: ['mcp', 'web', 'cron'] },
          limit: { type: 'number' },
        },
        additionalProperties: false,
      }
    default:
      return { type: 'object', properties: {}, additionalProperties: false }
  }
}

export async function handleMcpJsonRpc(options: {
  body: McpJsonRpcRequest
  user: McpAuthUser
  db: McpDbClient
  urlIntakeStore?: McpUrlIntakeStore | null
  workspaceStore?: McpWorkspaceStore | null
  approvalStore?: McpApprovalStore | null
  artifactStore?: McpArtifactStore | null
  adminStore?: McpAdminStore | null
  deleteStore?: McpDeleteStore | null
  brandKitStore?: McpBrandKitStore | null
  /** Offers, product photo metadata, uploads (085). */
  offerStore?: McpOfferStore | null
  /** C2 rehost of external image URLs (defaults to one built on offerStore storage). */
  rehost?: RehostFn | null
  /** Download of external images (import_image, rehost). Default: SSRF-safe fetchPublicUrl. Tests inject a fake. */
  remoteFetch?: RemoteFetch | null
  /** Ad Pack service (defaults to the shared Supabase-backed service). */
  adPackService?: AdPackService | null
  isAdmin?: boolean
  appOrigin?: string
}): Promise<McpJsonRpcResponse> {
  const { body, user, db } = options
  const isAdmin = options.isAdmin === true
  if (body.jsonrpc && body.jsonrpc !== '2.0') {
    return fail(body.id, -32600, 'Invalid Request: jsonrpc must be 2.0')
  }
  const method = body.method || ''
  const params = body.params || {}

  switch (method) {
    case 'initialize':
      return ok(body.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: MCP_SERVER_INFO,
      })
    case 'notifications/initialized':
      return ok(body.id, {})
    case 'tools/list': {
      const tools = listEnabledMcpTools({ isAdmin }).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toolInputSchema(tool.name),
      }))
      return ok(body.id, { tools })
    }
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const args = (params.arguments && typeof params.arguments === 'object')
        ? params.arguments as Record<string, unknown>
        : {}
      const def = getMcpTool(name)
      if (!def || !def.enabled) {
        return fail(body.id, -32601, `Unknown or disabled tool: ${name || '(missing)'}`)
      }
      if ((def.group === 'admin' || def.risk === 'admin' || isAdminToolName(name)) && !isAdmin) {
        return fail(body.id, -32601, `Unknown or disabled tool: ${name}`)
      }
      const startedAt = Date.now()
      try {
        const payload = await dispatchEnabledTool({
          name,
          args,
          user,
          db,
          urlIntakeStore: options.urlIntakeStore,
          workspaceStore: options.workspaceStore,
          approvalStore: options.approvalStore,
          artifactStore: options.artifactStore,
          adminStore: options.adminStore,
          deleteStore: options.deleteStore,
          brandKitStore: options.brandKitStore,
          offerStore: options.offerStore,
          rehost: options.rehost !== undefined
            ? options.rehost
            : options.offerStore
              ? createRehoster({ upload: (o) => options.offerStore!.uploadBytes(o), ...(options.remoteFetch ? { fetchImpl: options.remoteFetch } : {}) })
              : null,
          remoteFetch: options.remoteFetch,
          adPackService: options.adPackService,
          isAdmin,
          appOrigin: options.appOrigin,
        })
        await auditMcpToolCall({
          userId: user.id,
          userEmail: user.email,
          toolName: name,
          risk: def.risk,
          durationMs: Date.now() - startedAt,
          success: true,
          resultPayload: payload,
        })
        return ok(body.id, {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          isError: false,
        })
      } catch (err) {
        const message = formatMcpToolErrorMessage(err)
        const code = formatMcpToolErrorCode(err)
        await auditMcpToolCall({
          userId: user.id,
          userEmail: user.email,
          toolName: name,
          risk: def.risk,
          durationMs: Date.now() - startedAt,
          success: false,
          errorMessage: message,
        })
        // Structured JSON so hosts (Grok) surface a real body instead of bare "Tool failed".
        return ok(body.id, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              toolName: name,
              // Machine-readable details (e.g. COPY_REJECTED issues[], PLAN_CHANGED approved/planned).
              error: { message, code, ...formatMcpToolErrorDetails(err) },
            }, null, 2),
          }],
          isError: true,
        })
      }
    }
    default:
      return fail(body.id, -32601, `Method not found: ${method || '(missing)'}`)
  }
}

async function dispatchEnabledTool(options: {
  name: string
  args: Record<string, unknown>
  user: McpAuthUser
  db: McpDbClient
  urlIntakeStore?: McpUrlIntakeStore | null
  workspaceStore?: McpWorkspaceStore | null
  approvalStore?: McpApprovalStore | null
  artifactStore?: McpArtifactStore | null
  adminStore?: McpAdminStore | null
  deleteStore?: McpDeleteStore | null
  brandKitStore?: McpBrandKitStore | null
  offerStore?: McpOfferStore | null
  rehost?: RehostFn | null
  remoteFetch?: RemoteFetch | null
  adPackService?: AdPackService | null
  isAdmin?: boolean
  appOrigin?: string
}): Promise<unknown> {
  if (isAdminToolName(options.name)) {
    if (!options.isAdmin) throw new Error('Admin access required')
    if (!options.adminStore) throw new Error('Admin store not configured')
    return dispatchAdminTool({
      name: options.name,
      args: options.args,
      store: options.adminStore,
    })
  }

  if (options.name === 'create_ads') {
    // G1: one entry point, routed to the existing implementation (same approvals / credits).
    let route: ReturnType<typeof routeCreateAds>
    try {
      route = routeCreateAds(options.args)
    } catch (err) {
      if (err instanceof CreateAdsInputError) {
        const e = new Error(err.message) as Error & { code: string }
        e.code = 'BAD_INPUT'
        throw e
      }
      throw err
    }
    const payload = await dispatchEnabledTool({ ...options, name: route.tool, args: route.args })
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>), via: 'create_ads', mode: route.mode, routedTo: route.tool }
      : payload
  }

  if (isAdPackMcpTool(options.name)) {
    // Lazy: the ad-pack stack pulls in satori/resvg/sharp; keep other tools' cold start lean.
    const { dispatchAdPackTool } = await import('./adpack-tools.js')
    const service = options.adPackService ?? (await import('../adpack/service.js')).getDefaultAdPackService()
    return dispatchAdPackTool({
      name: options.name,
      args: options.args,
      user: options.user,
      service,
      approvalStore: options.approvalStore,
      appOrigin: options.appOrigin,
      db: options.db,
      offerStore: options.offerStore,
      brandKitStore: options.brandKitStore,
      rehost: options.rehost,
    })
  }

  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  const brandKitId = typeof options.args.brandKitId === 'string' ? options.args.brandKitId : undefined

  switch (options.name) {
    case 'list_brands': {
      const listed = await mcpListBrandsWithDuplicates(options.db, options.user, {
        includeIncomplete: options.args.includeIncomplete === true,
        includeArchived: options.args.includeArchived === true,
      })
      return {
        brands: listed.brands,
        possibleDuplicates: listed.possibleDuplicates,
        defaultOfferPolicy:
          'Always select by brandId (never by name). Default list hides kitReady:false (includeIncomplete:true for all) and archived brands (includeArchived:true). Duplicates are never merged automatically: show possibleDuplicates to the user and archive extras with archive_brand only after they confirm.',
      }
    }
    case 'create_brand': {
      if (!options.offerStore) throw new Error('Brand store not configured')
      return mcpCreateBrand({ db: options.db, store: options.offerStore, kitStore: options.brandKitStore, user: options.user, args: options.args, rehost: options.rehost })
    }
    case 'import_image':
    case 'import_images': {
      if (!options.offerStore) throw new Error('Offer store not configured')
      const deps = {
        db: options.db,
        store: options.offerStore,
        kitStore: options.brandKitStore,
        user: options.user,
        args: options.args,
        ...(options.remoteFetch ? { fetchImpl: options.remoteFetch } : {}),
      }
      return options.name === 'import_image' ? mcpImportImage(deps) : mcpImportImages(deps)
    }
    case 'create_offer': {
      if (!options.offerStore) throw new Error('Offer store not configured')
      return mcpCreateOffer({ db: options.db, store: options.offerStore, user: options.user, args: options.args })
    }
    case 'update_offer': {
      if (!options.offerStore) throw new Error('Offer store not configured')
      return mcpUpdateOffer({ db: options.db, store: options.offerStore, user: options.user, args: options.args })
    }
    case 'set_primary_brand_kit': {
      if (!options.brandKitStore) throw new Error('Brand kit store not configured')
      return mcpSetPrimaryBrandKit({ store: options.brandKitStore, user: options.user, args: options.args })
    }
    case 'set_primary_product_image': {
      if (!options.offerStore) throw new Error('Offer store not configured')
      return mcpSetPrimaryProductImage({ store: options.offerStore, user: options.user, args: options.args })
    }
    case 'tag_product_image': {
      if (!options.offerStore) throw new Error('Offer store not configured')
      return mcpTagProductImage({ store: options.offerStore, user: options.user, args: options.args })
    }
    case 'create_upload_url': {
      if (!options.offerStore) throw new Error('Offer store not configured')
      return mcpCreateUploadUrl({ db: options.db, store: options.offerStore, user: options.user, args: options.args })
    }
    case 'finalize_upload': {
      if (!options.offerStore) throw new Error('Offer store not configured')
      return mcpFinalizeUpload({ store: options.offerStore, brandKitStore: options.brandKitStore, user: options.user, args: options.args })
    }
    case 'list_offers': {
      if (!brandId) throw new Error('brandId is required')
      const brand = await options.db.getBusinessForUser(options.user.id, brandId)
      if (!brand) throw new Error('Brand not found')
      return { offers: await options.db.listOffersForBrand(options.user.id, brandId) }
    }
    case 'list_assets': {
      if (!brandId) throw new Error('brandId is required')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      const kind = options.args.kind === 'product'
        || options.args.kind === 'context'
        || options.args.kind === 'generated'
        ? options.args.kind
        : undefined
      const assets = await options.artifactStore.listOwnedAssets({
        userId: options.user.id,
        brandId,
        offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
        kind,
      })
      return {
        brandId,
        offerId: typeof options.args.offerId === 'string' ? options.args.offerId : null,
        kind: kind || 'all',
        assets: assets.map((asset) => ({
          id: asset.id,
          productImageId: asset.id,
          offerId: asset.offerId,
          imageUrl: asset.imageUrl,
          kind: asset.kind,
          label: asset.label || null,
          createdAt: asset.createdAt || null,
        })),
      }
    }
    case 'list_scripts': {
      if (!brandId) throw new Error('brandId is required')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      const brand = await options.db.getBusinessForUser(options.user.id, brandId)
      if (!brand) throw new Error('Brand not found')
      const scripts = await options.artifactStore.listOwnedScripts({
        userId: options.user.id,
        brandId,
        offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
        sessionId: typeof options.args.sessionId === 'string' ? options.args.sessionId : undefined,
        limit: typeof options.args.limit === 'number' ? options.args.limit : undefined,
      })
      return {
        brandId,
        offerId: typeof options.args.offerId === 'string' ? options.args.offerId : null,
        sessionId: typeof options.args.sessionId === 'string' ? options.args.sessionId : null,
        scripts: scripts.map((script) => ({
          id: script.id,
          scriptId: script.id,
          title: script.title,
          content: script.content,
          sections: sectionsFromStoredContent(script.content || ''),
          offerId: script.offerId,
          sessionId: script.sessionId,
          createdAt: script.createdAt || null,
        })),
      }
    }
    case 'get_brand_context':
      return mcpGetBrandContext(options.db, options.user, brandId, brandKitId)
    case 'list_brand_kits': {
      if (!options.brandKitStore) throw new Error('Brand kit store not configured')
      return mcpListBrandKits({
        store: options.brandKitStore,
        user: options.user,
        args: options.args,
      })
    }
    case 'get_brand_kit': {
      if (!options.brandKitStore) throw new Error('Brand kit store not configured')
      return mcpGetBrandKit({
        store: options.brandKitStore,
        user: options.user,
        args: options.args,
      })
    }
    case 'create_brand_kit': {
      if (!options.brandKitStore) throw new Error('Brand kit store not configured')
      return mcpCreateBrandKit({
        store: options.brandKitStore,
        db: options.db,
        user: options.user,
        args: options.args,
        rehost: options.rehost,
      })
    }
    case 'update_brand_kit': {
      if (!options.brandKitStore) throw new Error('Brand kit store not configured')
      return mcpUpdateBrandKit({
        store: options.brandKitStore,
        user: options.user,
        args: options.args,
        rehost: options.rehost,
      })
    }
    case 'link_brand_kit': {
      if (!options.brandKitStore) throw new Error('Brand kit store not configured')
      return mcpLinkBrandKit({
        store: options.brandKitStore,
        user: options.user,
        args: options.args,
      })
    }
    case 'delete_brand_kit': {
      if (!options.brandKitStore) throw new Error('Brand kit store not configured')
      if (!options.approvalStore) throw new Error('Approval store not configured')
      return mcpDeleteBrandKit({
        store: options.brandKitStore,
        approvalStore: options.approvalStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'guide_brand_pack':
      return mcpGuideBrandPack(options.db, options.user, brandId)
    case 'guide_script':
      return mcpGuideScript(options.db, options.user, {
        brandId,
        offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
        goal: typeof options.args.goal === 'string' ? options.args.goal : undefined,
        language: typeof options.args.language === 'string' ? options.args.language : undefined,
      })
    case 'guide_image':
      return mcpGuideImage(options.db, options.user, {
        brandId,
        offerId: typeof options.args.offerId === 'string' ? options.args.offerId : undefined,
        scene: typeof options.args.scene === 'string' ? options.args.scene : undefined,
        aspectRatio: typeof options.args.aspectRatio === 'string' ? options.args.aspectRatio : undefined,
      }, options.artifactStore)
    case 'workspace_save_url_context': {
      if (!options.urlIntakeStore) throw new Error('URL intake store not configured')
      return saveMcpUrlContext({
        db: options.db,
        store: options.urlIntakeStore,
        user: options.user,
        brandId,
        url: typeof options.args.url === 'string' ? options.args.url : '',
        appOrigin: options.appOrigin,
        wait: options.args.wait !== false,
        schedule: (work) => scheduleMcpExecuteWork(async () => {
          await work()
        }),
      })
    }
    case 'workspace_url_context_status': {
      if (!options.urlIntakeStore) throw new Error('URL intake store not configured')
      const intakeId = typeof options.args.intakeId === 'string' ? options.args.intakeId : ''
      if (!intakeId) throw new Error('intakeId is required')
      const status = await getMcpUrlContextStatus({
        store: options.urlIntakeStore,
        user: options.user,
        intakeId,
        appOrigin: options.appOrigin,
        schedule: (work) => scheduleMcpExecuteWork(async () => {
          await work()
        }),
      })
      if (!status) throw new Error('URL intake not found')
      return status
    }
    case 'workspace_ingest_file': {
      if (!options.workspaceStore) throw new Error('Workspace store not configured')
      return mcpWorkspaceIngestFile({
        db: options.db,
        store: options.workspaceStore,
        user: options.user,
        brandId,
        files: Array.isArray(options.args.files)
          ? options.args.files as Array<{ name?: string; mimeType: string; sizeBytes?: number }>
          : [],
        appOrigin: options.appOrigin,
      })
    }
    case 'workspace_note_generated_outside': {
      if (!options.workspaceStore) throw new Error('Workspace store not configured')
      return mcpWorkspaceNoteGeneratedOutside({
        db: options.db,
        store: options.workspaceStore,
        user: options.user,
        brandId,
        kind: typeof options.args.kind === 'string' ? options.args.kind : undefined,
        note: typeof options.args.note === 'string' ? options.args.note : undefined,
        appOrigin: options.appOrigin,
      })
    }
    case 'workspace_import_asset':
      return mcpWorkspaceImportAsset({
        db: options.db,
        user: options.user,
        brandId,
        appOrigin: options.appOrigin,
      })
    case 'execute_script_generate': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteScriptGenerate({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'confirm_execute': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      return mcpConfirmExecute({
        approvalStore: options.approvalStore,
        user: options.user,
        args: options.args,
      })
    }
    case 'get_execute_result': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      const jobId = typeof options.args.jobId === 'string'
        ? options.args.jobId
        : typeof options.args.approvalRequestId === 'string'
          ? options.args.approvalRequestId
          : undefined
      // A campaign pack is deliberately split across requests. Polling leases the
      // next artifact (or reclaims a host-killed chunk) before returning status.
      if (jobId && options.artifactStore) {
        await resumeMcpCampaignPack({
          db: options.db,
          approvalStore: options.approvalStore,
          artifactStore: options.artifactStore,
          user: options.user,
          jobId,
          appOrigin: options.appOrigin,
        })
      }
      try {
        const result = await getMcpExecuteResult({
          approvalStore: options.approvalStore,
          userId: options.user.id,
          jobId,
          approvalRequestId:
            typeof options.args.approvalRequestId === 'string'
              ? options.args.approvalRequestId
              : undefined,
        })
        // Ad Pack jobs (adpack_start / create_ads pack): the job only says "started" — attach the live
        // pack status so the same poll returns progress and, when finished, the deliverable
        // (stable full-res PNG + JPG URLs per ad and ratio).
        const packId = typeof result.packId === 'string' ? result.packId : ''
        if (packId && (result.toolName === 'adpack_start' || result.toolName === 'adpack_regenerate' || packId === jobId)) {
          try {
            const pack = await dispatchEnabledTool({ ...options, name: 'adpack_status', args: { packId } }) as Record<string, unknown>
            // #13: the job is "running" until the pack is terminal (never "completed" while it works).
            const running = pack.moreWork === true || !['done', 'partial', 'failed', 'cancelled'].includes(String(pack.status))
            return {
              ...result,
              status: running ? 'running' : 'completed',
              statusMessage: buildExecuteStatusMessage(String(result.toolName || 'adpack_start'), running ? 'running' : 'completed'),
              packStatus: pack.status,
              moreWork: pack.moreWork,
              ...(typeof pack.etaSeconds === 'number' ? { etaSeconds: pack.etaSeconds } : {}),
              ...(typeof pack.retryAfterSeconds === 'number' ? { retryAfterSeconds: pack.retryAfterSeconds, retryAfterMs: pack.retryAfterSeconds * 1000 } : {}),
              pack,
              ...(pack.deliverable ? { deliverable: pack.deliverable } : {}),
              nextTool: pack.moreWork ? 'adpack_status' : undefined,
            }
          } catch {
            return result
          }
        }
        return result
      } catch (err) {
        // G3: a URL-intake jobId (workspace_save_url_context) resolves here too, running the work inline.
        if (jobId && err instanceof Error && err.message === 'Job not found' && options.urlIntakeStore?.getUrlIntake) {
          const status = await getMcpUrlContextStatus({
            store: options.urlIntakeStore,
            user: options.user,
            intakeId: jobId,
            appOrigin: options.appOrigin,
            schedule: (work) => scheduleMcpExecuteWork(async () => {
              await work()
            }),
          })
          if (status) return { ...status, toolName: 'workspace_save_url_context' }
        }
        throw err
      }
    }
    case 'execute_image_generate': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteImageGenerate({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'guide_bulk_angles':
      return mcpGuideBulkAngles(options.db, options.user, options.args)
    case 'list_style_dnas':
      return mcpListStyleDnas(options.db, options.user, brandId)
    case 'set_style_dna':
      return mcpSetStyleDna(options.db, options.user, options.args)
    case 'execute_bulk_scripts': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteBulkScripts({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'execute_bulk_posts': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteBulkPosts({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'execute_campaign_pack': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteCampaignPack({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'execute_image_edit': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteImageEdit({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'execute_image_enhance': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteImageEnhance({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'execute_carousel_generate': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpExecuteCarouselGenerate({
        db: options.db,
        approvalStore: options.approvalStore,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'workspace_save_artifact': {
      if (!options.artifactStore) throw new Error('Artifact store not configured')
      return mcpWorkspaceSaveArtifact({
        db: options.db,
        artifactStore: options.artifactStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
        rehost: options.rehost,
      })
    }
    case 'archive_brand': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.deleteStore) throw new Error('Delete store not configured')
      return mcpArchiveBrand({
        db: options.db,
        deleteStore: options.deleteStore,
        approvalStore: options.approvalStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'delete_offer': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.deleteStore) throw new Error('Delete store not configured')
      return mcpDeleteOffer({
        db: options.db,
        deleteStore: options.deleteStore,
        approvalStore: options.approvalStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'delete_brand': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.deleteStore) throw new Error('Delete store not configured')
      return mcpDeleteBrand({
        db: options.db,
        deleteStore: options.deleteStore,
        approvalStore: options.approvalStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    case 'delete_asset': {
      if (!options.approvalStore) throw new Error('Approval store not configured')
      if (!options.deleteStore) throw new Error('Delete store not configured')
      return mcpDeleteAsset({
        db: options.db,
        deleteStore: options.deleteStore,
        approvalStore: options.approvalStore,
        user: options.user,
        args: options.args,
        appOrigin: options.appOrigin,
      })
    }
    default:
      throw new Error(`Unhandled tool: ${options.name}`)
  }
}
