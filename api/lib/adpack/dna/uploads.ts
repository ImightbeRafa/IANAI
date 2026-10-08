/**
 * Uploaded references → DnaPart.
 * - product_photo / logo: no model call (offer + visual).
 * - review_screenshot: vision → customer phrases + proof facts.
 * - reference_ad: vision → formats + style notes (claims are NOT taken: they may be competitors' ads).
 * - document: text (or a PDF/image URL) → facts.
 * Every model call is isolated: one failing group never drops the others.
 */

import type { AdFormat, AdLanguage, DnaFact, ModelGateway } from '../types.js'
import {
  cleanText,
  errorMessage,
  factsFromModel,
  formatsFromModel,
  stringArray,
  uniqStrings,
  type DnaPart,
} from './part.js'

export type UploadKind = 'product_photo' | 'logo' | 'reference_ad' | 'review_screenshot' | 'document'

export interface UploadItem {
  kind: UploadKind
  /** Public URL or data URL (images / PDFs). */
  url?: string
  /** Plain text (notes, pasted docs, extracted PDF text). */
  text?: string
  name?: string
}

const MAX_IMAGES_PER_CALL = 8
const MAX_DOC_CHARS = 12_000

const REVIEWS_SYSTEM = `You read screenshots of customer reviews / comments / chats about a brand.
Return ONLY JSON:
{
  "customerPhrases": ["verbatim customer phrases worth using as ad hooks (≤ 20 words each)"],
  "proof": [{"key": "proof_review|proof_number|custom:rating", "value": "exact text, e.g. a short quote or '4.9/5 (320 reseñas)'", "evidence": "screenshot # and where"}],
  "pains": ["problems customers mention before buying"],
  "desires": ["outcomes customers celebrate"],
  "objections": ["doubts customers mention"]
}
Rules: verbatim only, never invent or translate; drop names, usernames, faces and any personal data; at most 12 phrases.`

const REFERENCE_ADS_SYSTEM = `You classify reference ad images the user likes.
Return ONLY JSON:
{
  "formats": [subset of "offer_graphic","before_after","how_to_steps","variant_card","ugc_person","handheld_overlay","explainer"],
  "styleNotes": "≤ 40 words: layout, palette, typography, lighting, mood"
}`

const DOCUMENT_SYSTEM = `You extract business facts from a document written by or for the business (catalog, price list, FAQ, notes).
Return ONLY JSON:
{
  "facts": [{"key": "brand_name|offer_name|price|compare_at_price|bundle|shipping|delivery_time|payment_methods|guarantee|returns|ingredients_materials|how_it_works|usage_steps|variants|quantity_per_pack|proof_number|certification|location|contact_channel|differentiator|result_claim|custom:<slug>", "value": "exact text", "evidence": "short quote"}],
  "audience": ["who buys"], "pains": [], "desires": [], "objections": [], "voice": "≤ 20 words"
}
Rules: copy values EXACTLY (prices, times, guarantees); never invent; at most 25 facts.`

