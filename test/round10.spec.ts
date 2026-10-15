/**
 * Round 10 (MCP 0.23.0) — Content's round-9 live result (1/4: A 9, B 6, SP 6, PH 7.5), checked on the REAL raw scenes round 9 now stores (raw.sceneUrl):
 *  1. no mirror / flip in the canvas extension or the bottom continuation (B: ghost controller, SP: blurred mirrored side strips + ghost pouch print);
 *  2. no room → the picture shrinks before the text; text ≥ 85 % (B came out at 64 %);
 *  3. a CTA slot is clean only with objectShare 0, no overlap, no table edge (PH clipped the pouch at 0.052, SP sat on the table edge);
 *  4. one misspelled pack word = fail (retry → exact); < 4 reference words → quoted printed strings of the offer attributes; the "Ciarity" miss;
 *  5. wood grain is not a prop;
 *  6. a warning when productFidelity "generated" is passed for a pack.
 * Fixtures (test/fixtures/round10): the round-9 raw scenes of B and SP (reframed 4:5, half size), a crop of PH's raw scene (the pouch, full size) and a crop
 * of the round-8 LIVE PH post (pouch). No model call anywhere.
 */
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { prepareAndLayout, TEXT_MIN } from '../api/lib/mcp/compose-scene'
import { continueEdge, extendCanvas, shiftSceneUp, EXTEND_LAST_RESORT } from '../api/lib/mcp/scene-prep'
import { slotUnclean, splitCopyBlocks } from '../api/lib/mcp/layout-ad'
import { attributePrintedWords, checkPackText, compareWords, ocrAvailable } from '../api/lib/mcp/pack-ocr'
import { checkExtraObjects, isSurfaceTexture } from '../api/lib/mcp/extra-objects'
import { packGeneratedWarning } from '../api/lib/mcp/execute-tools'
import { MCP_VERSION } from '../api/lib/mcp/server-info'

const F10 = (n: string) => readFileSync(new URL(`./fixtures/round10/${n}`, import.meta.url))
const LOGO = readFileSync(new URL('./fixtures/round5b/kit-logo-prototipo.png', import.meta.url))
const PALETTE = { primary: '#15263E', secondary: '#F1EDE5', accent: '#2EC4B6' }
const COPY_B = 'Lo manejás con dos joysticks\n₡14.900 el kit con control\nEnvío gratis llevando 2 kits o más\nEscribinos por DM'
const COPY_SP = 'Tu ritual antes de dormir\n₡9.900 la bolsa de 30 noches\nEnvío gratis llevando 2 bolsas\nEscribinos al WhatsApp 7052 4184'
const B_AVOID = [{ x0: 0.33, y0: 0.69, x1: 0.68, y1: 0.87 }, { x0: 0.45, y0: 0.33, x1: 0.92, y1: 0.75 }]
const SP_AVOID = [{ x0: 0.12, y0: 0.39, x1: 0.58, y1: 0.95 }, { x0: 0.57, y0: 0.48, x1: 0.88, y1: 0.92 }]

/** Wall (top 60 %) + tan table, a saturated RED object touching the bottom edge at the centre. */
async function sceneWithObjectAtBottom(W = 400, H = 500) {
  const raw = Buffer.alloc(W * H * 3)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3
    const table = y > H * 0.6
    let r = table ? 196 : 40, g = table ? 160 : 52, b = table ? 120 : 80
    if (table && (y % 7 === 0)) { r -= 14; g -= 12; b -= 10 } // grain
    if (x > W * 0.4 && x < W * 0.6 && y > H * 0.8) { r = 220; g = 20; b = 30 }
    raw[i] = r; raw[i + 1] = g; raw[i + 2] = b
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
}
const redShare = async (bytes: Buffer, region: { x0: number; y0: number; x1: number; y1: number }) => {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
  let n = 0, t = 0
  for (let y = Math.floor(region.y0 * info.height); y < Math.ceil(region.y1 * info.height); y++) for (let x = Math.floor(region.x0 * info.width); x < Math.ceil(region.x1 * info.width); x++) {
    const i = (y * info.width + x) * info.channels; t++
    if (data[i] > 150 && data[i + 1] < 90 && data[i] - data[i + 1] > 100) n++
  }
  return t ? n / t : 0
}

