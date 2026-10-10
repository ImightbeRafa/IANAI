/**
 * Round 1c — one-idea headline rules for studio ads (the approved Prototipo v1 tone):
 * short, concrete, es-CR voseo, ONE specific idea per angle story (gift / build / use / value).
 *
 * - `oneIdeaGuidance`: the prompt rule block (tone only; never copied verbatim).
 * - `checkOneIdeaHeadline`: deterministic validator (length, fragments, article, ambiguity).
 * - `composeOneIdeaHeadline`: deterministic, seeded composer used when no model headline is
 *   available/valid. It only uses slots supplied from CONFIRMED product facts (verbs, noun,
 *   a free-shipping bundle) and returns null when a template would need an unconfirmed fact.
 */
import type { AdLanguage, AngleCategory } from './types.js'
import { findBareNounHeadline, findLossyClaim } from './check-copy.js'
import { normalizeText } from './util.js'

export type HeadlineStory = 'gift' | 'build' | 'use' | 'value'

const STORY_BY_CATEGORY: Record<AngleCategory, HeadlineStory> = {
  regalo: 'gift',
  temporada: 'gift',
  como_funciona: 'build',
  unboxing: 'build',
  detalle_tecnico: 'build',
  uso_real: 'use',
  problema_solucion: 'use',
  valor_precio: 'value',
  comparacion: 'value',
  prueba_social: 'value',
}

export function storyForCategory(category: AngleCategory | undefined): HeadlineStory {
  return (category && STORY_BY_CATEGORY[category]) || 'gift'
}

export const ONE_IDEA_LIMITS = { maxWords: 9, maxChars: 48, maxFragments: 2 } as const

const STORY_NOTE: Record<AdLanguage, Record<HeadlineStory, string>> = {
  es: {
    gift: 'regalo: a quién se lo regalás y qué hace con eso (un gesto concreto, no "el regalo perfecto")',
    build: 'armado: el paso concreto o el orden de las piezas ("X arriba. Y abajo."), nunca "fácil" a secas',
    use: 'uso: lo que hace la persona con el producto, en voseo ("Lo armás vos. Lo volás vos.")',
    value: 'valor: un hecho confirmado de precio, paquete o envío, dicho como beneficio concreto',
  },
  en: {
    gift: 'gift: who gets it and the concrete thing they do with it, not "the perfect gift"',
    build: 'build: the concrete step or order of parts ("X on top. Y underneath."), never a bare "easy"',
    use: 'use: what the person does with the product',
    value: 'value: one confirmed price, bundle or shipping fact stated as a concrete benefit',
  },
}

/** Prompt rules (tone examples are style references: the headline must be original and use confirmed facts only). */
export function oneIdeaGuidance(language: AdLanguage, story: HeadlineStory): string {
  const L = ONE_IDEA_LIMITS
  return language === 'es'
    ? `Titular de estudio (una sola idea): ≤ ${L.maxWords} palabras, ≤ ${L.maxChars} caracteres, 1–${L.maxFragments} frases cortas con punto; voseo costarricense; con artículo ("Un regalo que…", no "Regalo que…"); concreto y específico (${STORY_NOTE.es[story]}). Referencia de tono, NO copiar: "Papel arriba. Motores abajo." · "Lo doblás vos. Lo volás vos." · "Para quien siempre pregunta cómo funciona." Sin adjetivos vacíos ("increíble", "perfecto"), sin "todo incluido" si hay cosas no incluidas, sin promesas que no estén en los hechos confirmados.`
    : `Studio headline (one idea): ≤ ${L.maxWords} words, ≤ ${L.maxChars} chars, 1–${L.maxFragments} short sentences; concrete and specific (${STORY_NOTE.en[story]}). Tone reference, do NOT copy: "Paper on top. Motors underneath." No empty adjectives, no promise outside the confirmed facts.`
}

const EMPTY_ADJ = /\b(?:increible|perfect[oa]s?|espectacular|el mejor|la mejor|unic[oa]s?|revolucionari[oa]|todo incluido|todo lo que necesit\w+)\b/

export interface OneIdeaIssue { code: 'too_long' | 'too_many_fragments' | 'empty_adjective' | 'ellipsis' | 'bare_noun' | 'ambiguous_claim' | 'empty'; detail: string }

