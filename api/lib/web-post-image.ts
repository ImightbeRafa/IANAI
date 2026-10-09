/**
 * Web post image — the ONE Grok Imagine request builder shared by the web app
 * (`api/generate-image.ts`, chat-shell "generar imagen") and the MCP image tools
 * (`execute_image_generate`, `execute_bulk_posts`, `execute_campaign_pack`).
 *
 * Everything that decides what Grok receives lives here: slim post prompt
 * (`buildSlimGrokPostPrompt`), logo stamp rules, CTA guardrails, the 3-reference budget
 * (product first, brand logo as style ref, scene last), product-lock routing
 * (/images/edits vs /images/generations), ratio fallback, request body, and the
 * prompt-too-long clamp retry. The web route calls the pure builders below with the same
 * inputs it always used, so its request is unchanged; the MCP calls `runWebPostGrokImage`.
 */
import { withProviderRetry } from './mcp/provider-retry.js'
import type { CTAStrength } from '../data/organic-script-prompts.js'
import { describeReferenceFailures, fetchPublicImageDetailed, type ReferenceImageFailure } from './fetch-image-data-url.js'
import { safeZoneMargins } from './mcp/safe-zones.js'
import {
  estimateGrokImageCostUsd,
  GROK_IMAGE_DEFAULT_QUALITY,
  GROK_IMAGE_DEFAULT_RESOLUTION,
  GROK_IMAGE_PROVIDER_MODEL,
} from './grok-models.js'
import { resolveGrokImageApiMode } from './grok-image-generate.js'
import {
  buildSlimGrokPostPrompt,
  GROK_IMAGE_MAX_PROMPT_BYTES,
  grokPromptUtf8ByteLength,
  GROK_IMAGE_RETRY_PROMPT_BYTES,
  isGrokPromptLengthError,
  isShellMetaImagePrompt,
  prepareGrokImagePrompt,
} from './grok-image-prompt.js'
import { selectGrokReferenceBudget } from './image-prompt-context.js'
import { buildSceneRecipe } from './image-scene-recipe.js'
import {
  buildLogoStampRules,
  buildPostCtaGuardrails,
  isBloomDermalPatchSku,
  resolveLockedOfferPrice,
  resolveProductSilhouette,
  type BloomSkuScope,
  type ProductCreativeRow,
} from './product-creative-rules.js'

/** Grok Imagine 2.0 ratios (plus common social fallbacks). */
export const WEB_GROK_SUPPORTED_RATIOS = [
  '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2',
  '19.5:9', '9:19.5', '20:9', '9:20', 'auto',
] as const
const WEB_GROK_RATIO_FALLBACK: Record<string, string> = { '4:5': '3:4', '5:4': '4:3' }

/** Same pixel-size → ratio table the web route uses. */
export function getAspectRatio(width: number, height: number): string {
  const ratio = width / height
  if (Math.abs(ratio - 1) < 0.01) return '1:1'
  if (Math.abs(ratio - 4 / 5) < 0.01) return '4:5'
  if (Math.abs(ratio - 9 / 16) < 0.01) return '9:16'
  if (Math.abs(ratio - 16 / 9) < 0.01) return '16:9'
  if (Math.abs(ratio - 4 / 3) < 0.01) return '4:3'
  if (Math.abs(ratio - 3 / 4) < 0.01) return '3:4'
  if (Math.abs(ratio - 3 / 2) < 0.01) return '3:2'
  if (Math.abs(ratio - 2 / 3) < 0.01) return '2:3'
  return '1:1'
}

/** Ratio Grok is actually called with (4:5 → 3:4, unknown → 1:1). */
export function toWebGrokAspectRatio(aspect: string): string {
  if ((WEB_GROK_SUPPORTED_RATIOS as readonly string[]).includes(aspect)) return aspect
  return WEB_GROK_RATIO_FALLBACK[aspect] || '1:1'
}

export function normalizeWebCtaStrength(raw: unknown): CTAStrength {
  const v = typeof raw === 'string' ? raw : 'sales'
  return (['none', 'soft', 'brand_mention', 'sales'] as CTAStrength[]).includes(v as CTAStrength)
    ? (v as CTAStrength)
    : 'sales'
}

export type WebPostPromptInput = {
  language?: string | null
  postStyle?: string | null
  productSubStyle?: string | null
  textDensity?: string | null
  /** The guion / on-image copy (already stripped of shell meta prompts). */
  userCopy: string
  palette: string
  brandVoice?: string | null
  brandVisual?: string | null
  businessContext?: string | null
  hasProductRefs: boolean
  hasSceneRef: boolean
  productSilhouette?: string | null
  lockedOfferPrice?: string | null
  bloomSku?: boolean
  hasBrandLogo: boolean
  ctaStrength?: unknown
  productRow?: ProductCreativeRow | null
  /** MCP only. Absent on the web route → the prompt is byte-identical to the legacy one. */
  mcp?: WebPostMcpRules
}

