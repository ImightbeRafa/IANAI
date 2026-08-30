/**
 * Offer-level product silhouette + locked price rules for image generate/edit/enhance.
 * Used when reference images are missing or to keep patch SKUs on-brand.
 */

export type ProductCreativeRow = {
  name?: string | null
  product_description?: string | null
  description?: string | null
  technical_specs?: string | null
  product_category?: string | null
  product_category_custom?: string | null
  offer?: string | null
  price_range?: string | null
}

export const BLOOM_DERMAL_PATCH_PRICE = '₡9.900'

export const DERMAL_PATCH_SILHOUETTE_ES =
  'Hojita de 9 parches: lámina/plancha cuadrada transparente con 9 parches circulares en grilla 3×3, ~12 mm cada uno, centros con textura de micro-agujas punteada. NUNCA caja sellada, cartón genérico, frasco, tubo, pump ni empaque cerrado.'

export const DERMAL_PATCH_SILHOUETTE_EN =
  '9-patch sheet: transparent square film with 9 circular patches in a 3×3 grid, ~12 mm each, dotted micro-needle centers. NEVER a sealed box, generic carton, jar, tube, pump, or closed packaging.'

const SILUETA_PREFIX = /^SILUETA(?:\s+PRODUCTO)?:\s*/i

function productText(row: ProductCreativeRow): string {
  return [
    row.name,
    row.product_description,
    row.description,
    row.technical_specs,
    row.product_category,
    row.product_category_custom,
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

export function isDermalMicroPatchOffer(row: ProductCreativeRow, brandName?: string | null): boolean {
  const text = productText(row)
  const brand = (brandName || row.name || '').toLowerCase()
  const patchLike =
    /micro[- ]?aguj|micro[- ]?infusi|dermal|parche|patch|pimple|acne|granito/.test(text)
    || /bloom/.test(brand)
  const ninePack = /9\s*parche|nine\s*patch|3\s*[x×]\s*3|12\s*mm/.test(text)
  return patchLike && (ninePack || /hojita|sheet|lamina|plancha/.test(text))
}

export function parseSilhouetteFromTechnicalSpecs(technicalSpecs?: string | null): string | null {
  if (!technicalSpecs?.trim()) return null
  for (const line of technicalSpecs.split('\n')) {
    const trimmed = line.trim()
    if (SILUETA_PREFIX.test(trimmed)) {
      return trimmed.replace(SILUETA_PREFIX, '').trim()
    }
  }
  return null
}

export function resolveProductSilhouette(
  row: ProductCreativeRow,
  language: 'es' | 'en',
  brandName?: string | null
): string | null {
  const fromSpecs = parseSilhouetteFromTechnicalSpecs(row.technical_specs)
  if (fromSpecs) return fromSpecs
  if (isDermalMicroPatchOffer(row, brandName)) {
    return language === 'es' ? DERMAL_PATCH_SILHOUETTE_ES : DERMAL_PATCH_SILHOUETTE_EN
  }
  return null
}

/** Exact display price for prompts — never invent from price_range enum alone. */
export function resolveLockedOfferPrice(
  row: ProductCreativeRow,
  brandName?: string | null
): string | null {
  const explicit = typeof row.offer === 'string' ? row.offer.trim() : ''
  if (explicit) return explicit
  if (isDermalMicroPatchOffer(row, brandName)) return BLOOM_DERMAL_PATCH_PRICE
  return null
}

export function buildProductSilhouetteBlock(
  silhouette: string | null | undefined,
  language: 'es' | 'en',
  options?: { hasReferenceImages?: boolean; forEnhance?: boolean }
): string {
  if (!silhouette?.trim()) return ''
  const isES = language === 'es'
  const header = isES
    ? '═══════════════════════════════════════════════\nSILUETA OBLIGATORIA DEL PRODUCTO (SIN REFERENCIAS — NO NEGOCIABLE)\n═══════════════════════════════════════════════'
    : '═══════════════════════════════════════════════\nMANDATORY PRODUCT SILHOUETTE (NO REFERENCES — NON-NEGOTIABLE)\n═══════════════════════════════════════════════'
  const refNote = options?.hasReferenceImages
    ? (isES
      ? 'Las referencias adjuntas mandan sobre forma y color; esta silueta refuerza el SKU cuando falte detalle.'
      : 'Attached references override shape and color; this silhouette reinforces the SKU when detail is missing.')
    : (isES
      ? 'No hay fotos de referencia: esta silueta ES el producto que debés renderizar.'
      : 'No reference photos: this silhouette IS the product you must render.')
  const enhanceNote = options?.forEnhance
    ? (isES
      ? 'En edición/mejora: conservá exactamente esta silueta (9 parches visibles). PROHIBIDO cambiar SKU, agregar empaque o reemplazar por caja.'
      : 'On edit/enhance: keep this exact silhouette (9 visible patches). FORBIDDEN to change SKU, add packaging, or swap for a box.')
    : ''
  return `${header}\n${silhouette.trim()}\n${refNote}${enhanceNote ? `\n${enhanceNote}` : ''}\n═══════════════════════════════════════════════\n\n`
}

export function buildLogoStampRules(language: 'es' | 'en', hasLogo: boolean): string {
  const isES = language === 'es'
  if (!hasLogo) {
    return isES
      ? `REGLA — LOGO: no hay archivo de logo adjunto. NO inventes wordmark, NO escribas "BLOOM", NO generes el lockup "DERMAL MICRO-INFUSION PATCH" ni subtítulos de marca con IA.\n\n`
      : `LOGO RULE: no logo file attached. Do NOT invent a wordmark, do NOT write "BLOOM", do NOT generate the "DERMAL MICRO-INFUSION PATCH" lockup or brand subtitles with AI.\n\n`
  }
  return isES
    ? `REGLA — LOGO (ESTAMPADO, NO REGENERACIÓN):
- Se adjunta el archivo oficial del logo como imagen raster.
- COMPÓSITALO / estampalo tal cual — placement en esquina superior (izq o der), proporciones intactas.
- PROHIBIDO redibujar, reimaginar o reescribir con IA el wordmark "BLOOM" o el lockup "DERMAL MICRO-INFUSION PATCH" (garabatean).
- Si hay conflicto, el logo adjunto gana; ajustá fondo/composición, no el logo.\n\n`
    : `LOGO RULE (STAMP, DO NOT REDRAW):
- The official logo file is attached as a raster image.
- COMPOSITE / stamp it as-is — top corner placement, proportions intact.
- FORBIDDEN to redraw, reimagine, or re-typeset the "BLOOM" wordmark or "DERMAL MICRO-INFUSION PATCH" lockup with AI (they garble).
- On conflict, the attached logo wins; adjust background/composition, not the logo.\n\n`
}

export function buildLockedPriceRules(language: 'es' | 'en', price?: string | null): string {
  const locked = typeof price === 'string' ? price.trim() : ''
  if (!locked) return ''
  const isES = language === 'es'
  return isES
    ? `PRECIO LISTADO (${locked}): mostralo tal cual en el diseño. PROHIBIDO tachado/strikethrough, "antes/ahora" inventado, descuento ficticio o precio rebajado sin respaldo en el copy.\n\n`
    : `LIST PRICE (${locked}): show exactly as listed. FORBIDDEN strikethrough, invented before/after sale, fake discount, or reduced price unless the copy states it.\n\n`
}

export function buildEnhancePatchConstraints(
  row: ProductCreativeRow | null | undefined,
  language: 'es' | 'en',
  brandName?: string | null,
  options?: { hasProductRef?: boolean }
): string {
  if (!row) return ''
  const silhouette = resolveProductSilhouette(row, language, brandName)
  if (!silhouette) return ''
  const isES = language === 'es'
  const silhouetteBlock = buildProductSilhouetteBlock(silhouette, language, {
    hasReferenceImages: options?.hasProductRef ?? false,
    forEnhance: true,
  })
  const lockedPrice = resolveLockedOfferPrice(row, brandName)
  const priceRules = buildLockedPriceRules(language, lockedPrice)
  const improveNote = isES
    ? `MEJORA PERMITIDA: crop, contraste, luz, ambiente floral/púrpura nocturno coherente con la marca.
PROHIBIDO EN EDICIÓN: texto gibberish, cambiar SKU, agregar empaque/caja, reemplazar la hojita por cartón sellado.
`
    : `ALLOWED IMPROVEMENTS: crop, contrast, light, floral/purple night mood aligned with the brand.
FORBIDDEN ON EDIT: gibberish text, SKU change, add packaging/box, replace the patch sheet with a sealed carton.
`
  return `${silhouetteBlock}${priceRules}${improveNote}`
}

export function buildEditPatchConstraints(
  row: ProductCreativeRow | null | undefined,
  language: 'es' | 'en',
  brandName?: string | null
): string {
  return buildEnhancePatchConstraints(row, language, brandName, { hasProductRef: true })
}

export function buildPostCtaGuardrails(language: 'es' | 'en', ctaStrength?: string): string {
  const isES = language === 'es'
  const strength = ctaStrength || 'sales'
  const antiAdsManager = isES
    ? '- PROHIBIDO usar "Dale click a este anuncio" / copy de Ads Manager salvo que el guión lo traiga literal.'
    : '- FORBIDDEN to use "Click this ad" / Ads Manager boilerplate unless the script includes it verbatim.'
  if (strength === 'soft' || strength === 'brand_mention' || strength === 'none') {
    return `${antiAdsManager}
${isES
  ? '- CTA orgánico preferido: "Escribime", "Pedilo por DM", "Mandame mensaje" — texto pequeño o firma, no botón gigante de anuncio pagado.'
  : '- Preferred organic CTA: "Message us", "DM to order" — small text or signature, not a paid-ad giant button.'}\n\n`
  }
  return `${antiAdsManager}
${isES
  ? '- CTA de venta: botón claro ("Pedí acá", "Comprá ahora", "₡9.900") copiado del guión; no inventes otro precio ni SKU.'
  : '- Sales CTA: clear button ("Order here", "Buy now") copied from the script; do not invent another price or SKU.'}\n\n`
}
