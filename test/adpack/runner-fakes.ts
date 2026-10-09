import sharp from 'sharp'
import { fitBox } from '../../api/lib/adpack/fidelity/composite'
import type { AdPackStorage, ChargeFn, Renderer, RenderInput, RenderOutput, UploadInput } from '../../api/lib/adpack/runner-types'
import { adpackAssetPath } from '../../api/lib/adpack/storage'
import type { AspectRatio, ModelGateway } from '../../api/lib/adpack/types'
import { angleIndexFromPrompt, goodSerumCopy } from './helpers'

/** 1×1 PNG. */
export const PNG_1X1 = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
)
export const PRODUCT_REF = `data:image/png;base64,${Buffer.from(PNG_1X1).toString('base64')}`

const HEADLINES = [
  '¿Poros que se notan en fotos?',
  'Brillo en zona T, controlado',
  'Rutina nocturna de dos gotas',
  'Textura pareja sin pegajoso',
  'Sérums que no notaste',
  'Piel mixta, fórmula ligera',
  'Aloe con niacinamida',
  'Tu noche, tu cuidado',
  'Dos frascos, mejor precio',
  'Absorción rapidísima',
]
const SUBLINES = [
  'Niacinamida 5% para fotos de cerca',
  'Control del brillo hasta la tarde',
  'Antes de dormir, sobre piel limpia',
  'Suavidad que se siente al tacto',
  'Fórmula distinta a lo que probaste',
  'Ligera para piel mixta',
  'Aloe vera que calma',
  'Un paso que no cuesta cumplir',
  'Pareja de frascos para compartir',
  'Cero residuo en la almohada',
]
const CAPTION_OPENERS = [
  'Las fotos de cerca delatan los poros abiertos.',
  'A media tarde la frente ya brilla.',
  'Una rutina que cabe antes de dormir.',
  'Querés sentir la cara suave al tacto.',
  'Probaste otros frascos sin ver cambios.',
  'Tu piel mixta pide algo liviano.',
  'El aloe calma mientras trabajás de noche.',
  'Cuidarte no tiene que tomar horas.',
  'Llevate pareja y ahorrás.',
  'Se absorbe enseguida, cero residuo.',
]
/** One distinctive prop word per ad (appears in its scene prompt). */
export const PROPS = ['kiwi', 'mango', 'papaya', 'lychee', 'guava', 'quince', 'fig', 'plum', 'pomelo', 'cherry']

export function propFor(index: number): string {
  return PROPS[index % PROPS.length]
}

/** Plan position of the angle in a copy prompt (catalog ids are `<category>-<hook>-<format>`). */
function angleIndex(user: string): number {
  return angleIndexFromPrompt(user)
}

/** Serum copy, distinct per angle; passes the deterministic checker. */
export function serumCopyFor(user: string) {
  const i = angleIndex(user) % HEADLINES.length
  return {
    ...goodSerumCopy(),
    headline: HEADLINES[i],
    subline: SUBLINES[i],
    caption: `${CAPTION_OPENERS[i]} Con aloe vera, sin sensación pegajosa. Envíos a todo Costa Rica por Correos. Escribinos y pedí el tuyo.${
      user.includes('FORMATO: before_after') ? ' Resultados pueden variar.' : ''
    }`,
    sceneBrief: `Amber dropper bottle on wet stone beside a ${propFor(i)}, soft light, empty space at the top.`,
  }
}

export interface SceneCall {
  prompt: string
  refs: string[]
  styleRefs: string[]
  ratio: AspectRatio
  draft: boolean
  startedAt: number
  endedAt?: number
}

export interface RunnerGateway extends ModelGateway {
  jsonCalls: Array<{ system: string; user: string }>
  visionCalls: Array<{ images: string[] }>
  sceneCalls: SceneCall[]
  totalCalls(): number
}

