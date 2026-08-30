/**
 * Shared image creative-brief helpers: reference roles, lifestyle richness,
 * and Grok's 3-reference budget with deterministic priority.
 */

import { buildSceneRecipe, wantsStudioHeroScene } from './image-scene-recipe.js'

export type ImageReferenceRole = 'product' | 'scene' | 'style'

const SCENE_LABEL_RE = /\b(scene|escena|contexto)\b/i
const STYLE_LABEL_RE = /\b(style|estilo|layout|formato|post\s*ref)\b/i

export function normalizeImageReferenceRole(options: {
  kind?: string | null
  label?: string | null
}): ImageReferenceRole {
  if (options.kind === 'product') return 'product'
  if (STYLE_LABEL_RE.test(options.label || '')) return 'style'
  if (SCENE_LABEL_RE.test(options.label || '')) return 'scene'
  if (options.kind === 'context') return 'scene'
  return 'product'
}

export function selectGrokReferenceBudget<T extends { role: ImageReferenceRole }>(
  refs: T[],
  max = 3
): T[] {
  if (refs.length <= max) return refs.slice()
  const products = refs.filter((r) => r.role === 'product')
  const scenes = refs.filter((r) => r.role === 'scene')
  const styles = refs.filter((r) => r.role === 'style')
  const picked: T[] = []
  const pushUnique = (item: T | undefined) => {
    if (!item) return
    if (picked.includes(item)) return
    if (picked.length >= max) return
    picked.push(item)
  }
  // Product truth first (up to 2), then one scene, then one style.
  pushUnique(products[0])
  pushUnique(products[1])
  pushUnique(scenes[0])
  pushUnique(styles[0])
  for (const item of refs) {
    if (picked.length >= max) break
    pushUnique(item)
  }
  return picked
}

export function buildExplicitReferenceRoleContract(options: {
  language: string
  roles: ImageReferenceRole[]
  isProductMode?: boolean
}): string {
  const isEs = options.language === 'es'
  const roles = options.roles
  if (!roles.length) return ''

  const lines = roles.map((role, index) => {
    const n = index + 1
    if (role === 'product') {
      return isEs
        ? `IMAGEN ${n} = PRODUCTO (verdad visual): copiá forma, color, empaque, etiqueta y proporciones EXACTAS. No inventes otro producto.`
        : `IMAGE ${n} = PRODUCT (visual truth): copy exact shape, color, packaging, label, and proportions. Do not invent another product.`
    }
    if (role === 'style') {
      return isEs
        ? `IMAGEN ${n} = ESTILO (post de referencia): copiá SOLO layout, jerarquía, tipografía y densidad. Prohibido copiar producto, logo, precios o textos de esa referencia.`
        : `IMAGE ${n} = STYLE (post reference): copy ONLY layout, hierarchy, typography, and density. Do not copy that reference's product, logo, prices, or text.`
    }
    return isEs
      ? `IMAGEN ${n} = ESCENA (inspiración): usá gente, lugar, acción, luz y mood. No reemplaces el producto real con objetos de esta escena.`
      : `IMAGE ${n} = SCENE (inspiration): use people, place, action, lighting, and mood. Do not replace the real product with objects from this scene.`
  })

  const modeLine = options.isProductMode
    ? (isEs
      ? 'Modo producto: el empaque/producto real domina; la escena solo ambienta.'
      : 'Product mode: the real product/packaging leads; scene only ambient.')
    : (isEs
      ? 'Modo post/anuncio: producto fiel + escena lifestyle rica + estilo de composición si hay referencia de estilo.'
      : 'Post/ad mode: faithful product + rich lifestyle scene + composition style when a style reference exists.')

  return isEs
    ? `CONTRATO DE ROLES DE REFERENCIA (NO RENDERIZAR):\n${lines.join('\n')}\n${modeLine}\nProhibido fusionar productos distintos. Prohibido ignorar una referencia con rol asignado.\n\n`
    : `REFERENCE ROLE CONTRACT (DO NOT RENDER):\n${lines.join('\n')}\n${modeLine}\nDo not fuse distinct products. Do not ignore a role-assigned reference.\n\n`
}

