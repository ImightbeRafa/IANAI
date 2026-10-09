/** Instagram UI margins (fraction of the canvas) that must stay free of text / logo / CTA. */
export function safeZoneMargins(ratio: string): { top: number; bottom: number; side: number } {
  if (ratio === '9:16' || ratio === '9:19.5' || ratio === '9:20') return { top: 0.14, bottom: 0.2, side: 0.05 }
  // 8 % top/bottom for every feed ratio (headline and logo out of the top 8 %, CTA out of the bottom 8 %).
  return { top: 0.08, bottom: 0.08, side: 0.05 }
}
