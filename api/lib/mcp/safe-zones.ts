/** Instagram UI margins (fraction of the canvas) that must stay free of text / logo / CTA. */
export function safeZoneMargins(ratio: string): { top: number; bottom: number; side: number } {
  if (ratio === '9:16' || ratio === '9:19.5' || ratio === '9:20') return { top: 0.14, bottom: 0.2, side: 0.05 }
  // 8 % top/bottom for every feed ratio (headline and logo out of the top 8 %, CTA out of the bottom 8 %).
  return { top: 0.08, bottom: 0.08, side: 0.05 }
}

/**
 * Bands the MCP prompt asks the model to leave EMPTY (fractions of the height) because the logo (top) and the CTA button (bottom)
 * are composited there in code: safe-zone margin + the layer's height (logo ≈ 7–8 %, CTA ≈ 6 %) + air.
 */
export function freeBands(ratio: string): { top: number; bottom: number } {
  const m = safeZoneMargins(ratio)
  return m.top > 0.1 ? { top: 0.24, bottom: 0.27 } : { top: 0.18, bottom: 0.16 }
}

/** Where the calm "text zone" ends (fraction of the height): headline / price / facts are laid out between the free top band and this line. */
export function textZoneEnd(ratio: string): number {
  return safeZoneMargins(ratio).top > 0.1 ? 0.42 : 0.38
}
