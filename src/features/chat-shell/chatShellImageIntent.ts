import {
  IMAGE_PRESETS,
  PRODUCT_SUB_STYLES,
} from '../../data/image-presets'
import type { ImageModel, OrganicSingleSubtype } from '../../types'
import type { PostTextDensity } from './chatShellImages'
import { normalizePostTextDensity } from './chatShellImages'

export type ShellImageAspect = '9:16' | '3:4' | '4:5' | '1:1'
export type ShellImageDensity = PostTextDensity

export type ShellImageStyle =
  | { kind: 'preset'; presetId: string }
  | { kind: 'product'; productSubStyle: string }
  | { kind: 'organic'; organicSubtype: OrganicSingleSubtype }
  | { kind: 'logo'; archetype?: string }

export interface ShellImagePreferences {
  style?: ShellImageStyle
  aspectRatio: ShellImageAspect
  model: ImageModel
  density: ShellImageDensity
  logoMode?: 'generate' | 'enhance'
  logoBackground?: 'transparent' | 'white' | 'dark'
}

export interface ShellImageIntent {
  matched: boolean
  preferences: Partial<ShellImagePreferences>
  wantsImage: boolean
}

export type ImageClarifyStep = 'script' | 'mode' | 'style' | 'aspect' | 'density' | 'styleRef' | 'refs' | 'ingredients'
export type ImageClarifyMode = 'anuncio' | 'product' | 'organic'

export interface ImageClarifyPlan {
  needed: boolean
  step: ImageClarifyStep | null
  mode?: ImageClarifyMode
  assumptions: string[]
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem?(key: string, value: string): void
}

export const SHELL_ASPECT_SIZES: Record<ShellImageAspect, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
  '3:4': { width: 1080, height: 1440 },
  '1:1': { width: 1080, height: 1080 },
}

export const IMAGE_ASPECT_CHOICES: Array<{
  id: ShellImageAspect
  labelEs: string
  labelEn: string
  hint: string
}> = [
  { id: '9:16', labelEs: 'Reel', labelEn: 'Reel', hint: '9:16' },
  { id: '1:1', labelEs: 'Post cuadrado', labelEn: 'Square post', hint: '1:1' },
  { id: '4:5', labelEs: 'Post vertical', labelEn: 'Vertical post', hint: '4:5' },
]

export const IMAGE_DENSITY_CHOICES: Array<{
  id: ShellImageDensity
  labelEs: string
  labelEn: string
  hint: string
}> = [
  { id: 'hard', labelEs: 'Poco texto', labelEn: 'Short copy', hint: 'Gancho + prueba + CTA' },
  { id: 'medium', labelEs: 'Texto medio', labelEn: 'Medium copy', hint: 'Gancho + desarrollo + CTA' },
]

/** Workplace-aligned shell defaults (style unresolved until sticky/clarify). */
export const DEFAULT_IMAGE_PREFERENCES: ShellImagePreferences = {
  aspectRatio: '9:16',
  model: 'grok-imagine',
  density: 'hard',
}

/** Workplace organic-single subtypes (no carousel). */
export const ORGANIC_SINGLE_SUBTYPES: readonly OrganicSingleSubtype[] = [
  'quote-motivational',
  'infographic',
  'product-showcase-organic',
  'aesthetic-brand',
] as const

const PRESET_IDS = new Set(IMAGE_PRESETS.map((p) => p.id))
const PRODUCT_SUB_IDS = new Set(PRODUCT_SUB_STYLES.map((s) => s.id))
const ORGANIC_SUB_IDS = new Set<string>(ORGANIC_SINGLE_SUBTYPES)

/** Extra anuncio-family ids (not in IMAGE_PRESETS catalog). */
const ANUNCIO_STYLE_IDS = new Set(['venta-directa', 'anuncio-conversion'])

const VALID_ASPECTS = new Set<ShellImageAspect>(['9:16', '3:4', '4:5', '1:1'])
const VALID_MODELS = new Set<ImageModel>([
  'nano-banana',
  'nano-banana-pro',
  'grok-imagine',
])

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '')
}

