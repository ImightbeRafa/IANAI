/**
 * Round 8: the plane-specific product lock (wheels, landing gear, propellers, flaps, controllers) must only be sent for plane-like products. A pouch / bottle /
 * garment gets the generic "every part, colour, material and proportion as in the reference photo". Derived from the offer's own text (name, type, description,
 * technical specs) and the owner's productNotes; unknown = generic.
 */
const PLANE_RE = /\b(avi[oó]n(es)?|aeroplano|planeador(es)?|airplane|aeroplane|glider|aircraft|drone?s?|dron(es)?|helic[oó]ptero|helicopter|aeromodel\w*|rc plane|paper plane|avioneta)\b/i

export type ProductKind = 'plane' | 'generic'

export function productKindOf(parts: Array<string | null | undefined>): ProductKind {
  const text = parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).join(' \n ')
  return PLANE_RE.test(text) ? 'plane' : 'generic'
}

/**
 * Round 9: printed soft packs (pouch / sachet / bag of patches …). Grok redraws their printing with misspellings ("Mental Ciarity", "Pick-Me-Lip"), so the
 * real-pixel path (productFidelity "exact") is the DEFAULT for them; an explicit productFidelity:"generated" still wins. A plane is never a pack.
 */
const PACK_RE = /\b(pouch(es)?|bolsa(s)?|bolsita(s)?|sobre(s)?|sachet(s)?|doypack|stand[- ]?up|parche(s)?|patch(es)?|empaque flexible|pack de \d+)\b/i

export function isPackProduct(parts: Array<string | null | undefined>): boolean {
  const text = parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).join(' \n ')
  return PACK_RE.test(text) && !PLANE_RE.test(text)
}
