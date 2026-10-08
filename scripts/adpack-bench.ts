/**
 * Ad Pack LIVE benchmark (real models, local files, no database).
 *
 *   npx tsx scripts/adpack-bench.ts --env-file <path/.env> [--out <dir>] [--steps A,B,C,D]
 *     [--cap 8] [--offers id,id] [--copy-offers all|id,id] [--copy-angles 10] [--judge 3]
 *
 * - Reads ONLY GROK_API_KEY / XAI_API_KEY and GEMINI_API_KEY from --env-file (or process.env).
 *   Values are never printed or written.
 * - Spend is tracked with `withCostLedger` and accumulated across runs in
 *   `<base>/spend.json` (base = parent of --out); every model call is refused once the cap is hit.
 * - Step A: one fictional "user product photo" per pack offer (cached in <base>/products).
 * - Step B: copy benchmark over BENCHMARK_OFFERS (planAngles → generatePackCopy → check → repair → judge sample).
 * - Step C: full packs (planPack + advancePack loop, concurrency 4, draft scenes) with local storage.
 * - Step D: one 4:5 contact sheet per pack.
 *
 * Default output: <os tmp>/adpack-bench/<timestamp>/ (metrics JSON + PNGs). Generated images stay local.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp, { type OverlayOptions } from 'sharp'
import { checkAdCopy, repairAdCopy } from '../api/lib/adpack/check-copy'
import { generatePackCopy, type PackCopyItem } from '../api/lib/adpack/copy'
import { createModelGateway, withCostLedger, type LedgerEntry, type LedgeredGateway } from '../api/lib/adpack/gateway'
import { advancePack, BLOCKING_COPY_CODES, planPack } from '../api/lib/adpack/pack-runner'
import { planAngles } from '../api/lib/adpack/plan-angles'
import { createDefaultRenderer } from '../api/lib/adpack/render-adapter'
import type { AdPackStorage } from '../api/lib/adpack/runner-types'
import { scoreAdCopy } from '../api/lib/adpack/score-copy'
import { createMemoryPackStore } from '../api/lib/adpack/store-memory'
import type { AdCopy, CopyCheckIssue, ModelGateway, PackItem } from '../api/lib/adpack/types'
import { mapWithConcurrency } from '../api/lib/adpack/util'
import { BENCHMARK_OFFERS, type BenchmarkCase } from '../test/fixtures/adpack/benchmark-offers'

// ---------------------------------------------------------------------------
// Args + env
// ---------------------------------------------------------------------------

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const OUT = resolve(arg('out') ?? join(tmpdir(), 'adpack-bench', stamp))
const BASE = dirname(OUT)
const STEPS = new Set((arg('steps') ?? 'A,B,C,D').split(',').map((s) => s.trim().toUpperCase()))
const CAP_USD = Number(arg('cap') ?? 8)
const PACK_OFFERS = (arg('offers') ?? 'beauty-serum,food-coffee,pets-bed,home-cleaner,fitness-bands').split(',').map((s) => s.trim())
const COPY_OFFERS = arg('copy-offers') ?? 'all'
const COPY_ANGLES = Number(arg('copy-angles') ?? 10)
const JUDGE_PER_OFFER = Number(arg('judge') ?? 3)
const PACK_CONCURRENCY = Number(arg('concurrency') ?? 4)
const PACK_SIZE = Number(arg('size') ?? 10)

const ALLOWED_ENV = ['GROK_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY'] as const

/** Parse only the allowed keys from a dotenv file. Never logs values. */
function loadKeys(): Record<string, string> {
  const out: Record<string, string> = {}
  const file = arg('env-file')
  if (file && existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m || !(ALLOWED_ENV as readonly string[]).includes(m[1])) continue
      out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').trim()
    }
  }
  for (const k of ALLOWED_ENV) if (!out[k] && process.env[k]) out[k] = process.env[k] as string
  return out
}