/**
 * MCP-only prompt rules (never passed by the web route):
 *  - `scene` becomes the binding SCENE RECIPE (instead of a "Contexto factual (NO renderizar)" line),
 *  - strict product lock + no invented props, Instagram safe-zone margins, separator hygiene,
 *  - an optional corrective hint for the one QA auto-retry.
 */
export type WebPostMcpRules = {
  scene?: string
  /** Strict product lock + no props that are not in the references / the scene / the allowed list. */
  strict?: boolean
  /** Extra objects the offer explicitly allows (offer ad_profile allowedProps / lock attributes). */
  allowedProps?: string[]
  /** Requested ratio, for the Instagram UI margins ('4:5', '9:16', …). */
  requestedRatio?: string
  /** Labels of real accessory photos attached as extra references (e.g. 'caja', 'control'). */
  accessoryLabels?: string[]
  /** Corrective instruction for the single QA retry. */
  retryHint?: string
  /** The one CTA line of the copy (exact text). Any other button / CTA text is forbidden. */
  ctaText?: string
  /** Cap the layout to: headline, one price line, one facts line, one CTA, logo. */
  layoutCap?: boolean
  /**
   * Round 5b: the logo and the CTA button are composited in CODE after generation (real kit logo asset + exact CTA text),
   * so Grok must draw neither and must leave the top / bottom bands empty.
   */
  compositeLayers?: boolean
  /** Reference slots sent to Grok (the web route is fixed at 3; xAI /images/edits accepts up to 5). MCP only. */
  refBudget?: number
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** Binding scene recipe built from the user's `scene` input (overrides the generic niche recipe). */
export function buildBindingSceneRecipe(language: 'es' | 'en', scene: string, strict: boolean): string {
  const text = scene.replace(/\s+/g, ' ').trim().slice(0, 600)
  if (language === 'en') {
    return `MANDATORY SCENE (SCENE RECIPE — DO NOT RENDER AS TEXT; the user's request overrides any generic place):
- Place and mood: ${text}
- The background MUST be that place. FORBIDDEN: a boutique/shop, office or any other generic place instead.
- Product light MUST match the set (same direction and temperature); soft contact shadows.
- Set props: ONLY what the scene names${strict ? '; no other objects' : ''}.
Goal: a complete photographed place, not a studio void.
`
  }
  return `ESCENA OBLIGATORIA DEL PEDIDO (SCENE RECIPE — NO RENDERIZAR COMO TEXTO; manda sobre cualquier lugar genérico):
- Lugar y ambiente: ${text}
- El fondo DEBE ser ese lugar. PROHIBIDO una boutique/tienda, oficina u otro lugar genérico en su lugar.
- Luz del producto: DEBE coincidir con el entorno (misma dirección y temperatura); sombras de contacto suaves.
- Props de set: SOLO lo que nombra la escena${strict ? '; ningún otro objeto' : ''}.
Objetivo: entorno fotografiado completo — un lugar real, no un vacío de estudio.
`
}

/** Generic recipe with its free-for-all "set props" line replaced by the strict no-invented-props rule. */
function strictenGenericRecipe(language: 'es' | 'en', recipe: string): string {
  if (!recipe) return recipe
  return language === 'en'
    ? recipe.replace(/^- Set props.*$/m, '- Set props: only a use-surface, ambient light and a contact shadow; NO box, controller, accessory, logo or object that is not in the reference photos')
    : recipe.replace(/^- Props de set.*$/m, '- Props de set: solo superficie de uso, luz de ambiente y sombra de contacto; NINGUNA caja, control, accesorio, logo ni objeto que no esté en las fotos de referencia')
}

export function buildMcpPromptRules(language: 'es' | 'en', rules: WebPostMcpRules, ctx: { hasProductRefs: boolean }): string {
  const es = language !== 'en'
  const m = safeZoneMargins(rules.requestedRatio || '4:5')
  const lines: string[] = []
  const cta = (rules.ctaText || '').trim().slice(0, 120)
  if (rules.compositeLayers) {
    // The logo and the CTA are composited in code afterwards: Grok paints the scene, the product and the headline / price / facts only.
    const freeTop = pct(m.top > 0.1 ? m.top + 0.02 : 0.1)
    const freeBot = pct(m.top > 0.1 ? m.bottom + 0.02 : 0.12)
    lines.push(es
      ? `REGLA 1 — FRANJAS LIBRES (Instagram tapa su UI): el ${freeTop} superior y el ${freeBot} inferior de la imagen quedan VACÍOS: sin texto, sin logo, sin botón, sin sellos; solo fondo/escena que continúa hasta el borde. El titular y la línea de precio van en la franja del medio, a ${pct(m.side)} de los costados. Nada toca ni se corta en el borde.`
      : `RULE 1 — FREE BANDS (Instagram covers its UI): the top ${freeTop} and the bottom ${freeBot} of the picture stay EMPTY: no text, no logo, no button, no badges; only the background/scene running to the edge. The headline and the price line go in the middle band, ${pct(m.side)} from the sides. Nothing touches or is cut by an edge.`)
    lines.push(es
      ? 'SIN LOGO NI BOTÓN: NO dibujes el logo de la marca, ni ningún botón, CTA, llamado a la acción, flecha, sello o insignia (el logo y el botón se agregan después, por código). Ningún texto de acción.'
      : 'NO LOGO, NO BUTTON: do NOT draw the brand logo, nor any button, CTA, call to action, arrow, seal or badge (the logo and the button are added afterwards, in code). No action text.')
    if (rules.layoutCap !== false) {
      lines.push(es
        ? 'COMPOSICIÓN LIMPIA: como máximo estos bloques de texto — un titular, UNA línea de precio, UNA línea de datos — más el producto grande. Ningún otro texto, sello, viñeta ni bloque; aire entre bloques.'
        : 'CLEAN LAYOUT: at most these text blocks — one headline, ONE price line, ONE facts line — plus a large product. No other text, badges, bullets or blocks; air between blocks.')
    }
  } else {
    // RULE 1 — margins first: the prompt clamp trims the tail, never the opening instructions.
    const topPct = pct(Math.max(0.08, m.top))
    const botPct = pct(Math.max(0.08, m.bottom))
    lines.push(es
      ? `REGLA 1 — MÁRGENES (Instagram recorta la UI): el titular y el logo quedan FUERA del ${topPct} superior; el botón CTA y todo texto quedan FUERA del ${botPct} inferior (el CTA termina a ≥ ${pct(Math.max(0.08, m.bottom) + 0.03)} del borde de abajo) y a ${pct(m.side)} de los costados. Nada toca ni se corta en el borde.`
      : `RULE 1 — MARGINS (Instagram crops its UI): the headline and logo stay OUT of the top ${topPct}; the CTA button and all text stay OUT of the bottom ${botPct} (the CTA ends ≥ ${pct(Math.max(0.08, m.bottom) + 0.03)} above the bottom edge) and ${pct(m.side)} from the sides. Nothing touches or is cut by an edge.`)
    lines.push(es
      ? `UN SOLO CTA${cta ? `: el único botón/llamado a la acción dice EXACTAMENTE «${cta}»` : ': el único botón/llamado a la acción es el de la copy'}. PROHIBIDO un segundo botón, banner o texto de acción distinto (nada de "Pedí acá", "Comprá ya", flechas ni sellos extra).`
      : `ONE CTA ONLY${cta ? `: the only button / call to action says EXACTLY "${cta}"` : ': the only button / call to action is the one in the copy'}. FORBIDDEN: a second button, banner or different action text (no "Order here", "Buy now", arrows or extra badges).`)
    if (rules.layoutCap !== false) {
      lines.push(es
        ? 'COMPOSICIÓN LIMPIA: como máximo estos bloques de texto — un titular, UNA línea de precio, UNA línea de datos, UN CTA — más el logo y el producto grande. Ningún otro texto, sello, viñeta ni bloque; aire entre bloques.'
        : 'CLEAN LAYOUT: at most these text blocks — one headline, ONE price line, ONE facts line, ONE CTA — plus the logo and a large product. No other text, badges, bullets or blocks; air between blocks.')
    }
  }
  if (rules.strict && ctx.hasProductRefs) {
    const allowed = (rules.allowedProps || []).map((a) => a.trim()).filter(Boolean).slice(0, 8)
    const accessories = (rules.accessoryLabels || []).map((a) => a.trim()).filter(Boolean).slice(0, 3)
    lines.push(es
      ? 'PRODUCTO BLOQUEADO (reforzado): NO alteres forma, partes, ruedas, tren de aterrizaje, cola, pliegues, cables, hélices, proporciones ni colores. No agregues ni quites alas, aletas, flaps ni piezas: el mismo número de partes que la foto. Es el MISMO objeto físico de la foto; solo cambian el entorno y la luz.'
      : 'PRODUCT LOCK (reinforced): do NOT alter shape, parts, wheels, landing gear, tail, folds, wires, propellers, proportions or colours. Do not add or remove wings, fins, flaps or parts: the same number of parts as the photo. It is the SAME physical object as the photo; only the environment and light change.')
    lines.push(es
      ? `PROPS: PROHIBIDO añadir objetos que no estén en las fotos de referencia adjuntas ni nombrados en la escena: ninguna caja, empaque, control/gamepad, cable, herramienta, repuesto, hoja con dibujo, logo, accesorio ni texto impreso inventado. Solo el producto${accessories.length ? ', los accesorios de las fotos adjuntas' : ''} y la superficie/ambiente.${allowed.length ? ` Únicos extras permitidos: ${allowed.join('; ')}.` : ' No hay extras permitidos.'}`
      : `PROPS: FORBIDDEN to add objects that are not in the attached reference photos or named in the scene: no box, packaging, controller/gamepad, cable, tool, spare part, drawn sheet, logo, accessory or invented printed text. Only the product${accessories.length ? ', the accessories in the attached photos' : ''} and the surface/ambience.${allowed.length ? ` Only extras allowed: ${allowed.join('; ')}.` : ' No extras allowed.'}`)
    if (accessories.length) {
      lines.push(es
        ? `Las fotos de referencia adicionales son accesorios REALES del kit (${accessories.join(', ')}): si aparecen en la escena, copialos fielmente (misma impresión, forma, botones y tamaño relativo al producto; una caja plana sigue plana, un control pequeño sigue pequeño); no son el producto principal y no los inventes distintos.`
        : `The additional reference photos are REAL kit accessories (${accessories.join(', ')}): if they appear in the scene, copy them faithfully (same print, shape, buttons and size relative to the product; a flat box stays flat, a small controller stays small); they are not the main product and must not be reinvented.`)
    }
  }
  lines.push(es
    ? 'SEPARADORES: nunca dejes "·", "|" o "—" sueltos al inicio o al final de una línea; si una línea se parte, el separador desaparece.'
    : 'SEPARATORS: never leave "·", "|" or "—" dangling at the start or end of a line; if a line wraps, the separator disappears.')
  if (rules.retryHint?.trim()) {
    lines.push(es
      ? `CORRECCIÓN (el intento anterior falló el control de calidad): ${rules.retryHint.trim().slice(0, 400)}`
      : `FIX (the previous attempt failed quality control): ${rules.retryHint.trim().slice(0, 400)}`)
  }
  return lines.join('\n')
}

/** The slim post prompt exactly as the web route assembles it. */
export function buildWebPostSourcePrompt(input: WebPostPromptInput): string {
  const langCode = input.language === 'en' ? 'en' : 'es'
  const category = input.productRow?.product_category_custom || input.productRow?.product_category || null
  const offerName = input.productRow?.name || null
  const mcp = input.mcp
  let sceneRecipe: string | undefined
  if (mcp) {
    const strict = mcp.strict === true
    if (mcp.scene?.trim()) sceneRecipe = buildBindingSceneRecipe(langCode, mcp.scene, strict)
    else if (strict) {
      const generic = buildSceneRecipe({
        language: typeof input.language === 'string' ? input.language : 'es',
        postStyle: typeof input.postStyle === 'string' ? input.postStyle : 'venta-directa',
        productSubStyle: typeof input.productSubStyle === 'string' ? input.productSubStyle : null,
        hasSceneRef: input.hasSceneRef === true,
        niche: null,
        category,
        offerName,
        scriptContext: input.userCopy,
        businessContext: typeof input.businessContext === 'string' ? input.businessContext : null,
      })
      sceneRecipe = strictenGenericRecipe(langCode, generic) || undefined
    }
  }
  const base = buildSlimGrokPostPrompt({
    language: typeof input.language === 'string' ? input.language : 'es',
    postStyle: typeof input.postStyle === 'string' ? input.postStyle : 'venta-directa',
    productSubStyle: typeof input.productSubStyle === 'string' ? input.productSubStyle : null,
    textDensity: typeof input.textDensity === 'string' ? input.textDensity : 'hard',
    userCopy: input.userCopy,
    palette: input.palette,
    brandVoice: input.brandVoice || null,
    brandVisual: input.brandVisual || null,
    businessContext: typeof input.businessContext === 'string' ? input.businessContext : null,
    hasProductRefs: input.hasProductRefs,
    hasSceneRef: input.hasSceneRef,
    productSilhouette: input.productSilhouette,
    lockedOfferPrice: input.lockedOfferPrice,
    logoStampRules: buildLogoStampRules(langCode, input.hasBrandLogo, { bloomSku: input.bloomSku }),
    ctaGuardrails: buildPostCtaGuardrails(langCode, normalizeWebCtaStrength(input.ctaStrength)),
    hasBrandLogo: input.hasBrandLogo,
    category,
    offerName,
    scriptContext: input.userCopy,
    ...(sceneRecipe ? { sceneRecipe } : {}),
  })
  if (!mcp) return base
  // Composited flow (MCP only): the CTA button is drawn in code, so the generic "… → CTA" / "1 CTA" / CTA-example lines of the web builder go.
  const body = mcp.compositeLayers
    ? base
        .split('\n')
        .filter((l) => !/^\s*-\s*(CTA\b|Preferred (organic )?CTA|CTA orgánico)/i.test(l) && !/^CTA:/.test(l))
        .join('\n')
        .replace(/\s*→\s*CTA\b/g, '')
        .replace(/,\s*1 CTA\b/g, '')
    : base
  // MCP rules go FIRST: the prompt clamp trims the tail of the head, never the opening instructions.
  const rules = buildMcpPromptRules(langCode, mcp, { hasProductRefs: input.hasProductRefs })
  return [rules, body].filter(Boolean).join('\n\n')
}

/** Product refs first, brand logo as style ref, scene refs last; capped at 3. */
export function selectWebPostReferenceUrls(input: {
  productUrls: string[]
  logoDataUrl?: string | null
  supportUrls?: string[]
  /** Reference slots (default 3 = the web route; the MCP path may raise it up to 5 for real accessory photos). */
  max?: number
}): string[] {
  return selectGrokReferenceBudget(
    [
      ...input.productUrls.map((url) => ({ url, role: 'product' as const })),
      ...(input.logoDataUrl ? [{ url: input.logoDataUrl, role: 'style' as const }] : []),
      ...(input.supportUrls || []).map((url) => ({ url, role: 'scene' as const })),
    ],
    input.max ?? 3
  ).map((row) => row.url)
}

export type WebGrokApi = ReturnType<typeof resolveGrokImageApiMode>

export function resolveWebGrokApi(productReferenceCount: number, referenceCount: number): WebGrokApi {
  return resolveGrokImageApiMode({ action: 'generate', productReferenceCount, referenceCount })
}

/** The JSON body POSTed to xAI. */
export function buildWebGrokRequest(input: {
  prompt: string
  aspectRatio: string
  referenceUrls: string[]
  logoDataUrl?: string | null
  api: WebGrokApi
}): Record<string, unknown> {
  const grokRequest: Record<string, unknown> = {
    model: GROK_IMAGE_PROVIDER_MODEL,
    prompt: input.prompt,
    n: 1,
    response_format: 'b64_json',
    aspect_ratio: input.aspectRatio,
    resolution: GROK_IMAGE_DEFAULT_RESOLUTION,
    quality: GROK_IMAGE_DEFAULT_QUALITY,
  }
  // Product refs → /edits product_lock_scene (pixel-faithful SKU + scene replace).
  // No product refs → /generations compose. Never attach logo as the only edit base when product photos exist.
  if (input.referenceUrls.length === 1) {
    grokRequest.image = { url: input.referenceUrls[0], type: 'image_url' }
  } else if (input.referenceUrls.length > 1) {
    grokRequest.images = input.referenceUrls.map((url) => ({ url, type: 'image_url' }))
  } else if (input.logoDataUrl && input.api.mode === 'compose') {
    grokRequest.image = { url: input.logoDataUrl, type: 'image_url' }
  }
  return grokRequest
}

/** preferTail is the user copy unless the prompt is a shell meta prompt / product / logo mode. */
export function webGrokPreferTail(userPrompt: unknown, options: { productOrLogoMode?: boolean } = {}): string {
  if (options.productOrLogoMode || isShellMetaImagePrompt(userPrompt as string)) return ''
  return typeof userPrompt === 'string' ? userPrompt : ''
}

/**
 * POST to xAI; on a prompt-length rejection re-prepare with the aggressive clamp and POST once more
 * (never ask the user to shorten the guion). `onRetry` lets the web route keep its log line.
 */
export async function postWebGrokWithClampRetry(input: {
  endpoint: string
  apiKey: string
  sourcePrompt: string
  preferTail: string
  buildRequest: (prompt: string) => Record<string, unknown>
  prepared?: ReturnType<typeof prepareGrokImagePrompt>
  onRetry?: (prepared: ReturnType<typeof prepareGrokImagePrompt>) => void
}): Promise<{
  response: Response
  errorText: string
  prepared: ReturnType<typeof prepareGrokImagePrompt>
  retried: boolean
}> {
  let prepared = input.prepared || prepareGrokImagePrompt(input.sourcePrompt, { preferTail: input.preferTail })
  const post = async (prompt: string) => {
    const response = await fetch(input.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(input.buildRequest(prompt)),
    })
    const errorText = response.ok ? '' : await response.text()
    return { response, errorText }
  }
  let { response, errorText } = await post(prepared.prompt)
  let retried = false
  if (!response.ok && isGrokPromptLengthError(errorText)) {
    prepared = prepareGrokImagePrompt(input.sourcePrompt, {
      preferTail: input.preferTail,
      maxBytes: GROK_IMAGE_RETRY_PROMPT_BYTES,
    })
    input.onRetry?.(prepared)
    retried = true
    ;({ response, errorText } = await post(prepared.prompt))
  }
  return { response, errorText, prepared, retried }
}

