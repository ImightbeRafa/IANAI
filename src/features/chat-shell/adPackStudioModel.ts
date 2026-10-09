/**
 * Ad Pack studio — pure helpers (labels, fact edits, polling rules, copy errors).
 * No React, no network: unit-testable and shared by the studio + the dev mock.
 */
import type {
  AdPackCopyPatch,
  AdPackFactEdit,
  AdPackItemView,
  AdPackStatusResponse,
  AdPackUploadKind,
} from './adPackApi'
import type {
  AdAngle,
  AspectRatio,
  BrandDna,
  BusinessCategory,
  CopyCheckIssue,
  DnaFact,
  FactKey,
  FactSource,
  PackStatus,
} from '../../../api/lib/adpack/types'
import type { ChatShellLanguage } from './chatShellLabels'

export const ADPACK_MIN_SIZE = 4
export const ADPACK_MAX_SIZE = 20
export const ADPACK_DEFAULT_SIZE = 10
export const ADPACK_RATIOS: AspectRatio[] = ['1:1', '4:5', '9:16']
/** Feed + story preselected (same default as the server); 1:1 stays one click away. */
export const ADPACK_DEFAULT_RATIOS: AspectRatio[] = ['4:5', '9:16']
export const ADPACK_MAX_UPLOADS = 12
export const ADPACK_POLL_MS = 2500
export const ADPACK_POLL_MAX_BACKOFF_MS = 20_000

type L = ChatShellLanguage

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const FACT_LABELS: Record<string, { es: string; en: string }> = {
  brand_name: { es: 'Marca', en: 'Brand' },
  offer_name: { es: 'Oferta', en: 'Offer' },
  price: { es: 'Precio', en: 'Price' },
  compare_at_price: { es: 'Precio anterior', en: 'Compare-at price' },
  bundle: { es: 'Combo / bundle', en: 'Bundle' },
  shipping: { es: 'Envío', en: 'Shipping' },
  delivery_time: { es: 'Tiempo de entrega', en: 'Delivery time' },
  payment_methods: { es: 'Métodos de pago', en: 'Payment methods' },
  guarantee: { es: 'Garantía', en: 'Guarantee' },
  returns: { es: 'Devoluciones', en: 'Returns' },
  ingredients_materials: { es: 'Ingredientes / materiales', en: 'Ingredients / materials' },
  how_it_works: { es: 'Cómo funciona', en: 'How it works' },
  usage_steps: { es: 'Modo de uso', en: 'Usage steps' },
  variants: { es: 'Variantes', en: 'Variants' },
  quantity_per_pack: { es: 'Cantidad por paquete', en: 'Quantity per pack' },
  proof_review: { es: 'Reseña', en: 'Review' },
  proof_number: { es: 'Dato de prueba', en: 'Proof number' },
  certification: { es: 'Certificación', en: 'Certification' },
  location: { es: 'Ubicación', en: 'Location' },
  contact_channel: { es: 'Canal de contacto', en: 'Contact channel' },
  differentiator: { es: 'Diferenciador', en: 'Differentiator' },
  result_claim: { es: 'Resultado prometido', en: 'Result claim' },
}

export function factLabel(key: FactKey | string, language: L): string {
  const known = FACT_LABELS[key]
  if (known) return known[language]
  if (key.startsWith('custom:')) {
    const slug = key.slice(7).replace(/[-_]+/g, ' ').trim()
    return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : key
  }
  // `price#alt` style alternates from conflicts.
  const base = key.split('#')[0]
  if (base !== key && FACT_LABELS[base]) return `${FACT_LABELS[base][language]} (alt)`
  return key
}

const SOURCE_LABELS: Record<FactSource, { es: string; en: string }> = {
  website: { es: 'Sitio web', en: 'Website' },
  instagram: { es: 'Instagram', en: 'Instagram' },
  upload: { es: 'Archivo', en: 'Upload' },
  user: { es: 'Vos', en: 'You' },
  offer_form: { es: 'Oferta', en: 'Offer' },
  inferred: { es: 'Inferido', en: 'Inferred' },
}