// ---------------------------------------------------------------------------
// Spend ledger (accumulated across runs) + cap guard
// ---------------------------------------------------------------------------

const SPEND_FILE = join(BASE, 'spend.json')
interface SpendFile {
  totalUsd: number
  runs: Array<{ out: string; steps: string; usd: number; at: string }>
}
function readSpend(): SpendFile {
  try {
    return JSON.parse(readFileSync(SPEND_FILE, 'utf8')) as SpendFile
  } catch {
    return { totalUsd: 0, runs: [] }
  }
}
const priorSpend = readSpend().totalUsd
let runSpend = 0
const runLedger: Array<LedgerEntry & { stage: string }> = []
let stage = 'init'

function persistSpend(): void {
  const s = readSpend()
  const runs = s.runs.filter((r) => r.out !== OUT)
  runs.push({ out: OUT, steps: [...STEPS].join(','), usd: Number(runSpend.toFixed(4)), at: new Date().toISOString() })
  const totalUsd = Number((runs.reduce((a, r) => a + r.usd, 0)).toFixed(4))
  writeFileSync(SPEND_FILE, JSON.stringify({ totalUsd, runs }, null, 2))
}

class CapReached extends Error {
  constructor() {
    super('bench_cost_cap_reached')
  }
}

/** Refuse new calls once prior + this run's spend reaches the cap. */
function capGuard(inner: ModelGateway): ModelGateway {
  const check = () => {
    if (priorSpend + runSpend >= CAP_USD) throw new CapReached()
  }
  return {
    json(input) {
      check()
      return inner.json(input)
    },
    visionJson(input) {
      check()
      return inner.visionJson(input)
    },
    scene(input) {
      check()
      return inner.scene(input)
    },
  }
}

let baseGateway: ModelGateway
/** A fresh ledger per scope (pack / copy offer); all entries also go to the run ledger. */
function scopedGateway(): LedgeredGateway {
  return withCostLedger(capGuard(baseGateway), (e) => {
    runSpend += e.costUsd
    runLedger.push({ ...e, stage })
    persistSpend()
  })
}

// ---------------------------------------------------------------------------
// Step A — product photos
// ---------------------------------------------------------------------------

const PRODUCT_SHOTS: Record<string, string> = {
  'beauty-serum':
    'a 30 ml amber glass dropper bottle of facial serum with a black rubber dropper bulb and a minimal matte white label with a small sage-green leaf mark and the short word "ALBA"',
  'food-coffee':
    'a 340 g matte kraft-paper stand-up coffee bag with a one-way valve, folded top, and a simple cream label with a mountain line drawing and the word "NEBLINA"',
  'pets-bed':
    'a large rectangular orthopedic dog bed: thick light-grey memory foam base with a charcoal waterproof fabric cover, raised bolster on three sides, visible side zipper, no logo',
  'home-cleaner':
    'a 1 liter white HDPE plastic bottle of concentrated multipurpose cleaner with a green flip cap and a simple white-and-green label with eucalyptus leaves and the words "BRILLO CASERO"',
  'fitness-bands':
    'a set of three fabric resistance loop bands (light pink, coral and deep plum), neatly stacked and slightly fanned, woven elastic texture with grey anti-slip rubber lines inside, no logo',
}

function productPrompt(desc: string): string {
  return [
    `Professional e-commerce packshot photo of ${desc}.`,
    'Single product, centered, front-facing, fully in frame with margins, on a seamless plain light-grey studio background, soft even studio lighting, subtle natural shadow.',
    'Photorealistic, sharp focus, true-to-life materials. No props, no hands, no extra text besides the product label described.',
  ].join(' ')
}