export async function ingestUploads(input: {
  items: UploadItem[]
  gateway?: ModelGateway
  language?: AdLanguage
  now?: () => Date
}): Promise<DnaPart> {
  const fetchedAt = (input.now ? input.now() : new Date()).toISOString()
  const items = (input.items || []).filter((item) => item && (item.url || item.text))
  const notes: string[] = []
  const facts: DnaFact[] = []
  const customerPhrases: string[] = []
  const pains: string[] = []
  const desires: string[] = []
  const objections: string[] = []
  const audience: string[] = []
  let voice = ''
  let formats: AdFormat[] = []
  let styleNotes = ''
  let costUsd = 0
  const textSample: string[] = []

  const urlsOf = (kind: UploadKind) => items.filter((i) => i.kind === kind && i.url).map((i) => i.url as string)
  const productImageUrls = uniqStrings(urlsOf('product_photo'), 12)
  const logoUrl = urlsOf('logo')[0]
  const referenceAds = urlsOf('reference_ad').slice(0, MAX_IMAGES_PER_CALL)
  const reviewShots = urlsOf('review_screenshot').slice(0, MAX_IMAGES_PER_CALL)
  const reviewTexts = items.filter((i) => i.kind === 'review_screenshot' && i.text).map((i) => cleanText(i.text, 2_000))
  const documents = items.filter((i) => i.kind === 'document')

  const tasks: Array<Promise<void>> = []
  const gateway = input.gateway
  const language = input.language === 'en' ? 'English' : 'Spanish'

  if (gateway && (reviewShots.length || reviewTexts.length)) {
    tasks.push((async () => {
      const user = [`Output language: keep phrases verbatim (${language} expected).`, reviewTexts.length ? `PASTED REVIEWS:\n${reviewTexts.join('\n---\n')}` : '', reviewShots.length ? `${reviewShots.length} screenshots attached.` : ''].filter(Boolean).join('\n\n')
      const res = reviewShots.length
        ? await gateway.visionJson<Record<string, unknown>>({ system: REVIEWS_SYSTEM, user, images: reviewShots })
        : await gateway.json<Record<string, unknown>>({ system: REVIEWS_SYSTEM, user, maxTokens: 1_500, temperature: 0.1 })
      costUsd += res.costUsd || 0
      const data = res.data || {}
      customerPhrases.push(...stringArray(data.customerPhrases, 12, 200))
      facts.push(...factsFromModel(data.proof, 'upload', 8).filter((f) => f.key === 'proof_review' || f.key === 'proof_number' || f.key.startsWith('custom:')))
      pains.push(...stringArray(data.pains, 6))
      desires.push(...stringArray(data.desires, 6))
      objections.push(...stringArray(data.objections, 6))
    })().catch((err) => { notes.push(`review screenshots: ${errorMessage(err)}`) }))
  }

  if (gateway && referenceAds.length) {
    tasks.push((async () => {
      const res = await gateway.visionJson<Record<string, unknown>>({
        system: REFERENCE_ADS_SYSTEM,
        user: `${referenceAds.length} reference ads attached. styleNotes in ${language}.`,
        images: referenceAds,
      })
      costUsd += res.costUsd || 0
      formats = formatsFromModel(res.data?.formats)
      styleNotes = cleanText(res.data?.styleNotes, 300)
    })().catch((err) => { notes.push(`reference ads: ${errorMessage(err)}`) }))
  }

  if (gateway) {
    for (const doc of documents.slice(0, 4)) {
      tasks.push((async () => {
        const label = doc.name ? `DOCUMENT: ${doc.name}` : 'DOCUMENT'
        let res: { data: Record<string, unknown>; costUsd: number }
        if (doc.text) {
          const text = doc.text.slice(0, MAX_DOC_CHARS)
          textSample.push(text.slice(0, 2_000))
          res = await gateway.json<Record<string, unknown>>({ system: DOCUMENT_SYSTEM, user: `${label}\n\n${text}`, maxTokens: 2_000, temperature: 0.1 })
        } else {
          res = await gateway.visionJson<Record<string, unknown>>({ system: DOCUMENT_SYSTEM, user: `${label} attached (image or PDF).`, images: [doc.url as string] })
        }
        costUsd += res.costUsd || 0
        const data = res.data || {}
        facts.push(...factsFromModel(data.facts, 'upload', 25))
        audience.push(...stringArray(data.audience, 4))
        pains.push(...stringArray(data.pains, 6))
        desires.push(...stringArray(data.desires, 6))
        objections.push(...stringArray(data.objections, 6))
        if (!voice) voice = cleanText(data.voice, 160)
      })().catch((err) => { notes.push(`document ${doc.name || ''}: ${errorMessage(err)}`.trim()) }))
    }
  } else if (reviewShots.length || referenceAds.length || documents.length) {
    notes.push('uploads: no model gateway, only product photos / logo were used')
  }

  await Promise.all(tasks)
  // Deterministic order regardless of which call finished first.
  facts.sort((a, b) => a.key.localeCompare(b.key) || a.value.localeCompare(b.value))

  const analyzed = items.length
  const ok = notes.length === 0 || facts.length > 0 || customerPhrases.length > 0 || productImageUrls.length > 0 || Boolean(logoUrl)
  return {
    source: 'upload',
    sourceEntry: {
      kind: 'upload',
      fetchedAt,
      ok,
      note: notes.length ? notes.join(' | ').slice(0, 400) : `${analyzed} uploads`,
    },
    facts,
    visual: {
      ...(logoUrl ? { logoUrl } : {}),
      ...(styleNotes ? { styleNotes } : {}),
      ...(formats.length ? { formatsSeen: formats } : {}),
    },
    productImageUrls,
    referenceImageUrls: referenceAds,
    customerPhrases: uniqStrings(customerPhrases, 12),
    pains: uniqStrings(pains, 8),
    desires: uniqStrings(desires, 8),
    objections: uniqStrings(objections, 8),
    audience: uniqStrings(audience, 4),
    voice: voice || undefined,
    textSample: [...textSample, ...reviewTexts].join('\n').slice(0, 4_000),
    notes,
    costUsd,
  }
}
