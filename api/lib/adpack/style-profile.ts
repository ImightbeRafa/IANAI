/**
 * Style DNA → render choices (shared resolver for adpack and any image tool).
 *
 * A Style DNA (brand kit `style_dnas[]`: reference / winner ad URLs + notes) is analyzed once
 * with `ModelGateway.visionJson` into a small visual-system description
 * {layoutPattern, hierarchy, hookType, density, colorUsage, typeWeight, ctaStyle}. That
 * analysis is stored back on the same jsonb entry (`analysis`, no new column) and mapped
 * deterministically to a StyleRenderProfile: which layout families to use, palette emphasis,
 * type weight, CTA style and copy density. It is a QUALITY FLOOR — the pack matches the
 * winners' system; reference images are never copied or sent to the scene model as templates.
 */
import { createHash } from 'node:crypto'
import type { StyleDna, StyleDnaAnalysis } from '../bulk/types.js'
import type { AdLanguage, HookType, LayoutFamily, ModelGateway, StyleRenderProfile } from './types.js'

export const STYLE_ANALYSIS_MAX_IMAGES = 6

const LAYOUTS: StyleDnaAnalysis['layoutPattern'][] = ['pill_overlay', 'editorial', 'split_panel', 'type_led', 'badge', 'card', 'native_ugc']
const HIERARCHY: StyleDnaAnalysis['hierarchy'][] = ['headline_first', 'product_first', 'price_first']
const HOOKS: HookType[] = ['pain', 'desire', 'objection', 'social_proof', 'comparison', 'price_value', 'urgency_scarcity', 'curiosity', 'routine', 'identity']
const DENSITY: StyleDnaAnalysis['density'][] = ['minimal', 'standard', 'rich']
const COLOR: StyleDnaAnalysis['colorUsage'][] = ['brand_blocks', 'accent_pops', 'neutral_photo']

/** Layout pattern of the winners → families that reproduce that SYSTEM (not the ads). */
export const LAYOUT_PATTERN_FAMILIES: Record<StyleDnaAnalysis['layoutPattern'], LayoutFamily[]> = {
  pill_overlay: ['bold_pill', 'badge_corner'],
  editorial: ['editorial_minimal', 'framed_card'],
  split_panel: ['split_panel', 'framed_card'],
  type_led: ['full_bleed_type', 'editorial_minimal'],
  badge: ['badge_corner', 'bold_pill'],
  card: ['framed_card', 'split_panel'],
  native_ugc: ['ugc_native', 'full_bleed_type'],
}

export function referenceHash(urls: string[]): string {
  return createHash('sha1').update(urls.join('\n')).digest('hex').slice(0, 16)
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback)

export function buildStyleAnalysisPrompt(dna: Pick<StyleDna, 'name' | 'notes'>, language: AdLanguage): { system: string; user: string } {
  const system = [
    'You analyze a brand\'s winning static social ads to extract their VISUAL SYSTEM only (layout, hierarchy, density, color usage, type weight, CTA style) and the hook type they lean on.',
    'Do not describe or transcribe the products, the copy or any text; do not identify people. The result is used as a quality floor for new ads, never to copy the references.',
    'Reply with JSON only:',
    `{"layoutPattern":"${LAYOUTS.join('|')}","hierarchy":"${HIERARCHY.join('|')}","hookType":"${HOOKS.join('|')}","density":"${DENSITY.join('|')}","colorUsage":"${COLOR.join('|')}","typeWeight":"heavy|regular","ctaStyle":"button|text|sticker","notes":"≤ 25 words on what makes them work"}`,
    'layoutPattern: pill_overlay = text and rounded pills/badges over the photo; editorial = big type, thin rules, lots of space; split_panel = a solid color block holds the copy; type_led = huge headline over a dark photo; badge = clean photo + price sticker; card = photo with an inset/white card; native_ugc = looks like an organic post (captions, stickers).',
  ].join('\n')
  const user = `${language === 'es' ? 'Estilo' : 'Style'}: ${dna.name}${dna.notes ? `\nNotes from the owner: ${dna.notes.slice(0, 400)}` : ''}\nAnalyze the attached reference ads.`
  return { system, user }
}