export function sourceLabel(source: FactSource | string, language: L): string {
  const known = SOURCE_LABELS[source as FactSource]
  return known ? known[language] : source
}

const CATEGORY_LABELS: Record<BusinessCategory, { es: string; en: string }> = {
  beauty: { es: 'Belleza', en: 'Beauty' },
  health_wellness: { es: 'Salud y bienestar', en: 'Health & wellness' },
  food_beverage: { es: 'Comida y bebida', en: 'Food & beverage' },
  fashion_apparel: { es: 'Moda', en: 'Fashion' },
  home_garden: { es: 'Hogar y jardín', en: 'Home & garden' },
  tech_electronics: { es: 'Tecnología', en: 'Tech' },
  fitness_sports: { es: 'Fitness y deporte', en: 'Fitness & sports' },
  pets: { es: 'Mascotas', en: 'Pets' },
  kids_baby: { es: 'Niños y bebés', en: 'Kids & baby' },
  services_local: { es: 'Servicios locales', en: 'Local services' },
  education: { es: 'Educación', en: 'Education' },
  finance: { es: 'Finanzas', en: 'Finance' },
  other: { es: 'Otra', en: 'Other' },
}

export function categoryLabel(category: BusinessCategory | string, language: L): string {
  const known = CATEGORY_LABELS[category as BusinessCategory]
  return known ? known[language] : category
}

const FORMAT_LABELS: Record<AdAngle['format'], { es: string; en: string; glyph: string }> = {
  offer_graphic: { es: 'Oferta', en: 'Offer graphic', glyph: '◆' },
  before_after: { es: 'Antes / después', en: 'Before / after', glyph: '◐' },
  how_to_steps: { es: 'Paso a paso', en: 'How-to steps', glyph: '☰' },
  variant_card: { es: 'Variante', en: 'Variant card', glyph: '▣' },
  ugc_person: { es: 'UGC', en: 'UGC', glyph: '◉' },
  handheld_overlay: { es: 'En mano', en: 'Handheld', glyph: '✋' },
  explainer: { es: 'Explicativo', en: 'Explainer', glyph: 'ⓘ' },
}

export function formatLabel(format: AdAngle['format'], language: L): string {
  return FORMAT_LABELS[format]?.[language] ?? format
}

export function formatGlyph(format: AdAngle['format']): string {
  return FORMAT_LABELS[format]?.glyph ?? '◆'
}

const HOOK_LABELS: Record<AdAngle['hookType'], { es: string; en: string }> = {
  pain: { es: 'Dolor', en: 'Pain' },
  desire: { es: 'Deseo', en: 'Desire' },
  objection: { es: 'Objeción', en: 'Objection' },
  social_proof: { es: 'Prueba social', en: 'Social proof' },
  comparison: { es: 'Comparación', en: 'Comparison' },
  price_value: { es: 'Precio / valor', en: 'Price / value' },
  urgency_scarcity: { es: 'Urgencia', en: 'Urgency' },
  curiosity: { es: 'Curiosidad', en: 'Curiosity' },
  routine: { es: 'Rutina', en: 'Routine' },
  identity: { es: 'Identidad', en: 'Identity' },
}

export function hookLabel(hook: AdAngle['hookType'], language: L): string {
  return HOOK_LABELS[hook]?.[language] ?? hook
}

export function uploadKindLabel(kind: AdPackUploadKind, language: L): string {
  const es = language === 'es'
  switch (kind) {
    case 'product_photo':
      return es ? 'Producto' : 'Product'
    case 'logo':
      return 'Logo'
    case 'review_screenshot':
      return es ? 'Captura' : 'Screenshot'
    case 'reference_ad':
      return es ? 'Referencia' : 'Reference'
    default:
      return es ? 'Documento' : 'Document'
  }
}

// ---------------------------------------------------------------------------
// DNA facts — local editable rows → confirm edits
// ---------------------------------------------------------------------------

export interface FactRow {
  /** Stable row id (index-based at ingest time). */
  id: string
  key: FactKey
  /** Value as ingested (what the server knows). */
  originalValue: string
  value: string
  source: FactSource
  confirmed: boolean
  evidence?: string
}

