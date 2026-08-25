import { GROK_TEXT_MODEL_EFFICIENT } from '../grok-models.js'
import { safeJsonParse } from '../guiones/utils.js'
import {
  BULK_COUNT_DEFAULT,
  BULK_COUNT_MAX,
  BULK_COUNT_MIN,
  type AngleBoard,
  type AngleBoardItem,
  type BulkLanguage,
  type BulkOrchestratorInput,
} from './types.js'

export type AngleOrchestratorDeps = {
  fetchFn?: typeof fetch
  apiKey?: string | null
  model?: string
}

const FALLBACK_NICHES = [
  { niche: 'nightlife', why: 'wants a visible glow-up before going out', hook: 'night_reveal', framework: 'venta_directa' },
  { niche: 'creators', why: 'needs camera-ready confidence on a schedule', hook: 'on_camera_proof', framework: 'storytelling' },
  { niche: 'gym', why: 'trains hard and wants posture or appearance to match effort', hook: 'performance_gap', framework: 'desvalidar_alternativas' },
  { niche: 'nurses', why: 'long shifts punish the body; wants relief that survives a 12-hour day', hook: 'shift_survival', framework: 'educativo' },
  { niche: 'office', why: 'sits all day and feels the cost by 4pm', hook: 'hidden_desk_cost', framework: 'paso_a_paso' },
  { niche: 'parents', why: 'needs something that works between school runs', hook: 'time_poor_proof', framework: 'venta_directa' },
  { niche: 'students', why: 'budget-aware and social-proof driven', hook: 'peer_check', framework: 'engagement' },
  { niche: 'travelers', why: 'wants a compact ritual that survives a suitcase', hook: 'packable_ritual', framework: 'mostrar_servicio' },
  { niche: 'remote workers', why: 'video calls make small details feel public', hook: 'call_closeup', framework: 'reconocimiento' },
  { niche: 'seniors', why: 'wants comfort and dignity without a medical vibe', hook: 'dignity_first', framework: 'educativo' },
  { niche: 'athletes', why: 'recovery and appearance are part of the identity', hook: 'recovery_edge', framework: 'desvalidar_alternativas' },
  { niche: 'retail staff', why: 'on their feet and in front of people all day', hook: 'floor_shift', framework: 'storytelling' },
  { niche: 'drivers', why: 'hours seated; wants something that works in the cab', hook: 'cab_reality', framework: 'paso_a_paso' },
  { niche: 'wedding guests', why: 'one event, high photo density, no time to experiment', hook: 'event_countdown', framework: 'venta_directa' },
  { niche: 'first dates', why: 'wants a low-risk confidence boost tonight', hook: 'tonight_only', framework: 'tendencia' },
  { niche: 'new managers', why: 'presence matters more than they expected', hook: 'room_read', framework: 'reconocimiento' },
  { niche: 'night-shift workers', why: 'schedule wrecks routines; needs a simple system', hook: 'graveyard_system', framework: 'educativo' },
  { niche: 'freelancers', why: 'looks like the brand; every meeting is a pitch', hook: 'personal_brand', framework: 'storytelling' },
  { niche: 'caregivers', why: 'puts others first and needs something that does not add work', hook: 'one_less_task', framework: 'engagement' },
  { niche: 'host-city locals', why: 'wants the local edge without tourist gimmicks', hook: 'local_insider', framework: 'tendencia' },
  { niche: 'gym-to-office', why: 'commutes between two worlds and needs both to work', hook: 'two_life_bridge', framework: 'variedad_productos' },
  { niche: 'content teams', why: 'shoots weekly and cannot look like last week', hook: 'batch_day', framework: 'mostrar_servicio' },
  { niche: 'hospitality', why: 'faces guests all night; wants polish that lasts', hook: 'closing_shift', framework: 'venta_directa' },
  { niche: 'commuters', why: 'dead time on the ride is the only ritual window', hook: 'ride_ritual', framework: 'paso_a_paso' },
  { niche: 'weekend hosts', why: 'wants the house and the look to feel intentional', hook: 'guest_ready', framework: 'storytelling' },
] as const

export function clampBulkCount(value: unknown, fallback = BULK_COUNT_DEFAULT): number {
  if (value == null || value === '') return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(BULK_COUNT_MAX, Math.max(BULK_COUNT_MIN, Math.round(n)))
}

