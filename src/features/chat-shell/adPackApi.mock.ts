/**
 * DEV-ONLY in-memory Ad Pack client for the `/dev/adpack-studio` QA harness and
 * component tests. Never imported from production code paths: the dev page
 * loads it with a dynamic import behind `import.meta.env.DEV`.
 *
 * Simulates: DNA ingest (gaps + Instagram-limited note + a price conflict),
 * confirm, angles, quote, start (incl. insufficient credits), progressive
 * status (planned → copy_ready → scene_ready → done over ~20 s, one item
 * failing), edit text (rejects an unconfirmed price), regenerate and cancel.
 */
import {
  AdPackApiError,
  type AdPackClient,
  type AdPackFactEdit,
  type AdPackItemView,
  type AdPackQuote,
  type AdPackStatusResponse,
} from './adPackApi'
import type {
  AdAngle,
  AdCopy,
  AspectRatio,
  BrandDna,
  DnaFact,
  FactKey,
  PackItemStatus,
  PackStatus,
  RenderedAd,
} from '../../../api/lib/adpack/types'

export interface MockAdPackOptions {
  /** Starting credit balance (default 500). */
  credits?: number
  /** Multiplies every simulated delay (default 1; tests use ~0.01). */
  timeScale?: number
  /** Index of the item that fails its scene step (default 3; -1 = none). */
  failIndex?: number
  /** Clock override for tests. */
  now?: () => number
}

const PER_AD = 6

const FORMATS: AdAngle['format'][] = ['offer_graphic', 'how_to_steps', 'ugc_person', 'handheld_overlay', 'explainer', 'variant_card', 'before_after']
const HOOKS: AdAngle['hookType'][] = ['pain', 'desire', 'social_proof', 'objection', 'price_value', 'routine', 'curiosity', 'comparison', 'identity', 'urgency_scarcity']
const ARCHETYPES: AdAngle['archetype'][] = ['venta_directa', 'desvalidar_alternativas', 'mostrar_servicio', 'paso_a_paso', 'variedad_productos']

const MESSAGES = [
  ['Café de altura, tostado esta semana', 'Personas que toman café a diario'],
  ['Prepará un pour-over perfecto en 3 pasos', 'Principiantes del café de especialidad'],
  ['“El mejor café que he probado en casa”', 'Clientes que confían en reseñas'],
  ['¿Caro? Sale a menos que un café de cafetería', 'Quien compara precio por taza'],
  ['Envío gratis en la GAM desde 2 bolsas', 'Compradores sensibles al envío'],
  ['Tu ritual de las 6 a.m., mejorado', 'Profesionales con rutina temprana'],
  ['Qué significa “tueste medio” y por qué importa', 'Curiosos del café'],
  ['Café de supermercado vs. café de finca', 'Quien toma café instantáneo'],
  ['Para quienes no negocian su primer café', 'Amantes del café'],
  ['Últimas bolsas del lote de cosecha', 'Compradores que dudan'],
  ['Regalá café de origen', 'Quien busca regalos'],
  ['Notas a chocolate y caramelo', 'Paladares dulces'],
]

const HEADLINES = [
  'Café recién tostado',
  'Tu pour-over en 3 pasos',
  'Reseñas 4.9 de 5',
  'Menos que tu café diario',
  'Envío gratis en la GAM',
  'El ritual de las 6 a.m.',
  '¿Qué es tueste medio?',
  'Finca vs. supermercado',
  'Primer café, sin negociar',
  'Últimas bolsas del lote',
  'Regalá café de origen',
  'Chocolate y caramelo',
]

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))
}

// ---------------------------------------------------------------------------
// Placeholder images (PNG via canvas in the browser; SVG data URL otherwise)
// ---------------------------------------------------------------------------

const SIZES: Record<AspectRatio, [number, number]> = { '1:1': [540, 540], '4:5': [540, 675], '9:16': [540, 960] }

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string))
}

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max && line) {
      lines.push(line)
      line = w
    } else {
      line = (line + ' ' + w).trim()
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 3)
}