export function factRowsFromDna(dna: BrandDna): FactRow[] {
  return dna.facts.map((fact, index) => ({
    id: `${fact.key}:${index}`,
    key: fact.key,
    originalValue: fact.value,
    value: fact.value,
    source: fact.source,
    confirmed: fact.confirmed,
    evidence: fact.evidence,
  }))
}

export interface GapDraft {
  key: FactKey
  value: string
}

/**
 * Build the `dna_confirm` payload. Unconfirming a fact is a local flag on the
 * DNA (the server keeps `confirmed` as sent); confirming / editing / adding go
 * through `edits` so the engine settles conflicts and gaps.
 */
export function buildConfirmPayload(dna: BrandDna, rows: FactRow[], gaps: GapDraft[]): { dna: BrandDna; edits: AdPackFactEdit[] } {
  const edits: AdPackFactEdit[] = []
  const facts: DnaFact[] = dna.facts.map((fact, index) => {
    const row = rows.find((r) => r.id === `${fact.key}:${index}`)
    if (!row) return fact
    return { ...fact, confirmed: row.confirmed ? fact.confirmed : false }
  })
  for (const row of rows) {
    const value = row.value.trim()
    if (!row.confirmed) continue
    if (!value) continue
    if (value !== row.originalValue.trim()) {
      edits.push({ op: 'edit', key: row.key, value, previousValue: row.originalValue })
    } else {
      edits.push({ op: 'confirm', key: row.key, value: row.originalValue })
    }
  }
  for (const gap of gaps) {
    const value = gap.value.trim()
    if (value) edits.push({ op: 'add', key: gap.key, value })
  }
  return { dna: { ...dna, facts }, edits }
}

export function confirmedFactCount(rows: FactRow[], gaps: GapDraft[]): number {
  return rows.filter((r) => r.confirmed && r.value.trim()).length + gaps.filter((g) => g.value.trim()).length
}

/** `conflict:price: "₡9.900" (website) vs "₡8.900" (instagram)` → readable line. */
export function readableDnaNote(note: string, language: L): { kind: 'conflict' | 'info'; text: string } {
  const m = /^conflict:([^:]+):\s*(.*)$/.exec(note)
  if (m) {
    const label = factLabel(m[1], language)
    const detail = m[2].replace(/\((website|instagram|upload|user|offer_form|inferred)\)/g, (_, s: string) => `(${sourceLabel(s, language)})`)
    return {
      kind: 'conflict',
      text: language === 'es' ? `Conflicto en ${label.toLowerCase()}: ${detail}. Confirmá el correcto.` : `Conflict on ${label.toLowerCase()}: ${detail}. Confirm the right one.`,
    }
  }
  return { kind: 'info', text: note }
}

export function gapSummary(gaps: FactKey[], language: L): string {
  if (!gaps.length) return ''
  const names = gaps.map((g) => factLabel(g, language).toLowerCase()).join(', ')
  return language === 'es' ? `Falta: ${names}` : `Missing: ${names}`
}

// ---------------------------------------------------------------------------
// Angles + quote
// ---------------------------------------------------------------------------

export function clampPackSize(raw: number): number {
  if (!Number.isFinite(raw)) return ADPACK_DEFAULT_SIZE
  return Math.min(ADPACK_MAX_SIZE, Math.max(ADPACK_MIN_SIZE, Math.round(raw)))
}

/**
 * The start contract plans angles server-side (deterministic, prefix-stable) and
 * takes only `size`. True when the enabled set equals the first N angles — i.e.
 * exactly what will be generated.
 */
export function selectionIsPrefix(angles: AdAngle[], enabled: ReadonlySet<string>): boolean {
  const n = angles.filter((a) => enabled.has(a.id)).length
  return angles.slice(0, n).every((a) => enabled.has(a.id))
}

export function quoteLine(count: number, credits: number | null, language: L): string {
  const ads = language === 'es' ? `${count} anuncio${count === 1 ? '' : 's'}` : `${count} ad${count === 1 ? '' : 's'}`
  if (credits == null) return ads
  return language === 'es' ? `${ads} · ${credits} créditos` : `${ads} · ${credits} credits`
}

