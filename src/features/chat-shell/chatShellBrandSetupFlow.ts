/**
 * Conversational brand-setup state machine.
 * Ingest URL + pasted text once, show a resume, confirm or correct.
 * Questions are a last resort when there is nothing to hypothesize.
 * Tracker completeness stays in chatShellBrandSetup.ts.
 */

import type { ProductType, SalesChannel } from '../../types'
import { isProductType, isSalesChannel, nonempty, type BrandSetupStepId } from './chatShellBrandSetup'

export type SetupFlowPhase =
  | 'intro'
  | 'analyzing'
  | 'asking'
  | 'confirm_offer'
  | 'complete'
  | 'paused'

export type SetupQuestionId =
  | 'source'
  | 'channels'
  | 'location'
  | 'audience'
  | 'type_confirm'
  | 'offer_name'
  | 'product_benefits'
  | 'product_result'
  | 'product_alternatives'
  | 'service_problem'
  | 'service_result'
  | 'service_diff'
  | 'restaurant_menu'
  | 'restaurant_place'
  | 'restaurant_hours'
  | 're_deal'
  | 're_place'
  | 're_highlights'
  | 'ind_what'
  | 'ind_material'
  | 'brand_voice'
  | 'brand_visual'

export interface SetupFacts {
  businessName: string
  salesChannels: SalesChannel[]
  location: string
  doesShipping: boolean
  shippingMethod: string
  icp: string
  storageType: ProductType
  customLabel: string
  typeConfidence: 'high' | 'low'
  offerName: string
  offerConfirmed: boolean
  product_description: string
  utility: string
  result: string
  current_alternatives: string
  key_objection: string
  main_problem: string
  expected_result: string
  differentiation: string
  menu_text: string
  schedule: string
  re_price: string
  re_location: string
  re_highlights: string
  re_cta: string
  ind_article_type: string
  ind_variations_description: string
  ind_main_material: string
  brand_voice: string
  tone_keywords: string[]
  must_use_phrases: string[]
  forbidden_phrases: string[]
  brand_visual: string
  primary_color: string
  secondary_color: string
  accent_color: string
  logo_url: string
  reference_images: string[]
  palette_candidates: string[]
  tagline: string
  font_primary: string
  sourceUrl: string
  sourceText: string
}

export interface SetupTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface SetupFlowState {
  phase: SetupFlowPhase
  asked: SetupQuestionId[]
  pendingQuestion: SetupQuestionId | null
  confirmOffered: boolean
  facts: SetupFacts
  turns: SetupTurn[]
}

export function emptySetupFacts(brandName = ''): SetupFacts {
  return {
    businessName: brandName,
    salesChannels: [],
    location: '',
    doesShipping: false,
    shippingMethod: '',
    icp: '',
    storageType: 'product',
    customLabel: '',
    typeConfidence: 'low',
    offerName: '',
    offerConfirmed: false,
    product_description: '',
    utility: '',
    result: '',
    current_alternatives: '',
    key_objection: '',
    main_problem: '',
    expected_result: '',
    differentiation: '',
    menu_text: '',
    schedule: '',
    re_price: '',
    re_location: '',
    re_highlights: '',
    re_cta: '',
    ind_article_type: '',
    ind_variations_description: '',
    ind_main_material: '',
    brand_voice: '',
    tone_keywords: [],
    must_use_phrases: [],
    forbidden_phrases: [],
    brand_visual: '',
    primary_color: '',
    secondary_color: '',
    accent_color: '',
    logo_url: '',
    reference_images: [],
    palette_candidates: [],
    tagline: '',
    font_primary: '',
    sourceUrl: '',
    sourceText: '',
  }
}

let turnSeq = 0
export function setupTurn(role: SetupTurn['role'], content: string): SetupTurn {
  turnSeq += 1
  return { id: `setup-${role}-${turnSeq}`, role, content }
}

export function introPrompt(language: 'en' | 'es', brandName: string): string {
  if (language === 'es') {
    return `¡Hola! Bienvenido a Advance AI. Compartí logos, URLs, documentos o información de ${brandName || 'tu marca'} para que pueda escanearla y configurar todo. Si falta algo importante, te lo voy a pedir.`
  }
  return `Hi! Welcome to Advance AI. Share logos, URLs, documents, or information about ${brandName || 'your brand'} so I can scan it and configure everything. If anything important is missing, I’ll ask for it.`
}

export function createInitialFlow(language: 'en' | 'es', brandName: string): SetupFlowState {
  return {
    phase: 'intro',
    asked: ['source'],
    pendingQuestion: 'source',
    confirmOffered: false,
    facts: emptySetupFacts(brandName),
    turns: [setupTurn('assistant', introPrompt(language, brandName))],
  }
}

export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/i)
  if (!match) return null
  return match[0].replace(/[),.;]+$/, '')
}

export function splitSourceAndNotes(text: string): { url: string | null; notes: string } {
  const url = extractFirstUrl(text)
  const notes = (url ? text.replace(url, ' ') : text).replace(/\s+/g, ' ').trim()
  return { url, notes }
}

