/**
 * Round 6: the whole ad text is composited in CODE over a scene-only picture (free, local: sharp + satori + resvg, no model call).
 *
 * Grok keeps drawing text in the Instagram bands, redraws logos and over-draws buttons, so the MCP flow asks it for the SCENE ONLY
 * (no headline, price, facts, logo or button) and this module lays everything out from the real text boxes:
 *   - the REAL kit logo (exact asset, whole), the headline, the price line, the facts line and ONE CTA pill with the exact `copy` text;
 *   - brand fonts / colours through the adpack text + font code (fitText, measureText, satori, resvg);
 *   - every element inside the Instagram safe zones, at least 1.5 % of the height apart from any other element, text shrunk / wrapped
 *     before it is ever clipped, WCAG contrast ≥ 4.5:1 against the WORST pixel under it (soft scrim sampled from the picture when needed);
 *   - logo and CTA are placed AFTER the text layout is known; the CTA avoids the located product and busy areas;
 *   - the picture is never shrunk, framed or padded: output pixel size and ratio are exactly the input's.
 */
import sharp from 'sharp'
import satori from 'satori'
import { blend, contrastFromLuminance, INK, luminance, parseColor, toHex, WHITE, type Rgb } from '../adpack/render/color.js'
import { cssFamily, resolveFonts, satoriFonts } from '../adpack/render/fonts.js'
import { fitText } from '../adpack/render/text.js'
import { edgeMap, rasterize, renderCtaPill, type Box, type CompositeInput, type CompositeReport } from './composite-ad.js'
import { PRICE_RE } from './copy-layout.js'
import { safeZoneMargins } from './safe-zones.js'

export type AdBlocks = { headline?: string; price?: string; facts?: string[]; cta?: string }

/** Split the capped copy into the blocks the layout knows: headline, ONE price line, facts lines, the CTA (exact text). */
export function splitCopyBlocks(copy: string, ctaText?: string): AdBlocks {
  const lines = copy.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const cta = ctaText?.replace(/\s+/g, ' ').trim()
  const rest = lines.filter((l) => !cta || l !== cta)
  const pi = rest.findIndex((l, i) => i > 0 && PRICE_RE.test(l))
  const price = pi >= 0 ? rest[pi] : undefined
  const others = rest.filter((_, i) => i !== pi)
  const facts = others.slice(1)
  return { ...(others[0] ? { headline: others[0] } : {}), ...(price ? { price } : {}), ...(facts.length ? { facts } : {}), ...(cta ? { cta } : {}) }
}

export type LayoutInput = Pick<CompositeInput, 'bytes' | 'ratio' | 'logo' | 'palette' | 'fonts' | 'avoid'> & { blocks: AdBlocks }

export type LayoutElement = { id: string; role: 'logo' | 'headline' | 'price' | 'facts' | 'cta'; box: Box; text?: string; lines?: string[]; fontSize?: number; color?: string; contrast?: number; fits?: boolean }

export type AdLayoutReport = CompositeReport & {
  text: {
    drawn: boolean
    corridor: 'top' | 'bottom' | 'over_product' | 'none'
    /** Type scale applied to the nominal sizes (1 = nominal). */
    scale: number
    fits: boolean
    textOverProduct: boolean
    productSource: 'located' | 'edge_density' | 'located+edge_density' | 'none'
    scrim: { tone: string; alpha: number; box: Box } | null
    lowContrast: boolean
  }
  layout: {
    elements: LayoutElement[]
    /** Required distance between any two elements (px) = 1.5 % of the height (rounded up). */
    gapPx: number
    /** Smallest measured distance between any two elements, as a fraction of the height. */
    minGap: number
    overlaps: string[]
    insideSafeZones: boolean
  }
}

type NBox = { x0: number; y0: number; x1: number; y1: number }

