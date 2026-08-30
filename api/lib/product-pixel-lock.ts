/**
 * Hard product pixel-fidelity contracts for Grok Imagine first-gen + enhance.
 * When a real product photo is attached, the SKU must stay the same physical object.
 */

export function buildProductPixelLockContract(options: {
  language?: string | null
  /** When true, task is environment/scene swap around a locked product (edits API). */
  sceneReplace?: boolean
}): string {
  const es = options.language !== 'en'
  const sceneTask = options.sceneReplace
    ? (es
      ? `TAREA DE ESCENA (obligatoria):
- REEMPLAZÁ el fondo del packshot / vacío / podio por el lugar de la SCENE RECIPE (lugar fotografiado completo).
- El producto queda anclado con sombra de contacto; su luz debe coincidir con el set (misma dirección y temperatura).
- PROHIBIDO conservar el vacío de estudio o solo “embellecerlo”.
- PROHIBIDO redibujar el producto para “encajarlo” — mové/re-iluminá el mismo objeto, no inventes otro.`
      : `SCENE TASK (required):
- REPLACE the packshot background / void / podium with the SCENE RECIPE place (complete photographed environment).
- Ground the product with a contact shadow; its light must match the set (same direction and color temperature).
- FORBIDDEN to keep the studio void or only “pretty it up.”
- FORBIDDEN to redraw the product to “fit” — re-light/place the SAME object; do not invent another.`)
    : ''

  if (es) {
    return `PRODUCT LOCK — FIDELIDAD DE PÍXELES (NO NEGOCIABLE):
- La foto de producto adjunta es la VERDAD visual del SKU real.
- El producto en la salida DEBE ser el MISMO objeto físico: misma forma, color, etiqueta, empaque, proporciones, materiales y detalles impresos.
- PROHIBIDO redibujar, restilizar, recolorear, añadir/quitar partes, morphing, o inventar otro producto/SKU.
- PROHIBIDO “mejorar” el packaging ni inventar un diseño nuevo del pack.
- Solo se permite re-iluminar el producto para coincidir con el entorno, sin cambiar su geometría ni identidad de superficie.
${sceneTask}`
  }

  return `PRODUCT LOCK — PIXEL FIDELITY (NON-NEGOTIABLE):
- The attached product photo is the visual TRUTH of the real SKU.
- The product in the output MUST be the SAME physical object: identical shape, color, label, packaging, proportions, materials, and printed details.
- FORBIDDEN to redraw, restyle, recolor, add/remove parts, morph, or invent another product/SKU.
- FORBIDDEN to “improve” packaging or invent a new pack design.
- Re-lighting to match the environment is allowed only if geometry and surface identity stay locked.
${sceneTask}`
}

export function hasProductPixelLockLanguage(text: string): boolean {
  const t = text.toLowerCase()
  const hasLockHeader = /product lock|fidelidad de p[ií]xeles|pixel fidelity/.test(t)
  const hasSameObject = /mismo objeto f[ií]sico|same physical object/.test(t)
  const bansRedraw = /prohibido redibujar|forbidden to redraw/.test(t)
  return hasLockHeader && hasSameObject && bansRedraw
}