// ---------------------------------------------------------------------------
// Status / polling
// ---------------------------------------------------------------------------

const TERMINAL: ReadonlySet<PackStatus> = new Set(['done', 'partial', 'failed', 'cancelled'])

export function isTerminalPackStatus(status: PackStatus): boolean {
  return TERMINAL.has(status)
}

/** Stop polling once the pack is terminal and the server reports no more work. */
export function shouldKeepPolling(status: Pick<AdPackStatusResponse, 'status' | 'moreWork'>): boolean {
  if (status.status === 'cancelled') return false
  return !isTerminalPackStatus(status.status) || status.moreWork
}

export function nextPollDelay(consecutiveErrors: number): number {
  if (consecutiveErrors <= 0) return ADPACK_POLL_MS
  return Math.min(ADPACK_POLL_MAX_BACKOFF_MS, ADPACK_POLL_MS * 2 ** consecutiveErrors)
}

export function progressLine(progress: AdPackStatusResponse['progress'], language: L): string {
  const base = language === 'es' ? `${progress.done}/${progress.total} listos` : `${progress.done}/${progress.total} ready`
  if (!progress.failed) return base
  return language === 'es' ? `${base} · ${progress.failed} con error` : `${base} · ${progress.failed} failed`
}

export function packStatusLabel(status: PackStatus, language: L): string {
  const es = language === 'es'
  switch (status) {
    case 'planned':
      return es ? 'En cola' : 'Queued'
    case 'running':
      return es ? 'Generando' : 'Generating'
    case 'done':
      return es ? 'Listo' : 'Done'
    case 'partial':
      return es ? 'Listo con errores' : 'Done with errors'
    case 'failed':
      return es ? 'Falló' : 'Failed'
    case 'cancelled':
      return es ? 'Cancelado' : 'Cancelled'
  }
}

export function itemStageLabel(item: AdPackItemView, language: L): string {
  const es = language === 'es'
  switch (item.status) {
    case 'planned':
      return es ? 'Escribiendo copy…' : 'Writing copy…'
    case 'copy_ready':
      return es ? 'Creando escena…' : 'Creating scene…'
    case 'scene_ready':
    case 'rendered':
      return es ? 'Componiendo…' : 'Composing…'
    case 'done':
      return es ? 'Listo' : 'Ready'
    case 'failed':
      return es ? 'Error' : 'Failed'
  }
}

export function mergeItem(status: AdPackStatusResponse, item: AdPackItemView): AdPackStatusResponse {
  return { ...status, items: status.items.map((i) => (i.id === item.id ? item : i)) }
}

// ---------------------------------------------------------------------------
// Copy edit
// ---------------------------------------------------------------------------

export interface CopyDraft {
  headline: string
  subline: string
  cta: string
  bullets: string
}

export function copyDraftFromItem(item: AdPackItemView): CopyDraft {
  return {
    headline: item.copy?.headline ?? item.headline ?? '',
    subline: item.copy?.subline ?? '',
    cta: item.copy?.cta ?? '',
    bullets: (item.copy?.bullets ?? []).join('\n'),
  }
}

/** Only changed fields; `null` when nothing changed. */
export function copyPatchFromDraft(item: AdPackItemView, draft: CopyDraft): AdPackCopyPatch | null {
  const before = copyDraftFromItem(item)
  const patch: AdPackCopyPatch = {}
  if (draft.headline.trim() !== before.headline.trim()) patch.headline = draft.headline.trim()
  if (draft.subline.trim() !== before.subline.trim()) patch.subline = draft.subline.trim()
  if (draft.cta.trim() !== before.cta.trim()) patch.cta = draft.cta.trim()
  const bullets = draft.bullets.split('\n').map((b) => b.trim()).filter(Boolean)
  const beforeBullets = before.bullets.split('\n').map((b) => b.trim()).filter(Boolean)
  if (bullets.join('\n') !== beforeBullets.join('\n')) patch.bullets = bullets.slice(0, 4)
  return Object.keys(patch).length ? patch : null
}