export function buildLifestyleCreativeBrief(options: {
  language: string
  postStyle?: string | null
  productSubStyle?: string | null
  hasProductRef: boolean
  hasSceneRef: boolean
  hasStyleRef: boolean
  scriptContext?: string | null
  niche?: string | null
  category?: string | null
  offerName?: string | null
  businessContext?: string | null
}): string {
  const isEs = options.language === 'es'
  const wantsLifestyle =
    options.postStyle === 'organic-single'
    || options.productSubStyle === 'lifestyle'
    || options.postStyle === 'venta-directa'
    || options.postStyle === 'anuncio-conversion'
    || !options.postStyle

  if (
    !wantsLifestyle
    && wantsStudioHeroScene({ productSubStyle: options.productSubStyle })
    && !options.hasSceneRef
  ) {
    return isEs
      ? `BRIEF CREATIVO (NO RENDERIZAR): foto de producto limpia y premium. Fidelidad total al producto real. Sin inventar claims.\n\n`
      : `CREATIVE BRIEF (DO NOT RENDER): clean premium product photo. Total fidelity to the real product. No invented claims.\n\n`
  }

  const scriptHint = (options.scriptContext || '').trim().slice(0, 900)
  const scriptBlock = scriptHint
    ? (isEs
      ? `Copy / guion fuente (usar hechos reales, no inventar):\n${scriptHint}`
      : `Source copy / script (use real facts only, do not invent):\n${scriptHint}`)
    : (isEs
      ? 'Copy / guion: usá solo el texto condensado del usuario; no inventes precio, garantía ni claims.'
      : 'Copy / script: use only the user condensed text; do not invent price, warranty, or claims.')

  const recipe = buildSceneRecipe({
    language: options.language,
    postStyle: options.postStyle,
    productSubStyle: options.productSubStyle,
    hasSceneRef: options.hasSceneRef,
    niche: options.niche,
    category: options.category,
    offerName: options.offerName,
    scriptContext: options.scriptContext,
    businessContext: options.businessContext,
  })

  const sceneLine = recipe
    ? (isEs
      ? 'Escena: seguí la SCENE RECIPE (lugar fotografiado completo). Luz del producto = luz del entorno.'
      : 'Scene: follow the SCENE RECIPE (complete photographed place). Product light = environment light.')
    : options.hasSceneRef
      ? (isEs
        ? 'Escena: inspirate en la referencia de escena (lugar, luz, gente, acción) sin robar el producto de esa foto.'
        : 'Scene: take place, light, people, and action from the scene reference without stealing its product.')
      : (isEs
        ? 'Escena: entorno fotografiado creíble y premium con luz coherente y props del nicho.'
        : 'Scene: credible premium photographed setting with coherent light and niche-fit props.')

  const styleLine = options.hasStyleRef
    ? (isEs
      ? 'Estilo: seguí el layout/jerarquía de la referencia de estilo; no copies su marca ni textos.'
      : 'Style: follow the style reference layout/hierarchy; do not copy its brand or text.')
    : (isEs
      ? 'Estilo: social-native premium (IG/TikTok): aire, tipografía limpia, CTA claro, sensación de marca grande.'
      : 'Style: premium social-native (IG/TikTok): breathing room, clean type, clear CTA, big-brand feel.')

  const productLine = options.hasProductRef
    ? (isEs
      ? 'Producto: fidelidad absoluta a las fotos de producto (forma, color, label). El producto debe verse usable en la escena, no flotando genérico.'
      : 'Product: absolute fidelity to product photos (shape, color, label). Product must feel in-use in the scene, not a generic floating render.')
    : (isEs
      ? 'Producto: si no hay foto, representalo con honestidad a partir del guion; no inventes empaque falso detallado.'
      : 'Product: if no photo, represent it honestly from the script; do not invent detailed fake packaging.')

  const recipeBlock = recipe ? `${recipe}\n` : ''

  return isEs
    ? `BRIEF CREATIVO LIFESTYLE + FIDELIDAD (NO RENDERIZAR):
Objetivo: un post social rico en un LUGAR FOTOGRAFIADO COMPLETO — no un vacío de estudio ni podio en void.
Planificá sujeto, acción, setting, iluminación, props y encuadre social-native.
${productLine}
${sceneLine}
${styleLine}
${recipeBlock}${scriptBlock}
Prohibido: claims inventados, placeholders, logos inventados, amalgamar productos, ignorar el guion, fondo limpio / vacío de estudio.
\n`
    : `LIFESTYLE + FIDELITY CREATIVE BRIEF (DO NOT RENDER):
Goal: a rich social post in a COMPLETE PHOTOGRAPHED PLACE — not a studio void or podium void.
Plan subject, action, setting, lighting, props, and social-native framing.
${productLine}
${sceneLine}
${styleLine}
${recipeBlock}${scriptBlock}
Forbidden: invented claims, placeholders, invented logos, amalgamating products, ignoring the script, seamless paper / studio void.
\n`
}