/** Luminance percentiles (0–1) of the pixels inside a box. */
function lumaStats(raw: Buffer, W: number, H: number, box: Box): { lo: number; hi: number; mean: Rgb; samples: Float32Array } {
  const x0 = Math.max(0, Math.floor(box.x)), x1 = Math.min(W, Math.ceil(box.x + box.w))
  const y0 = Math.max(0, Math.floor(box.y)), y1 = Math.min(H, Math.ceil(box.y + box.h))
  const step = 3
  const vals: number[] = []
  let r = 0, g = 0, b = 0
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * W + x) * 3
      const c = { r: raw[i], g: raw[i + 1], b: raw[i + 2] }
      vals.push(luminance(c)); r += c.r; g += c.g; b += c.b
    }
  }
  const n = Math.max(1, vals.length)
  const sorted = Float32Array.from(vals).sort()
  const at = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))] : 0.5)
  return { lo: at(0.04), hi: at(0.96), mean: { r: r / n, g: g / n, b: b / n }, samples: sorted }
}

/** Worst-case WCAG contrast of a text colour over background luminances in [lo, hi]. */
function worstContrast(textLum: number, lo: number, hi: number): number {
  if (textLum >= lo && textLum <= hi) return 1
  return Math.min(contrastFromLuminance(textLum, lo), contrastFromLuminance(textLum, hi))
}

/** Per-channel median colour of a band (sampled), the "background" a flat dark / bright object is measured against. */
function medianColor(raw: Buffer, W: number, H: number, y0: number, y1: number): Rgb {
  const ch: number[][] = [[], [], []]
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y += 4) for (let x = 0; x < W; x += 6) { const i = (y * W + x) * 3; ch[0].push(raw[i]); ch[1].push(raw[i + 1]); ch[2].push(raw[i + 2]) }
  const med = (a: number[]) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 128)
  return { r: med(ch[0]), g: med(ch[1]), b: med(ch[2]) }
}

/** Share of pixels of a box that differ strongly from a background colour: catches FLAT objects (a black controller) the edge map misses. */
function deviation(raw: Buffer, W: number, H: number, box: Box, bg: Rgb): number {
  const x0 = Math.max(0, Math.floor(box.x)), x1 = Math.min(W, Math.ceil(box.x + box.w))
  const y0 = Math.max(0, Math.floor(box.y)), y1 = Math.min(H, Math.ceil(box.y + box.h))
  let n = 0, t = 0
  for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) { const i = (y * W + x) * 3; t++; if (Math.hypot(raw[i] - bg.r, raw[i + 1] - bg.g, raw[i + 2] - bg.b) > 75) n++ }
  return t ? n / t : 0
}

const dist = (a: Box, b: Box) => {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))
  return Math.hypot(dx, dy)
}

type Fit = { role: 'headline' | 'price' | 'facts'; text: string; size: number; lineH: number; lines: string[]; w: number; h: number; fits: boolean; weight: number; family: string }