async function stepProducts(cases: BenchmarkCase[]): Promise<Record<string, string>> {
  stage = 'A_product_photo'
  const dir = join(BASE, 'products')
  await mkdir(dir, { recursive: true })
  const gw = scopedGateway()
  const out: Record<string, string> = {}
  await mapWithConcurrency(cases, 3, async (c) => {
    const file = join(dir, `${c.id}.png`)
    if (!existsSync(file)) {
      const desc = PRODUCT_SHOTS[c.id] ?? `${c.offer.name}, a physical retail product`
      const res = await gw.scene({ prompt: productPrompt(desc), refs: [], ratio: '1:1', draft: true, language: 'en' })
      await writeFile(file, await sharp(Buffer.from(res.bytes)).png().toBuffer())
      console.log(`[A] product photo ${c.id} ($${res.costUsd.toFixed(3)})`)
    } else {
      console.log(`[A] product photo ${c.id} (cached)`)
    }
    out[c.id] = file
  })
  return out
}

async function fileToDataUrl(file: string): Promise<string> {
  const buf = await readFile(file)
  return `data:image/png;base64,${buf.toString('base64')}`
}

// ---------------------------------------------------------------------------
// Step B — copy benchmark
// ---------------------------------------------------------------------------

interface CopyAdRecord {
  offerId: string
  angleId: string
  format: string
  ok: boolean
  error?: string
  initialIssues: CopyCheckIssue[]
  finalIssues: CopyCheckIssue[]
  repaired: boolean
  shipped: boolean
  copy?: AdCopy
  judge?: { score: number; reasons: string[]; criteria: Record<string, number> }
}

const FACT_CODES = new Set<CopyCheckIssue['code']>(['unconfirmed_fact', 'number_mismatch'])

async function copyBenchOffer(c: BenchmarkCase): Promise<{ records: CopyAdRecord[]; costUsd: number }> {
  const gw = scopedGateway()
  const { dna, offer } = c
  const language = dna.language
  const angles = planAngles({ dna, offer, size: 10, language }).slice(0, COPY_ANGLES)
  const res = await generatePackCopy({ gateway: gw, dna, offer, angles, language, repair: false })
  const items = res.items
  const initial = items.map((x) => (x.ok ? x.check.issues : []))
  const okCopies = () => items.filter((x): x is Extract<PackCopyItem, { ok: true }> => x.ok)
  const repaired = new Set<number>()
  await mapWithConcurrency(
    items.map((x, i) => ({ x, i })).filter(({ x }) => x.ok && !x.check.ok),
    5,
    async ({ x, i }) => {
      if (!x.ok) return
      const others = okCopies().filter((y) => y !== x).map((y) => y.copy)
      const rep = await repairAdCopy({ gateway: gw, copy: x.copy, issues: x.check.issues, dna, offer, angle: angles[i], language, otherCopies: others })
      x.copy = rep.copy
      x.check = rep.check
      if (rep.repaired) repaired.add(i)
    }
  )
  const records: CopyAdRecord[] = items.map((x, i) => {
    if (!x.ok) return { offerId: c.id, angleId: angles[i].id, format: angles[i].format, ok: false, error: x.error, initialIssues: [], finalIssues: [], repaired: false, shipped: false }
    const earlier = items.filter((y, j) => j < i && y.ok).map((y) => (y as Extract<PackCopyItem, { ok: true }>).copy)
    const check = checkAdCopy(x.copy, { dna, offer, angle: angles[i], language, otherCopies: earlier })
    const blocking = check.issues.filter((iss) => BLOCKING_COPY_CODES.has(iss.code))
    return {
      offerId: c.id,
      angleId: angles[i].id,
      format: angles[i].format,
      ok: true,
      initialIssues: initial[i],
      finalIssues: check.issues,
      repaired: repaired.has(i),
      shipped: blocking.length === 0,
      copy: x.copy,
    }
  })
  // Judge a spread sample of shipped ads.
  const shippedIdx = records.map((r, i) => (r.shipped ? i : -1)).filter((i) => i >= 0)
  const pick: number[] = []
  for (let k = 0; k < JUDGE_PER_OFFER && shippedIdx.length; k++) {
    const idx = shippedIdx[Math.floor((k * shippedIdx.length) / JUDGE_PER_OFFER)]
    if (!pick.includes(idx)) pick.push(idx)
  }
  await mapWithConcurrency(pick, 3, async (i) => {
    const r = records[i]
    const j = await scoreAdCopy({ gateway: gw, copy: r.copy!, angle: angles[i], dna, language, offer })
    r.judge = { score: j.score, reasons: j.reasons, criteria: j.criteria as Record<string, number> }
  })
  return { records, costUsd: gw.totalCostUsd() }
}