// ---------------------------------------------------------------------------
// MCP entry point
// ---------------------------------------------------------------------------

export type WebPostGrokImageOptions = {
  apiKey: string
  /** Ratio to generate at (already a Grok-native one, e.g. '3:4' for 4:5). */
  aspectRatio: string
  language?: 'es' | 'en'
  postStyle?: string
  textDensity?: string
  ctaStrength?: unknown
  /** On-image copy / guion. */
  copy?: string
  businessContext?: string | null
  palette?: string[]
  brandVoice?: string | null
  brandVisual?: string | null
  brandName?: string | null
  brandKitId?: string | null
  offerId?: string | null
  productRow?: ProductCreativeRow | null
  /** https (or data:) product photos, confirmed ones first. */
  productUrls: string[]
  /** Brand-kit product reference photos auto-appended as product refs (web `appendKitProductReferenceImages`). */
  kitReferenceUrls?: string[]
  /** Scene / style refs the user confirmed. */
  supportUrls?: string[]
  logoUrl?: string | null
  /** Offer lock (ad_profile) — appended as an extra immutable-attributes rule when present. */
  lockProductAppearance?: boolean
  immutableAttributes?: string[]
  /** MCP only: the user's `scene` as a binding instruction + strict lock / props / safe zones / retry hint. */
  mcp?: WebPostMcpRules
  /**
   * MCP only: real accessory photos of the offer (box, controller, contents). Appended right after the confirmed
   * product photos so they win the 3-reference budget over kit refs: hero first, then the best accessory, then
   * the logo (style ref); with no logo a second accessory fits.
   */
  accessoryUrls?: string[]
}