export async function layoutAdLayers(input: LayoutInput): Promise<{ bytes: Buffer; report: AdLayoutReport }> {
  const base = sharp(input.bytes).rotate().removeAlpha()
  const meta = await base.metadata()
  const W = meta.width || 0
  const H = meta.height || 0
  if (!W || !H) throw new Error('layout: image has no size')
  const raw = await base.clone().raw().toBuffer()
  const m = safeZoneMargins(input.ratio)
  const story = m.top > 0.1
  const busy = await edgeMap(raw, W, H)
  const gap = Math.ceil(H * 0.016)
  const sideX = Math.round(W * m.side)
  const layers: import("sharp").OverlayOptions[] = []
  const elements: LayoutElement[] = []
  const blocks = input.blocks
  const cta = (blocks.cta || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const fonts = resolveFonts({ headingFont: input.fonts?.headingFont ?? undefined, bodyFont: input.fonts?.bodyFont ?? undefined } as never)
  const palette = [input.palette?.primary, input.palette?.secondary, input.palette?.accent].map((c) => parseColor(c)).filter((c): c is Rgb => Boolean(c))

  const report: AdLayoutReport = {
    method: 'composite', width: W, height: H,
    logo: { status: 'not_requested' }, cta: { status: 'none' }, scrim: null, zones: { top: m.top, bottom: m.bottom },
    text: { drawn: false, corridor: 'none', scale: 1, fits: true, textOverProduct: false, productSource: 'none', scrim: null, lowContrast: false },
    layout: { elements, gapPx: gap, minGap: 1, overlaps: [], insideSafeZones: true },
  }

  // ---- 1. reserved geometry: logo row (top) and CTA row (bottom) --------------------------------------------------------
  let logoBox: Box | null = null
  let logoAspect = 0
  if (input.logo) {
    try {
      const lm = await sharp(input.logo).metadata()
      if (!lm.width || !lm.height) throw new Error('logo asset has no size')
      logoAspect = lm.width / lm.height
      let lh = Math.round(H * (story ? 0.07 : 0.078))
      let lw = Math.round(lh * logoAspect)
      const maxW = Math.round(W * 0.34)
      if (lw > maxW) { lw = maxW; lh = Math.round(lw / logoAspect) }
      logoBox = { x: 0, y: Math.round(H * (m.top + 0.008)), w: lw, h: lh }
    } catch (err) {
      report.logo = { status: 'unavailable', reason: `logo asset could not be drawn: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}` }
    }
  } else {
    report.logo = { status: 'unavailable', reason: 'no logo asset in the brand kit' }
  }
  const btnH = Math.round(H * (story ? 0.048 : 0.0624))
  const bottomEdge = Math.round(H * (1 - m.bottom - 0.012))
  const ctaTop = cta ? bottomEdge - btnH : Math.round(H * (1 - m.bottom))
  const textTop = logoBox ? logoBox.y + logoBox.h + gap : Math.round(H * (m.top + 0.01))

  // ---- 2. where the objects are: located product box + edge-density rows (props, boxes, packaging) ------------------------
  const objBoxes: Array<{ y0: number; y1: number }> = []
  const located = (input.avoid ?? []).map((r) => ({ y0: Math.round(r.y0 * H), y1: Math.round(r.y1 * H) }))
  objBoxes.push(...located)
  const rowsN = 100
  const rows: number[] = []
  for (let i = 0; i < rowsN; i++) rows.push(busy({ x: W * 0.04, y: (i * H) / rowsN, w: W * 0.92, h: H / rowsN }))
  const thr = 0.07
  let edgeTop = -1, edgeBottom = -1
  for (let i = Math.floor((textTop / H) * rowsN); i < Math.min(rowsN - 1, Math.ceil((ctaTop / H) * rowsN)); i++) {
    if (rows[i] > thr && rows[i + 1] > thr && (rows[i + 2] ?? 1) > thr) { edgeTop = i; break }
  }
  for (let i = Math.min(rowsN - 1, Math.floor((ctaTop / H) * rowsN)); i > Math.max(0, edgeTop); i--) {
    if (rows[i] > thr && rows[i - 1] > thr && (rows[i - 2] ?? 1) > thr) { edgeBottom = i + 1; break }
  }
  if (edgeTop >= 0) objBoxes.push({ y0: Math.round((edgeTop / rowsN) * H), y1: edgeBottom >= 0 ? Math.round((edgeBottom / rowsN) * H) : Math.round((edgeTop / rowsN) * H) })
  const objTop = objBoxes.length ? Math.min(...objBoxes.map((b) => b.y0)) : null
  const objBottom = objBoxes.length ? Math.max(...objBoxes.map((b) => b.y1)) : null
  report.text.productSource = located.length && edgeTop >= 0 ? 'located+edge_density' : located.length ? 'located' : edgeTop >= 0 ? 'edge_density' : 'none'

  // ---- 3. text stack: nominal sizes, shrunk step by step until the stack fits a corridor --------------------------------
  const maxTextW = W - 2 * sideX
  const family = fonts.heading.family
  const bodyFam = fonts.body.family
  const specs: Array<{ role: Fit['role']; text: string; max: number; min: number; lines: number; prefer?: number; preferMin?: number; weight: number; family: string; lh: number }> = []
  if (blocks.headline) specs.push({ role: 'headline', text: blocks.headline, max: W * 0.0625, min: W * 0.036, lines: 2, prefer: 1, preferMin: W * 0.044, weight: fonts.heading.weight, family, lh: 1.12 })
  if (blocks.price) specs.push({ role: 'price', text: blocks.price, max: W * 0.046, min: W * 0.03, lines: 2, prefer: 1, preferMin: W * 0.034, weight: fonts.body.boldWeight, family: bodyFam, lh: 1.12 })
  for (const f of (blocks.facts ?? []).slice(0, 2)) specs.push({ role: 'facts', text: f, max: W * 0.033, min: W * 0.024, lines: 2, prefer: 1, preferMin: W * 0.027, weight: fonts.body.weight, family: bodyFam, lh: 1.14 })
  const fitAll = (scale: number): { fits: Fit[]; total: number; ok: boolean } => {
    const out: Fit[] = []
    let ok = true
    for (const s of specs) {
      const f = fitText({ text: s.text, font: { family: s.family, weight: s.weight }, maxWidth: maxTextW, maxLines: s.lines, preferLines: s.prefer, preferMinSize: s.preferMin ? s.preferMin * scale : undefined, maxSize: s.max * scale, minSize: s.min * scale * 0.9, floorSize: s.min * scale * 0.8, lineHeight: s.lh, balance: true })
      if (!f.fits) ok = false
      out.push({ role: s.role, text: f.text, size: f.fontSize, lineH: f.lineHeightPx, lines: f.lines, w: f.width, h: f.height, fits: f.fits, weight: s.weight, family: s.family })
    }
    const total = out.reduce((a, f) => a + f.h, 0) + Math.max(0, out.length - 1) * gap
    return { fits: out, total, ok }
  }
  const SCALES = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58]
  const pick = (avail: number) => {
    for (const s of SCALES) { const r = fitAll(s); if (r.ok && r.total <= avail) return { ...r, scale: s } }
    return null
  }
  let placed: { fits: Fit[]; total: number; scale: number; y: number; corridor: 'top' | 'bottom' | 'over_product'; ok: boolean } | null = null
  if (specs.length) {
    const topAvail = (objTop != null ? Math.min(objTop - gap, ctaTop - gap) : ctaTop - gap) - textTop
    const botStart = objBottom != null ? objBottom + gap : null
    const botAvail = botStart != null ? ctaTop - gap - botStart : 0
    const top = topAvail > 0 ? pick(topAvail) : null
    const bot = botStart != null && botAvail > 0 ? pick(botAvail) : null
    if (top && (top.scale >= 0.8 || !bot || top.scale >= bot.scale)) placed = { ...top, y: textTop, corridor: 'top' }
    else if (bot) {
      // bottom corridor: sit the stack right under the objects (text and CTA stay apart)
      placed = { ...bot, y: botStart!, corridor: 'bottom' }
    } else {
      // no calm corridor: smallest type, directly under the logo, over the top of the objects (flagged, scrim guarantees contrast)
      const r = fitAll(SCALES[SCALES.length - 1])
      placed = { ...r, scale: SCALES[SCALES.length - 1], y: textTop, corridor: 'over_product' }
    }
  }

  // ---- 4. render the stack: colours from the brand palette (worst-pixel contrast ≥ 4.5), soft scrim only when needed -----
  if (placed) {
    let y = placed.y
    const boxes: Array<{ fit: Fit; box: Box }> = []
    for (const f of placed.fits) {
      const w = Math.min(maxTextW, f.w)
      const x = Math.round((W - w) / 2)
      boxes.push({ fit: f, box: { x, y: Math.round(y), w: Math.ceil(w), h: f.h } })
      y += f.h + gap
    }
    const stack: Box = { x: sideX, y: boxes[0].box.y, w: maxTextW, h: boxes[boxes.length - 1].box.y + boxes[boxes.length - 1].box.h - boxes[0].box.y }
    const st = lumaStats(raw, W, H, { x: Math.min(...boxes.map((b) => b.box.x)), y: stack.y, w: Math.max(...boxes.map((b) => b.box.w)), h: stack.h })
    const candidates = [...palette, WHITE, INK]
    const best = (lo: number, hi: number, list: Rgb[]) => list.find((c) => worstContrast(luminance(c), lo, hi) >= 4.6)
    let lo = st.lo, hi = st.hi
    let scrim: AdLayoutReport['text']['scrim'] = null
    let headColor = best(lo, hi, candidates)
    if (!headColor) {
      // soft scrim in a tone sampled from the picture; alpha grows until the worst pixel reads at ≥ 4.6:1
      const useWhite = worstContrast(1, lo, hi) >= worstContrast(luminance(INK), lo, hi)
      const tone = useWhite ? blend({ r: 0, g: 0, b: 0 }, 0.7, st.mean) : blend(WHITE, 0.78, st.mean)
      const textRgb = useWhite ? WHITE : INK
      const lt = luminance(tone)
      let alpha = 0.3
      for (; alpha <= 0.86; alpha += 0.06) {
        // blended luminance ≈ linear mix of the scrim tone and the picture (reported contrast keeps a 0.1 margin over 4.5)
        const lo2 = lt * alpha + st.lo * (1 - alpha), hi2 = lt * alpha + st.hi * (1 - alpha)
        if (worstContrast(luminance(textRgb), lo2, hi2) >= 4.6) break
      }
      alpha = Math.min(alpha, 0.86)
      lo = lt * alpha + st.lo * (1 - alpha)
      hi = lt * alpha + st.hi * (1 - alpha)
      headColor = textRgb
      const pad = Math.round(H * 0.045)
      const sbox: Box = { x: 0, y: Math.max(0, stack.y - pad), w: W, h: Math.min(H, stack.h + pad * 2) }
      const sigma = Math.round(H * 0.016)
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><filter id="b" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="${sigma}"/></filter></defs><rect x="${-W * 0.1}" y="${sbox.y}" width="${W * 1.2}" height="${sbox.h}" fill="${toHex(tone)}" fill-opacity="${alpha.toFixed(3)}" filter="url(#b)"/></svg>`
      layers.push({ input: rasterize(svg), left: 0, top: 0 })
      scrim = { tone: toHex(tone), alpha: Math.round(alpha * 100) / 100, box: sbox }
    }
    const priceColor = best(lo, hi, [palette[2], palette[0], palette[1]].filter((c): c is Rgb => Boolean(c))) ?? headColor!
    const tail = headColor!
    report.text.scrim = scrim
    for (const { fit, box } of boxes) {
      const color = fit.role === 'price' ? priceColor : fit.role === 'headline' ? headColor! : tail
      const pad = Math.ceil(fit.size * 0.12)
      const tw = box.w + pad * 2
      const svg = await satori({
        type: 'div',
        props: {
          style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: tw, height: box.h, color: toHex(color), fontFamily: cssFamily(fit.family), fontWeight: fit.weight, fontSize: fit.size, lineHeight: `${fit.lineH}px` },
          children: fit.lines.map((l) => ({ type: 'div', props: { style: { display: 'flex', whiteSpace: 'nowrap', height: fit.lineH, justifyContent: 'center' }, children: l } })),
        },
      } as unknown as Parameters<typeof satori>[0], { width: tw, height: box.h, fonts: satoriFonts([fit.family]) })
      layers.push({ input: rasterize(svg), left: box.x - pad, top: box.y })
      const contrast = Math.round(worstContrast(luminance(color), lo, hi) * 100) / 100
      elements.push({ id: fit.role, role: fit.role, box: box, text: fit.text, lines: fit.lines, fontSize: fit.size, color: toHex(color), contrast, fits: fit.fits })
    }
    const tightBoxes = elements.filter((e) => e.role !== 'logo' && e.role !== 'cta')
    report.text = {
      drawn: true, corridor: placed.corridor, scale: placed.scale, fits: tightBoxes.every((e) => e.fits !== false), textOverProduct: placed.corridor === 'over_product',
      productSource: report.text.productSource, scrim, lowContrast: tightBoxes.some((e) => (e.contrast ?? 0) < 4.5),
    }
  }

  // ---- 5. CTA pill (bottom safe zone): calm slot, off the located product; text rows above stay ≥ gap away ---------------
  let ctaBox: Box | null = null
  if (cta) {
    const around = lumaStats(raw, W, H, { x: 0, y: H * (1 - m.bottom - 0.12), w: W, h: H * 0.12 + H * m.bottom })
    const dark = blend({ r: 0, g: 0, b: 0 }, 0.62, around.mean)
    const maxAlpha = luminance(around.mean) > 0.55 ? 0.42 : 0.6
    const zoneTop = Math.round(H * (1 - m.bottom - 0.22))
    const scrimSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${toHex(dark)}" stop-opacity="0"/><stop offset="0.45" stop-color="${toHex(dark)}" stop-opacity="${maxAlpha * 0.8}"/><stop offset="1" stop-color="${toHex(dark)}" stop-opacity="${maxAlpha}"/></linearGradient></defs><rect x="0" y="${zoneTop}" width="${W}" height="${H - zoneTop}" fill="url(#s)"/></svg>`
    layers.push({ input: rasterize(scrimSvg), left: 0, top: 0 })
    report.scrim = { color: toHex(dark), maxAlpha }
    const scrimMean = blend(dark, maxAlpha, around.mean)
    const pill = await renderCtaPill({ text: cta, btnH, W, scrimMean, palette: input.palette, fonts: input.fonts })
    const by = ctaTop
    const btnW = pill.btnW
    const slots: Array<['center' | 'left' | 'right', number]> = [['center', Math.round((W - btnW) / 2)], ['left', sideX], ['right', W - sideX - btnW]]
    const overlapOf = (x: number) => {
      let o = 0
      for (const r of input.avoid ?? []) {
        const ix = Math.max(0, Math.min((x + btnW) / W, r.x1) - Math.max(x / W, r.x0))
        const iy = Math.max(0, Math.min((by + btnH) / H, r.y1) - Math.max(by / H, r.y0))
        o = Math.max(o, (ix * iy) / ((btnW / W) * (btnH / H)))
      }
      return o
    }
    let sel = { slot: slots[0][0], x: slots[0][1], busyness: 1, score: Infinity }
    const bandBg = medianColor(raw, W, H, by - btnH * 0.5, by + btnH * 1.6)
    for (const [slot, x] of slots) {
      const b = busy({ x: x - W * 0.01, y: by - H * 0.006, w: btnW + W * 0.02, h: btnH + H * 0.012 })
      const dev = deviation(raw, W, H, { x: x - W * 0.01, y: by - H * 0.006, w: btnW + W * 0.02, h: btnH + H * 0.012 }, bandBg)
      const score = b + 1.2 * dev + 3 * overlapOf(x)
      if (score < sel.score - 0.004) sel = { slot, x, busyness: b, score }
    }
    ctaBox = { x: sel.x, y: by, w: btnW, h: btnH }
    const shadow = await sharp({ create: { width: btnW, height: btnH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.35 } } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${btnW}" height="${btnH}"><rect width="${btnW}" height="${btnH}" rx="${Math.round(btnH * 0.3)}" fill="#fff"/></svg>`), blend: 'dest-in' }])
      .blur(Math.max(2, btnH * 0.1)).png().toBuffer()
    layers.push({ input: shadow, left: sel.x, top: by + Math.round(btnH * 0.08) })
    layers.push({ input: pill.png, left: sel.x, top: by })
    report.cta = { status: 'drawn', text: cta, box: ctaBox, fill: toHex(pill.fill), textColor: toHex(pill.ink), contrast: Math.round(contrastFromLuminance(luminance(pill.fill), luminance(pill.ink)) * 100) / 100, fontSize: pill.fontSize, fits: pill.fits, slot: sel.slot, busyness: Math.round(sel.busyness * 1000) / 1000, busy: sel.score > 0.08 }
    elements.push({ id: 'cta', role: 'cta', box: ctaBox, text: cta, fontSize: pill.fontSize, color: toHex(pill.ink), contrast: report.cta.contrast, fits: pill.fits })
  }

  // ---- 6. logo LAST (the text row is known): calmest slot of right / left / centre of the top safe zone ------------------
  if (logoBox) {
    try {
      const heights = [logoBox.h, Math.round(logoBox.h * 0.93), Math.round(logoBox.h * 0.86)]
      let best: { x: number; w: number; h: number; score: number } | null = null
      search: for (const hh of heights) {
        let lh = hh
        let lw = Math.round(lh * logoAspect)
        const maxW = Math.round(W * 0.34)
        if (lw > maxW) { lw = maxW; lh = Math.round(lw / logoAspect) }
        for (const x of [Math.round((W - lw) / 2), W - sideX - lw, sideX]) {
          const score = busy({ x: x - W * 0.012, y: logoBox.y - H * 0.006, w: lw + W * 0.024, h: lh + H * 0.012 })
          if (!best || score < best.score - 1e-9) best = { x, w: lw, h: lh, score }
          if (score <= 0.012) { best = { x, w: lw, h: lh, score }; break search }
        }
      }
      const { x: lx, w: lw, h: lh } = best!
      const ly = logoBox.y
      const logoPng = await sharp(input.logo!).rotate().ensureAlpha().resize(lw, lh, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer()
      const { channels, data } = await sharp(logoPng).raw().toBuffer({ resolveWithObject: true }).then((r) => ({ channels: r.info.channels, data: r.data }))
      let lr = 0, lg = 0, lb = 0, ln = 0, opaque = 0
      for (let i = 0; i < data.length; i += channels) { if (data[i + 3] > 200) { lr += data[i]; lg += data[i + 1]; lb += data[i + 2]; ln++ } opaque++ }
      const logoMean: Rgb = ln ? { r: lr / ln, g: lg / ln, b: lb / ln } : { r: 255, g: 255, b: 255 }
      const under = lumaStats(raw, W, H, { x: lx, y: ly, w: lw, h: lh })
      const contrast = Math.round(contrastFromLuminance(luminance(logoMean), luminance(under.mean)) * 100) / 100
      const selfContained = ln / Math.max(1, opaque) >= 0.85
      let glow = false
      if (!selfContained && contrast < 2.5) {
        const tone = luminance(logoMean) > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }
        const gl = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g"><stop offset="0" stop-color="${toHex(tone)}" stop-opacity="0.5"/><stop offset="1" stop-color="${toHex(tone)}" stop-opacity="0"/></radialGradient></defs><ellipse cx="${lx + lw / 2}" cy="${ly + lh / 2}" rx="${lw * 0.75}" ry="${lh * 1.1}" fill="url(#g)"/></svg>`
        layers.push({ input: rasterize(gl), left: 0, top: 0 })
        glow = true
      }
      layers.push({ input: logoPng, left: lx, top: ly })
      const box = { x: lx, y: ly, w: lw, h: lh }
      report.logo = { status: 'drawn', box, contrast, glow }
      elements.push({ id: 'logo', role: 'logo', box, contrast, fits: true })
    } catch (err) {
      report.logo = { status: 'unavailable', reason: `logo asset could not be drawn: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}` }
    }
  }

  // ---- 7. verification of the layout itself (reported, and covered by the tests) ---------------------------------------
  let minGap = Infinity
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const d = dist(elements[i].box, elements[j].box)
      minGap = Math.min(minGap, d)
      if (d < gap - 1) report.layout.overlaps.push(`${elements[i].id}~${elements[j].id}`)
    }
  }
  report.layout.minGap = Number.isFinite(minGap) ? Math.round((minGap / H) * 10000) / 10000 : 1
  const top = H * m.top, bot = H * (1 - m.bottom)
  report.layout.insideSafeZones = elements.every((e) => e.box.y >= top - 1 && e.box.y + e.box.h <= bot + 1 && e.box.x >= 0 && e.box.x + e.box.w <= W)
  if (report.layout.overlaps.length) report.text.fits = false

  const out = await sharp(input.bytes).rotate().removeAlpha().composite(layers).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer()
  return { bytes: out, report }
}