export function normalizeAngle(raw: Partial<AngleBoardItem> | null | undefined, index: number): AngleBoardItem {
  const fallback = FALLBACK_NICHES[index % FALLBACK_NICHES.length]
  const title = typeof raw?.title === 'string' && raw.title.trim()
    ? raw.title.trim()
    : `${fallback.niche} angle`
  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `angle_${index + 1}`,
    title: title.slice(0, 120),
    niche: (typeof raw?.niche === 'string' && raw.niche.trim() ? raw.niche.trim() : fallback.niche).slice(0, 80),
    whyItBuys: (typeof raw?.whyItBuys === 'string' && raw.whyItBuys.trim()
      ? raw.whyItBuys.trim()
      : fallback.why).slice(0, 280),
    hookStyle: (typeof raw?.hookStyle === 'string' && raw.hookStyle.trim()
      ? raw.hookStyle.trim()
      : fallback.hook).slice(0, 80),
    frameworkHint: (typeof raw?.frameworkHint === 'string' && raw.frameworkHint.trim()
      ? raw.frameworkHint.trim()
      : fallback.framework).slice(0, 80),
  }
}

function asAngleList(parsed: unknown): Partial<AngleBoardItem>[] {
  if (Array.isArray(parsed)) return parsed as Partial<AngleBoardItem>[]
  if (!parsed || typeof parsed !== 'object') return []
  const rec = parsed as Record<string, unknown>
  if (Array.isArray(rec.angles)) return rec.angles as Partial<AngleBoardItem>[]
  if (Array.isArray(rec.candidates)) return rec.candidates as Partial<AngleBoardItem>[]
  if (Array.isArray(rec.board)) return rec.board as Partial<AngleBoardItem>[]
  return []
}