function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a'
}

async function stepCopy(): Promise<unknown> {
  stage = 'B_copy'
  const cases = COPY_OFFERS === 'all' ? BENCHMARK_OFFERS : BENCHMARK_OFFERS.filter((c) => COPY_OFFERS.split(',').includes(c.id))
  const t0 = Date.now()
  const results = await mapWithConcurrency(cases, 3, async (c) => {
    const r = await copyBenchOffer(c)
    console.log(`[B] ${c.id}: ${r.records.filter((x) => x.shipped).length}/${r.records.length} shipped, $${r.costUsd.toFixed(3)}`)
    return r
  })
  const records = results.flatMap((r) => (r.ok ? r.value.records : []))
  const errors = results.map((r, i) => (r.ok ? null : `${cases[i].id}: ${String((r.error as Error)?.message ?? r.error)}`)).filter(Boolean)
  const generated = records.filter((r) => r.ok)
  const passInitial = generated.filter((r) => r.initialIssues.length === 0).length
  const passFinal = generated.filter((r) => r.finalIssues.length === 0).length
  const shipped = generated.filter((r) => r.shipped)
  const factCaughtInitial = generated.filter((r) => r.initialIssues.some((i) => FACT_CODES.has(i.code))).length
  const factFinal = generated.filter((r) => r.finalIssues.some((i) => FACT_CODES.has(i.code))).length
  const factShipped = shipped.filter((r) => r.finalIssues.some((i) => FACT_CODES.has(i.code))).length
  const factRepaired = generated.filter((r) => r.initialIssues.some((i) => FACT_CODES.has(i.code)) && !r.finalIssues.some((i) => FACT_CODES.has(i.code))).length
  const byCode = (list: CopyAdRecord[], key: 'initialIssues' | 'finalIssues') => {
    const m: Record<string, number> = {}
    for (const r of list) for (const code of new Set(r[key].map((i) => i.code))) m[code] = (m[code] ?? 0) + 1
    return m
  }
  const judged = records.filter((r) => r.judge)
  const scores = judged.map((r) => r.judge!.score).sort((a, b) => a - b)
  const hist: Record<string, number> = {}
  for (const s of scores) hist[String(Math.floor(s))] = (hist[String(Math.floor(s))] ?? 0) + 1
  const criteria: Record<string, number[]> = {}
  for (const r of judged) for (const [k, v] of Object.entries(r.judge!.criteria)) (criteria[k] ??= []).push(v)
  const reasons: Record<string, number> = {}
  for (const r of judged) for (const reason of r.judge!.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1
  const summary = {
    offers: cases.length,
    offerErrors: errors,
    ads: records.length,
    generated: generated.length,
    generationFailures: records.length - generated.length,
    passCheckInitial: passInitial,
    passCheckFinal: passFinal,
    passCheckFinalPct: pct(passFinal, generated.length),
    shipped: shipped.length,
    shippedPct: pct(shipped.length, generated.length),
    repairedAds: generated.filter((r) => r.repaired).length,
    factIssuesCaughtInitial: factCaughtInitial,
    factIssuesRepaired: factRepaired,
    factIssuesBlockedFinal: factFinal,
    factIssuesInShipped: factShipped,
    issuesInitialByCode: byCode(generated, 'initialIssues'),
    issuesFinalByCode: byCode(generated, 'finalIssues'),
    judged: judged.length,
    judgeMean: scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null,
    judgeMedian: scores.length ? scores[Math.floor(scores.length / 2)] : null,
    judgeGte7: judged.filter((r) => r.judge!.score >= 7).length,
    judgeGte7Pct: pct(judged.filter((r) => r.judge!.score >= 7).length, judged.length),
    judgeHistogram: hist,
    judgeCriteriaMean: Object.fromEntries(Object.entries(criteria).map(([k, v]) => [k, Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2))])),
    topJudgeReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 15),
    costUsd: Number(runLedger.filter((e) => e.stage === 'B_copy').reduce((s, e) => s + e.costUsd, 0).toFixed(4)),
    wallMs: Date.now() - t0,
  }
  await writeFile(join(OUT, 'copy-bench.json'), JSON.stringify({ summary, records }, null, 2))
  console.log('[B] summary', JSON.stringify(summary, null, 2))
  return summary
}

