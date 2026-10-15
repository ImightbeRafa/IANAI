/**
 * Round 9: printed-pack text fidelity (free, local OCR). Grok redraws the small print of a pouch with plausible misspellings ("Mental Ciarity", "Pick-Me-Lip")
 * that pass every colour / feature check (round 8: 0.74). The words printed on the REFERENCE photo are read with Tesseract OCR (tesseract-ocr 5, Apache-2.0,
 * CLI via execFile — installed in the runtime image; when the binary is missing the check reports 'unavailable' and nothing else changes) and looked up in the
 * text read from the generated scene (the composite flow's scene has no drawn text, so every word on it is printing the model made):
 *   - exact: the same word is there;
 *   - misspelled: the closest generated word is 1..⅓·len edits away (Clarity → Ciarity);
 *   - missing: nothing close.
 * Round 10: ANY misspelled word = fail (round 9 PH: one "Piok-Me-Up" was only a warning and the pack shipped misspelled): the generated flow regenerates once
 * and then falls back to productFidelity "exact" (real pixels). When the reference photo has < 4 readable words (dark pouch, small print) the printed strings
 * quoted in the offer's immutable attributes ('Sleeping Patches CR', '30 patches') join the reference words.
 * Round 9 "Ciarity" miss: the round-9 local check ran on a RECONSTRUCTION (round-8 post, compressed + inpainted); on the real round-8 post the same settings read
 * "Ciarity" (fixture test). Upscaling past ~2000 px smooths "Ci" into "Cl", so the 2000 px cap stays.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

export const OCR_ENGINE = 'tesseract'

export type PackTextCheck =
  | { status: 'unavailable'; engine: typeof OCR_ENGINE; reason: string }
  | { status: 'skipped'; engine: typeof OCR_ENGINE; reason: string; referenceWords?: string[] }
  | { status: 'pass' | 'warning' | 'fail'; engine: typeof OCR_ENGINE; referenceWords: string[]; exact: string[]; misspelled: Array<{ expected: string; found: string; distance: number }>; missing: string[]; score: number; reason: string }

type Runner = (bin: string, args: string[]) => Promise<string>
const defaultRunner: Runner = (bin, args) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: 20_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, OMP_THREAD_LIMIT: '1' } }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))))
})

let availability: Promise<boolean> | null = null
export function ocrAvailable(run: Runner = defaultRunner): Promise<boolean> {
  if (run !== defaultRunner) return run('tesseract', ['--version']).then(() => true, () => false)
  availability ??= run('tesseract', ['--version']).then(() => true, () => false)
  return availability
}

/** Words (lower-case, edge punctuation stripped, internal hyphens kept, ≥ 4 letters, mostly letters) read by Tesseract (sparse text mode). */
export async function ocrWords(bytes: Buffer, opts: { box?: { x0: number; y0: number; x1: number; y1: number } | null; run?: Runner; /** Round 11: also read 2 × 3 overlapping tiles, each upscaled (small print: round 9 SP "Ingocdicotes"). */ tiles?: boolean } = {}): Promise<string[]> {
  const r = await ocrWordsSplit(bytes, opts)
  return [...r.whole, ...r.tiles]
}

/** Round 11: whole-crop words and tile-only words, kept apart (a tile misread is held to a stricter rule). */
export async function ocrWordsSplit(bytes: Buffer, opts: { box?: { x0: number; y0: number; x1: number; y1: number } | null; run?: Runner; tiles?: boolean } = {}): Promise<{ whole: string[]; tiles: string[] }> {
  const whole = await ocrWordsOnce(bytes, opts)
  if (!opts.tiles) return { whole, tiles: [] }
  const meta = await sharp(bytes).rotate().metadata()
  const W = meta.width ?? 0, H = meta.height ?? 0
  if (!W || !H) return { whole, tiles: [] }
  const b = opts.box ?? { x0: 0, y0: 0, x1: 1, y1: 1 }
  const out: string[] = []
  const C = 2, R = 3, ov = 0.15
  const bw = (b.x1 - b.x0) * W, bh = (b.y1 - b.y0) * H
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const tw = (bw / C) * (1 + ov), th = (bh / R) * (1 + ov)
    const x = Math.max(0, b.x0 * W + (c * bw) / C - (tw * ov) / 2), y = Math.max(0, b.y0 * H + (r * bh) / R - (th * ov) / 2)
    const w = Math.round(Math.min(tw, W - x)), h = Math.round(Math.min(th, H - y))
    if (w < 24 || h < 24) continue
    const tile = await sharp(bytes).rotate().extract({ left: Math.round(x), top: Math.round(y), width: Math.min(w, W - Math.round(x)), height: Math.min(h, H - Math.round(y)) }).png().toBuffer()
    out.push(...(await ocrWordsOnce(tile, { run: opts.run })))
  }
  return { whole, tiles: out }
}