describe('1. no mirror / flip in the continuation', () => {
  it('scene-prep.ts has no flip / flop / rotate-by-90 of the picture any more', () => {
    const src = readFileSync(new URL('../api/lib/mcp/scene-prep.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/\.flip\(|\.flop\(|rotate\(\s*-?90/)
  })
  it('shiftSceneUp: the object touching the bottom edge is NOT reproduced in the new bottom rows (masked, colour continuation only)', async () => {
    const img = await sceneWithObjectAtBottom()
    const up = await shiftSceneUp(img, 100, 93, [{ x0: 0.4, y0: 0.8, x1: 0.6, y1: 1 }])
    // the object moved up by 20 %: its old place is now continuation → no red there (round 9 would have mirrored it / carried its colour)
    expect(await redShare(up, { x0: 0.3, y0: 0.82, x1: 0.7, y1: 1 })).toBe(0)
    expect(await redShare(up, { x0: 0.4, y0: 0.62, x1: 0.6, y1: 0.78 })).toBeGreaterThan(0.5)
  })
  it('extendCanvas: same pixel size; no red outside the scaled picture; the border is textured, not flat', async () => {
    const img = await sceneWithObjectAtBottom()
    const ext = await extendCanvas(img, 0.86, 0.25, 93, [{ x0: 0.4, y0: 0.8, x1: 0.6, y1: 1 }])
    const m = await sharp(ext.bytes).metadata()
    expect([m.width, m.height]).toEqual([400, 500])
    const pic = ext.map({ x0: 0, y0: 0, x1: 1, y1: 1 })
    expect(await redShare(ext.bytes, { x0: 0, y0: pic.y1 + 0.005, x1: 1, y1: 1 })).toBe(0)
    // left strip carries the wall / table rows: two tones top / bottom, and some grain (std > 0.5)
    const st = await sharp(ext.bytes).extract({ left: 0, top: Math.round(500 * 0.75), width: Math.round(400 * pic.x0) - 2, height: 60 }).stats()
    expect(st.channels[0].stdev).toBeGreaterThan(0.5)
  })
  it('continueEdge: rows ordered from the edge outward, background colour of the masked columns re-interpolated from the neighbours', () => {
    const W = 50, H = 40
    const raw = Buffer.alloc(W * H * 3, 100)
    for (let y = 30; y < H; y++) for (let x = 20; x < 30; x++) { const i = (y * W + x) * 3; raw[i] = 250; raw[i + 1] = 0; raw[i + 2] = 0 }
    const mask = new Uint8Array(W); for (let x = 18; x < 32; x++) mask[x] = 1
    const { fill } = continueEdge(raw, W, H, 'bottom', 0, 10, 3, mask)
    for (let k = 0; k < 10; k++) { const i = (k * W + 25) * 3; expect(fill[i]).toBeLessThan(130) }
  })
  it('real round-9 B scene: the bottom continuation has no ghost of the black controller (no dark blob under it)', async () => {
    const scene = F10('b-scene-r9.jpg')
    const done = await prepareAndLayout({ bytes: scene, ratio: '4:5', logo: LOGO, blocks: splitCopyBlocks(COPY_B, 'Escribinos por DM'), palette: PALETTE, fonts: { headingFont: null, bodyFont: null }, avoid: B_AVOID })
    const { data, info } = await sharp(done.sceneBytes).raw().toBuffer({ resolveWithObject: true })
    // the bottom 12 % of the prepared scene (continuation) must not hold dark controller pixels
    let dark = 0, t = 0
    for (let y = Math.round(info.height * 0.88); y < info.height; y++) for (let x = 0; x < info.width; x += 2) { const i = (y * info.width + x) * info.channels; t++; if (data[i] + data[i + 1] + data[i + 2] < 150) dark++ }
    expect(dark / t).toBeLessThan(0.002)
  }, 120_000)
})

describe('2. shrink the picture before the text (text ≥ 85 %)', () => {
  it('real round-9 B scene: text ≥ 85 % (live: 64 %), not over the product, CTA drawn and clean', async () => {
    const done = await prepareAndLayout({ bytes: F10('b-scene-r9.jpg'), ratio: '4:5', logo: LOGO, blocks: splitCopyBlocks(COPY_B, 'Escribinos por DM'), palette: PALETTE, fonts: { headingFont: null, bodyFont: null }, avoid: B_AVOID })
    expect(done.report.text.scale).toBeGreaterThanOrEqual(TEXT_MIN)
    expect(done.report.text.textOverProduct).toBe(false)
    expect(done.report.cta.status).toBe('drawn')
    expect(done.report.cta.blocked).toBeFalsy()
  }, 120_000)
})

describe('3. a CTA slot must be clean (objectShare 0, no overlap, no table edge)', () => {
  it('slotUnclean: any overlap / object pixel / seam rejects the slot', () => {
    expect(slotUnclean(0, 0, false)).toBe(false)
    expect(slotUnclean(0, 0.052, false)).toBe(true) // round 9 PH
    expect(slotUnclean(0, 0.011, false)).toBe(true) // round 9 SP
    expect(slotUnclean(0, 0, true)).toBe(true) // table edge
    expect(slotUnclean(0.05, 0, false)).toBe(true)
    expect(slotUnclean(0.004, 0, false)).toBe(false) // a sliver of the 0.8 % air margin
  })
  it('real round-9 SP scene (pouch to 95 % of the height): the picture shrinks so the CTA lands on a clean slot — objectShare 0, no seam, not blocked', async () => {
    const done = await prepareAndLayout({ bytes: F10('sp-scene-r9.jpg'), ratio: '4:5', logo: LOGO, blocks: splitCopyBlocks(COPY_SP, 'Escribinos al WhatsApp 7052 4184'), palette: { primary: '#0D1845', secondary: '#2C3E9E', accent: '#F5C842' }, fonts: { headingFont: null, bodyFont: null }, avoid: SP_AVOID })
    expect(done.report.cta.status).toBe('drawn')
    expect(done.report.cta.objectShare).toBe(0)
    expect(done.report.cta.seam).toBeFalsy()
    expect(done.report.cta.blocked).toBeFalsy()
    expect(done.scenePrep.ctaBlocked).toBeFalsy()
    expect(done.scenePrep.extended?.scale).toBeGreaterThanOrEqual(EXTEND_LAST_RESORT)
    expect(done.report.text.scale).toBeGreaterThanOrEqual(TEXT_MIN)
  }, 120_000)
})

describe('4. pack printing: one misspelling fails; attribute fallback; Ciarity', () => {
  it('compareWords: ONE misspelled word is a fail (round 9 PH "Piok-Me-Up" was a warning)', () => {
    const ref = ['energy', 'patches', 'pick-me-up', 'mental', 'clarity']
    expect(compareWords(ref, ['energy', 'patches', 'piok-me-up', 'mental', 'clarity']).status).toBe('fail')
    expect(compareWords(ref, ref).status).toBe('pass')
  })
  it('attributePrintedWords: only the QUOTED printed strings of the offer attributes', () => {
    const attrs = ["Franja inferior azul grisácea con 3 iconos (cama, manos con hoja, brazo) y textos impresos", "Insignia redonda '30 patches' abajo a la derecha y 'Sleeping Patches CR' abajo al centro"]
    expect(attributePrintedWords(attrs).sort()).toEqual(['patches', 'sleeping'])
  })
  it('< 4 words on the reference photo → the attribute strings join the reference (mock OCR): a misspelled "Sleepinq" fails', async () => {
    let call = 0
    const run = async (_bin: string, args: string[]) => (args[0] === '--version' ? 'tesseract 5' : (call++ === 0 ? 'Sleeping' : 'Sleepinq Patches CR'))
    const r = await checkPackText({ reference: await sceneWithObjectAtBottom(), generated: await sceneWithObjectAtBottom(), run, attributes: ["Insignia 'Sleeping Patches CR'"] })
    expect(r.status).toBe('fail')
    expect(r.referenceSource).toBe('photo+attributes')
  })
  it('real OCR: round-9 PH raw scene "Piok-Me-Up" fails; the round-8 live post reads "Ciarity" (the round-9 miss came from the reconstruction)', async () => {
    if (!(await ocrAvailable())) { console.warn('tesseract not installed: OCR test skipped'); return }
    const ref = readFileSync(new URL('./fixtures/round9/ph-ref-crop.jpg', import.meta.url))
    const r9 = await checkPackText({ reference: ref, generated: F10('ph-pack-r9.jpg') })
    expect(r9.status).toBe('fail')
    if (r9.status === 'fail') expect(r9.misspelled.map((m) => m.found).join(' ')).toMatch(/piok-me-up/)
    const r8 = await checkPackText({ reference: ref, generated: F10('ph-pack-r8-post.jpg') })
    expect(r8.status).toBe('fail')
    if (r8.status === 'fail') expect(r8.misspelled.map((m) => m.found).join(' ')).toMatch(/ciarity/)
  }, 90_000)
})

describe('5. wood grain is not a prop', () => {
  it('isSurfaceTexture: a warm, wide, sparse band touching a side is texture; a compact orange blob is not; a blue band is not', () => {
    expect(isSurfaceTexture(4, 0.051, { x0: 0, y0: 0.695, x1: 1, y1: 0.885 })).toBe(true)
    expect(isSurfaceTexture(4, 0.02, { x0: 0.4, y0: 0.6, x1: 0.55, y1: 0.7 })).toBe(false)
    expect(isSurfaceTexture(17, 0.051, { x0: 0, y0: 0.695, x1: 1, y1: 0.885 })).toBe(false)
  })
  it('real round-9 B scene: the wooden table no longer flags a prop (live: "red-orange / orange" false positive)', async () => {
    const scene = F10('b-scene-r9.jpg')
    const m = await sharp(scene).metadata()
    const ctrl = await sharp(scene).extract({ left: Math.round(m.width! * 0.36), top: Math.round(m.height! * 0.72), width: Math.round(m.width! * 0.28), height: Math.round(m.height! * 0.12) }).jpeg().toBuffer()
    const r = await checkExtraObjects({ generated: scene, references: [ctrl, LOGO], productBox: B_AVOID[0], allowedCount: 0, mode: 'scene' })
    expect(r.suspected).toBe(false)
    expect(r.ignoredTextures?.length).toBeGreaterThan(0)
  }, 60_000)
  it('a compact orange prop on a grey table is still flagged', async () => {
    const W = 320, H = 400
    const raw = Buffer.alloc(W * H * 3)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; const o = x > 60 && x < 110 && y > 230 && y < 290; raw[i] = o ? 235 : 150; raw[i + 1] = o ? 120 : 150; raw[i + 2] = o ? 20 : 152 }
    const img = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg().toBuffer()
    const r = await checkExtraObjects({ generated: img, references: [LOGO], productBox: { x0: 0.6, y0: 0.5, x1: 0.9, y1: 0.8 }, allowedCount: 0, mode: 'scene' })
    expect(r.suspected).toBe(true)
  })
})

describe('6. explicit "generated" on a pack', () => {
  it('the warning names the risk and the fix', () => {
    expect(packGeneratedWarning()).toMatch(/generated.*pack/)
    expect(packGeneratedWarning()).toMatch(/exact/)
  })
})

describe('version', () => {
  it('MCP 0.23.0', () => expect(MCP_VERSION).toBe('0.23.0'))
})