// ---------------------------------------------------------------------------
// Step C — full packs
// ---------------------------------------------------------------------------

function localStorage(dir: string): AdPackStorage {
  return {
    async upload(input) {
      await mkdir(dir, { recursive: true })
      const ext = input.contentType === 'image/png' ? 'png' : 'jpg'
      const file = join(dir, `${String(input.itemIndex).padStart(2, '0')}-${input.kind}.${ext}`)
      await writeFile(file, input.bytes)
      // Scenes are reused as style refs / vision inputs → data URL. Renders only need a path.
      if (input.kind === 'scene') return { url: `data:${input.contentType};base64,${Buffer.from(input.bytes).toString('base64')}` }
      return { url: pathToFileURL(file).href }
    },
  }
}

interface PackMetrics {
  offerId: string
  packId: string
  wallMs: number
  costUsd: number
  costByKind: Record<string, number>
  callsByKind: Record<string, number>
  done: number
  failed: number
  sceneItems: number
  sceneAttemptsTotal: number
  sceneRetries: number
  sceneProductPass: number
  sceneFullPass: number
  sceneFirstTryPass: number
  failures: string[]
  dir: string
  items: Array<Omit<PackItem, 'scene' | 'renders'> & { renders: string[]; scene?: Omit<NonNullable<PackItem['scene']>, 'imageUrl'> }>
}