/** Deterministic one-idea check (article + ambiguity rules still enforced). */
export function checkOneIdeaHeadline(headline: string, claims: string[] = []): OneIdeaIssue[] {
  const h = String(headline ?? '').trim()
  const out: OneIdeaIssue[] = []
  if (!h) return [{ code: 'empty', detail: 'empty headline' }]
  const words = h.split(/\s+/).filter(Boolean).length
  if (words > ONE_IDEA_LIMITS.maxWords || h.length > ONE_IDEA_LIMITS.maxChars) out.push({ code: 'too_long', detail: `${words} words / ${h.length} chars (max ${ONE_IDEA_LIMITS.maxWords} / ${ONE_IDEA_LIMITS.maxChars}): one short idea` })
  const fragments = h.split(/(?<=[.!?])\s+/).filter((s) => s.replace(/[.!?¡¿\s]/g, '').length > 0)
  if (fragments.length > ONE_IDEA_LIMITS.maxFragments) out.push({ code: 'too_many_fragments', detail: `${fragments.length} sentences (max ${ONE_IDEA_LIMITS.maxFragments})` })
  if (/…|\.{3}/.test(h)) out.push({ code: 'ellipsis', detail: 'ellipsis headline' })
  const adj = EMPTY_ADJ.exec(normalizeText(h))
  if (adj) out.push({ code: 'empty_adjective', detail: `"${adj[0]}" says nothing concrete` })
  const bare = findBareNounHeadline(h)
  if (bare) out.push({ code: 'bare_noun', detail: `missing article: "${bare.match}" → ${bare.fix}` })
  const lossy = claims.length ? findLossyClaim(h, claims) : null
  if (lossy) out.push({ code: 'ambiguous_claim', detail: `drops ${lossy.dropped.join(', ')} from "${lossy.claim}"` })
  return out
}

export interface HeadlineSlots {
  /** Two infinitives of what the buyer does with the product, e.g. ['armar', 'volar'] (confirmed by the kit/offer). */
  verbs?: [string, string]
  /** The same verbs in 2nd-person voseo present, e.g. ['armás', 'volás']. */
  vos?: [string, string]
  /** The same verbs in impersonal 3rd person, e.g. ['arma', 'vuela'] ("se arma y se vuela"). */
  se?: [string, string]
  /** Two concrete parts in the order they appear, e.g. ['Papel arriba', 'Motores abajo'] — only from confirmed facts. */
  parts?: [string, string]
  /** The offer ships free from N kits (confirmed fact). */
  freeShippingFrom?: number
  /** Who receives the gift when the brief states it ("cumpleaños", "Navidad"). */
  occasion?: string
}

const TEMPLATES: Record<HeadlineStory, Array<{ id: string; needs: Array<keyof HeadlineSlots>; make: (s: HeadlineSlots) => string }>> = {
  gift: [
    { id: 'gift-se', needs: ['se'], make: (s) => `Un regalo que se ${s.se![0]} y se ${s.se![1]}.` },
    { id: 'gift-para', needs: ['verbs'], make: (s) => `Regalá algo para ${s.verbs![0]} y ${s.verbs![1]}.` },
    { id: 'gift-occasion', needs: ['occasion', 'se'], make: (s) => `${s.occasion} con un regalo que se ${s.se![0]}.` },
  ],
  build: [
    { id: 'build-parts', needs: ['parts'], make: (s) => `${s.parts![0]}. ${s.parts![1]}.` },
    { id: 'build-order', needs: ['verbs'], make: (s) => `Primero ${s.verbs![0]}. Después ${s.verbs![1]}.` },
  ],
  use: [
    { id: 'use-vos', needs: ['vos'], make: (s) => `Lo ${s.vos![0]} vos. Lo ${s.vos![1]} vos.` },
    { id: 'use-yo', needs: ['vos'], make: (s) => `Vos lo ${s.vos![0]}, vos lo ${s.vos![1]}.` },
    { id: 'use-se', needs: ['se'], make: (s) => `Se ${s.se![0]} y se ${s.se![1]}. Así de directo.` },
  ],
  value: [
    { id: 'value-ship', needs: ['freeShippingFrom'], make: (s) => `Llevá ${s.freeShippingFrom} y el envío corre por nuestra cuenta.` },
    { id: 'value-ship2', needs: ['freeShippingFrom'], make: (s) => `${s.freeShippingFrom} kits, envío gratis.` },
  ],
}

function hashSeed(seed: string | number): number {
  let h = 2166136261
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

/** Seeded composer: the same (story, seed) is stable; a different seed rotates the template. Null when no template has its slots. */
export function composeOneIdeaHeadline(story: HeadlineStory, slots: HeadlineSlots, seed: string | number = 0, avoid: string[] = []): string | null {
  const usable = TEMPLATES[story].filter((t) => t.needs.every((k) => slots[k] !== undefined && slots[k] !== null))
  if (!usable.length) return null
  const start = hashSeed(seed) % usable.length
  const avoided = new Set(avoid.map((a) => normalizeText(a)))
  for (let i = 0; i < usable.length; i++) {
    const h = usable[(start + i) % usable.length].make(slots)
    if (!avoided.has(normalizeText(h)) && checkOneIdeaHeadline(h).length === 0) return h
  }
  return null
}