export type WebPostGrokImageResult = {
  imageDataUrl: string
  providerModel: string
  estimatedCostUsd: number
  resolution: string
  quality: string
  aspectRatio: string
  mode: string
  endpoint: string
  lockApplied: boolean
  referenceCount: number
  retriedWithClamp: boolean
  /** Product reference photos (data URLs) the request carried — for the local fidelity post-check. */
  productReferenceDataUrls: string[]
  /** Which kinds of references made the 3-slot budget, in request order. */
  referencesUsed: Array<'product' | 'accessory' | 'kit' | 'logo' | 'scene'>
  /** Optional references (kit / accessory / scene) that could not be loaded: url + HTTP status or reason. */
  referenceWarnings: ReferenceImageFailure[]
  /** Transient provider failures retried inside the job (capacity / 5xx); 0 normally. Not an error, not charged. */
  providerRetries: number
  /** Every reference actually sent (product, accessories, kit, logo, scene), as data URLs. */
  allReferenceDataUrls: string[]
  /** The brand logo as a data URL when one was loaded (used by the MCP safe-zone fix to restore a clipped logo). */
  logoDataUrl: string | null
  /** The request exactly as POSTed (images omitted → lengths only) — for parity evidence. */
  request: Record<string, unknown>
  prompt: string
}