export interface RunnerGatewayOptions {
  delayMs?: number
  /** Throw for scene prompts matching this predicate. */
  sceneFails?: (prompt: string) => boolean
  /** Vision verdict per call (default: matches, no text). */
  vision?: (callIndex: number, images: string[]) => Record<string, unknown>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function runnerGateway(options: RunnerGatewayOptions = {}): RunnerGateway {
  const delay = options.delayMs ?? 0
  const gw: RunnerGateway = {
    jsonCalls: [],
    visionCalls: [],
    sceneCalls: [],
    totalCalls: () => gw.jsonCalls.length + gw.visionCalls.length + gw.sceneCalls.length,
    async json<T>(input: { system: string; user: string; model?: string }) {
      gw.jsonCalls.push({ system: input.system, user: input.user })
      if (delay) await sleep(delay)
      return { data: serumCopyFor(input.user) as T, costUsd: 0.001, model: 'fake-text' }
    },
    async visionJson<T>(input: { images: string[] }) {
      const index = gw.visionCalls.length
      gw.visionCalls.push({ images: input.images })
      if (delay) await sleep(delay)
      const data = options.vision?.(index, input.images) ?? { productMatches: input.images.length > 1 ? true : null, strayText: false, headlineSpace: true, score: 0.9 }
      return { data: data as T, costUsd: 0.0005, model: 'fake-vision' }
    },
    async scene(input) {
      const call: SceneCall = { prompt: input.prompt, refs: input.refs, styleRefs: input.styleRefs ?? [], ratio: input.ratio, draft: input.draft, startedAt: Date.now() }
      gw.sceneCalls.push(call)
      if (delay) await sleep(delay)
      call.endedAt = Date.now()
      if (options.sceneFails?.(input.prompt)) throw new Error('fake scene failure')
      return { bytes: PNG_1X1, mimeType: 'image/png', costUsd: 0.02, model: 'fake-image', productLocked: input.refs.length > 0 }
    },
  }
  return gw
}

const RATIO_SIZE: Record<AspectRatio, [number, number]> = { '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920], '16:9': [1920, 1080] }

/** Synthetic studio product photo: a teal "bottle" with a cap and a label band on white. */
let photoCache: Promise<Uint8Array> | null = null
export function syntheticProductPhoto(): Promise<Uint8Array> {
  photoCache ??= (async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">' +
      '<rect width="600" height="800" fill="#ffffff"/>' +
      '<rect x="210" y="120" width="180" height="90" rx="16" fill="#1f2937"/>' +
      '<rect x="170" y="200" width="260" height="480" rx="40" fill="#0f766e"/>' +
      '<rect x="170" y="380" width="260" height="120" fill="#f59e0b"/>' +
      '<circle cx="300" cy="300" r="40" fill="#e0f2f1"/>' +
      '</svg>'
    return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer())
  })()
  return photoCache
}

/** No-network image loader: every product photo URL resolves to the synthetic photo (cut-out URLs too). */
export function fakeImageLoader(overrides: Record<string, () => Promise<Uint8Array>> = {}): ((url: string) => Promise<Uint8Array>) & { calls: string[] } {
  const calls: string[] = []
  const fn = (async (url: string) => {
    calls.push(url)
    const o = overrides[url]
    if (o) return o()
    if (url.startsWith('data:')) return new Uint8Array(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
    return syntheticProductPhoto()
  }) as ((url: string) => Promise<Uint8Array>) & { calls: string[] }
  fn.calls = calls
  return fn
}

async function toBytes(v: Uint8Array | string): Promise<Buffer> {
  if (typeof v !== 'string') return Buffer.from(v)
  if (v.startsWith('data:')) return Buffer.from(v.slice(v.indexOf(',') + 1), 'base64')
  return Buffer.from(await syntheticProductPhoto())
}

/**
 * Fake renderer. Exact mode: pastes the cut-out unchanged on a small gray canvas and reports the
 * placement (so the runner's fidelity score is real); `alter` corrupts the product pixels.
 */
export function fakeRenderer(options: { alter?: boolean } = {}): Renderer & { calls: RenderInput[] } {
  const calls: RenderInput[] = []
  return {
    calls,
    async render(input): Promise<RenderOutput> {
      calls.push(input)
      const [width, height] = RATIO_SIZE[input.ratio]
      if (input.productMode !== 'exact' || !input.productCutout) return { png: PNG_1X1, width, height }
      const W = Math.round(width / 4)
      const H = Math.round(height / 4)
      const cut = await toBytes(input.productCutout)
      const meta = await sharp(cut).metadata()
      const box = fitBox({ width: meta.width ?? 1, height: meta.height ?? 1 }, { x: Math.round(W * 0.5), y: Math.round(H * 0.3), w: Math.round(W * 0.42), h: Math.round(H * 0.6) }, 'bottom')
      const placed = await sharp(cut).ensureAlpha().resize(box.w, box.h, { fit: 'fill' }).png().toBuffer()
      let layer = placed
      if (options.alter) layer = await sharp(placed).modulate({ hue: 160, saturation: 2 }).negate({ alpha: false }).png().toBuffer()
      const png = await sharp({ create: { width: W, height: H, channels: 3, background: '#d6d3d1' } })
        .composite([{ input: layer, left: box.x, top: box.y }])
        .png()
        .toBuffer()
      return { png: new Uint8Array(png), width, height, productPlacements: [{ box, placed: new Uint8Array(placed), role: 'hero' }] }
    },
  }
}

export function fakeStorage(): AdPackStorage & { uploads: UploadInput[] } {
  const uploads: UploadInput[] = []
  let n = 0
  return {
    uploads,
    async upload(input) {
      uploads.push(input)
      return { url: `https://storage.test/${adpackAssetPath(input, `id${++n}`)}` }
    },
  }
}

export function fakeCharge(delayMs = 0): ChargeFn & { counts: Map<string, number>; total(): number } {
  const counts = new Map<string, number>()
  const fn = (async ({ generationId }: { userId: string; generationId: string }) => {
    if (delayMs) await sleep(delayMs)
    counts.set(generationId, (counts.get(generationId) ?? 0) + 1)
    return { charged: true }
  }) as ChargeFn & { counts: Map<string, number>; total(): number }
  fn.counts = counts
  fn.total = () => [...counts.values()].reduce((s, v) => s + v, 0)
  return fn
}