export function placeholderImage(opts: { ratio: AspectRatio; hue: number; copy?: Pick<AdCopy, 'headline' | 'subline' | 'cta' | 'bullets' | 'offerLine'> }): string {
  const [w, h] = SIZES[opts.ratio]
  const { hue, copy } = opts
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  const ctx = canvas?.getContext?.('2d') ?? null
  if (canvas && ctx && typeof canvas.toDataURL === 'function') {
    canvas.width = w
    canvas.height = h
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, `hsl(${hue} 45% 28%)`)
    g.addColorStop(1, `hsl(${(hue + 40) % 360} 55% 14%)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    // "product": a bag silhouette
    ctx.fillStyle = `hsl(${(hue + 20) % 360} 30% 72%)`
    const bw = w * 0.34
    const bh = bw * 1.25
    const bx = w * 0.58
    const by = h - bh - h * 0.12
    ctx.beginPath()
    ctx.moveTo(bx, by + bh * 0.08)
    ctx.lineTo(bx + bw * 0.12, by)
    ctx.lineTo(bx + bw * 0.88, by)
    ctx.lineTo(bx + bw, by + bh * 0.08)
    ctx.lineTo(bx + bw, by + bh)
    ctx.lineTo(bx, by + bh)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = `hsl(${hue} 40% 22%)`
    ctx.fillRect(bx + bw * 0.18, by + bh * 0.38, bw * 0.64, bh * 0.22)
    if (copy) {
      ctx.fillStyle = '#ffffff'
      ctx.font = '800 44px Inter, system-ui, sans-serif'
      let y = h * 0.14
      for (const line of wrap(copy.headline, 18)) {
        ctx.fillText(line, 36, y)
        y += 52
      }
      if (copy.subline) {
        ctx.font = '500 22px Inter, system-ui, sans-serif'
        ctx.fillStyle = 'rgba(255,255,255,0.86)'
        for (const line of wrap(copy.subline, 34)) {
          ctx.fillText(line, 36, y + 4)
          y += 30
        }
      }
      ctx.font = '600 18px Inter, system-ui, sans-serif'
      y += 20
      for (const b of copy.bullets.slice(0, 3)) {
        const tw = ctx.measureText(b).width + 28
        ctx.fillStyle = 'rgba(255,255,255,0.16)'
        ctx.fillRect(36, y - 22, tw, 32)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(b, 50, y)
        y += 42
      }
      if (copy.offerLine) {
        ctx.font = '800 26px Inter, system-ui, sans-serif'
        ctx.fillStyle = '#ffd36b'
        ctx.fillText(copy.offerLine, 36, h - 120)
      }
      ctx.fillStyle = '#ffffff'
      const cw = ctx.measureText(copy.cta).width
      ctx.font = '800 22px Inter, system-ui, sans-serif'
      const ctaW = Math.max(160, cw + 56)
      ctx.fillRect(36, h - 86, ctaW, 50)
      ctx.fillStyle = `hsl(${hue} 50% 20%)`
      ctx.fillText(copy.cta, 36 + 24, h - 53)
    }
    return canvas.toDataURL('image/png')
  }
  const text = copy
    ? `<text x="36" y="${Math.round(h * 0.14)}" font-family="Inter,sans-serif" font-size="40" font-weight="800" fill="#fff">${escapeXml(copy.headline)}</text>
       <rect x="36" y="${h - 86}" width="200" height="50" fill="#fff"/><text x="60" y="${h - 53}" font-family="Inter,sans-serif" font-size="22" font-weight="800" fill="#222">${escapeXml(copy.cta)}</text>`
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,28%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},55%,14%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect x="${w * 0.58}" y="${h * 0.45}" width="${w * 0.34}" height="${w * 0.42}" fill="hsl(${(hue + 20) % 360},30%,72%)"/>${text}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// ---------------------------------------------------------------------------
// DNA
// ---------------------------------------------------------------------------

function mockDna(input: { brandName?: string; offerName?: string; websiteUrl?: string; instagramUrl?: string; uploads: number; productImageUrls: string[]; logoUrl?: string }): BrandDna {
  const fetchedAt = new Date().toISOString()
  const brandName = input.brandName?.trim() || 'Café Montaña'
  const facts: DnaFact[] = [
    { key: 'brand_name', value: brandName, source: 'website', confirmed: true },
    { key: 'offer_name', value: input.offerName?.trim() || 'Café de altura 340 g', source: 'website', confirmed: false },
    { key: 'price', value: '₡9.900', source: 'website', confirmed: false, evidence: 'Página de producto' },
    { key: 'shipping', value: 'Envío gratis en la GAM desde 2 bolsas', source: 'website', confirmed: false },
    { key: 'proof_review', value: '4.9★ en 212 reseñas de Google', source: 'instagram', confirmed: false },
    { key: 'ingredients_materials', value: '100% arábica, Tarrazú, tueste medio', source: 'website', confirmed: false },
    { key: 'payment_methods', value: 'SINPE Móvil o tarjeta', source: 'inferred', confirmed: false },
  ]
  const sources: BrandDna['sources'] = []
  if (input.websiteUrl) sources.push({ kind: 'website', url: input.websiteUrl, fetchedAt, ok: true })
  sources.push({
    kind: 'instagram',
    url: input.instagramUrl || 'https://instagram.com/cafemontana',
    fetchedAt,
    ok: true,
    note: 'Instagram limitado: solo se pudo leer la bio — subí capturas de tus posts para mejores resultados.',
  })
  if (input.uploads) sources.push({ kind: 'upload', fetchedAt, ok: true, note: `${input.uploads} archivo(s) analizados` })
  return {
    version: 1,
    brandName,
    category: 'food_beverage',
    language: 'es',
    register: 'voseo',
    oneLiner: 'Café de especialidad costarricense, tostado cada semana.',
    voice: 'Cálida, directa y orgullosa del origen; voseo costarricense.',
    audience: ['Profesionales 25–45 que toman café en casa', 'Regaladores de fin de año', 'Principiantes del café de especialidad'],
    pains: ['El café de supermercado sabe quemado', 'No saben preparar café de especialidad'],
    desires: ['Un ritual de mañana que se sienta premium'],
    objections: ['Es caro', '¿Llega fresco?'],
    customerPhrases: ['El mejor café que he probado en casa'],
    facts,
    visual: { primaryColor: '#5b3a29', accentColor: '#ffd36b', logoUrl: input.logoUrl },
    gaps: ['delivery_time', 'guarantee'],
    sources,
    productImageUrls: input.productImageUrls,
    notes: ['conflict:price: "₡9.900" (website) vs "₡8.900" (instagram)'],
  }
}

function applyEdits(dna: BrandDna, edits: AdPackFactEdit[]): BrandDna {
  let facts = dna.facts.map((f) => ({ ...f }))
  let gaps = [...dna.gaps]
  let notes = [...(dna.notes || [])]
  const settle = (key: FactKey) => {
    gaps = gaps.filter((g) => g !== key)
    notes = notes.filter((n) => !n.startsWith(`conflict:${key}:`))
  }
  for (const e of edits) {
    if (e.op === 'confirm') {
      facts = facts.map((f) => (f.key === e.key && (e.value === undefined || f.value === e.value) ? { ...f, confirmed: true } : f))
      settle(e.key)
    } else if (e.op === 'edit' || e.op === 'add') {
      facts = facts.filter((f) => f.key !== e.key || (e.op === 'edit' && e.previousValue !== undefined && f.value !== e.previousValue))
      facts.push({ key: e.key, value: e.value, source: 'user', confirmed: true })
      settle(e.key)
    } else if (e.op === 'remove') {
      facts = facts.filter((f) => !(f.key === e.key && (e.value === undefined || f.value === e.value)))
    }
  }
  return { ...dna, facts, gaps, notes }
}

function mockAngles(size: number): AdAngle[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `angle-${i + 1}`,
    archetype: ARCHETYPES[i % ARCHETYPES.length],
    hookType: HOOKS[i % HOOKS.length],
    format: FORMATS[i % FORMATS.length],
    message: MESSAGES[i % MESSAGES.length][0],
    target: MESSAGES[i % MESSAGES.length][1],
    factKeys: i % 3 === 0 ? ['price'] : ['ingredients_materials'],
  }))
}

// ---------------------------------------------------------------------------
// Pack simulation
// ---------------------------------------------------------------------------

interface SimItem {
  id: string
  index: number
  angle: AdAngle
  /** Absolute ms when each stage is reached. */
  t: { copy: number; scene: number; done: number }
  fails: boolean
  variant: number
  copy: AdCopy
  renders: RenderedAd[] | null
  sceneUrl?: string
  attempts: number
  charged: boolean
  editedAt?: number
}

interface SimPack {
  id: string
  ratios: AspectRatio[]
  size: number
  brandName: string
  confirmedPrice?: string
  cancelledAt?: number
  createdAt: string
  items: SimItem[]
}

function makeCopy(angle: AdAngle, index: number, variant: number, price?: string): AdCopy {
  const h = HEADLINES[(index + variant * 5) % HEADLINES.length]
  return {
    headline: variant ? `${h} ✦` : h,
    subline: 'Tarrazú, tueste medio, notas a chocolate',
    bullets: ['100% arábica', 'Tostado semanal', 'Envío gratis GAM'].slice(0, (index % 3) + 1),
    offerLine: angle.factKeys.includes('price') && price ? `${price} · 340 g` : undefined,
    cta: index % 2 ? 'Pedí el tuyo' : 'Comprar ahora',
    caption: `${angle.message}. Café de altura de Tarrazú, tostado cada semana y enviado fresco a tu casa. ${index % 2 ? 'Pedí el tuyo por DM.' : 'Comprá en el link de la bio.'}`,
    sceneBrief: 'Bolsa de café sobre mesa de madera con luz de mañana',
    usedFactKeys: angle.factKeys,
  }
}

function hueFor(index: number, variant: number): number {
  return (index * 37 + variant * 90 + 18) % 360
}

export function createMockAdPackApi(options: MockAdPackOptions = {}): AdPackClient & { setCredits(n: number): void; credits(): number } {
  const scale = options.timeScale ?? 1
  const now = options.now ?? (() => Date.now())
  const failIndex = options.failIndex ?? 3
  let credits = options.credits ?? 500
  const packs = new Map<string, SimPack>()
  const delay = (ms: number) => sleep(Math.max(0, Math.round(ms * scale)))

  const quoteFor = (size: number): AdPackQuote => ({ size, credits: size * PER_AD, perAd: PER_AD })

  const schedule = (from: number, slot: number): SimItem['t'] => {
    const copy = from + (1500 + slot * 1200) * scale
    const scene = copy + 3000 * scale
    return { copy, scene, done: scene + 2000 * scale }
  }

  const statusOf = (item: SimItem, pack: SimPack, at: number): PackItemStatus => {
    const clock = pack.cancelledAt !== undefined ? Math.min(at, pack.cancelledAt) : at
    if (clock < item.t.copy) return 'planned'
    if (clock < item.t.scene) return 'copy_ready'
    if (item.fails) return 'failed'
    if (clock < item.t.done) return 'scene_ready'
    return 'done'
  }

  const view = (item: SimItem, pack: SimPack, at: number): AdPackItemView => {
    const status = statusOf(item, pack, at)
    const hue = hueFor(item.index, item.variant)
    if (status === 'done' && !item.renders) {
      item.renders = pack.ratios.map((ratio) => ({ ratio, imageUrl: placeholderImage({ ratio, hue, copy: item.copy }), width: SIZES[ratio][0], height: SIZES[ratio][1] }))
    }
    if (status === 'done' && !item.charged) {
      item.charged = true
      credits -= PER_AD
    }
    return {
      id: item.id,
      index: item.index,
      status,
      format: item.angle.format,
      archetype: item.angle.archetype,
      hookType: item.angle.hookType,
      message: item.angle.message,
      headline: status === 'planned' ? undefined : item.copy.headline,
      copy: status === 'planned' ? undefined : item.copy,
      sceneUrl: status === 'scene_ready' || status === 'done' ? (item.sceneUrl ??= placeholderImage({ ratio: pack.ratios[0], hue })) : undefined,
      renders: status === 'done' ? item.renders ?? [] : [],
      attempts: item.attempts,
      charged: item.charged,
      error: status === 'failed' ? 'La escena no pasó el control de producto después de 2 intentos.' : undefined,
    }
  }

  const statusResponse = (pack: SimPack): AdPackStatusResponse => {
    const at = now()
    const items = pack.items.map((i) => view(i, pack, at))
    const counts = { planned: 0, copy_ready: 0, scene_ready: 0, rendered: 0, done: 0, failed: 0 } as Record<PackItemStatus, number>
    for (const i of items) counts[i.status] += 1
    const pending = items.length - counts.done - counts.failed
    let status: PackStatus
    if (pack.cancelledAt !== undefined) status = 'cancelled'
    else if (pending > 0) status = 'running'
    else if (counts.failed === 0) status = 'done'
    else if (counts.done === 0) status = 'failed'
    else status = 'partial'
    return {
      packId: pack.id,
      status,
      size: pack.size,
      ratios: pack.ratios,
      source: 'web',
      quotedCredits: pack.size * PER_AD,
      chargedCredits: items.filter((i) => i.charged).length * PER_AD,
      progress: { total: items.length, done: counts.done, failed: counts.failed, pending, counts },
      items,
      moreWork: status === 'running',
      leaseActive: false,
      language: 'es',
      summary: `${counts.done}/${items.length} listos${counts.failed ? ` · ${counts.failed} ${counts.failed === 1 ? 'falló' : 'fallaron'}` : ''}${status === 'running' ? '' : ' · pack terminado'}`,
      createdAt: pack.createdAt,
      updatedAt: new Date(at).toISOString(),
    }
  }

  const getPack = (packId: string): SimPack => {
    const pack = packs.get(packId)
    if (!pack) throw new AdPackApiError(404, { error: 'Pack not found', code: 'NOT_FOUND' })
    return pack
  }

  const getItem = (pack: SimPack, itemId: string): SimItem => {
    const item = pack.items.find((i) => i.id === itemId)
    if (!item) throw new AdPackApiError(404, { error: 'Ad not found', code: 'NOT_FOUND' })
    return item
  }

  return {
    credits: () => credits,
    setCredits(n: number) {
      credits = n
    },

    async ingestDna(body) {
      await delay(1600)
      const uploads = body.uploads ?? []
      const productImageUrls = [
        ...(body.offerForm?.productImageUrls ?? []),
        ...uploads.filter((u) => u.kind === 'product_photo' && u.url).map((u) => u.url as string),
      ]
      const logo = uploads.find((u) => u.kind === 'logo' && u.url)?.url
      let dna = mockDna({
        brandName: body.offerForm?.brandName,
        offerName: body.offerForm?.name,
        websiteUrl: body.websiteUrl,
        instagramUrl: body.instagramUrl,
        uploads: uploads.length,
        productImageUrls,
        logoUrl: logo,
      })
      if (body.userFacts?.length) dna = applyEdits(dna, body.userFacts.map((f) => ({ op: 'add', key: f.key, value: f.value })))
      return { dna, costUsd: 0.012, timingsMs: { website: 900, instagram: 400, total: 1600 } }
    },

    async confirm(body) {
      await delay(300)
      return { dna: applyEdits(body.dna, body.edits) }
    },

    async angles(body) {
      await delay(500)
      const size = Math.min(20, Math.max(1, Math.round(body.size ?? 10)))
      return { size, angles: mockAngles(size) }
    },

    async quote(body) {
      await delay(120)
      return quoteFor(Math.min(20, Math.max(1, Math.round(body.size ?? 10))))
    },

    async start(body) {
      await delay(500)
      const boardSize = Math.min(20, Math.max(1, Math.round(body.size ?? 10)))
      const keep = body.angleIds?.length ? new Set(body.angleIds) : null
      const angles = mockAngles(boardSize).filter((a) => !keep || keep.has(a.id))
      const size = angles.length
      const quote = quoteFor(size)
      if (credits < quote.credits) {
        throw new AdPackApiError(402, { error: 'Not enough AI credits for this pack', code: 'INSUFFICIENT_CREDITS', creditsRequired: quote.credits, remaining: credits })
      }
      const at = now()
      const price = body.dna?.facts.find((f) => f.key === 'price' && f.confirmed)?.value
      const pack: SimPack = {
        id: uuid(),
        ratios: body.ratios?.length ? body.ratios : ['1:1', '4:5', '9:16'],
        size,
        brandName: body.dna?.brandName ?? 'Marca',
        confirmedPrice: price,
        createdAt: new Date(at).toISOString(),
        items: angles.map((angle, index) => ({
          id: uuid(),
          index,
          angle,
          t: schedule(at, index),
          fails: index === failIndex,
          variant: 0,
          copy: makeCopy(angle, index, 0, price),
          renders: null,
          attempts: 1,
          charged: false,
        })),
      }
      packs.set(pack.id, pack)
      return { packId: pack.id, status: 'running', quote, existing: false }
    },

    async status(body) {
      await delay(250)
      return statusResponse(getPack(body.packId))
    },

    async editText(body) {
      await delay(400)
      const pack = getPack(body.packId)
      const item = getItem(pack, body.itemId)
      if (statusOf(item, pack, now()) !== 'done') {
        throw new AdPackApiError(409, { error: 'This ad is not rendered yet', code: 'NOT_READY' })
      }
      const texts = [body.copy.headline, body.copy.subline, body.copy.cta, body.copy.offerLine, ...(body.copy.bullets ?? [])].filter(Boolean) as string[]
      for (const text of texts) {
        const m = /(₡|\$|USD\s?)\s?\d[\d.,]*/i.exec(text)
        if (m && m[0].replace(/\s/g, '') !== (pack.confirmedPrice ?? '').replace(/\s/g, '')) {
          throw new AdPackApiError(422, {
            error: 'The edited text breaks the facts or length rules',
            code: 'COPY_REJECTED',
            issues: [{ code: 'unconfirmed_fact', field: body.copy.headline && text === body.copy.headline ? 'headline' : 'subline', detail: `Price "${m[0]}" is not a confirmed fact` }],
          })
        }
      }
      if (body.copy.headline !== undefined && body.copy.headline.split(/\s+/).length > 8) {
        throw new AdPackApiError(422, {
          error: 'The edited text breaks the facts or length rules',
          code: 'COPY_REJECTED',
          issues: [{ code: 'too_long', field: 'headline', detail: 'Headline has more than 8 words' }],
        })
      }
      item.copy = { ...item.copy, ...body.copy, bullets: body.copy.bullets ?? item.copy.bullets }
      const hue = hueFor(item.index, item.variant)
      item.renders = pack.ratios.map((ratio) => ({ ratio, imageUrl: placeholderImage({ ratio, hue, copy: item.copy }), width: SIZES[ratio][0], height: SIZES[ratio][1] }))
      item.editedAt = now()
      return { item: view(item, pack, now()) }
    },

    async regenerate(body) {
      await delay(400)
      const pack = getPack(body.packId)
      if (pack.cancelledAt !== undefined) throw new AdPackApiError(409, { error: 'Pack was cancelled', code: 'NOT_READY' })
      const item = getItem(pack, body.itemId)
      const st = statusOf(item, pack, now())
      if (st !== 'done' && st !== 'failed') throw new AdPackApiError(409, { error: 'This ad is still being generated', code: 'BUSY' })
      if (credits < PER_AD) {
        throw new AdPackApiError(402, { error: 'Not enough AI credits', code: 'INSUFFICIENT_CREDITS', creditsRequired: PER_AD, remaining: credits })
      }
      const at = now()
      item.variant += 1
      item.attempts += 1
      item.fails = false
      item.charged = false
      item.renders = null
      item.sceneUrl = undefined
      if (body.mode === 'copy') {
        item.copy = makeCopy(item.angle, item.index, item.variant, pack.confirmedPrice)
        item.t = schedule(at, 0)
      } else {
        // Keep copy: jump straight to the scene stage.
        item.t = { copy: at, scene: at + 2500 * scale, done: at + 4500 * scale }
      }
      return { item: view(item, pack, at), quote: quoteFor(1) }
    },

    async cancel(body) {
      await delay(200)
      const pack = getPack(body.packId)
      const st = statusResponse(pack).status
      if (st === 'running' || st === 'planned') pack.cancelledAt = now()
      return { packId: pack.id, status: pack.cancelledAt !== undefined ? 'cancelled' : st }
    },
  }
}
