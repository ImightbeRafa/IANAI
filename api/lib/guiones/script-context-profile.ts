import type {
  BusinessContextLike,
  ContextDocumentData,
  CTAStrength,
  ProductContextLike,
  SalesChannel,
  ScriptContextProfile,
} from './types.js'
import { cleanText, compactLines, pushUnique } from './utils.js'

interface BuildProfileInput {
  businessContext?: BusinessContextLike
  productContext?: ProductContextLike
  contextDocuments?: ContextDocumentData[]
  activeSalesChannel?: SalesChannel
  ctaStrength?: CTAStrength
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean)
  const text = cleanText(value)
  if (!text) return []
  return text
    .split(/\n|;|\|/)
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 12)
}

function addAudience(target: string[], business?: BusinessContextLike): void {
  for (const audience of business?.target_audiences || []) {
    const parts: string[] = []
    if (audience.sex && audience.sex !== 'both') parts.push(audience.sex)
    if (audience.age_min && audience.age_max) parts.push(`${audience.age_min}-${audience.age_max}`)
    if (audience.geographic_scope === 'custom' && audience.geographic_scope_custom) parts.push(audience.geographic_scope_custom)
    else if (audience.geographic_scope) parts.push(audience.geographic_scope)
    if (audience.has_specific_profession && audience.profession_description) parts.push(audience.profession_description)
    pushUnique(target, parts.join(' | '))
  }
  pushUnique(target, business?.icp_description, 6)
}

function addSuccessCases(target: string[], product?: ProductContextLike): void {
  for (const sc of product?.success_cases || []) {
    const parts = [
      sc.client_name ? `cliente: ${sc.client_name}` : '',
      sc.before_state ? `antes: ${sc.before_state}` : '',
      sc.result ? `resultado: ${sc.result}` : '',
      sc.timeline ? `tiempo: ${sc.timeline}` : '',
      sc.life_change ? `cambio: ${sc.life_change}` : '',
    ].filter(Boolean)
    pushUnique(target, parts.join(' | '))
  }
}

function buildAlternatives(product?: ProductContextLike): Array<{ name: string; weakness?: string; ethicalContrast?: string }> {
  const names = splitList(product?.current_alternatives)
  const weaknesses = splitList(product?.alternatives_disadvantages || product?.svc_alternatives_failures)
  const serviceTried = splitList(product?.svc_alternatives_tried)
  const allNames = names.length > 0 ? names : serviceTried
  return allNames.slice(0, 8).map((name, index) => ({
    name,
    weakness: weaknesses[index] || weaknesses[0],
    ethicalContrast: cleanText(product?.differentiation || product?.svc_differentiation || product?.technical_specs),
  }))
}

function mapPriceRangeFact(priceRange: string | null | undefined): string | null {
  const key = cleanText(priceRange).toLowerCase()
  if (!key) return null
  const map: Record<string, string> = {
    economico: 'Posicionamiento de precio accesible (valor por dinero). Nunca imprimas enums de precio internos.',
    medio: 'Posicionamiento de precio medio (equilibrio calidad/precio).',
    premium: 'Posicionamiento de precio premium (exclusividad y calidad superior).',
  }
  return map[key] || null
}

function missingFor(product?: ProductContextLike, business?: BusinessContextLike): string[] {
  const missing: string[] = []
  if (!cleanText(product?.name)) missing.push('[NOMBRE DEL PRODUCTO/SERVICIO]')
  if (!cleanText(product?.product_description) && !cleanText(product?.svc_problem) && !cleanText(product?.menu_text) && !cleanText(product?.re_highlights)) missing.push('[BENEFICIO O DESCRIPCION CONCRETA]')
  if (!cleanText(product?.differentiation) && !cleanText(product?.svc_differentiation) && !cleanText(product?.technical_specs)) missing.push('[DIFERENCIADOR TANGIBLE]')
  if (!cleanText(business?.name)) missing.push('[NOMBRE DEL NEGOCIO]')
  if (!business?.sales_channels?.length) missing.push('[CANAL DE COMPRA]')
  if (product?.type === 'real_estate' && !cleanText(product.re_price) && !cleanText(product.exact_price)) missing.push('[PRECIO]')
  if (product?.type === 'restaurant' && !cleanText(product.menu_text)) missing.push('[PLATILLO REAL DEL MENU]')
  if (product?.type === 'service' && !cleanText(product.svc_process_steps)) missing.push('[PASOS DEL PROCESO]')
  return missing
}