const MAX_INPUT_SLOTS = 4

function uniqueUrls(urls: Array<string | null | undefined>, max: number): string[] {
  const out: string[] = []
  for (const raw of urls) {
    const u = typeof raw === 'string' ? raw.trim() : ''
    if (u && !out.includes(u)) out.push(u)
    if (out.length >= max) break
  }
  return out
}

/** Offer attributes that describe a separate object (box, controller, cable…) rather than the product itself. */
const ACCESSORY_ATTR_RE = /\b(caja|box|empaque|packaging|control|gamepad|mando|remote|cable|usb|cargador|charger|manual|estuche|bolsa|pouch)\b/i

export function lockRulesBlock(
  language: 'es' | 'en',
  lock: { lockProductAppearance?: boolean; immutableAttributes?: string[] },
  opts: { strict?: boolean; accessoriesAttached?: boolean } = {}
): string {
  const attrs = (lock.immutableAttributes || []).map((a) => a.trim()).filter(Boolean)
  if (!lock.lockProductAppearance && attrs.length === 0) return ''
  const es = language !== 'en'
  if (!opts.strict) {
    const list = attrs.length ? ` ${es ? 'Atributos inmutables' : 'Immutable attributes'}: ${attrs.join('; ')}.` : ''
    return es
      ? `PRODUCTO BLOQUEADO por la oferta: forma, color, partes y marca idénticas a la foto de referencia; no inventes variantes.${list}`
      : `PRODUCT LOCKED by the offer: shape, colour, parts and branding identical to the reference photo; do not invent variants.${list}`
  }
  // Strict (MCP): attributes about other objects must not invite the model to draw them from imagination.
  const own = attrs.filter((a) => !ACCESSORY_ATTR_RE.test(a))
  const other = attrs.filter((a) => ACCESSORY_ATTR_RE.test(a))
  const ownList = own.length ? ` ${es ? 'Atributos inmutables' : 'Immutable attributes'}: ${own.join('; ')}.` : ''
  const otherList = other.length
    ? (opts.accessoriesAttached
      ? (es
        ? ` Accesorios reales (copiar SOLO de la foto adjunta, con su impresión real): ${other.join('; ')}.`
        : ` Real accessories (copy ONLY from the attached photo, with their real print): ${other.join('; ')}.`)
      : (es
        ? ` Accesorios del kit (${other.join('; ')}) NO tienen foto adjunta: NO los dibujes ni los inventes.`
        : ` Kit accessories (${other.join('; ')}) have no attached photo: do NOT draw or invent them.`))
    : ''
  return es
    ? `PRODUCTO BLOQUEADO por la oferta: forma, color, partes y marca idénticas a la foto de referencia; no inventes variantes.${ownList}${otherList}`
    : `PRODUCT LOCKED by the offer: shape, colour, parts and branding identical to the reference photo; do not invent variants.${ownList}${otherList}`
}