async function runOnePack(c: BenchmarkCase, productFile: string): Promise<PackMetrics> {
  stage = `C_pack_${c.id}`
  const gw = scopedGateway()
  const dir = join(OUT, 'packs', c.id)
  await mkdir(dir, { recursive: true })
  const productRef = await fileToDataUrl(productFile)
  const offer = { ...c.offer, productImageUrls: [productRef] }
  const store = createMemoryPackStore()
  const { pack, items } = planPack({ dna: c.dna, offer, size: PACK_SIZE, userId: 'bench', source: 'web', seed: c.id })
  await store.createPack(pack, items)
  // Log scene prompts + vision verdicts for review (sequence order).
  const sceneLog: Array<{ prompt: string }> = []
  const visionLog: unknown[] = []
  const logged: ModelGateway = {
    json: (i) => gw.json(i),
    async visionJson<T>(i: Parameters<ModelGateway['visionJson']>[0]) {
      const r = await gw.visionJson<T>(i)
      visionLog.push(r.data)
      return r
    },
    scene: (i) => {
      sceneLog.push({ prompt: i.prompt })
      return gw.scene(i)
    },
  }
  const renderer = createDefaultRenderer()
  const storage = localStorage(dir)
  const t0 = Date.now()
  let progress
  for (let round = 0; round < 20; round++) {
    progress = await advancePack({ store, gateway: logged, renderer, storage, charge: async () => ({ charged: true }), packId: pack.id, userId: 'bench', budgetMs: 50_000, concurrency: PACK_CONCURRENCY, draft: true })
    console.log(`[C] ${c.id} round ${round}: done ${progress.done} failed ${progress.failed} pending ${progress.pending} ($${gw.totalCostUsd().toFixed(3)}, ${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    if (progress.pending === 0) break
    if (priorSpend + runSpend >= CAP_USD) break
  }
  const wallMs = Date.now() - t0
  const final = (await store.getPack(pack.id, 'bench'))!.items
  const costByKind: Record<string, number> = {}
  const callsByKind: Record<string, number> = {}
  for (const e of gw.ledger) {
    const k = e.kind === 'json' ? 'copy(json)' : e.kind === 'visionJson' ? 'sceneCheck(vision)' : 'scene(image)'
    costByKind[k] = Number(((costByKind[k] ?? 0) + e.costUsd).toFixed(5))
    callsByKind[k] = (callsByKind[k] ?? 0) + 1
  }
  const withScene = final.filter((i) => i.sceneAttempts)
  const m: PackMetrics = {
    offerId: c.id,
    packId: pack.id,
    wallMs,
    costUsd: Number(gw.totalCostUsd().toFixed(4)),
    costByKind,
    callsByKind,
    done: final.filter((i) => i.status === 'done').length,
    failed: final.filter((i) => i.status === 'failed').length,
    sceneItems: withScene.length,
    sceneAttemptsTotal: withScene.reduce((s, i) => s + (i.sceneAttempts ?? 0), 0),
    sceneRetries: withScene.reduce((s, i) => s + Math.max(0, (i.sceneAttempts ?? 1) - 1), 0),
    sceneProductPass: withScene.filter((i) => i.sceneCheck && i.sceneCheck.productMatches !== false).length,
    sceneFullPass: withScene.filter((i) => i.sceneCheck?.ok).length,
    sceneFirstTryPass: withScene.filter((i) => i.sceneAttempts === 1 && i.sceneCheck && i.sceneCheck.productMatches !== false && i.sceneCheck.strayText !== true).length,
    failures: final.filter((i) => i.status === 'failed').map((i) => `#${i.index} ${i.angle.format}: ${i.error}`),
    dir,
    items: final.map(({ scene, renders, ...rest }) => ({
      ...rest,
      renders: renders.map((r) => r.imageUrl),
      ...(scene ? { scene: { width: scene.width, height: scene.height, model: scene.model, costUsd: scene.costUsd, productLocked: scene.productLocked } } : {}),
    })),
  }
  await writeFile(join(dir, 'pack.json'), JSON.stringify({ metrics: { ...m, items: undefined }, items: m.items, sceneLog, visionLog }, null, 2))
  return m
}

// ---------------------------------------------------------------------------
// Step D — contact sheets
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function contactSheet(m: PackMetrics): Promise<string> {
  const TW = 360
  const TH = 450
  const LABEL = 92
  const COLS = 5
  const GAP = 16
  const rows = Math.ceil(m.items.length / COLS)
  const W = COLS * TW + (COLS + 1) * GAP
  const H = 70 + rows * (TH + LABEL + GAP) + GAP
  const comps: OverlayOptions[] = []
  const labels: string[] = []
  for (const [k, it] of m.items.entries()) {
    const x = GAP + (k % COLS) * (TW + GAP)
    const y = 70 + Math.floor(k / COLS) * (TH + LABEL + GAP)
    const r45 = it.renders.find((u) => u.includes('render-4x5'))
    if (r45) {
      const buf = await sharp(new URL(r45).pathname.replace(/^\/([A-Za-z]:)/, '$1')).resize(TW, TH, { fit: 'cover' }).png().toBuffer()
      comps.push({ input: buf, left: x, top: y })
    } else {
      labels.push(`<rect x="${x}" y="${y}" width="${TW}" height="${TH}" fill="#ddd"/><text x="${x + 12}" y="${y + 30}" font-size="16" fill="#a00">FAILED</text><text x="${x + 12}" y="${y + 54}" font-size="12" fill="#333">${esc((it.error ?? '').slice(0, 52))}</text>`)
    }
    const sc = it.sceneCheck
    const line1 = `#${it.index} ${it.angle.format} · ${it.angle.hookType} · tries ${it.sceneAttempts ?? '-'}`
    const line2 = sc ? `product ${sc.productMatches} · text ${sc.strayText} · score ${sc.score.toFixed(2)}` : '-'
    const line3 = (it.copy?.headline ?? '').slice(0, 48)
    labels.push(
      `<text x="${x}" y="${y + TH + 22}" font-size="15" font-weight="bold" fill="#111">${esc(line1)}</text>` +
        `<text x="${x}" y="${y + TH + 44}" font-size="14" fill="#444">${esc(line2)}</text>` +
        `<text x="${x}" y="${y + TH + 66}" font-size="14" fill="#225">${esc(line3)}</text>`
    )
  }
  const title = `${m.offerId} · ${m.done}/${m.items.length} done · ${(m.wallMs / 1000).toFixed(0)} s · $${m.costUsd.toFixed(3)}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><style>text{font-family:Arial,Helvetica,sans-serif}</style><text x="${GAP}" y="44" font-size="28" font-weight="bold" fill="#111">${esc(title)}</text>${labels.join('')}</svg>`
  const file = join(OUT, `contact-${m.offerId}.png`)
  await sharp({ create: { width: W, height: H, channels: 3, background: '#f4f4f4' } })
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }, ...comps])
    .png()
    .toFile(file)
  return file
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(OUT, { recursive: true })
  const keys = loadKeys()
  baseGateway = createModelGateway({ env: keys })
  console.log(`[bench] out=${OUT} steps=${[...STEPS].join(',')} cap=$${CAP_USD} prior spend=$${priorSpend.toFixed(3)}`)
  const result: Record<string, unknown> = { out: OUT, startedAt: new Date().toISOString() }

  const packCases = PACK_OFFERS.map((id) => BENCHMARK_OFFERS.find((c) => c.id === id)).filter((c): c is BenchmarkCase => Boolean(c))
  let products: Record<string, string> = {}
  if (STEPS.has('A') || STEPS.has('C')) products = await stepProducts(packCases)

  if (STEPS.has('B')) result.copy = await stepCopy()

  const packs: PackMetrics[] = []
  if (STEPS.has('C')) {
    for (const c of packCases) {
      if (priorSpend + runSpend >= CAP_USD) {
        console.log('[C] cost cap reached, stopping')
        break
      }
      const m = await runOnePack(c, products[c.id])
      packs.push(m)
      if (STEPS.has('D')) console.log(`[D] contact sheet ${await contactSheet(m)}`)
    }
    result.packs = packs.map((p) => ({ ...p, items: undefined }))
  }

  const byStage: Record<string, number> = {}
  for (const e of runLedger) {
    const s = e.stage.startsWith('C_pack') ? `C_pack:${e.kind}` : `${e.stage}:${e.kind}`
    byStage[s] = Number(((byStage[s] ?? 0) + e.costUsd).toFixed(5))
  }
  result.costByStage = byStage
  result.runSpendUsd = Number(runSpend.toFixed(4))
  result.totalSpendUsd = Number((priorSpend + runSpend).toFixed(4))
  result.ledgerErrors = runLedger.filter((e) => !e.ok).map((e) => `${e.stage} ${e.kind}: ${e.error}`).slice(0, 50)
  await writeFile(join(OUT, 'bench.json'), JSON.stringify(result, null, 2))
  console.log(`[bench] run spend $${runSpend.toFixed(3)}; total $${(priorSpend + runSpend).toFixed(3)} / $${CAP_USD}`)
  console.log(`[bench] wrote ${join(OUT, 'bench.json')}`)
}

main().catch((error) => {
  console.error('[bench] failed', error instanceof Error ? error.message : error)
  persistSpend()
  process.exit(1)
})