async function ocrWordsOnce(bytes: Buffer, opts: { box?: { x0: number; y0: number; x1: number; y1: number } | null; run?: Runner } = {}): Promise<string[]> {
  let img = sharp(bytes).rotate().flatten({ background: '#ffffff' })
  const meta = await img.metadata()
  const W = meta.width ?? 0, H = meta.height ?? 0
  if (opts.box && W && H) {
    const pad = 0.04
    const x0 = Math.max(0, Math.floor((opts.box.x0 - pad) * W)), y0 = Math.max(0, Math.floor((opts.box.y0 - pad) * H))
    const x1 = Math.min(W, Math.ceil((opts.box.x1 + pad) * W)), y1 = Math.min(H, Math.ceil((opts.box.y1 + pad) * H))
    if (x1 - x0 > 16 && y1 - y0 > 16) img = sharp(await img.extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).png().toBuffer())
  }
  const cur = await img.metadata()
  const cw = cur.width ?? W
  // small print needs ≈ 30 px x-height: upscale narrow crops (≤ 2400 px wide)
  const scale = Math.min(4, Math.max(1, 2000 / Math.max(1, cw)))
  const png = await img.resize({ width: Math.round(cw * scale), kernel: 'lanczos3' }).greyscale().png().toBuffer()
  const dir = await mkdtemp(join(tmpdir(), 'ocr-'))
  try {
    const f = join(dir, 'in.png')
    await writeFile(f, png)
    const out = await (opts.run ?? defaultRunner)('tesseract', [f, 'stdout', '-l', 'eng+spa', '--psm', '11'])
    return out.split(/\s+/).map((t) => t.toLowerCase().replace(/^[^a-záéíóúñü0-9]+|[^a-záéíóúñü0-9]+$/g, '')).filter((t) => (t.match(/[a-záéíóúñü]/g)?.length ?? 0) >= 4 && (t.match(/[a-záéíóúñü-]/g)?.length ?? 0) / t.length >= 0.8)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  const d = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= n; j++) {
      const t = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = t
    }
  }
  return d[n]
}

/** Compare the reference words with the generated ones (pure, used by the tests with fixed word lists). */
export function compareWords(reference: string[], generated: string[]): Omit<Extract<PackTextCheck, { status: 'pass' | 'warning' | 'fail' }>, 'engine'> {
  // Round 11: tile OCR reads partial words at tile borders ("natu" / "natur" of "naturales"): a word contained in a longer word of the same list (or, for the
  // generated side, in a reference word) is a fragment, not a print
  const r0 = [...new Set(reference)]
  const ref = r0.filter((w) => !r0.some((v) => v !== w && v.length > w.length && v.includes(w)))
  const g0 = [...new Set(generated)]
  const gen = new Set(g0.filter((g) => !g0.some((v) => v !== g && v.length > g.length && v.includes(g)) && !ref.some((v) => v !== g && v.length > g.length && v.includes(g))))
  const exact: string[] = []
  const misspelled: Array<{ expected: string; found: string; distance: number }> = []
  const missing: string[] = []
  for (const w of ref) {
    if (gen.has(w)) { exact.push(w); continue }
    let best = { found: '', distance: Infinity }
    for (const g of gen) { if (Math.abs(g.length - w.length) > 3) continue; const dd = editDistance(w, g); if (dd < best.distance) best = { found: g, distance: dd } }
    if (best.distance <= Math.max(1, Math.floor(w.length / 3))) misspelled.push({ expected: w, found: best.found, distance: best.distance })
    else missing.push(w)
  }
  const score = ref.length ? Math.round((exact.length / ref.length) * 100) / 100 : 1
  // Round 10: one misspelled word on a pack is already a defect (retry, then the real-pixel path)
  const status = misspelled.length >= 1 ? 'fail' : 'pass'
  const reason = misspelled.length
    ? `the printing on the product was redrawn with ${misspelled.length} misspelled word(s): ${misspelled.map((m) => `"${m.found}" instead of "${m.expected}"`).join(', ')} (OCR, ${exact.length}/${ref.length} reference words exact)`
    : `the printed words of the reference read the same on the generated product (${exact.length}/${ref.length} exact${missing.length ? `, ${missing.length} not readable / hidden` : ''})`
  return { status, referenceWords: ref, exact, misspelled, missing, score, reason }
}

/** OCR of reference photos (the same product photo is checked on every attempt / retry). */
const refCache = new Map<string, { whole: string[]; tiles: string[] }>()

