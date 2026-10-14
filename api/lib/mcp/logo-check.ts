import sharp from 'sharp'

/** Round 8 thresholds: "nearly square" = aspect within 0.85–1.15, "tiny" = max side < 256 px, or the URL says it is a favicon / app icon. */
export const LOGO_ICON_ASPECT: [number, number] = [0.85, 1.15]
export const LOGO_ICON_MAX_SIDE = 256
const ICON_URL_RE = /(favicon|apple-touch-icon|app-?icon|android-chrome|\.ico(?:$|[?#]))/i

export type LogoIconCheck = { looksLikeIcon: boolean; width: number | null; height: number | null; reason?: string }

/**
 * Is the kit logo a favicon-like square icon instead of the wordmark? Warning only (qa.logoLooksLikeIcon): the logo is still placed, never faked.
 * A vector (SVG) has no pixel size worth judging, so for it only the URL name counts.
 */
export async function logoIconCheck(bytes: Buffer, url?: string | null): Promise<LogoIconCheck> {
  const byUrl = Boolean(url && ICON_URL_RE.test(url))
  try {
    const meta = await sharp(bytes).metadata()
    const w = meta.width ?? null
    const h = meta.height ?? null
    if (!w || !h) return { looksLikeIcon: byUrl, width: w, height: h, ...(byUrl ? { reason: 'the logo URL names a favicon / app icon' } : {}) }
    const aspect = w / h
    const square = aspect >= LOGO_ICON_ASPECT[0] && aspect <= LOGO_ICON_ASPECT[1]
    const vector = meta.format === 'svg'
    const tiny = !vector && Math.max(w, h) < LOGO_ICON_MAX_SIDE
    if (square && (tiny || byUrl)) {
      return { looksLikeIcon: true, width: w, height: h, reason: tiny ? `nearly square (${w}x${h}) and tiny (< ${LOGO_ICON_MAX_SIDE}px)` : 'nearly square and the logo URL names a favicon / app icon' }
    }
    return { looksLikeIcon: false, width: w, height: h }
  } catch {
    return { looksLikeIcon: byUrl, width: null, height: null, ...(byUrl ? { reason: 'the logo URL names a favicon / app icon' } : {}) }
  }
}