export function buildScriptContextProfile(input: BuildProfileInput): ScriptContextProfile {
  const { businessContext: business, productContext: product } = input
  const productType = product?.type || 'product'
  const productName = cleanText(product?.name) || '[NOMBRE DEL PRODUCTO/SERVICIO]'
  const businessName = cleanText(business?.name) || undefined

  const audienceSegments: string[] = []
  addAudience(audienceSegments, business)

  const pains = compactLines([
    product?.main_problem,
    product?.svc_problem,
    product?.svc_current_pain,
    product?.svc_alternatives_failures,
    product?.key_objection,
  ])
  const desires = compactLines([
    product?.result,
    product?.utility,
    product?.svc_concrete_result,
    product?.svc_life_change,
    product?.expected_result,
    product?.attention_grabber,
  ])
  const objections = compactLines([
    product?.key_objection,
    product?.svc_main_objection,
    product?.current_alternatives,
    product?.alternatives_disadvantages,
    product?.failed_attempts,
  ])
  const proof = compactLines([
    product?.technical_specs,
    product?.guarantee_details,
    product?.svc_process_steps,
    product?.svc_result_timeline,
    product?.svc_method_name,
    product?.svc_guarantee_details,
    product?.ind_main_material,
    product?.ind_quality_description,
    product?.re_construction_size,
    product?.re_bedrooms,
    product?.re_bathrooms,
    product?.re_parking,
    product?.re_highlights,
  ], 16)
  addSuccessCases(proof, product)

  const logistics = compactLines([
    business?.shipping_method,
    business?.does_shipping ? 'Envios disponibles' : '',
    product?.location,
    product?.schedule,
    product?.re_location,
    product?.re_location_reference,
    product?.re_cta,
    business?.location,
    business?.sales_channels?.join(', '),
    product?.ind_change_policy,
  ], 14)

  const offerFacts = compactLines([
    product?.product_description,
    product?.product_category,
    product?.exact_price ? `Precio exacto: ${product.exact_price}` : '',
    mapPriceRangeFact(product?.price_range),
    product?.product_variations?.join(', '),
    product?.svc_service_type,
    product?.svc_service_format,
    product?.svc_service_duration,
    product?.ind_article_type,
    product?.ind_model_count ? `${product.ind_model_count} modelos/disenos` : '',
    product?.ind_variations_description,
    product?.ind_sizes,
    product?.menu_text,
    product?.re_price ? `Precio: ${product.re_price}` : '',
  ], 18)

  const sensoryFacts = compactLines([
    product?.menu_text,
    product?.ind_main_material,
    product?.ind_quality_description,
    product?.ind_variations_description,
    product?.re_highlights,
  ], 10)

  const buyerReadinessSignals = compactLines([
    product?.awareness_level,
    input.activeSalesChannel,
    business?.sales_channels?.join(', '),
    product?.stock_limited ? 'stock limitado' : '',
    product?.has_guarantee || product?.svc_has_guarantee ? 'garantia disponible' : '',
  ])

  return {
    productType,
    productName,
    businessName,
    category: cleanText(product?.product_category || product?.svc_service_type || product?.ind_article_type || product?.re_business_type) || undefined,
    audienceSegments,
    buyerReadinessSignals,
    pains,
    desires,
    objections,
    alternatives: buildAlternatives(product),
    proof,
    logistics,
    offerFacts,
    sensoryFacts,
    missingFacts: missingFor(product, business),
    bannedClaims: [
      'No inventar precios, cantidades, garantias, resultados, platos, ubicaciones ni casos de exito.',
      'No atacar competidores especificos; contrastar alternativas comunes de forma etica.',
      'Nunca imprimas enums internos (economico, medio, premium, cold, warm, hot) como copy de venta.',
      'Nunca dejes placeholders como [PRECIO EXACTO], [DIFERENCIADOR TANGIBLE] u otros corchetes en el guion final.',
      product?.exact_price
        ? `Si mencionas precio, usa exactamente: ${product.exact_price}.`
        : 'Si no hay precio exacto en los hechos, no inventes uno ni uses [PRECIO EXACTO].',
    ],
    activeSalesChannel: input.activeSalesChannel,
    ctaStrength: input.ctaStrength,
    contextDocumentsSummary: (input.contextDocuments || [])
      .map(doc => `${doc.type}: ${doc.name}${doc.content ? ` - ${doc.content.slice(0, 220)}` : ''}`)
      .slice(0, 8),
  }
}

