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

type LogoKit = { logoUrl?: string | null; brandProfile?: { logoVariants?: Array<{ url: string; variant: string }> } | null } | null | undefined

/**
 * Round 9: the logo candidates for an ad, best first: a wordmark / primary / badge variant of the kit profile before the kit's logo_url, an icon variant last.
 * The kit logo_url stays the default when the profile has no variants (nothing changes for kits without logoVariants).
 */
export function adLogoCandidates(kit: LogoKit): string[] {
  const rank: Record<string, number> = { wordmark: 0, primary: 1, badge: 2, light: 3, dark: 3, icon: 9 }
  const variants = (kit?.brandProfile?.logoVariants ?? []).filter((v) => v && typeof v.url === 'string' && v.url)
  const nonIcon = variants.filter((v) => v.variant !== 'icon').sort((a, b) => (rank[a.variant] ?? 5) - (rank[b.variant] ?? 5)).map((v) => v.url)
  const icons = variants.filter((v) => v.variant === 'icon').map((v) => v.url)
  const out = [...nonIcon, ...(kit?.logoUrl ? [kit.logoUrl] : []), ...icons]
  return [...new Set(out)]
}

/**
 * Round 9: load the ad logo and never settle for a favicon / app icon when the kit has a wordmark: candidates are tried in order and one that looks like
 * an icon (logoIconCheck) is skipped as long as a non-icon candidate loads.
 */
export async function loadAdLogo(kit: LogoKit, fetchBytes: (url: string) => Promise<Buffer | { error: string }>): Promise<{ bytes: Buffer | null; url: string | null; icon: LogoIconCheck | null; notes: string[]; skippedIcons: string[] }> {
  const notes: string[] = []
  const skippedIcons: string[] = []
  let fallback: { bytes: Buffer; url: string; icon: LogoIconCheck } | null = null
  for (const url of adLogoCandidates(kit)) {
    let got: Buffer | { error: string }
    try { got = await fetchBytes(url) } catch (err) { got = { error: err instanceof Error ? err.message.slice(0, 120) : 'error' } }
    if (!Buffer.isBuffer(got)) { notes.push(`logo asset not loaded: ${got.error}`); continue }
    const icon = await logoIconCheck(got, url)
    if (!icon.looksLikeIcon) return { bytes: got, url, icon, notes, skippedIcons }
    skippedIcons.push(url)
    if (!fallback) fallback = { bytes: got, url, icon }
  }
  return fallback ? { ...fallback, notes, skippedIcons: skippedIcons.filter((u) => u !== fallback!.url) } : { bytes: null, url: null, icon: null, notes, skippedIcons }
}

/**
 * Round 9: cut the transparent (or flat same-colour) padding around a logo so it is fitted by the aspect of the mark itself — a wide wordmark inside a square
 * transparent canvas was laid out as a 173×173 box (PatchHouse, round 8). Returns the input when nothing is trimmed or the trim fails.
 */
export async function trimLogoPadding(bytes: Buffer): Promise<{ bytes: Buffer; trimmed: boolean; before?: [number, number]; after?: [number, number] }> {
  try {
    const meta = await sharp(bytes).metadata()
    if (!meta.width || !meta.height || meta.format === 'svg') return { bytes, trimmed: false }
    const t = await sharp(bytes).rotate().ensureAlpha().trim({ threshold: 12 }).png().toBuffer({ resolveWithObject: true })
    const w = t.info.width, h = t.info.height
    if (w < 8 || h < 8 || (w >= meta.width - 2 && h >= meta.height - 2)) return { bytes, trimmed: false }
    // keep a hair of air (2 %) so anti-aliased edges are not clipped
    const pad = Math.max(1, Math.round(Math.max(w, h) * 0.02))
    const out = await sharp(t.data).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    return { bytes: out, trimmed: true, before: [meta.width, meta.height], after: [w + 2 * pad, h + 2 * pad] }
  } catch {
    return { bytes, trimmed: false }
  }
}