/** Reference photo vs generated scene. Needs ≥ 4 readable words on the reference (otherwise 'skipped': nothing to compare). */
/** Round 10: printed strings quoted in the offer's immutable attributes ('Sleeping Patches CR', "30 patches", “…”), as OCR-comparable words (same filter as ocrWords). */
export function attributePrintedWords(attributes: Array<string | null | undefined> | undefined): string[] {
  const out: string[] = []
  for (const a of attributes ?? []) {
    if (!a) continue
    for (const m of a.matchAll(/['"“”‘’«]([^'"“”‘’«»]{2,60})['"“”‘’»]/g)) {
      for (const t of m[1].split(/\s+/)) {
        const w = t.toLowerCase().replace(/^[^a-záéíóúñü0-9]+|[^a-záéíóúñü0-9]+$/g, '')
        if ((w.match(/[a-záéíóúñü]/g)?.length ?? 0) >= 4 && (w.match(/[a-záéíóúñü-]/g)?.length ?? 0) / w.length >= 0.8) out.push(w)
      }
    }
  }
  return [...new Set(out)]
}

export async function checkPackText(input: { reference: Buffer; generated: Buffer; generatedBox?: { x0: number; y0: number; x1: number; y1: number } | null; run?: Runner; /** Round 10: offer immutable attributes (quoted printed strings are used when the reference photo has < 4 readable words). */ attributes?: Array<string | null | undefined>; /** Round 11: tile OCR for the small print (default on). */ tiles?: boolean }): Promise<PackTextCheck & { referenceSource?: 'photo' | 'photo+attributes' }> {
  if (!(await ocrAvailable(input.run))) return { status: 'unavailable', engine: OCR_ENGINE, reason: 'tesseract OCR binary not installed: printed-text check not run' }
  try {
    const key = createHash('sha1').update(input.reference).update(input.tiles === false ? ':whole' : ':tiles').digest('hex')
    let refSplit = input.run ? undefined : refCache.get(key)
    if (!refSplit) {
      refSplit = await ocrWordsSplit(input.reference, { run: input.run, tiles: input.tiles !== false })
      if (!input.run) { refCache.set(key, refSplit); if (refCache.size > 32) refCache.delete(refCache.keys().next().value!) }
    }
    let ref = [...refSplit.whole, ...refSplit.tiles]
    const refWhole = new Set(refSplit.whole)
    let source: 'photo' | 'photo+attributes' = 'photo'
    if (new Set(ref).size < 4) {
      const attr = attributePrintedWords(input.attributes)
      const merged = [...new Set([...ref, ...attr])]
      if (!attr.length || merged.length < 2) return { status: 'skipped', engine: OCR_ENGINE, reason: `fewer than 4 readable printed words on the reference photo${input.attributes?.length ? ' and no quoted printed text in the offer attributes' : ''}`, referenceWords: [...new Set(ref)] }
      ref = merged
      source = 'photo+attributes'
    }
    const genSplit = await ocrWordsSplit(input.generated, { box: input.generatedBox ?? null, run: input.run, tiles: input.tiles !== false })
    const genWhole = new Set(genSplit.whole)
    let cmp = compareWords(ref, [...genSplit.whole, ...genSplit.tiles])
    // Round 11: a misspelling seen only in a tile read (either side) must be ≥ 2 edits — one-letter tile misreads of REAL print ("ingredicntes") are OCR noise
    const weak = cmp.misspelled.filter((m) => m.distance < 2 && (!genWhole.has(m.found) || !refWhole.has(m.expected)))
    if (weak.length) {
      const misspelled = cmp.misspelled.filter((m) => !weak.includes(m))
      const missing = [...cmp.missing, ...weak.map((m) => m.expected)]
      cmp = { ...cmp, misspelled, missing, status: misspelled.length ? 'fail' : 'pass', reason: misspelled.length ? `the printing on the product was redrawn with ${misspelled.length} misspelled word(s): ${misspelled.map((m) => `"${m.found}" instead of "${m.expected}"`).join(', ')} (OCR, ${cmp.exact.length}/${cmp.referenceWords.length} reference words exact)` : `the printed words of the reference read the same on the generated product (${cmp.exact.length}/${cmp.referenceWords.length} exact, ${missing.length} not readable / hidden)` }
    }
    return { engine: OCR_ENGINE, ...cmp, ...(source !== 'photo' ? { referenceSource: source, reason: `${cmp.reason} (reference = photo words + the printed strings quoted in the offer attributes)` } : {}) }
  } catch (err) {
    return { status: 'unavailable', engine: OCR_ENGINE, reason: `OCR failed: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}` }
  }
}