function normalizeText(text: string): string {
  return stripDiacritics(text || '')
    .toLowerCase()
    // Keep ":" so aspect ratios like 9:16 / 1:1 survive tokenization.
    .replace(/[¡!¿?.,;"'`´]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isValidStyle(style: ShellImageStyle | undefined): style is ShellImageStyle {
  if (!style) return false
  if (style.kind === 'product') return PRODUCT_SUB_IDS.has(style.productSubStyle)
  if (style.kind === 'organic') return ORGANIC_SUB_IDS.has(style.organicSubtype)
  if (style.kind === 'preset') {
    return ANUNCIO_STYLE_IDS.has(style.presetId) || PRESET_IDS.has(style.presetId)
  }
  if (style.kind === 'logo') return true
  const _exhaustive: never = style
  return _exhaustive
}

/** Sub-styles that can generate from offer context alone (0 uploaded refs). */
export const PRODUCT_ZERO_REF_SUBSTYLES = new Set(['studio-hero', 'podium'])

export function requiresProductReferences(style: ShellImageStyle | undefined): boolean {
  if (style?.kind !== 'product') return false
  return !PRODUCT_ZERO_REF_SUBSTYLES.has(style.productSubStyle)
}

export function productStyleAllowsZeroReferences(style: ShellImageStyle | undefined): boolean {
  return style?.kind === 'product' && PRODUCT_ZERO_REF_SUBSTYLES.has(style.productSubStyle)
}

export function imagePrefsStorageKey(sessionId: string): string {
  return `chat_shell:image:prefs:v1:${sessionId}`
}

export function readImagePreferences(
  storage: StorageLike | null | undefined,
  sessionId: string | null | undefined
): Partial<ShellImagePreferences> {
  if (!storage || !sessionId) return {}
  try {
    const raw = storage.getItem(imagePrefsStorageKey(sessionId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<ShellImagePreferences>
    return sanitizePartialPreferences(parsed)
  } catch {
    return {}
  }
}

export function writeImagePreferences(
  storage: StorageLike | null | undefined,
  sessionId: string | null | undefined,
  prefs: ShellImagePreferences
): void {
  if (!storage?.setItem || !sessionId) return
  try {
    storage.setItem(imagePrefsStorageKey(sessionId), JSON.stringify(prefs))
  } catch {
    /* ignore quota */
  }
}

export function sanitizePartialPreferences(
  input: Partial<ShellImagePreferences> | null | undefined
): Partial<ShellImagePreferences> {
  if (!input || typeof input !== 'object') return {}
  const out: Partial<ShellImagePreferences> = {}
  if (input.style && isValidStyle(input.style)) out.style = input.style
  if (input.aspectRatio && VALID_ASPECTS.has(input.aspectRatio)) {
    out.aspectRatio = input.aspectRatio
  }
  if (input.model && VALID_MODELS.has(input.model)) out.model = input.model
  if (input.density) out.density = normalizePostTextDensity(input.density)
  return out
}

export function resolveImagePreferences(
  explicit: Partial<ShellImagePreferences> | null | undefined,
  sticky: Partial<ShellImagePreferences> | null | undefined
): ShellImagePreferences {
  const e = sanitizePartialPreferences(explicit)
  const s = sanitizePartialPreferences(sticky)
  return {
    style: e.style ?? s.style,
    aspectRatio: e.aspectRatio ?? s.aspectRatio ?? DEFAULT_IMAGE_PREFERENCES.aspectRatio,
    model: e.model ?? s.model ?? DEFAULT_IMAGE_PREFERENCES.model,
    density: e.density ?? s.density ?? DEFAULT_IMAGE_PREFERENCES.density,
  }
}

function matchPresetAlias(normalized: string): string | null {
  if (/\bventa[\s-]?directa\b/.test(normalized) || /\bdirect\s+sale\b/.test(normalized)) {
    return 'venta-directa'
  }
  if (/\banuncio(?:\s+de\s+conversion)?\b/.test(normalized) || /\bconversion\s+ad\b/.test(normalized)) {
    return 'anuncio-conversion'
  }
  const aliases: Array<[string, RegExp]> = [
    ['features-benefits', /\b(?:features?\s*(?:&|and|y)?\s*benefits?|caracteristicas?\s*y\s*beneficios?)\b/],
    ['product-showcase', /\b(?:product\s+showcase|exhibici[oó]n\s+de\s+producto)\b/],
    ['social-proof', /\b(?:social\s+proof|prueba\s+social)\b/],
    ['comparison', /\b(?:comparison|comparaci[oó]n|vs)\b/],
    ['before-after', /\b(?:before\s*(?:&|and|y)?\s*after|antes\s*y\s*despu[eé]s)\b/],
    ['collage', /\bcollage\b/],
    ['deals-discounts', /\b(?:deals?\s*(?:&|and|y)?\s*discounts?|ofertas?\s*y\s*descuentos?|descuento)\b/],
    ['testimonial', /\b(?:testimonial|testimonio)\b/],
  ]
  for (const [id, re] of aliases) {
    if (re.test(normalized)) return id
  }
  for (const preset of IMAGE_PRESETS) {
    if (normalized.includes(normalizeText(preset.id.replace(/-/g, ' ')))) return preset.id
    if (normalized.includes(normalizeText(preset.name))) return preset.id
    if (normalized.includes(normalizeText(preset.nameEs))) return preset.id
  }
  return null
}

function matchProductSubStyle(normalized: string): string | null {
  const aliases: Array<[string, RegExp]> = [
    ['studio-hero', /\b(?:studio\s*hero|estudio\s*hero|hero\s*studio)\b/],
    ['lifestyle', /\b(?:lifestyle|contexto\s+lifestyle|en\s+contexto)\b/],
    ['background-swap', /\b(?:background\s*swap|cambiar\s+fondo|fondo\s+nuevo)\b/],
    ['pure-enhance', /\b(?:pure\s+enhance(?:ment)?|solo\s+mejorar|mejorar\s+(?:foto|imagen))\b/],
    ['splash-action', /\b(?:splash|acci[oó]n|action\s+shot)\b/],
    ['podium', /\b(?:podium|podio|display)\b/],
  ]
  for (const [id, re] of aliases) {
    if (re.test(normalized)) return id
  }
  return null
}

function matchOrganicSubtype(normalized: string): OrganicSingleSubtype | null {
  if (
    /\bproduct[\s-]?showcase[\s-]?organic\b/.test(normalized)
    || /\bshowcase\s+organic(?:o)?\b/.test(normalized)
    || /\bshowcase\s+organico\b/.test(normalized)
    || /\bexhibicion\s+organica\b/.test(normalized)
    || /\bproducto\s+editorial\b/.test(normalized)
    || /\borganic\s+product\s+showcase\b/.test(normalized)
  ) {
    return 'product-showcase-organic'
  }
  if (
    /\baesthetic[\s-]?brand\b/.test(normalized)
    || /\bbrand\s+aesthetic\b/.test(normalized)
    || /\baesthetic(?:a)?\s+(?:de\s+)?marca\b/.test(normalized)
    || /\bestetica\s+(?:de\s+)?marca\b/.test(normalized)
    || /\bmarca\s+aesthetic\b/.test(normalized)
  ) {
    return 'aesthetic-brand'
  }
  if (/\binfographic\b/.test(normalized) || /\binfografia\b/.test(normalized)) {
    return 'infographic'
  }
  if (
    /\bquote[\s-]?motivational\b/.test(normalized)
    || /\bcita\s+motivacional\b/.test(normalized)
    || /\bfrase\s+motivacional\b/.test(normalized)
    || /\bmotivational\s+quote\b/.test(normalized)
  ) {
    return 'quote-motivational'
  }
  // Ambiguous bare "cita"/"quote" — only when paired with image intent elsewhere.
  if (/\b(?:cita|quote|motivacional)\b/.test(normalized)) {
    return 'quote-motivational'
  }
  return null
}

function matchAspect(normalized: string): ShellImageAspect | null {
  if (/\b9\s*[:/x]\s*16\b/.test(normalized) || /\bstories?\b/.test(normalized) || /\breels?\b/.test(normalized)) {
    return '9:16'
  }
  if (/\b4\s*[:/x]\s*5\b/.test(normalized) || /\bpost\s+vertical\b/.test(normalized)) return '4:5'
  if (/\b3\s*[:/x]\s*4\b/.test(normalized)) return '3:4'
  if (/\b1\s*[:/x]\s*1\b/.test(normalized) || /\bcuadrad[oa]\b/.test(normalized) || /\bsquare\b/.test(normalized)) {
    return '1:1'
  }
  return null
}

export function aspectRatioFromDimensions(width: number, height: number): ShellImageAspect {
  if (!(width > 0) || !(height > 0)) return '1:1'
  const ratio = width / height
  const candidates: Array<[ShellImageAspect, number]> = [
    ['1:1', 1],
    ['4:5', 4 / 5],
    ['3:4', 3 / 4],
    ['9:16', 9 / 16],
  ]
  let best: ShellImageAspect = '1:1'
  let bestDiff = Number.POSITIVE_INFINITY
  for (const [id, target] of candidates) {
    const diff = Math.abs(ratio - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = id
    }
  }
  return best
}

export function readImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not read image size'))
    img.src = url
  })
}

export async function aspectRatioFromImageUrl(url: string): Promise<ShellImageAspect | null> {
  try {
    const size = await readImageDimensions(url)
    return aspectRatioFromDimensions(size.width, size.height)
  } catch {
    return null
  }
}

function matchModel(normalized: string): ImageModel | null {
  if (/\b(?:nano[\s-]?banana[\s-]?pro|nb[\s-]?pro|modelo\s+pro)\b/.test(normalized)) {
    return 'nano-banana-pro'
  }
  if (/\b(?:nano[\s-]?banana|nb[\s-]?fast|modelo\s+fast|rapido|rápido)\b/.test(normalized)) {
    return 'nano-banana'
  }
  if (/\bgrok(?:[\s-]?imagine)?\b/.test(normalized)) return 'grok-imagine'
  return null
}

function matchDensity(normalized: string): ShellImageDensity | null {
  if (/\b(?:densidad\s+)?hard\b/.test(normalized) || /\btexto\s+minimo\b/.test(normalized)) return 'hard'
  if (/\b(?:densidad\s+)?standard\b/.test(normalized) || /\btexto\s+completo\b/.test(normalized)) {
    return 'standard'
  }
  if (/\b(?:densidad\s+)?medium\b/.test(normalized) || /\btexto\s+medio\b/.test(normalized)) {
    return 'medium'
  }
  return null
}

const IMAGE_HINT =
  /\b(?:imagen(?:es)?|image(?:s)?|foto(?:s)?|photo(?:s)?|visual(?:es)?|logo(?:s)?|posts?|publicaci[oó]n(?:es)?|haz(?:me)?\s+una\s+imagen|genera(?:me)?\s+(?:una\s+)?(?:imagen|foto|logo|post)|crear?\s+(?:imagen|post)|crea(?:me)?\s+(?:una\s+)?(?:imagen|post))\b/

const SCRIPT_HINT =
  /\b(?:gui[oó]n(?:es)?|guion(?:es)?|script(?:s)?|venta(?:s)?(?:\s+directa)?|desvalidar|educativo|storytelling)\b/

/**
 * Parse natural-language image generation intent (does not steal pure script asks).
 */
export function parseChatShellImageIntent(
  text: string,
  _language: 'en' | 'es' = 'es'
): ShellImageIntent {
  const normalized = normalizeText(text)
  const preferences: Partial<ShellImagePreferences> = {}

  const imageCue = IMAGE_HINT.test(normalized)
  const scriptCue = SCRIPT_HINT.test(normalized)

  // Pure script asks without image language → not an image intent
  if (scriptCue && !imageCue) {
    return { matched: false, preferences: {}, wantsImage: false }
  }

  const productSub = matchProductSubStyle(normalized)
  const organicSub = imageCue ? matchOrganicSubtype(normalized) : null
  const presetId = matchPresetAlias(normalized)
  const wantsLogo = /\blogo(?:s)?\b/.test(normalized)
  if (wantsLogo) {
    preferences.style = { kind: 'logo', archetype: 'auto' }
  } else if (productSub) {
    preferences.style = { kind: 'product', productSubStyle: productSub }
  } else if (organicSub) {
    // Prefer organic-single over colliding anuncio presets (e.g. product-showcase).
    preferences.style = { kind: 'organic', organicSubtype: organicSub }
  } else if (presetId) {
    preferences.style = { kind: 'preset', presetId }
  }

  const aspect = matchAspect(normalized)
  if (aspect) preferences.aspectRatio = aspect
  const model = matchModel(normalized)
  if (model) preferences.model = model
  const density = matchDensity(normalized)
  if (density) preferences.density = density

  if (!imageCue && !productSub) {
    return { matched: false, preferences: {}, wantsImage: false }
  }

  return {
    matched: true,
    preferences,
    wantsImage: true,
  }
}

export function planImageClarifications(
  resolved: ShellImagePreferences,
  options?: { maxQuestions?: number; aspectUnset?: boolean; densityUnset?: boolean }
): ImageClarifyPlan {
  const maxQuestions = options?.maxQuestions ?? 2
  const assumptions: string[] = []
  if (!resolved.style) {
    return {
      needed: maxQuestions > 0,
      step: 'mode',
      assumptions,
    }
  }
  if (resolved.style.kind === 'product') {
    assumptions.push(`Producto · ${resolved.style.productSubStyle}`)
  } else if (resolved.style.kind === 'organic') {
    assumptions.push(`Orgánico · ${resolved.style.organicSubtype}`)
  } else if (resolved.style.kind === 'preset') {
    assumptions.push(`Anuncio · ${resolved.style.presetId}`)
  } else if (resolved.style.kind === 'logo') {
    assumptions.push(`Logo · ${resolved.style.archetype || 'auto'}`)
  } else {
    const _exhaustive: never = resolved.style
    void _exhaustive
  }
  if (options?.aspectUnset) {
    return { needed: maxQuestions > 0, step: 'aspect', assumptions }
  }
  assumptions.push(resolved.aspectRatio)
  if (options?.densityUnset) {
    return { needed: maxQuestions > 0, step: 'density', assumptions }
  }
  assumptions.push(resolved.model)
  assumptions.push(`density:${resolved.density}`)
  return { needed: false, step: null, assumptions }
}

export function formatImageAssumptions(
  prefs: ShellImagePreferences,
  language: 'en' | 'es' = 'es'
): string {
  let styleLabel =
    language === 'es' ? 'estilo por definir' : 'style TBD'
  const style = prefs.style
  if (style?.kind === 'product') {
    styleLabel =
      PRODUCT_SUB_STYLES.find((s) => s.id === style.productSubStyle)?.[
        language === 'es' ? 'nameEs' : 'name'
      ] || style.productSubStyle
  } else if (style?.kind === 'organic') {
    styleLabel =
      organicStyleChoices(language).find((c) => c.id === style.organicSubtype)?.label
      || style.organicSubtype
  } else if (style?.kind === 'preset') {
    styleLabel =
      style.presetId === 'venta-directa'
        ? (language === 'es' ? 'Venta directa' : 'Direct sale')
        : style.presetId === 'anuncio-conversion'
          ? (language === 'es' ? 'Anuncio de conversión' : 'Conversion ad')
          : (IMAGE_PRESETS.find((p) => p.id === style.presetId)?.[
              language === 'es' ? 'nameEs' : 'name'
            ] || style.presetId)
  } else if (style?.kind === 'logo') {
    styleLabel = language === 'es' ? 'Logo' : 'Logo'
  }

  const modelLabel =
    prefs.model === 'nano-banana-pro'
      ? 'Nano Banana Pro'
      : prefs.model === 'nano-banana'
        ? 'Nano Banana'
        : prefs.model === 'grok-imagine'
          ? 'Grok Imagine 2.0'
          : prefs.model

  const densityLabel =
    prefs.density === 'hard' ? 'Hard' : prefs.density === 'standard' ? 'Standard' : 'Medium'

  return language === 'es'
    ? `${styleLabel} · ${prefs.aspectRatio} · ${modelLabel} · ${densityLabel}`
    : `${styleLabel} · ${prefs.aspectRatio} · ${modelLabel} · ${densityLabel}`
}

export function buildShellImageGenerateBody(options: {
  preferences: ShellImagePreferences
  productId: string
  sessionId: string
  prompt: string
  language: 'en' | 'es'
  brandKitId?: string
  productImageIds?: string[]
  scriptText?: string
  businessContext?: string
  customColors?: string[]
  brandLogoUrl?: string
  generationId?: string
  referenceMode?: 'use' | 'none'
}): Record<string, unknown> {
  const prefs = options.preferences
  if (!prefs.style) {
    throw new Error('Image style is required before generate')
  }
  const size = SHELL_ASPECT_SIZES[prefs.aspectRatio]
  const productImageIds = options.productImageIds || []
  const body: Record<string, unknown> = {
    mode: 'post',
    productId: options.productId,
    sessionId: options.sessionId,
    prompt: options.prompt,
    aspectRatio: prefs.aspectRatio,
    width: size.width,
    height: size.height,
    model: prefs.model,
    language: options.language,
    textDensity: prefs.density,
  }
  if (options.brandKitId) body.brandKitId = options.brandKitId
  if (options.scriptText) body.scriptContext = options.scriptText
  if (options.businessContext) body.businessContext = options.businessContext
  if (options.customColors?.length) body.customColors = options.customColors.slice(0, 3)
  if (options.brandLogoUrl) body.brandLogoUrl = options.brandLogoUrl
  if (options.generationId) body.generationId = options.generationId
  if (options.referenceMode === 'none' || options.referenceMode === 'use') {
    body.referenceMode = options.referenceMode
  }
  body.productImageIds = productImageIds
  if (productImageIds[0]) body.productImageId = productImageIds[0]

  if (prefs.style.kind === 'logo') {
    body.postStyle = 'logo'
    body.logoArchetype = prefs.style.archetype || 'auto'
    body.logoMode = prefs.logoMode || 'generate'
    body.logoBackground = prefs.logoBackground || 'transparent'
    body.aspectRatio = '1:1'
    body.width = 1024
    body.height = 1024
    return body
  }

  if (prefs.style.kind === 'product') {
    body.postStyle = 'product'
    body.productSubStyle = prefs.style.productSubStyle
    body.prompt = ''
    return body
  }

  if (prefs.style.kind === 'organic') {
    const subtype = prefs.style.organicSubtype
    body.postStyle = 'organic-single'
    body.organicSubtype = subtype
    body.ctaStrength = 'soft'
    // Workplace maps script idea into subtype-specific content hints.
    if (subtype === 'quote-motivational') {
      body.organicQuote = options.scriptText || options.prompt
    } else {
      body.organicHeadline = options.scriptText || options.prompt
    }
    return body
  }

  if (prefs.style.kind === 'preset') {
    const presetId = prefs.style.presetId
    if (presetId === 'venta-directa') {
      body.postStyle = 'venta-directa'
      return body
    }
    if (presetId === 'anuncio-conversion') {
      body.postStyle = 'anuncio-conversion'
      return body
    }
    body.postStyle = 'preset'
    body.presetId = presetId
    return body
  }

  const _exhaustive: never = prefs.style
  return _exhaustive
}

export function anuncioStyleChoices(language: 'en' | 'es' = 'es'): Array<{ id: string; label: string }> {
  const venta = { id: 'venta-directa', label: language === 'es' ? 'Venta directa' : 'Direct sale' }
  const anuncio = {
    id: 'anuncio-conversion',
    label: language === 'es' ? 'Anuncio de conversión' : 'Conversion ad',
  }
  const presets = IMAGE_PRESETS.map((p) => ({
    id: p.id,
    label: language === 'es' ? p.nameEs : p.name,
  }))
  return [venta, anuncio, ...presets]
}

export function productStyleChoices(language: 'en' | 'es' = 'es'): Array<{ id: string; label: string }> {
  return PRODUCT_SUB_STYLES.map((s) => ({
    id: s.id,
    label: language === 'es' ? s.nameEs : s.name,
  }))
}

export function organicStyleChoices(language: 'en' | 'es' = 'es'): Array<{ id: OrganicSingleSubtype; label: string }> {
  const labels: Record<OrganicSingleSubtype, { es: string; en: string }> = {
    'quote-motivational': { es: 'Cita / Motivacional', en: 'Quote / Motivational' },
    infographic: { es: 'Infografía', en: 'Infographic' },
    'product-showcase-organic': { es: 'Showcase orgánico', en: 'Organic showcase' },
    'aesthetic-brand': { es: 'Brand aesthetic', en: 'Brand aesthetic' },
  }
  return ORGANIC_SINGLE_SUBTYPES.map((id) => ({
    id,
    label: language === 'es' ? labels[id].es : labels[id].en,
  }))
}

/**
 * Detect sales-script handoff so ScriptCard→post can default to venta-directa
 * when no sticky/explicit style exists.
 * Explicit sales signals only — generic Gancho/CTA structure is not enough.
 */
export function looksLikeSalesScript(text?: string | null, title?: string | null): boolean {
  const hay = normalizeText(`${title || ''} ${text || ''}`)
  if (!hay) return false
  return (
    /\bventa(?:\s+directa)?\b/.test(hay)
    || /\bdirect\s+sale\b/.test(hay)
    || /\bsales?\s+script\b/.test(hay)
    || /\bguion(?:es)?\s+de\s+venta\b/.test(hay)
  )
}

/** Organic script signals — prefer Orgánico clarify path (not venta-directa). */
/** Meta phrases that must never become Grok on-image copy or API userPrompt tails. */
export const SHELL_META_IMAGE_PROMPTS = new Set([
  'generar post',
  'generate post',
  'generar foto de producto',
  'generate product photo',
  'professional product photograph',
  'generar logo',
  'generate logo',
  'generar post orgánico',
  'generate organic post',
  'post publicitario',
  'ad post',
  'ad image',
])

export function isShellMetaImagePrompt(text?: string | null): boolean {
  const normalized = (text || '').trim().toLowerCase()
  if (!normalized) return false
  return SHELL_META_IMAGE_PROMPTS.has(normalized)
}

/** User-visible chat label + API prompt for shell image flows (rail / chat). */
export function shellImageFlowCopy(
  prefs: Partial<ShellImagePreferences>,
  language: 'en' | 'es' = 'es',
  businessContext?: string | null
): { userText: string; prompt: string } {
  const style = prefs.style
  if (style?.kind === 'product') {
    const sub = PRODUCT_SUB_STYLES.find((row) => row.id === style.productSubStyle)
    const subLabel = language === 'es' ? (sub?.nameEs || style.productSubStyle) : (sub?.name || style.productSubStyle)
    const aspect = prefs.aspectRatio || '1:1'
    return {
      userText: language === 'es'
        ? `Foto de producto · ${subLabel} · ${aspect}`
        : `Product photo · ${subLabel} · ${aspect}`,
      prompt: '',
    }
  }
  if (style?.kind === 'logo') {
    return {
      userText: language === 'es' ? 'Generar logo' : 'Generate logo',
      prompt: businessContext?.trim() || (language === 'es' ? 'Logo de marca' : 'Brand logo'),
    }
  }
  if (style?.kind === 'organic') {
    return {
      userText: language === 'es' ? 'Generar post orgánico' : 'Generate organic post',
      prompt: businessContext?.trim() || (language === 'es' ? 'Post orgánico' : 'Organic post'),
    }
  }
  return {
    userText: language === 'es' ? 'Generar post' : 'Generate post',
    prompt: businessContext?.trim() || (language === 'es' ? 'Post publicitario' : 'Ad post'),
  }
}

export function looksLikeOrganicScript(text?: string | null, title?: string | null): boolean {
  if (looksLikeSalesScript(text, title)) return false
  const hay = normalizeText(`${title || ''} ${text || ''}`)
  if (!hay) return false
  return (
    /\beducativo\b/.test(hay)
    || /\bstorytelling\b/.test(hay)
    || /\btendencia\b/.test(hay)
    || /\bengagement\b/.test(hay)
    || /\borganic(?:o|a)?\b/.test(hay)
    || /\borganico\b/.test(hay)
  )
}

/**
 * Resolve prefs for ScriptCard→post:
 * explicit → sticky preset/organic → sales venta-directa → unresolved.
 * Sticky `kind:'product'` must not hijack a sales ScriptCard→post path.
 * Sticky organic (like sticky anuncio preset) beats sales fallback.
 */
export function resolveScriptPostPreferences(options: {
  explicit?: Partial<ShellImagePreferences> | null
  sticky?: Partial<ShellImagePreferences> | null
  scriptText?: string | null
  scriptTitle?: string | null
}): ShellImagePreferences {
  const stickyBase = resolveImagePreferences(options.sticky, {})
  const stickyPostStyleBeatsSales =
    stickyBase.style?.kind === 'preset' || stickyBase.style?.kind === 'organic'
  const explicitStyle = sanitizePartialPreferences(options.explicit).style
  const salesFallback: Partial<ShellImagePreferences> =
    !explicitStyle
    && !stickyPostStyleBeatsSales
    && looksLikeSalesScript(options.scriptText, options.scriptTitle)
      ? { style: { kind: 'preset', presetId: 'venta-directa' } }
      : {}
  // Drop product sticky style when sales fallback applies so resolve doesn't keep studio-hero.
  const stickyForMerge: ShellImagePreferences =
    salesFallback.style && stickyBase.style?.kind === 'product'
      ? { ...stickyBase, style: undefined }
      : stickyBase
  return resolveImagePreferences(
    options.explicit,
    resolveImagePreferences(salesFallback, stickyForMerge)
  )
}
