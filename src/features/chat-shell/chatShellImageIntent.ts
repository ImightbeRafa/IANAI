import {
  IMAGE_PRESETS,
  PRODUCT_SUB_STYLES,
} from '../../data/image-presets'
import type { ImageModel } from '../../types'
import type { PostTextDensity } from './chatShellImages'
import { normalizePostTextDensity } from './chatShellImages'

export type ShellImageAspect = '9:16' | '3:4' | '1:1'
export type ShellImageDensity = PostTextDensity

export type ShellImageStyle =
  | { kind: 'preset'; presetId: string }
  | { kind: 'product'; productSubStyle: string }

export interface ShellImagePreferences {
  style?: ShellImageStyle
  aspectRatio: ShellImageAspect
  model: ImageModel
  density: ShellImageDensity
}

export interface ShellImageIntent {
  matched: boolean
  preferences: Partial<ShellImagePreferences>
  wantsImage: boolean
}

export type ImageClarifyStep = 'mode' | 'style' | 'refs'

export interface ImageClarifyPlan {
  needed: boolean
  step: ImageClarifyStep | null
  mode?: 'anuncio' | 'product'
  assumptions: string[]
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem?(key: string, value: string): void
}

export const SHELL_ASPECT_SIZES: Record<ShellImageAspect, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '3:4': { width: 1080, height: 1440 },
  '1:1': { width: 1080, height: 1080 },
}

/** Workplace-aligned shell defaults (style unresolved until sticky/clarify). */
export const DEFAULT_IMAGE_PREFERENCES: ShellImagePreferences = {
  aspectRatio: '9:16',
  model: 'nano-banana-pro',
  density: 'medium',
}

const PRESET_IDS = new Set(IMAGE_PRESETS.map((p) => p.id))
const PRODUCT_SUB_IDS = new Set(PRODUCT_SUB_STYLES.map((s) => s.id))

/** Extra anuncio-family ids (not in IMAGE_PRESETS catalog). */
const ANUNCIO_STYLE_IDS = new Set(['venta-directa', 'anuncio-conversion'])

const VALID_ASPECTS = new Set<ShellImageAspect>(['9:16', '3:4', '1:1'])
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
  return ANUNCIO_STYLE_IDS.has(style.presetId) || PRESET_IDS.has(style.presetId)
}

export function requiresProductReferences(style: ShellImageStyle | undefined): boolean {
  return style?.kind === 'product'
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

function matchAspect(normalized: string): ShellImageAspect | null {
  if (/\b9\s*[:/x]\s*16\b/.test(normalized) || /\bstories?\b/.test(normalized) || /\breels?\b/.test(normalized)) {
    return '9:16'
  }
  if (/\b3\s*[:/x]\s*4\b/.test(normalized)) return '3:4'
  if (/\b1\s*[:/x]\s*1\b/.test(normalized) || /\bcadrad[oa]\b/.test(normalized) || /\bsquare\b/.test(normalized)) {
    return '1:1'
  }
  return null
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
  /\b(?:imagen(?:es)?|image(?:s)?|foto(?:s)?|photo(?:s)?|visual(?:es)?|haz(?:me)?\s+una\s+imagen|genera(?:me)?\s+(?:una\s+)?(?:imagen|foto)|crear?\s+imagen|crea(?:me)?\s+(?:una\s+)?imagen)\b/

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

  const productSub = matchProductSubStyle(normalized)
  const presetId = matchPresetAlias(normalized)
  if (productSub) {
    preferences.style = { kind: 'product', productSubStyle: productSub }
  } else if (presetId) {
    preferences.style = { kind: 'preset', presetId }
  }

  const aspect = matchAspect(normalized)
  if (aspect) preferences.aspectRatio = aspect
  const model = matchModel(normalized)
  if (model) preferences.model = model
  const density = matchDensity(normalized)
  if (density) preferences.density = density

  const imageCue = IMAGE_HINT.test(normalized)
  const scriptCue = SCRIPT_HINT.test(normalized)

  // Pure script asks without image language → not an image intent
  if (scriptCue && !imageCue) {
    return { matched: false, preferences: {}, wantsImage: false }
  }

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
  options?: { maxQuestions?: number }
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
  } else {
    assumptions.push(`Anuncio · ${resolved.style.presetId}`)
  }
  assumptions.push(resolved.aspectRatio)
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
  } else if (style?.kind === 'preset') {
    styleLabel =
      style.presetId === 'venta-directa'
        ? (language === 'es' ? 'Venta directa' : 'Direct sale')
        : style.presetId === 'anuncio-conversion'
          ? (language === 'es' ? 'Anuncio' : 'Conversion ad')
          : (IMAGE_PRESETS.find((p) => p.id === style.presetId)?.[
              language === 'es' ? 'nameEs' : 'name'
            ] || style.presetId)
  }

  const modelLabel =
    prefs.model === 'nano-banana-pro'
      ? 'Nano Banana Pro'
      : prefs.model === 'nano-banana'
        ? 'Nano Banana'
        : prefs.model === 'grok-imagine'
          ? 'Grok Imagine'
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
  if (productImageIds.length > 0) {
    body.productImageIds = productImageIds
    body.productImageId = productImageIds[0]
  }

  if (prefs.style.kind === 'product') {
    body.postStyle = 'product'
    body.productSubStyle = prefs.style.productSubStyle
    return body
  }

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

export function anuncioStyleChoices(language: 'en' | 'es' = 'es'): Array<{ id: string; label: string }> {
  const venta = { id: 'venta-directa', label: language === 'es' ? 'Venta directa' : 'Direct sale' }
  const anuncio = { id: 'anuncio-conversion', label: language === 'es' ? 'Anuncio' : 'Conversion ad' }
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

/**
 * Resolve prefs for ScriptCard→post:
 * explicit → sticky → sales venta-directa fallback → unresolved (clarify).
 */
export function resolveScriptPostPreferences(options: {
  explicit?: Partial<ShellImagePreferences> | null
  sticky?: Partial<ShellImagePreferences> | null
  scriptText?: string | null
  scriptTitle?: string | null
}): ShellImagePreferences {
  const stickyBase = resolveImagePreferences(options.sticky, {})
  const salesFallback: Partial<ShellImagePreferences> =
    !stickyBase.style
    && !options.explicit?.style
    && looksLikeSalesScript(options.scriptText, options.scriptTitle)
      ? { style: { kind: 'preset', presetId: 'venta-directa' } }
      : {}
  return resolveImagePreferences(
    options.explicit,
    resolveImagePreferences(salesFallback, stickyBase)
  )
}