const ISSUE_LABELS: Record<CopyCheckIssue['code'], { es: string; en: string }> = {
  unconfirmed_fact: { es: 'Usa un dato no confirmado', en: 'Uses an unconfirmed fact' },
  number_mismatch: { es: 'Un número no coincide con tus datos', en: 'A number does not match your facts' },
  too_long: { es: 'Texto demasiado largo', en: 'Text too long' },
  empty_field: { es: 'Campo vacío', en: 'Empty field' },
  forbidden_phrase: { es: 'Frase prohibida', en: 'Forbidden phrase' },
  compliance: { es: 'No cumple las reglas de la categoría', en: 'Breaks category rules' },
  greeting: { es: 'No empieces con un saludo', en: 'Do not open with a greeting' },
  duplicate_message: { es: 'Mensaje repetido', en: 'Duplicate message' },
  placeholder: { es: 'Tiene un texto de relleno', en: 'Contains a placeholder' },
  register: { es: 'Mezcla el trato (vos/tú/usted)', en: 'Wrong form of address' },
  locale_register: { es: 'No usa el trato obligatorio del idioma (vos/tú/usted)', en: 'Breaks the required form of address for the locale' },
  cliche: { es: 'Frase hecha genérica', en: 'Generic stock phrase' },
  missing_fact: { es: 'Falta un dato obligatorio de la oferta', en: 'A required offer fact is missing' },
  urgency: { es: 'Mete presión o urgencia que la marca no usa', en: 'Uses urgency the brand does not allow' },
  grammar: { es: 'Le falta un artículo (texto telegráfico)', en: 'Telegraphic text (missing article)' },
  unverified_comparison: { es: 'Comparación sin dato verificado', en: 'Comparison without a verified fact' },
  ambiguous_claim: { es: 'Frase recortada de un dato confirmado (falta a qué se refiere)', en: 'Shortened confirmed claim (missing what it refers to)' },
}

const FIELD_LABELS: Record<string, { es: string; en: string }> = {
  headline: { es: 'Titular', en: 'Headline' },
  subline: { es: 'Subtítulo', en: 'Subline' },
  bullets: { es: 'Viñetas', en: 'Bullets' },
  offerLine: { es: 'Línea de oferta', en: 'Offer line' },
  cta: { es: 'CTA', en: 'CTA' },
  caption: { es: 'Caption', en: 'Caption' },
  script: { es: 'Guion', en: 'Script' },
  sceneBrief: { es: 'Escena', en: 'Scene' },
}

export function copyFieldLabel(field: string, language: L): string {
  return FIELD_LABELS[field]?.[language] ?? field
}

/** A checker issue, or an edit rejection (E1: `field` is the exact path like "bullets[2]", `baseField` the copy key). */
export type CopyIssueLike = Pick<CopyCheckIssue, 'code' | 'detail'> & { field: string; baseField?: string; limit?: number; actual?: number }

export function describeCopyIssue(issue: CopyIssueLike, language: L): string {
  const label = ISSUE_LABELS[issue.code]?.[language] ?? issue.code
  const index = /\[(\d+)\]$/.exec(issue.field)
  const where = `${copyFieldLabel(issue.baseField ?? issue.field.replace(/[[.].*$/, ''), language)}${index ? ` ${Number(index[1]) + 1}` : ''}`
  const limit = issue.limit !== undefined && issue.actual !== undefined ? ` (${issue.actual}/${issue.limit})` : ''
  return `${where}: ${label}${limit}${issue.detail ? ` — ${issue.detail}` : ''}`
}

export function captionsText(items: AdPackItemView[], language: L): string {
  return items
    .filter((i) => i.copy?.caption)
    .map((i) => `#${i.index + 1} · ${i.copy?.headline ?? ''}\n${i.copy?.caption ?? ''}`)
    .join(language === 'es' ? '\n\n— — —\n\n' : '\n\n— — —\n\n')
}

export function adFilename(brandName: string, item: AdPackItemView, ratio: AspectRatio): string {
  const slug = (brandName || 'ad').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ad'
  return `${slug}-${String(item.index + 1).padStart(2, '0')}-${ratio.replace(':', 'x')}.png`
}

export function ratioCss(ratio: AspectRatio): string {
  return ratio.replace(':', ' / ')
}