export function parseAngleBoard(raw: unknown, count: number): AngleBoardItem[] {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')
  const parsed = typeof raw === 'string' ? safeJsonParse<unknown>(text) : raw
  const list = asAngleList(parsed)
  if (!list.length) return []
  const seen = new Set<string>()
  const out: AngleBoardItem[] = []
  for (let i = 0; i < list.length && out.length < count; i += 1) {
    const angle = normalizeAngle(list[i], i)
    const key = `${angle.niche.toLowerCase()}|${angle.hookStyle.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(angle)
  }
  return out
}

export function fallbackAngleBoard(input: BulkOrchestratorInput, count: number): AngleBoardItem[] {
  const offer = (input.offerName || 'offer').trim()
  const brand = (input.brandName || 'brand').trim()
  return Array.from({ length: count }, (_, index) => {
    const seed = FALLBACK_NICHES[index % FALLBACK_NICHES.length]
    return normalizeAngle({
      id: `angle_${index + 1}`,
      title: `${offer} for ${seed.niche}`,
      niche: seed.niche,
      whyItBuys: `${seed.why} — ${brand}`,
      hookStyle: seed.hook,
      frameworkHint: seed.framework,
    }, index)
  })
}

export function buildOrchestratorSystemPrompt(language: BulkLanguage): string {
  const isEs = language === 'es'
  return isEs
    ? [
        'Eres un estratega de demanda, no un copywriter de variaciones.',
        'Tu trabajo es un TABLERO DE ÁNGULOS: nichos de comprador distintos, cada uno con una razón distinta de compra.',
        'PROHIBIDO: el mismo anuncio con otras palabras, el mismo gancho con otro adjetivo, o “versión A/B” del mismo ICP.',
        'Ejemplos correctos: blanqueamiento → nightlife vs creators; arnés de postura → gym vs enfermeras vs oficina.',
        'Cada ángulo debe cambiar nicho, por qué compra, estilo de gancho y framework.',
        'No inventes claims médicos, precios ni resultados. Responde SOLO JSON {"angles":[...]}.',
      ].join(' ')
    : [
        'You are a demand strategist, not a copywriter of variations.',
        'Output an ANGLE BOARD: distinct buyer niches, each with a different reason to buy.',
        'FORBIDDEN: the same ad in different words, the same hook with a new adjective, or A/B versions of one ICP.',
        'Correct examples: teeth whitening → nightlife vs creators; posture harness → gym vs nurses vs office.',
        'Each angle must change niche, whyItBuys, hookStyle, and frameworkHint.',
        'Do not invent medical claims, prices, or outcomes. Return ONLY JSON {"angles":[...]}.',
      ].join(' ')
}

export function buildOrchestratorUserPrompt(input: BulkOrchestratorInput, count: number): string {
  const language = input.language === 'en' ? 'en' : 'es'
  const isEs = language === 'es'
  const recent = (input.recentSummaries || []).filter(Boolean).slice(0, 8)
  return [
    isEs ? `Crea ${count} ángulos de comprador para:` : `Create ${count} buyer angles for:`,
    `Brand: ${input.brandName}`,
    `Offer: ${input.offerName}${input.offerType ? ` (${input.offerType})` : ''}`,
    input.offerDescription ? `Offer facts: ${input.offerDescription}` : '',
    input.brandIcp ? `ICP: ${input.brandIcp}` : '',
    input.audience ? `Audience notes: ${input.audience}` : '',
    input.brandVoice ? `Voice: ${input.brandVoice}` : '',
    recent.length
      ? (isEs
        ? `Evita casi-duplicados de estos guiones recientes (resumen):\n- ${recent.join('\n- ')}`
        : `Avoid near-duplicates of these recent scripts (summaries):\n- ${recent.join('\n- ')}`)
      : '',
    isEs
      ? 'Cada ángulo = un nicho distinto (no un tono distinto). title, niche, whyItBuys, hookStyle, frameworkHint.'
      : 'Each angle = a different niche (not a different tone). title, niche, whyItBuys, hookStyle, frameworkHint.',
    'JSON: {"angles":[{"id":"angle_1","title":"...","niche":"...","whyItBuys":"...","hookStyle":"...","frameworkHint":"venta_directa|storytelling|educativo|..."}]}',
  ].filter(Boolean).join('\n')
}

async function callGrokAngles(options: {
  fetchFn: typeof fetch
  apiKey: string
  model: string
  system: string
  user: string
}): Promise<string> {
  const response = await options.fetchFn('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
      ],
      temperature: 0.7,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
  })
  if (!response.ok) {
    throw new Error(`Grok angle orchestrator failed: ${response.status}`)
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content || ''
}

export async function orchestrateAngles(
  input: BulkOrchestratorInput,
  deps: AngleOrchestratorDeps = {}
): Promise<AngleBoard> {
  const count = clampBulkCount(input.count)
  const language: BulkLanguage = input.language === 'en' ? 'en' : 'es'
  const recent = (input.recentSummaries || []).filter(Boolean)
  const fill = (angles: AngleBoardItem[], source: AngleBoard['source']): AngleBoard => {
    const padded = angles.length >= count
      ? angles.slice(0, count)
      : [...angles, ...fallbackAngleBoard(input, count - angles.length).map((item, i) => ({
          ...item,
          id: `angle_${angles.length + i + 1}`,
        }))]
    return {
      angles: padded.slice(0, count),
      count,
      source,
      avoidedNearDuplicates: recent.length > 0,
    }
  }

  const apiKey = deps.apiKey ?? process.env.XAI_API_KEY ?? process.env.GROK_API_KEY ?? ''
  const fetchFn = deps.fetchFn ?? fetch
  if (!apiKey) {
    return fill(fallbackAngleBoard(input, count), 'fallback')
  }

  try {
    const text = await callGrokAngles({
      fetchFn,
      apiKey,
      model: deps.model || GROK_TEXT_MODEL_EFFICIENT,
      system: buildOrchestratorSystemPrompt(language),
      user: buildOrchestratorUserPrompt({ ...input, language, recentSummaries: recent }, count),
    })
    const parsed = parseAngleBoard(text, count)
    if (!parsed.length) return fill(fallbackAngleBoard(input, count), 'fallback')
    return fill(parsed, 'model')
  } catch {
    return fill(fallbackAngleBoard(input, count), 'fallback')
  }
}

export function pickAngles(
  board: AngleBoardItem[],
  selectedIds?: string[] | null,
  count = board.length
): AngleBoardItem[] {
  const limit = clampBulkCount(count, board.length || BULK_COUNT_DEFAULT)
  if (selectedIds && selectedIds.length) {
    const wanted = new Set(selectedIds)
    const picked = board.filter((angle) => wanted.has(angle.id))
    return (picked.length ? picked : board).slice(0, limit)
  }
  return board.slice(0, limit)
}
