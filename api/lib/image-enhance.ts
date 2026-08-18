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