/** Vision analysis of a Style DNA's references (one visionJson call). Throws on gateway errors. */
export async function analyzeStyleDna(input: {
  gateway: ModelGateway
  styleDna: Pick<StyleDna, 'name' | 'notes' | 'referenceUrls'>
  language?: AdLanguage
  model?: string
  now?: () => Date
}): Promise<{ analysis: StyleDnaAnalysis; costUsd: number }> {
  const images = input.styleDna.referenceUrls.filter((u) => /^https:\/\//i.test(u) || /^data:image\//i.test(u)).slice(0, STYLE_ANALYSIS_MAX_IMAGES)
  if (!images.length) throw new Error('style_dna_has_no_references')
  const prompt = buildStyleAnalysisPrompt(input.styleDna, input.language ?? 'es')
  const res = await input.gateway.visionJson<Record<string, unknown>>({ ...prompt, images, model: input.model })
  const d = res.data ?? {}
  const analysis: StyleDnaAnalysis = {
    layoutPattern: pick(d.layoutPattern, LAYOUTS, 'pill_overlay'),
    hierarchy: pick(d.hierarchy, HIERARCHY, 'headline_first'),
    hookType: pick(d.hookType, HOOKS, 'desire'),
    density: pick(d.density, DENSITY, 'standard'),
    colorUsage: pick(d.colorUsage, COLOR, 'accent_pops'),
    typeWeight: pick(d.typeWeight, ['heavy', 'regular'] as const, 'heavy'),
    ctaStyle: pick(d.ctaStyle, ['button', 'text', 'sticker'] as const, 'button'),
    ...(typeof d.notes === 'string' && d.notes.trim() ? { notes: d.notes.trim().slice(0, 300) } : {}),
    analyzedAt: (input.now ?? (() => new Date()))().toISOString(),
    model: res.model,
    referenceCount: images.length,
    referenceHash: referenceHash(input.styleDna.referenceUrls),
  }
  return { analysis, costUsd: res.costUsd }
}

const NOTE_RULES: Array<[RegExp, StyleDnaAnalysis['layoutPattern']]> = [
  [/ugc|nativ|org[aá]nic|casual|selfie|tiktok|story|historia/i, 'native_ugc'],
  [/editorial|minimal|limpi|clean|elegant|lujo|luxury|premium|revista|magazine/i, 'editorial'],
  [/bloque|panel|split|color s[oó]lido|solid color|dividid/i, 'split_panel'],
  [/tipogr|typograph|big type|letra grande|poster|bold headline|titular enorme/i, 'type_led'],
  [/sticker|badge|sello|precio grande|price tag|etiqueta de precio/i, 'badge'],
  [/tarjeta|card|marco|frame|polaroid/i, 'card'],
  [/pill|p[ií]ldora|chip|performance|directo/i, 'pill_overlay'],
]

/** Deterministic mapping: analysis (or notes keywords when there is no analysis) → render profile. */
export function styleProfileFromAnalysis(analysis: StyleDnaAnalysis | null | undefined, opts: { notes?: string; styleDnaId?: string } = {}): StyleRenderProfile {
  if (analysis) {
    return {
      ...(opts.styleDnaId ? { styleDnaId: opts.styleDnaId } : {}),
      families: LAYOUT_PATTERN_FAMILIES[analysis.layoutPattern],
      paletteEmphasis: analysis.colorUsage === 'brand_blocks' ? 'primary' : analysis.colorUsage === 'accent_pops' ? 'accent' : 'neutral',
      typeWeight: analysis.typeWeight,
      ctaStyle: analysis.ctaStyle,
      copyDensity: analysis.density,
      hookType: analysis.hookType,
      source: 'analysis',
    }
  }
  const notes = opts.notes ?? ''
  const hit = NOTE_RULES.find(([re]) => re.test(notes))
  if (hit) {
    const pattern = hit[1]
    return {
      ...(opts.styleDnaId ? { styleDnaId: opts.styleDnaId } : {}),
      families: LAYOUT_PATTERN_FAMILIES[pattern],
      paletteEmphasis: pattern === 'split_panel' || pattern === 'card' ? 'primary' : 'accent',
      typeWeight: pattern === 'editorial' || pattern === 'native_ugc' ? 'regular' : 'heavy',
      ctaStyle: pattern === 'native_ugc' ? 'sticker' : pattern === 'editorial' ? 'text' : 'button',
      copyDensity: pattern === 'editorial' || pattern === 'type_led' || pattern === 'native_ugc' ? 'minimal' : 'standard',
      source: 'notes',
    }
  }
  return { ...(opts.styleDnaId ? { styleDnaId: opts.styleDnaId } : {}), families: [], paletteEmphasis: 'accent', typeWeight: 'heavy', ctaStyle: 'button', copyDensity: 'standard', source: 'default' }
}

export interface ResolveStyleProfileResult {
  profile: StyleRenderProfile
  styleDna: StyleDna
  /** Set when a fresh analysis was made (caller persists it on the style DNA). */
  analysis?: StyleDnaAnalysis
  analyzed: boolean
  costUsd: number
  /** Why no analysis was used (no references, model error…). */
  note?: string
}

/**
 * Shared resolver: Style DNA id → render profile. Re-uses a stored analysis while the
 * references are unchanged; otherwise analyzes (when `gateway` is given and `analyze` is not
 * false) and falls back to the notes heuristic on any failure. Returns null for an unknown id.
 */
export async function resolveStyleProfile(input: {
  styleDnas: StyleDna[]
  styleDnaId: string
  gateway?: ModelGateway
  analyze?: boolean
  language?: AdLanguage
  now?: () => Date
}): Promise<ResolveStyleProfileResult | null> {
  const styleDna = input.styleDnas.find((d) => d.id === input.styleDnaId)
  if (!styleDna) return null
  const stored = styleDna.analysis && styleDna.analysis.referenceHash === referenceHash(styleDna.referenceUrls) ? styleDna.analysis : undefined
  if (stored) return { profile: styleProfileFromAnalysis(stored, { notes: styleDna.notes, styleDnaId: styleDna.id }), styleDna, analyzed: false, costUsd: 0 }
  if (input.gateway && input.analyze !== false && styleDna.referenceUrls.length) {
    try {
      const { analysis, costUsd } = await analyzeStyleDna({ gateway: input.gateway, styleDna, language: input.language, now: input.now })
      return { profile: styleProfileFromAnalysis(analysis, { notes: styleDna.notes, styleDnaId: styleDna.id }), styleDna: { ...styleDna, analysis }, analysis, analyzed: true, costUsd }
    } catch (err) {
      return {
        profile: styleProfileFromAnalysis(null, { notes: styleDna.notes, styleDnaId: styleDna.id }),
        styleDna,
        analyzed: false,
        costUsd: 0,
        note: `style analysis unavailable (${err instanceof Error ? err.message : String(err)}); using the style notes`.slice(0, 200),
      }
    }
  }
  return {
    profile: styleProfileFromAnalysis(null, { notes: styleDna.notes, styleDnaId: styleDna.id }),
    styleDna,
    analyzed: false,
    costUsd: 0,
    ...(styleDna.referenceUrls.length ? {} : { note: 'style DNA has no reference ads; using its notes' }),
  }
}