export function seedFactsFromPastedText(facts: SetupFacts, text: string): SetupFacts {
  const { url, notes } = splitSourceAndNotes(text)
  const next = { ...facts }
  if (url) next.sourceUrl = url
  if (!notes) return next
  next.sourceText = [next.sourceText, notes].filter(Boolean).join('\n')
  if (!next.offerName) {
    const first = notes.split(/[|/•\n]/)[0]?.trim() || ''
    if (first.length >= 2 && first.length <= 80 && !/^https?:/i.test(first)) {
      next.offerName = first
    }
  }
  if (!next.product_description && notes.length > 8) next.product_description = notes
  return next
}

export function isExplicitGenerationRequest(text: string): boolean {
  const t = text.trim()
  if (/^\/(guion|post|logo|producto|marca)\b/i.test(t)) return true
  if (/^(genera(?:r|me)?|genérame|generate|crea(?:r|me)?|haz(?:me)?)\b/i.test(t)) return true
  if (/\b(guiones?|scripts?|posts?|im[aá]genes?|images?|fotos?|photos?|logos?|piezas?|assets?)\b/i.test(t)
    && /\b(genera|generar|generate|dame|haz|make|crear|crea|create|quiero|want)\b/i.test(t)) return true
  return false
}

export function isBrandContextEditRequest(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
  const editVerb = /\b(cambia|cambiar|cambiemos|actualiza|actualizar|edita|editar|corrige|corregir|ajusta|ajustar|guarda|guardar|change|update|edit|correct|adjust|save)\b/
  const contextField = /\b(contexto|marca|negocio|oferta|producto|servicio|publico|audiencia|cliente ideal|tono|voz|frase|palabra|color|paleta|visual|logo|diferenciador|objecion|cta|canal|ubicacion|context|brand|business|offer|product|service|audience|customer|tone|voice|phrase|word|color|palette|visual|differentiator|objection|channel|location)\b/
  return editVerb.test(normalized) && contextField.test(normalized)
}

export function isBrandRuleRequest(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
  const ruleLanguage = /\b(no (?:pongas|uses|digas|muestres|incluyas|menciones)|nunca|evita|prohibido|siempre|a partir de ahora|de ahora en adelante|quita|elimina|borra|remueve|remove|delete|do not|don't|never|avoid|always|from now on)\b/
  const creativeField = /\b(precio|price|producto|product|marca|brand|logo|color|tono|tone|voz|voice|cta|frase|phrase|palabra|word|guion|script|post|imagen|image|foto|photo|descuento|discount|envio|shipping)\b/
  return ruleLanguage.test(normalized) && creativeField.test(normalized)
}

export function isBrandRuleRemoval(text: string): boolean {
  const normalized = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  return /\b(quita|elimina|borra|remueve|remove|delete)\b/.test(normalized)
}

export function findBrandRuleToRemove(text: string, rules: string[]): string | null {
  const normalize = (value: string) => value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\b(quita|elimina|borra|remueve|remove|delete|la|el|regla|rule|de)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const query = normalize(text)
  if (!query) return null
  return rules.find((rule) => {
    const candidate = normalize(rule)
    return candidate === query || candidate.includes(query) || query.includes(candidate)
  }) || null
}

export function normalizeBrandRule(text: string): string {
  return text.trim().replace(/[.!]+$/g, '').replace(/\s+/g, ' ')
}

export function isPauseSetup(text: string): boolean {
  return /^(ahora no|saltar todo|skip setup|not now|después todo)$/i.test(text.trim())
}

export function isSkipThis(text: string): boolean {
  return /^(saltar|skip|después|later|omitir)$/i.test(text.trim())
}

export function isAffirmative(text: string): boolean {
  const t = text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,!¡¿;:]+$/g, '')
    .replace(/\s+/g, ' ')
  if (/^(si|yes|ok|okay|dale|exacto|asi es|confirmo|confirmado|yeah|yep|si correcto|todo bien|asi|perfecto)$/i.test(t)) {
    return true
  }
  // A tiny typo such as "coorrecto" should confirm, not restart the summary.
  return /^co+r+ecto+$/i.test(t) || /^cor+e+c+to+$/i.test(t)
}

export function parseChannelsFromText(text: string): SalesChannel[] {
  const lower = text.toLowerCase()
  const out: SalesChannel[] = []
  if (/\b(local|f[ií]sico|tienda|store|in-?store|physical)\b/.test(lower)) out.push('physical')
  if (/\b(whatsapp|mensaje|mensajes|dm|instagram|messages)\b/.test(lower)) out.push('messages')
  if (/\b(web|website|sitio|ecommerce|e-?commerce|tienda online)\b/.test(lower)) out.push('website')
  return out.filter(isSalesChannel)
}