async function loadReferences(urls: string[]): Promise<{ loaded: Array<{ url: string; dataUrl: string }>; failures: ReferenceImageFailure[] }> {
  const loaded: Array<{ url: string; dataUrl: string }> = []
  const failures: ReferenceImageFailure[] = []
  for (const url of urls) {
    const res = await fetchPublicImageDetailed(url)
    if ('dataUrl' in res) loaded.push({ url, dataUrl: res.dataUrl })
    else failures.push(res.failure)
  }
  return { loaded, failures }
}

/** Shared xAI call for the MCP tools: same prompt/refs/request/retry as the web post flow. */
export async function runWebPostGrokImage(options: WebPostGrokImageOptions): Promise<WebPostGrokImageResult> {
  const language = options.language === 'en' ? 'en' : 'es'
  const aspectRatio = toWebGrokAspectRatio(options.aspectRatio)
  const scope: BloomSkuScope = { productId: options.offerId ?? null, brandKitId: options.brandKitId ?? null }
  const row = options.productRow || null

  // Reference hydration — confirmed product photos first, then real accessory photos, then kit refs (4 slots max).
  const confirmed = uniqueUrls(options.productUrls, MAX_INPUT_SLOTS)
  const supportUrls = uniqueUrls(options.supportUrls || [], MAX_INPUT_SLOTS)
  const slotsLeft = Math.max(0, MAX_INPUT_SLOTS - confirmed.length - supportUrls.length)
  const accessoryUrls = uniqueUrls(options.accessoryUrls || [], Math.min(2, slotsLeft)).filter((u) => !confirmed.includes(u))
  const kitUrls = uniqueUrls(options.kitReferenceUrls || [], Math.max(0, slotsLeft - accessoryUrls.length)).filter((u) => !confirmed.includes(u) && !accessoryUrls.includes(u))
  const confirmedLoad = await loadReferences(confirmed)
  if (confirmed.length > 0 && confirmedLoad.loaded.length < confirmed.length) {
    // The confirmed photo IS the product truth: never silently swap it for a kit photo.
    throw new Error(`Could not load product reference images: ${describeReferenceFailures(confirmedLoad.failures)}. Re-import the photo into Advance storage (import_image) and try again.`)
  }
  const accessoryLoad = await loadReferences(accessoryUrls)
  const kitLoad = await loadReferences(kitUrls)
  const productData = [...confirmedLoad.loaded, ...accessoryLoad.loaded, ...kitLoad.loaded].map((r) => r.dataUrl)
  const referenceWarnings = [...accessoryLoad.failures, ...kitLoad.failures]
  const supportLoad = await loadReferences(supportUrls)
  referenceWarnings.push(...supportLoad.failures)
  const supportData = supportLoad.loaded.map((r) => r.dataUrl)

  let logoDataUrl: string | null = null
  const logoSource = (options.logoUrl || '').trim()
  if (logoSource) {
    if (logoSource.startsWith('data:')) logoDataUrl = logoSource
    else {
      const logo = await fetchPublicImageDetailed(logoSource)
      if (!('dataUrl' in logo)) throw new Error(`Could not load the brand logo: ${describeReferenceFailures([logo.failure])}. Re-upload it and try again.`)
      logoDataUrl = logo.dataUrl
    }
  }

  const referenceUrls = selectWebPostReferenceUrls({ productUrls: productData, logoDataUrl, supportUrls: supportData, ...(options.mcp?.refBudget ? { max: Math.min(5, Math.max(3, options.mcp.refBudget)) } : {}) })
  const kindOf = (dataUrl: string): WebPostGrokImageResult['referencesUsed'][number] => {
    if (confirmedLoad.loaded.some((r) => r.dataUrl === dataUrl)) return 'product'
    if (accessoryLoad.loaded.some((r) => r.dataUrl === dataUrl)) return 'accessory'
    if (kitLoad.loaded.some((r) => r.dataUrl === dataUrl)) return 'kit'
    if (dataUrl === logoDataUrl) return 'logo'
    return 'scene'
  }
  const referencesUsed = referenceUrls.map(kindOf)
  const accessoriesInRequest = referencesUsed.filter((k) => k === 'accessory').length
  const lockBlock = lockRulesBlock(language, options, { strict: options.mcp?.strict === true, accessoriesAttached: accessoriesInRequest > 0 })
  const rawCopy = (options.copy || '').trim()
  const userCopy = rawCopy && !isShellMetaImagePrompt(rawCopy) ? rawCopy : ''
  const mcpRules: WebPostMcpRules | undefined = options.mcp
    ? { ...options.mcp, accessoryLabels: accessoriesInRequest ? options.mcp.accessoryLabels : [] }
    : undefined
  const assemble = (businessContext: string | null, brandVisual: string | null | undefined) => [
    buildWebPostSourcePrompt({
      language,
      postStyle: options.postStyle || 'venta-directa',
      textDensity: options.textDensity || 'hard',
      userCopy,
      palette: (options.palette || []).filter(Boolean).slice(0, 3).join(', '),
      brandVoice: options.brandVoice,
      brandVisual,
      businessContext,
      hasProductRefs: productData.length > 0,
      hasSceneRef: supportData.length > 0,
      productSilhouette: row ? resolveProductSilhouette(row, language, options.brandName, scope) : null,
      lockedOfferPrice: row ? resolveLockedOfferPrice(row, options.brandName, scope) : null,
      bloomSku: isBloomDermalPatchSku(scope),
      hasBrandLogo: Boolean(logoDataUrl),
      ctaStrength: options.ctaStrength,
      productRow: row,
      ...(mcpRules ? { mcp: mcpRules } : {}),
    }),
    lockBlock,
  ].filter(Boolean).join('\n\n')
  let sourcePrompt = assemble(options.businessContext ?? null, options.brandVisual)
  if (mcpRules) {
    // The MCP rules add ~1.3 KB: shed the least important context before the clamp would cut something else.
    if (grokPromptUtf8ByteLength(sourcePrompt) > GROK_IMAGE_MAX_PROMPT_BYTES) sourcePrompt = assemble(null, options.brandVisual)
    if (grokPromptUtf8ByteLength(sourcePrompt) > GROK_IMAGE_MAX_PROMPT_BYTES) sourcePrompt = assemble(null, null)
  }

  const api = resolveWebGrokApi(productData.length, referenceUrls.length)
  const buildRequest = (prompt: string) => buildWebGrokRequest({ prompt, aspectRatio, referenceUrls, logoDataUrl, api })
  // Transient provider failures ("temporarily at capacity", 429, 5xx) are retried with backoff inside the job: not
  // surfaced to the user and not charged (the caller charges once, after success).
  const { value: posted, trace: providerTrace } = await withProviderRetry(async () => {
    const attempt = await postWebGrokWithClampRetry({
      endpoint: api.endpoint,
      apiKey: options.apiKey,
      sourcePrompt,
      preferTail: userCopy,
      buildRequest,
    })
    if (!attempt.response.ok) {
      let message = attempt.errorText
      try {
        const parsed = JSON.parse(attempt.errorText) as { error?: { message?: string } | string }
        message = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message || attempt.errorText
      } catch { /* keep raw */ }
      throw Object.assign(new Error(message || `Grok image generate failed (${attempt.response.status})`), { status: attempt.response.status })
    }
    return attempt
  })
  const { response, prepared, retried } = posted
  const json = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> }
  const b64 = json.data?.[0]?.b64_json
  const url = json.data?.[0]?.url
  const imageDataUrl = b64 ? `data:image/jpeg;base64,${b64}` : url || ''
  if (!imageDataUrl) throw new Error('Grok image generate returned no image')
  return {
    imageDataUrl,
    providerModel: GROK_IMAGE_PROVIDER_MODEL,
    estimatedCostUsd: estimateGrokImageCostUsd({ outputImages: 1, referenceCount: referenceUrls.length }),
    resolution: GROK_IMAGE_DEFAULT_RESOLUTION,
    quality: GROK_IMAGE_DEFAULT_QUALITY,
    aspectRatio,
    mode: api.mode,
    endpoint: api.endpoint,
    lockApplied: api.mode === 'product_lock_scene',
    referenceCount: referenceUrls.length,
    retriedWithClamp: retried,
    productReferenceDataUrls: [...confirmedLoad.loaded, ...kitLoad.loaded].map((r) => r.dataUrl),
    referencesUsed,
    referenceWarnings,
    request: buildRequest(prepared.prompt),
    prompt: prepared.prompt,
    providerRetries: providerTrace.retries.length,
    allReferenceDataUrls: referenceUrls,
    logoDataUrl,
  }
}
