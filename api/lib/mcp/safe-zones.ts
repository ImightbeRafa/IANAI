/** Instagram UI margins (fraction of the canvas) that must stay free of text / logo / CTA. */
export function safeZoneMargins(ratio: string): { top: number; bottom: number; side: number } {
  if (ratio === '9:16' || ratio === '9:19.5' || ratio === '9:20') return { top: 0.14, bottom: 0.2, side: 0.05 }
  if (ratio === '4:5' || ratio === '3:4') return { top: 0.05, bottom: 0.08, side: 0.04 }
  return { top: 0.05, bottom: 0.06, side: 0.04 }
}