export function classifyStorageType(raw: Record<string, unknown>): {
  storageType: ProductType
  customLabel: string
  typeConfidence: 'high' | 'low'
} {
  const explicit = raw.type
  if (isProductType(explicit)) {
    return {
      storageType: explicit,
      customLabel: typeof raw.type_label === 'string' ? raw.type_label.trim() : '',
      typeConfidence: 'high',
    }
  }
  const blob = JSON.stringify(raw).toLowerCase()
  if (/\b(menu|menú|restaurante|restaurant|comida|food)\b/.test(blob)) {
    return { storageType: 'restaurant', customLabel: '', typeConfidence: 'high' }
  }
  if (/\b(airbnb|alquiler|inmueble|real.?estate|propiedad)\b/.test(blob)) {
    return { storageType: 'real_estate', customLabel: '', typeConfidence: 'high' }
  }
  if (/\b(ropa|indumentaria|zapatos|talla|fashion|apparel)\b/.test(blob)) {
    return { storageType: 'indumentaria', customLabel: '', typeConfidence: 'high' }
  }
  if (/\b(consultor|servicio|coaching|mentoria|agencia|service)\b/.test(blob)) {
    return { storageType: 'service', customLabel: typeof raw.type_label === 'string' ? raw.type_label.trim() : '', typeConfidence: 'low' }
  }
  const label = typeof raw.type_label === 'string' ? raw.type_label.trim() : ''
  return { storageType: 'product', customLabel: label, typeConfidence: label ? 'low' : 'low' }
}

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  const short = raw.match(/^#([0-9a-f]{3})$/i)
  if (short) {
    const [r, g, b] = short[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  const long = raw.match(/^#([0-9a-f]{6})$/i)
  return long ? `#${long[1].toLowerCase()}` : null
}

function uniqueHexes(values: unknown[]): string[] {
  const out: string[] = []
  for (const value of values) {
    const hex = normalizeHexColor(value)
    if (hex && !out.includes(hex)) out.push(hex)
  }
  return out
}

export function factsHaveVisualIdentity(facts: SetupFacts): boolean {
  return nonempty(facts.brand_visual) || nonempty(facts.primary_color) || nonempty(facts.logo_url)
}

export function mergeExtractedBrandIntoFacts(
  facts: SetupFacts,
  brand: Record<string, unknown>
): SetupFacts {
  const next = { ...facts }
  const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const primary = normalizeHexColor(brand.primary_color)
  const secondary = normalizeHexColor(brand.secondary_color)
  const accent = normalizeHexColor(brand.accent_color)
  if (primary) next.primary_color = primary
  if (secondary) next.secondary_color = secondary
  if (accent) next.accent_color = accent
  if (str(brand.voice_tone) && !next.brand_voice) next.brand_voice = str(brand.voice_tone)
  if (Array.isArray(brand.tone_keywords)) {
    next.tone_keywords = brand.tone_keywords.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
  }
  if (Array.isArray(brand.must_use_phrases)) {
    next.must_use_phrases = brand.must_use_phrases.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
  }
  if (Array.isArray(brand.forbidden_phrases)) {
    next.forbidden_phrases = brand.forbidden_phrases.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
  }
  if (str(brand.style_notes) && !next.brand_visual) next.brand_visual = str(brand.style_notes)
  if (str(brand.logo_url) && !next.logo_url) next.logo_url = str(brand.logo_url)
  if (Array.isArray(brand.reference_images)) {
    next.reference_images = brand.reference_images.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
  }
  if (str(brand.tagline) && !next.tagline) next.tagline = str(brand.tagline)
  if (str(brand.font_primary) && !next.font_primary) next.font_primary = str(brand.font_primary)
  if (str(brand.brand_name) && (!next.businessName || next.businessName.length < 2)) {
    next.businessName = str(brand.brand_name)
  }
  const extra = Array.isArray(brand.css_colors) ? brand.css_colors : []
  next.palette_candidates = uniqueHexes([
    ...next.palette_candidates,
    primary,
    secondary,
    accent,
    ...extra,
  ])
  return next
}

export interface PaletteDraft {
  primary: string
  secondary: string
  accent: string
  candidates: string[]
  logoUrl: string
}

export function paletteDraftFromFacts(facts: SetupFacts): PaletteDraft | null {
  if (!facts.primary_color && !facts.secondary_color && !facts.accent_color && facts.palette_candidates.length === 0) {
    return null
  }
  return {
    primary: facts.primary_color,
    secondary: facts.secondary_color,
    accent: facts.accent_color,
    candidates: facts.palette_candidates,
    logoUrl: facts.logo_url,
  }
}

export function mergeAutofillIntoFacts(facts: SetupFacts, data: Record<string, unknown>): SetupFacts {
  const next = { ...facts }
  const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  if (str(data.name) && !next.offerName) next.offerName = str(data.name)
  if (str(data.name) && (!next.businessName || next.businessName.length < 2)) next.businessName = str(data.name)
  if (Array.isArray(data.sales_channels)) {
    const channels = data.sales_channels.filter(isSalesChannel)
    if (channels.length) next.salesChannels = channels
  }
  if (str(data.location)) next.location = str(data.location)
  if (typeof data.does_shipping === 'boolean') next.doesShipping = data.does_shipping
  if (str(data.shipping_method)) next.shippingMethod = str(data.shipping_method)
  if (str(data.icp_description) || str(data.context) || str(data.audience_profession)) {
    next.icp = str(data.icp_description) || str(data.context) || str(data.audience_profession) || next.icp
  }
  if (!next.icp) {
    const sex = str(data.audience_sex)
    const profession = str(data.audience_profession)
    const scope = str(data.audience_geographic_scope)
    const bits = [profession, sex && sex !== 'both' ? sex : '', scope].filter(Boolean)
    if (bits.length) next.icp = bits.join(', ')
  }
  if (str(data.product_description)) next.product_description = str(data.product_description)
  if (str(data.utility)) next.utility = str(data.utility)
  if (str(data.result)) next.result = str(data.result)
  if (str(data.current_alternatives)) next.current_alternatives = str(data.current_alternatives)
  if (str(data.svc_problem) || str(data.main_problem)) {
    next.main_problem = str(data.svc_problem) || str(data.main_problem)
  }
  if (str(data.svc_concrete_result) || str(data.expected_result)) {
    next.expected_result = str(data.svc_concrete_result) || str(data.expected_result)
  }
  if (str(data.svc_differentiation) || str(data.differentiation)) {
    next.differentiation = str(data.svc_differentiation) || str(data.differentiation)
  }
  if (str(data.menu_text)) next.menu_text = str(data.menu_text)
  if (str(data.schedule)) next.schedule = str(data.schedule)
  if (str(data.re_price)) next.re_price = str(data.re_price)
  if (str(data.re_location)) next.re_location = str(data.re_location)
  if (str(data.re_highlights)) next.re_highlights = str(data.re_highlights)
  if (str(data.re_cta)) next.re_cta = str(data.re_cta)
  if (str(data.ind_article_type)) next.ind_article_type = str(data.ind_article_type)
  if (str(data.ind_variations_description)) next.ind_variations_description = str(data.ind_variations_description)
  if (str(data.ind_main_material)) next.ind_main_material = str(data.ind_main_material)
  if (str(data.brand_voice)) next.brand_voice = str(data.brand_voice)
  if (Array.isArray(data.tone_keywords)) {
    next.tone_keywords = data.tone_keywords.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
  }
  if (Array.isArray(data.must_use_phrases)) {
    next.must_use_phrases = data.must_use_phrases.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
  }
  if (Array.isArray(data.forbidden_phrases)) {
    next.forbidden_phrases = data.forbidden_phrases.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
  }
  if (str(data.visual_style_notes) || str(data.brand_visual)) {
    next.brand_visual = str(data.visual_style_notes) || str(data.brand_visual)
  }
  const primary = normalizeHexColor(data.primary_color)
  const secondary = normalizeHexColor(data.secondary_color)
  const accent = normalizeHexColor(data.accent_color)
  if (primary) next.primary_color = primary
  if (secondary) next.secondary_color = secondary
  if (accent) next.accent_color = accent
  if (str(data.logo_url) && !next.logo_url) next.logo_url = str(data.logo_url)
  const classified = classifyStorageType(data)
  if (classified.typeConfidence === 'high' || next.typeConfidence === 'low') {
    next.storageType = classified.storageType
    next.customLabel = classified.customLabel || next.customLabel
    next.typeConfidence = classified.typeConfidence
  }
  return next
}

/** Merge the coordinated website analysis whose keys intentionally mirror SetupFacts. */
export function mergeSiteAnalysisIntoFacts(
  facts: SetupFacts,
  data: Record<string, unknown>,
  sourceUrl: string
): SetupFacts {
  let next = mergeAutofillIntoFacts(facts, data)
  const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const stringList = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
    : []

  if (str(data.businessName)) next.businessName = str(data.businessName)
  if (str(data.offerName)) next.offerName = str(data.offerName)
  if (str(data.icp)) next.icp = str(data.icp)
  if (typeof data.doesShipping === 'boolean') next.doesShipping = data.doesShipping
  if (str(data.shippingMethod)) next.shippingMethod = str(data.shippingMethod)
  if (str(data.customLabel)) next.customLabel = str(data.customLabel)
  if (isProductType(data.storageType)) {
    next.storageType = data.storageType
    next.typeConfidence = 'high'
  }

  const directStrings: Array<keyof SetupFacts> = [
    'location', 'product_description', 'utility', 'result', 'current_alternatives',
    'key_objection', 'main_problem', 'expected_result', 'differentiation', 'menu_text',
    'schedule', 're_price', 're_location', 're_highlights', 're_cta', 'ind_article_type',
    'ind_variations_description', 'ind_main_material', 'brand_voice', 'brand_visual',
    'primary_color', 'secondary_color', 'accent_color', 'logo_url', 'tagline', 'font_primary',
  ]
  for (const key of directStrings) {
    const value = str(data[key])
    if (value) (next as unknown as Record<string, unknown>)[key] = value
  }
  if (Array.isArray(data.salesChannels)) {
    const channels = data.salesChannels.filter(isSalesChannel)
    if (channels.length) next.salesChannels = channels
  }
  const listFields: Array<'tone_keywords' | 'must_use_phrases' | 'forbidden_phrases' | 'reference_images'> = [
    'tone_keywords', 'must_use_phrases', 'forbidden_phrases', 'reference_images',
  ]
  for (const key of listFields) {
    const values = stringList(data[key])
    if (values.length) next = { ...next, [key]: values }
  }
  next.sourceUrl = sourceUrl
  return next
}

export function hasOfferHypothesis(facts: SetupFacts): boolean {
  return (
    nonempty(facts.offerName)
    || nonempty(facts.product_description)
    || nonempty(facts.main_problem)
    || nonempty(facts.menu_text)
    || nonempty(facts.re_price)
    || nonempty(facts.ind_article_type)
  )
}

export function questionPrompt(id: SetupQuestionId, language: 'en' | 'es', facts: SetupFacts): string {
  const es = language === 'es'
  switch (id) {
    case 'source':
      return es
        ? 'Pegá una URL o contame qué vendés. Con eso armo la oferta y te la confirmo.'
        : 'Paste a URL or tell me what you sell. I’ll draft the offer and confirm it with you.'
    case 'channels':
      return es
        ? '¿Vendés en local físico, por mensajes (WhatsApp/DM) o por web? Podés marcar más de uno.'
        : 'Do you sell in-store, via messages (WhatsApp/DM), or on a website? You can pick more than one.'
    case 'location':
      return es ? '¿Dónde está el local?' : 'Where is the physical location?'
    case 'audience':
      return es
        ? '¿Quién es tu cliente ideal, en una o dos frases?'
        : 'Who is the ideal customer, in one or two sentences?'
    case 'type_confirm':
      return es
        ? `Inferí que esto es ${typeLabel(facts, 'es')}. ¿Correcto, o es producto, servicio, restaurante, inmobiliaria o indumentaria?`
        : `I inferred this is ${typeLabel(facts, 'en')}. Correct, or is it a product, service, restaurant, real estate, or apparel?`
    case 'offer_name':
      return es ? '¿Cómo se llama la oferta o el producto?' : 'What is the offer or product called?'
    case 'product_benefits':
      return es
        ? '¿Qué tiene de bueno este producto? (qué es / para qué sirve)'
        : 'What’s good about this product? (what it is / what it does)'
    case 'product_result':
      return es
        ? '¿Qué resultado consigue alguien al usarlo?'
        : 'What result does someone get from using it?'
    case 'product_alternatives':
      return es
        ? '¿Qué compra hoy la gente para el mismo problema, y qué les falla?'
        : 'What do people buy today for the same problem, and what fails?'
    case 'service_problem':
      return es
        ? '¿Qué problema específico resuelve tu servicio, y qué está pasando hoy por eso?'
        : 'What specific problem does the service solve, and what’s happening because of it today?'
    case 'service_result':
      return es
        ? '¿Qué resultado concreto obtiene el cliente, y en cuánto tiempo?'
        : 'What concrete result does the client get, and in what timeframe?'
    case 'service_diff':
      return es
        ? '¿Qué lo hace distinto, y cuál es la objeción más común?'
        : 'What makes it different, and what’s the most common objection?'
    case 'restaurant_menu':
      return es
        ? '¿Cuáles son los platos o el menú que más querés empujar?'
        : 'What dishes or menu should we push most?'
    case 'restaurant_place':
      return es ? '¿Dónde está el restaurante?' : 'Where is the restaurant?'
    case 'restaurant_hours':
      return es ? '¿Cuál es el horario?' : 'What are the hours?'
    case 're_deal':
      return es
        ? '¿Es venta, alquiler o Airbnb, y cuál es el precio?'
        : 'Is it sale, rent, or Airbnb, and what’s the price?'
    case 're_place':
      return es ? '¿Dónde está la propiedad?' : 'Where is the property?'
    case 're_highlights':
      return es
        ? '¿Qué highlights tiene, y cuál es el llamado a la acción?'
        : 'What are the highlights, and what’s the call to action?'
    case 'ind_what':
      return es
        ? '¿Qué artículo es, y qué variaciones (tallas, colores, modelos) hay?'
        : 'What article is it, and what variations (sizes, colors, models) exist?'
    case 'ind_material':
      return es ? '¿Cuál es el material o la calidad que lo diferencia?' : 'What’s the material or quality that sets it apart?'
    case 'brand_voice':
      return es
        ? '¿Cómo debería sonar la marca? (tono, palabras que sí / que no)'
        : 'How should the brand sound? (tone, words to use / avoid)'
    case 'brand_visual':
      return es
        ? '¿Cómo se ve la marca? Colores, estilo de fotos, logo, o lo que no querés que aparezca. Podés saltar y lo afinamos después.'
        : 'How should the brand look? Colors, photo style, logo, or what should never appear. You can skip and we’ll refine later.'
    default: {
      const _never: never = id
      return _never
    }
  }
}

export function typeLabel(facts: SetupFacts, language: 'en' | 'es'): string {
  if (facts.customLabel) return facts.customLabel
  const map = {
    es: {
      product: 'un producto',
      service: 'un servicio',
      restaurant: 'un restaurante',
      real_estate: 'inmobiliaria',
      indumentaria: 'indumentaria',
    },
    en: {
      product: 'a product',
      service: 'a service',
      restaurant: 'a restaurant',
      real_estate: 'real estate',
      indumentaria: 'apparel',
    },
  } as const
  return map[language][facts.storageType]
}

export function offerSummary(facts: SetupFacts, language: 'en' | 'es'): string {
  const kind = typeLabel(facts, language)
  const name = facts.offerName || facts.businessName
  const channels = facts.salesChannels.length
    ? facts.salesChannels.join(', ')
    : language === 'es' ? '—' : '—'
  const detail =
    facts.product_description
    || facts.utility
    || facts.result
    || facts.main_problem
    || facts.menu_text
    || facts.re_highlights
    || facts.ind_variations_description
  const audience = facts.icp
  if (language === 'es') {
    return [
      'Armé este resumen con lo que me diste (URL y texto). Si algo está mal, decime qué cambiar. Si está bien, escribí “correcto”.',
      `• Tipo: ${kind}`,
      `• Oferta: ${name || '—'}`,
      `• Canales: ${channels}`,
      audience ? `• Público: ${audience}` : null,
      facts.location ? `• Ubicación: ${facts.location}` : null,
      detail ? `• Detalle: ${detail}` : null,
    ].filter(Boolean).join('\n')
  }
  return [
    'I drafted this from the URL and text you pasted. If something is wrong, tell me what to change. If it’s right, type “correct”.',
    `• Type: ${kind}`,
    `• Offer: ${name || '—'}`,
    `• Channels: ${channels}`,
    audience ? `• Audience: ${audience}` : null,
    facts.location ? `• Location: ${facts.location}` : null,
    detail ? `• Detail: ${detail}` : null,
  ].filter(Boolean).join('\n')
}

/** Compact folder brief written to session.context for generation. */
export function buildFolderContext(facts: SetupFacts, language: 'en' | 'es'): string {
  const kind = typeLabel(facts, language)
  const name = facts.offerName || facts.businessName
  const channels = facts.salesChannels.length ? facts.salesChannels.join(', ') : ''
  const detail =
    facts.product_description
    || facts.utility
    || facts.result
    || facts.main_problem
    || facts.menu_text
    || facts.re_highlights
    || facts.ind_variations_description
  const lines = language === 'es'
    ? [
      facts.businessName ? `Marca: ${facts.businessName}` : null,
      name ? `Oferta: ${name}` : null,
      `Tipo: ${kind}`,
      channels ? `Canales: ${channels}` : null,
      facts.icp ? `Público: ${facts.icp}` : null,
      facts.location ? `Ubicación: ${facts.location}` : null,
      detail ? `Qué vende: ${detail}` : null,
      facts.main_problem ? `Problema principal: ${facts.main_problem}` : null,
      (facts.result || facts.expected_result) ? `Resultado prometido: ${facts.result || facts.expected_result}` : null,
      facts.differentiation ? `Diferenciador: ${facts.differentiation}` : null,
      facts.current_alternatives ? `Alternativas actuales: ${facts.current_alternatives}` : null,
      facts.key_objection ? `Objeción principal: ${facts.key_objection}` : null,
      facts.brand_voice ? `Voz de marca: ${facts.brand_voice}` : null,
      facts.tone_keywords.length ? `Tonos clave: ${facts.tone_keywords.join(', ')}` : null,
      facts.must_use_phrases.length ? `Frases que sí usa: ${facts.must_use_phrases.join(' | ')}` : null,
      facts.forbidden_phrases.length ? `Frases que evita: ${facts.forbidden_phrases.join(' | ')}` : null,
      facts.brand_visual ? `Dirección visual: ${facts.brand_visual}` : null,
      [facts.primary_color, facts.secondary_color, facts.accent_color].filter(Boolean).length
        ? `Colores: ${[facts.primary_color, facts.secondary_color, facts.accent_color].filter(Boolean).join(', ')}`
        : null,
      facts.logo_url ? 'Logo oficial: disponible en el Brand Kit' : null,
      facts.reference_images.length ? `Referencias visuales: ${facts.reference_images.length} disponibles en el Brand Kit` : null,
      facts.sourceUrl ? `Fuente principal: ${facts.sourceUrl}` : null,
    ]
    : [
      facts.businessName ? `Brand: ${facts.businessName}` : null,
      name ? `Offer: ${name}` : null,
      `Type: ${kind}`,
      channels ? `Channels: ${channels}` : null,
      facts.icp ? `Audience: ${facts.icp}` : null,
      facts.location ? `Location: ${facts.location}` : null,
      detail ? `What it sells: ${detail}` : null,
      facts.main_problem ? `Main problem: ${facts.main_problem}` : null,
      (facts.result || facts.expected_result) ? `Promised outcome: ${facts.result || facts.expected_result}` : null,
      facts.differentiation ? `Differentiator: ${facts.differentiation}` : null,
      facts.current_alternatives ? `Current alternatives: ${facts.current_alternatives}` : null,
      facts.key_objection ? `Main objection: ${facts.key_objection}` : null,
      facts.brand_voice ? `Brand voice: ${facts.brand_voice}` : null,
      facts.tone_keywords.length ? `Tone keywords: ${facts.tone_keywords.join(', ')}` : null,
      facts.must_use_phrases.length ? `Phrases to use: ${facts.must_use_phrases.join(' | ')}` : null,
      facts.forbidden_phrases.length ? `Phrases to avoid: ${facts.forbidden_phrases.join(' | ')}` : null,
      facts.brand_visual ? `Visual direction: ${facts.brand_visual}` : null,
      [facts.primary_color, facts.secondary_color, facts.accent_color].filter(Boolean).length
        ? `Colors: ${[facts.primary_color, facts.secondary_color, facts.accent_color].filter(Boolean).join(', ')}`
        : null,
      facts.logo_url ? 'Official logo: available in Brand Kit' : null,
      facts.reference_images.length ? `Visual references: ${facts.reference_images.length} available in Brand Kit` : null,
      facts.sourceUrl ? `Primary source: ${facts.sourceUrl}` : null,
    ]
  const supplemental = language === 'es'
    ? [
      facts.doesShipping ? `Envios: si${facts.shippingMethod ? `; ${facts.shippingMethod}` : ''}` : null,
      facts.utility ? `Utilidad principal: ${facts.utility}` : null,
      facts.menu_text ? `Menu: ${facts.menu_text}` : null,
      facts.schedule ? `Horario: ${facts.schedule}` : null,
      facts.re_price ? `Precio inmobiliario: ${facts.re_price}` : null,
      facts.re_location ? `Ubicacion inmobiliaria: ${facts.re_location}` : null,
      facts.re_highlights ? `Atributos inmobiliarios: ${facts.re_highlights}` : null,
      facts.re_cta ? `CTA inmobiliario: ${facts.re_cta}` : null,
      facts.ind_article_type ? `Tipo de prenda: ${facts.ind_article_type}` : null,
      facts.ind_variations_description ? `Variaciones: ${facts.ind_variations_description}` : null,
      facts.ind_main_material ? `Material principal: ${facts.ind_main_material}` : null,
      facts.tagline ? `Tagline: ${facts.tagline}` : null,
      facts.font_primary ? `Tipografia principal: ${facts.font_primary}` : null,
    ]
    : [
      facts.doesShipping ? `Shipping: yes${facts.shippingMethod ? `; ${facts.shippingMethod}` : ''}` : null,
      facts.utility ? `Primary utility: ${facts.utility}` : null,
      facts.menu_text ? `Menu: ${facts.menu_text}` : null,
      facts.schedule ? `Schedule: ${facts.schedule}` : null,
      facts.re_price ? `Real-estate price: ${facts.re_price}` : null,
      facts.re_location ? `Real-estate location: ${facts.re_location}` : null,
      facts.re_highlights ? `Real-estate highlights: ${facts.re_highlights}` : null,
      facts.re_cta ? `Real-estate CTA: ${facts.re_cta}` : null,
      facts.ind_article_type ? `Apparel type: ${facts.ind_article_type}` : null,
      facts.ind_variations_description ? `Variations: ${facts.ind_variations_description}` : null,
      facts.ind_main_material ? `Primary material: ${facts.ind_main_material}` : null,
      facts.tagline ? `Tagline: ${facts.tagline}` : null,
      facts.font_primary ? `Primary font: ${facts.font_primary}` : null,
    ]
  return [...lines, ...supplemental].filter(Boolean).join('\n')
}

export function askedFromFacts(facts: SetupFacts): SetupQuestionId[] {
  const asked: SetupQuestionId[] = []
  const add = (id: SetupQuestionId, filled: boolean) => {
    if (filled) asked.push(id)
  }
  add('source', nonempty(facts.sourceUrl) || nonempty(facts.sourceText) || hasOfferHypothesis(facts))
  add('type_confirm', facts.typeConfidence === 'high' || nonempty(facts.offerName) || nonempty(facts.product_description))
  add('channels', facts.salesChannels.length > 0)
  add('location', nonempty(facts.location))
  add('audience', nonempty(facts.icp))
  add('offer_name', nonempty(facts.offerName))
  add('product_benefits', nonempty(facts.product_description) || nonempty(facts.utility))
  add('product_result', nonempty(facts.result) || nonempty(facts.expected_result))
  add('product_alternatives', nonempty(facts.current_alternatives))
  add('service_problem', nonempty(facts.main_problem))
  add('service_result', nonempty(facts.expected_result) || nonempty(facts.result))
  add('service_diff', nonempty(facts.differentiation))
  add('restaurant_menu', nonempty(facts.menu_text))
  add('restaurant_place', nonempty(facts.location))
  add('restaurant_hours', nonempty(facts.schedule))
  add('re_deal', nonempty(facts.re_price))
  add('re_place', nonempty(facts.re_location) || nonempty(facts.location))
  add('re_highlights', nonempty(facts.re_highlights))
  add('ind_what', nonempty(facts.ind_article_type))
  add('ind_material', nonempty(facts.ind_main_material))
  add('brand_voice', nonempty(facts.brand_voice))
  add('brand_visual', factsHaveVisualIdentity(facts))
  return asked
}

export function nextSetupQuestion(state: SetupFlowState): SetupQuestionId | null {
  const { facts, asked } = state
  const missing = (id: SetupQuestionId, filled: boolean) => !filled && !asked.includes(id)

  if (facts.offerConfirmed) {
    if (missing('brand_visual', factsHaveVisualIdentity(facts))) return 'brand_visual'
    return null
  }
  if (state.confirmOffered) return null
  if (hasOfferHypothesis(facts)) return null

  if (missing('source', nonempty(facts.sourceUrl) || nonempty(facts.sourceText) || hasOfferHypothesis(facts))) {
    return 'source'
  }
  if (missing('type_confirm', facts.typeConfidence === 'high' || Boolean(facts.customLabel) || nonempty(facts.offerName))) {
    return 'type_confirm'
  }
  if (missing('channels', facts.salesChannels.length > 0)) return 'channels'
  if (facts.salesChannels.includes('physical') && missing('location', nonempty(facts.location))) {
    return 'location'
  }
  if (missing('audience', nonempty(facts.icp))) return 'audience'
  if (missing('offer_name', nonempty(facts.offerName))) return 'offer_name'
  return null
}

export function applyQuestionAnswer(
  facts: SetupFacts,
  question: SetupQuestionId,
  text: string
): SetupFacts {
  const next = { ...facts }
  const trimmed = text.trim()
  switch (question) {
    case 'source':
      next.sourceText = trimmed
      if (!next.icp) next.icp = trimmed
      break
    case 'channels':
      next.salesChannels = parseChannelsFromText(trimmed)
      break
    case 'location':
    case 'restaurant_place':
      next.location = trimmed
      break
    case 'audience':
      next.icp = trimmed
      break
    case 'type_confirm': {
      const lower = trimmed.toLowerCase()
      if (/\b(servicio|service)\b/.test(lower)) next.storageType = 'service'
      else if (/\b(restaurante|restaurant)\b/.test(lower)) next.storageType = 'restaurant'
      else if (/\b(inmobiliaria|real.?estate|propiedad)\b/.test(lower)) next.storageType = 'real_estate'
      else if (/\b(indumentaria|ropa|apparel|fashion)\b/.test(lower)) next.storageType = 'indumentaria'
      else if (/\b(producto|product)\b/.test(lower)) next.storageType = 'product'
      else next.customLabel = trimmed
      next.typeConfidence = 'high'
      break
    }
    case 'offer_name':
      next.offerName = trimmed
      break
    case 'product_benefits':
      next.product_description = trimmed
      if (!next.utility) next.utility = trimmed
      break
    case 'product_result':
      next.result = trimmed
      next.expected_result = trimmed
      break
    case 'product_alternatives':
      next.current_alternatives = trimmed
      break
    case 'service_problem':
      next.main_problem = trimmed
      break
    case 'service_result':
      next.expected_result = trimmed
      next.result = trimmed
      break
    case 'service_diff':
      next.differentiation = trimmed
      break
    case 'restaurant_menu':
      next.menu_text = trimmed
      break
    case 'restaurant_hours':
      next.schedule = trimmed
      break
    case 're_deal':
      next.re_price = trimmed
      if (/\balquil/i.test(trimmed)) next.customLabel = 'rent'
      if (/\bairbnb/i.test(trimmed)) next.customLabel = 'airbnb'
      break
    case 're_place':
      next.re_location = trimmed
      break
    case 're_highlights':
      next.re_highlights = trimmed
      next.re_cta = next.re_cta || (trimmed.includes('agenda') ? trimmed : '')
      break
    case 'ind_what':
      next.ind_article_type = trimmed
      next.ind_variations_description = trimmed
      break
    case 'ind_material':
      next.ind_main_material = trimmed
      break
    case 'brand_voice':
      next.brand_voice = trimmed
      break
    case 'brand_visual':
      next.brand_visual = trimmed
      break
    default: {
      const _never: never = question
      return _never
    }
  }
  return next
}

export function markAsked(asked: SetupQuestionId[], id: SetupQuestionId): SetupQuestionId[] {
  return asked.includes(id) ? asked : [...asked, id]
}

export const SETUP_COMPOSER_PLACEHOLDER = {
  es: 'Pegá una URL o respondé acá…',
  en: 'Paste a URL or reply here…',
} as const

export function questionForSetupStep(
  step: BrandSetupStepId,
  facts: SetupFacts
): SetupQuestionId {
  switch (step) {
    case 'business':
      return hasOfferHypothesis(facts) ? 'type_confirm' : 'source'
    case 'channels':
      return 'channels'
    case 'audience':
      return 'audience'
    case 'offer':
      return nonempty(facts.offerName) ? 'product_benefits' : 'offer_name'
    case 'brand':
      return factsHaveVisualIdentity(facts) ? 'brand_voice' : 'brand_visual'
    case 'sources':
      return 'source'
    default: {
      const _never: never = step
      return _never
    }
  }
}
