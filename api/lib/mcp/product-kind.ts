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
