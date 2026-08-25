const GENERIC_BLUE_BAN = 'PROHIBIDO azul genérico (#0000FF, #0066FF, #1877F2, Facebook/Instagram blue) salvo que esté en esta paleta. Ignora cualquier otro color mencionado en las instrucciones siguientes.'

export function normalizeEnhanceColors(colors: unknown): string[] {
  if (!Array.isArray(colors)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of colors) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
    if (out.length === 3) break
  }
  return out
}

export function buildEnhanceColorOverride(
  clientColors: unknown,
  brandKitOverride: string | null | undefined
): string | null {
  const colors = normalizeEnhanceColors(clientColors)
  if (colors.length > 0) {
    return `USA SOLO ESTOS COLORES DE MARCA: ${colors.join(', ')}. Estos son los colores oficiales — NO uses ningún otro color fuera de esta paleta. ${GENERIC_BLUE_BAN}`
  }
  return brandKitOverride?.trim() || null
}

export function resolveEnhanceUserDirection(
  editPrompt: unknown,
  originalPrompt: unknown
): string | null {
  const edit = typeof editPrompt === 'string' ? editPrompt.trim() : ''
  if (edit) return edit
  const original = typeof originalPrompt === 'string' ? originalPrompt.trim() : ''
  return original || null
}

export function appendEnhanceUserDirection(
  basePrompt: string,
  direction: string | null | undefined
): string {
  const trimmed = typeof direction === 'string' ? direction.trim() : ''
  if (!trimmed) return basePrompt
  return `${basePrompt}

═══════════════════════════════════════════════
DIRECCIÓN DEL USUARIO (subordinada a las reglas #0–#4)
═══════════════════════════════════════════════
${trimmed}
Aplica esta dirección SOLO si no contradice texto, producto, logo oficial ni aspect ratio.`
}

export type EnhanceTier = 'polish' | 'modernize' | 'rebuild'

export function resolveEnhanceTier(raw: unknown): EnhanceTier {
  return raw === 'polish' || raw === 'rebuild' ? raw : 'modernize'
}

export function buildEnhanceSystemPrompt(options: {
  language: 'es' | 'en'
  tier: EnhanceTier
  hasProductRef: boolean
  brandPrefix?: string | null
  userDirection?: string | null
}): string {
  const langLabel = options.language === 'es' ? 'ESPAÑOL' : 'ENGLISH'
  const productRefRule = options.hasProductRef
    ? `
═══════════════════════════════════════════════
REGLA #0 — IMAGEN DE PRODUCTO DE REFERENCIA (MÁXIMA PRIORIDAD)
═══════════════════════════════════════════════
Se adjuntan imágenes de referencia del PRODUCTO REAL del usuario.
- El producto en el diseño mejorado DEBE verse EXACTAMENTE como en las imágenes de referencia.
- NO inventes, rediseñes ni reimagines el producto.
`
    : ''

  const hardConstraints = `${productRefRule}
═══════════════════════════════════════════════
REGLA #1 — TEXTO Y LENGUAJE (NO NEGOCIABLE)
═══════════════════════════════════════════════
- El idioma de TODA la imagen es: ${langLabel}.
- COPIA EXACTAMENTE cada palabra, frase, título, CTA y precio que aparezca.
- NO traduzcas, parafrasees ni inventes texto.
═══════════════════════════════════════════════
REGLA #2 — PRODUCTO INTACTO (NO NEGOCIABLE)
- La forma del producto NO se modifica.
REGLA #3 — LOGO INTACTO (NO NEGOCIABLE)
- Copia el logo píxel por píxel.
REGLA #4 — FORMATO (NO NEGOCIABLE)
- Mantén el mismo aspect ratio.
═══════════════════════════════════════════════
`

  const polish = `
MODO: POLISH. Pulí ejecución conservando el diseño original. Refiná tipografía, espaciado, contraste. No cambies composición ni paleta.
`
  const modernize = `
MODO: MODERNIZE. Actualizá ejecución conservando concepto, mensaje y elementos clave. No cambies el texto ni el producto.
`
  const rebuild = `
MODO: REBUILD. Reinterpretá el diseño con mayor impacto creativo. No cambies texto, producto, logo ni aspect ratio.
`
  const tierBody = options.tier === 'polish' ? polish : options.tier === 'rebuild' ? rebuild : modernize
  const brand = options.brandPrefix?.trim() ? `${options.brandPrefix}\n\n` : ''
  return appendEnhanceUserDirection(
    `${hardConstraints}
${brand}${tierBody}

GENERA LA IMAGEN MEJORADA. Devuelve SOLO la imagen resultante.`,
    options.userDirection
  )
}
