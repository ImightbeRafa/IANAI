/**
 * Instagram → DnaPart, best-effort and PUBLIC business-profile data only.
 *
 * - No login, no credentials, no Meta Graph API.
 * - Tier 1 (optional, unstable): the public `web_profile_info` endpoint used by the web client.
 * - Tier 2: the public profile HTML (og/meta tags + any embedded JSON).
 * - Only business-profile data is kept (name, bio, link, aggregate counts, own posts).
 *   Nothing about followers or commenters is read or stored.
 * - Hard 8s timeout per request, body size caps, no retries.
 */

import type { AdFormat, AdLanguage, DnaFact, FactKey, ModelGateway } from '../types.js'
import {
  cleanText,
  errorMessage,
  factsFromModel,
  formatsFromModel,
  makeFact,
  readTextCapped,
  stringArray,
  stripEmoji,
  type DnaPart,
  type FetchLike,
} from './part.js'

export const IG_APP_ID = '936619743392459'
const REQUEST_TIMEOUT_MS = 8_000
const MAX_HTML_BYTES = 1_500_000
const MAX_JSON_BYTES = 1_000_000
const MAX_POSTS = 12
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const RESERVED_PATHS = new Set([
  'p', 'reel', 'reels', 'tv', 'explore', 'accounts', 'direct', 'about', 'legal', 'developer', 'web',
  'api', 'graphql', 'challenge', 'emails', 'session', 'login', 'signup', 'privacy', 'terms', 'press',
])

export const IG_LIMITED_NOTE = {
  es: 'Instagram limitado: solo se pudo leer la bio — subí capturas de tus posts para mejores resultados.',
  en: 'Instagram limited: only bio available — upload screenshots for better results.',
}
export const IG_UNAVAILABLE_NOTE = {
  es: 'Instagram no disponible públicamente — subí capturas de tu perfil y posts.',
  en: 'Instagram unavailable publicly — upload screenshots of your profile and posts.',
}

/** `@brand`, `brand`, `instagram.com/brand`, `https://www.instagram.com/brand/?igsh=…` → `brand`. */
export function normalizeInstagramHandle(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  let raw = input.trim()
  if (!raw) return null
  if (/instagram\.com|instagr\.am/i.test(raw)) {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`
    let url: URL
    try { url = new URL(withScheme) } catch { return null }
    if (!/(^|\.)instagram\.com$|(^|\.)instagr\.am$/i.test(url.hostname)) return null
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments[0]?.toLowerCase() === 'stories' && segments[1]) raw = segments[1]
    else if (segments[0] && !RESERVED_PATHS.has(segments[0].toLowerCase())) raw = segments[0]
    else return null
  }
  raw = raw.replace(/^@+/, '').trim()
  try { raw = decodeURIComponent(raw) } catch { /* keep raw */ }
  if (!/^[A-Za-z0-9._]{1,30}$/.test(raw)) return null
  if (/^\.|\.$|\.\./.test(raw)) return null
  if (RESERVED_PATHS.has(raw.toLowerCase())) return null
  return raw.toLowerCase()
}

export interface InstagramPost {
  imageUrl: string
  caption?: string
  isVideo?: boolean
}

export interface InstagramProfile {
  handle: string
  profileUrl: string
  tier: 'web_profile_info' | 'html' | 'none'
  name?: string
  bio?: string
  bioLines: string[]
  /** Aggregate count text as shown publicly, e.g. "12,3 mil" — never follower identities. */
  followersText?: string
  followerCount?: number
  postsCount?: number
  externalUrl?: string
  categoryName?: string
  isBusiness?: boolean
  posts: InstagramPost[]
  /** Captions found without a reliable image pairing (HTML tier). */
  captions: string[]
  errors: string[]
}

// ---------------------------------------------------------------------------
// Parsing helpers (pure)
// ---------------------------------------------------------------------------

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
}

function metaTag(html: string, key: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase()
    if (name !== key) continue
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1]
    if (content != null) return decodeEntities(content).trim()
  }
  return ''
}

function decodeJsonString(raw: string): string {
  try { return JSON.parse(`"${raw}"`) as string } catch { return raw }
}

/** "298M" → 298000000, "1,553" → 1553, "12,3 mil" → 12300, "1.2K" → 1200. */
export function parseCountText(text: string): number | undefined {
  const match = text.trim().match(/^([\d.,]+)\s*(k|m|b|mil|mill(?:ones|ón)?|mm)?\b/i)
  if (!match) return undefined
  const suffix = (match[2] || '').toLowerCase()
  let numeric = match[1]
  if (suffix) numeric = numeric.replace(',', '.')
  else numeric = numeric.replace(/[.,](?=\d{3}(?:\D|$))/g, '')
  const base = Number(numeric)
  if (!Number.isFinite(base)) return undefined
  const mult = suffix === 'k' || suffix === 'mil' ? 1e3
    : suffix === 'm' || suffix.startsWith('mill') ? 1e6
      : suffix === 'b' || suffix === 'mm' ? 1e9 : 1
  return Math.round(base * mult)
}

/** Splits a bio into lines; emoji that start a new segment also start a new line. */
export function splitBioLines(bio: string): string[] {
  return bio
    .replace(/\r/g, '')
    .replace(/\s*(?:[•|·]|\s-\s)\s*/g, '\n')
    .replace(/([^\s\p{Extended_Pictographic}\u{FE0F}\u{200D}])\s+(?=\p{Extended_Pictographic})/gu, '$1\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => stripEmoji(line).length > 1)
    .slice(0, 20)
}

const BIO_RULES: Array<{ key: FactKey; re: RegExp }> = [
  { key: 'shipping', re: /🚚|📦|🛵|env[ií]os?|entregas?\b|a\s+domicilio|shipping|ships?\b|delivery|express|todo\s+el\s+pa[ií]s|nationwide|worldwide/i },
  { key: 'delivery_time', re: /(\d+\s*(?:a|-|–|to)\s*\d+|\d+)\s*(?:h\b|hrs?|horas|d[ií]as(?:\s+h[aá]biles)?|days|hours)|mismo\s+d[ií]a|same[-\s]day|24\s*\/\s*48/i },
  { key: 'payment_methods', re: /💳|\bsinpe\b|tarjeta|transferencia|efectivo|contra\s*entrega|paypal|mercado\s*pago|\bcard\b|\bcash\b|tasa\s*cero|cuotas/i },
  { key: 'location', re: /📍|🏠|ubicad[oa]s?\s+en|tienda\s+f[ií]sica|showroom|\b(?:san\s+jos[eé]|heredia|alajuela|cartago|escaz[uú]|cdmx|bogot[aá]|buenos\s+aires|montevideo|madrid)\b/i },
  { key: 'contact_channel', re: /📲|📞|☎|💬|whats\s*app|\bwa\.me\b|\bdm\b|mensaje\s+directo|pedidos\s+(?:al|por|v[ií]a)|\binbox\b|\+?\d{3,4}[\s-]?\d{4}\b/i },
  { key: 'guarantee', re: /garant[ií]a|guarantee|money[-\s]back/i },
  { key: 'returns', re: /devoluci[oó]n|cambios\s+gratis|free\s+returns/i },
  { key: 'price', re: /(?:₡|\$|€|CRC|USD)\s?\d/i },
  { key: 'proof_number', re: /\+?\d[\d.,]*\+?\s*(?:clientes|rese[ñn]as|vendidos|ventas|customers|reviews|sold)/i },
]

/** Bio lines → candidate facts (source instagram, never confirmed, evidence = original line). */
export function parseBioFacts(lines: string[]): DnaFact[] {
  const facts: DnaFact[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const value = stripEmoji(line)
    if (!value) continue
    for (const rule of BIO_RULES) {
      if (!rule.re.test(line)) continue
      const dedupe = `${rule.key}|${value.toLowerCase()}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      facts.push(makeFact(rule.key, value.slice(0, 160), 'instagram', `bio: ${line.slice(0, 200)}`))
    }
  }
  return facts
}

/** Parses the public profile HTML (meta tags + embedded JSON when present). */
export function parseInstagramHtml(html: string, handle: string): Omit<InstagramProfile, 'tier' | 'errors' | 'profileUrl'> & { found: boolean } {
  const ogTitle = metaTag(html, 'og:title')
  const ogDescription = metaTag(html, 'og:description')
  const description = metaTag(html, 'description')
  const found = Boolean(ogTitle || ogDescription || description)

  const embeddedName = html.match(/"full_name"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
  const name = ogTitle.match(/^(.+?)\s*\(@[^)]+\)/)?.[1]?.trim()
    || (embeddedName ? decodeJsonString(embeddedName).trim() : '')
    || undefined

  const countsSource = description || ogDescription
  const followersText = countsSource.match(/([\d.,]+\s*(?:k|m|b|mil|mill(?:ones|ón)?|mm)?)\s*(?:followers|seguidores)/i)?.[1]?.trim()
  const postsText = countsSource.match(/([\d.,]+\s*(?:k|m|mil)?)\s*(?:posts|publicaciones)/i)?.[1]?.trim()

  let bio = ''
  const embeddedBio = html.match(/"biography"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
  if (embeddedBio) bio = decodeJsonString(embeddedBio)
  if (!bio) {
    const quoted = (description || ogDescription).match(/(?:on|en)\s+Instagram\s*:\s*["“](.*)["”]\s*$/is)?.[1]
    if (quoted) bio = quoted
  }

  const externalRaw = html.match(/"external_url"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
  const externalUrl = externalRaw ? decodeJsonString(externalRaw) : undefined

  const images: string[] = []
  for (const match of html.matchAll(/"display_url"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    const url = decodeJsonString(match[1])
    if (/^https:\/\/[^/]*(?:cdninstagram\.com|fbcdn\.net)\//i.test(url) && !images.includes(url)) images.push(url)
    if (images.length >= MAX_POSTS) break
  }
  const captions: string[] = []
  for (const match of html.matchAll(/"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    const caption = cleanText(decodeJsonString(match[1]), 1_000)
    if (caption) captions.push(caption)
    if (captions.length >= MAX_POSTS) break
  }
  const posts: InstagramPost[] = images.map((imageUrl, index) => (
    images.length === captions.length && captions[index] ? { imageUrl, caption: captions[index] } : { imageUrl }
  ))

  return {
    found,
    handle,
    name,
    bio: bio || undefined,
    bioLines: bio ? splitBioLines(bio) : [],
    followersText,
    followerCount: followersText ? parseCountText(followersText) : undefined,
    postsCount: postsText ? parseCountText(postsText) : undefined,
    externalUrl,
    posts,
    captions: images.length === captions.length ? [] : captions,
  }
}

interface WebProfileUser {
  full_name?: string
  biography?: string
  external_url?: string | null
  bio_links?: Array<{ url?: string }>
  category_name?: string | null
  business_category_name?: string | null
  is_business_account?: boolean
  edge_followed_by?: { count?: number }
  edge_owner_to_timeline_media?: {
    count?: number
    edges?: Array<{ node?: {
      display_url?: string
      thumbnail_src?: string
      is_video?: boolean
      edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> }
    } }>
  }
}

/** Parses the web_profile_info JSON. Returns null when the shape is not usable. */
export function parseWebProfileInfo(json: unknown, handle: string): Omit<InstagramProfile, 'tier' | 'errors' | 'profileUrl'> | null {
  const user = (json as { data?: { user?: WebProfileUser } } | null)?.data?.user
  if (!user || typeof user !== 'object') return null
  const bio = typeof user.biography === 'string' ? user.biography : ''
  const posts: InstagramPost[] = []
  for (const edge of user.edge_owner_to_timeline_media?.edges || []) {
    const node = edge?.node
    const imageUrl = node?.display_url || node?.thumbnail_src
    if (!imageUrl || !/^https:\/\//i.test(imageUrl)) continue
    const caption = cleanText(node?.edge_media_to_caption?.edges?.[0]?.node?.text, 1_000)
    posts.push({ imageUrl, ...(caption ? { caption } : {}), ...(node?.is_video ? { isVideo: true } : {}) })
    if (posts.length >= MAX_POSTS) break
  }
  const followers = user.edge_followed_by?.count
  return {
    handle,
    name: cleanText(user.full_name, 120) || undefined,
    bio: bio || undefined,
    bioLines: bio ? splitBioLines(bio) : [],
    followerCount: typeof followers === 'number' ? followers : undefined,
    followersText: typeof followers === 'number' ? String(followers) : undefined,
    postsCount: user.edge_owner_to_timeline_media?.count,
    externalUrl: user.external_url || user.bio_links?.find((link) => link?.url)?.url || undefined,
    categoryName: user.category_name || user.business_category_name || undefined,
    isBusiness: typeof user.is_business_account === 'boolean' ? user.is_business_account : undefined,
    posts,
    captions: [],
  }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function fetchCapped(fetchImpl: FetchLike, url: string, headers: Record<string, string>, maxBytes: number, timeoutMs: number): Promise<{ status: number; body: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { headers, redirect: 'follow', signal: controller.signal })
    const body = response.ok ? await readTextCapped(response, maxBytes) : ''
    return { status: response.status, body }
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`timeout after ${timeoutMs}ms`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchInstagramProfile(input: {
  url?: string
  handle?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
  /** Skip the unstable endpoint (e.g. if it starts misbehaving). */
  skipWebProfileInfo?: boolean
}): Promise<InstagramProfile> {
  const handle = normalizeInstagramHandle(input.handle || input.url || '')
  if (!handle) throw new Error('Invalid Instagram handle or URL')
  const fetchImpl: FetchLike = input.fetchImpl || ((u, init) => fetch(u, init))
  const timeoutMs = Math.min(input.timeoutMs ?? REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS)
  const profileUrl = `https://www.instagram.com/${handle}/`
  const errors: string[] = []

  const apiTask = input.skipWebProfileInfo
    ? Promise.resolve(null)
    : fetchCapped(fetchImpl, `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`, {
      'x-ig-app-id': IG_APP_ID,
      'Accept': 'application/json',
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'es,en;q=0.8',
    }, MAX_JSON_BYTES, timeoutMs).then((res) => {
      if (res.status !== 200) throw new Error(`web_profile_info HTTP ${res.status}`)
      let json: unknown
      try { json = JSON.parse(res.body) } catch { throw new Error('web_profile_info returned non-JSON') }
      const parsed = parseWebProfileInfo(json, handle)
      if (!parsed) throw new Error('web_profile_info shape not recognized')
      return parsed
    })
  const htmlTask = fetchCapped(fetchImpl, profileUrl, {
    'User-Agent': BROWSER_UA,
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'es,en;q=0.8',
  }, MAX_HTML_BYTES, timeoutMs).then((res) => {
    if (res.status !== 200) throw new Error(`profile HTML HTTP ${res.status}`)
    const parsed = parseInstagramHtml(res.body, handle)
    if (!parsed.found) throw new Error('profile HTML had no public meta tags (login wall?)')
    return parsed
  })

  const [api, html] = await Promise.allSettled([apiTask, htmlTask])
  const apiData = api.status === 'fulfilled' ? api.value : null
  if (api.status === 'rejected') errors.push(errorMessage(api.reason))
  const htmlData = html.status === 'fulfilled' ? html.value : null
  if (html.status === 'rejected') errors.push(errorMessage(html.reason))

  if (apiData) {
    return {
      ...apiData,
      name: apiData.name || htmlData?.name,
      followersText: htmlData?.followersText || apiData.followersText,
      bio: apiData.bio || htmlData?.bio,
      bioLines: apiData.bioLines.length ? apiData.bioLines : htmlData?.bioLines || [],
      externalUrl: apiData.externalUrl || htmlData?.externalUrl,
      profileUrl,
      tier: 'web_profile_info',
      errors,
    }
  }
  if (htmlData) {
    const { found: _found, ...rest } = htmlData
    return { ...rest, profileUrl, tier: 'html', errors }
  }
  return { handle, profileUrl, tier: 'none', bioLines: [], posts: [], captions: [], errors }
}

// ---------------------------------------------------------------------------
// Post analysis (vision)
// ---------------------------------------------------------------------------

export interface InstagramPostAnalysis {
  formatsSeen: AdFormat[]
  styleNotes?: string
  facts: DnaFact[]
  customerPhrases: string[]
  costUsd: number
}

const POSTS_SYSTEM = `You analyze a brand's own recent Instagram posts (images + captions) to help write ads.
Return ONLY JSON:
{
  "formats": [subset of "offer_graphic","before_after","how_to_steps","variant_card","ugc_person","handheld_overlay","explainer"],
  "styleNotes": "≤ 40 words: palette, lighting, composition, typography, mood",
  "claims": [{"key": "price|bundle|shipping|delivery_time|payment_methods|guarantee|returns|result_claim|proof_number|differentiator|variants|custom:<slug>", "value": "exact text as seen", "evidence": "where it appears (post # / caption quote)"}],
  "customerPhrases": ["verbatim phrases customers use, from quoted reviews/testimonials in captions or images"]
}
Rules: copy prices/offers EXACTLY as written; never invent; skip anything unreadable; at most 12 claims and 10 phrases.`

export async function analyzeInstagramPosts(input: {
  gateway: ModelGateway
  images: string[]
  captions: string[]
  language?: AdLanguage
}): Promise<InstagramPostAnalysis> {
  const images = input.images.filter((url) => /^(?:https:\/\/|data:image\/)/i.test(url)).slice(0, MAX_POSTS)
  const captions = input.captions.map((c) => cleanText(c, 600)).filter(Boolean).slice(0, MAX_POSTS)
  if (!images.length && !captions.length) return { formatsSeen: [], facts: [], customerPhrases: [], costUsd: 0 }
  const user = [
    `Language for styleNotes: ${input.language === 'en' ? 'English' : 'Spanish'}.`,
    captions.length ? `CAPTIONS:\n${captions.map((c, i) => `#${i + 1}: ${c}`).join('\n')}` : 'CAPTIONS: none',
    images.length ? `${images.length} post images attached in order (#1…#${images.length}).` : 'No images.',
  ].join('\n\n')
  const result = images.length
    ? await input.gateway.visionJson<Record<string, unknown>>({ system: POSTS_SYSTEM, user, images })
    : await input.gateway.json<Record<string, unknown>>({ system: POSTS_SYSTEM, user, maxTokens: 1_200, temperature: 0.1 })
  const data = result.data && typeof result.data === 'object' ? result.data : {}
  const styleNotes = cleanText(data.styleNotes, 300)
  return {
    formatsSeen: formatsFromModel(data.formats),
    styleNotes: styleNotes || undefined,
    facts: factsFromModel(data.claims, 'instagram', 12),
    customerPhrases: stringArray(data.customerPhrases, 10, 200),
    costUsd: result.costUsd || 0,
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function ingestInstagram(input: {
  url: string
  gateway?: ModelGateway
  fetchImpl?: FetchLike
  language?: AdLanguage
  /** Default true when a gateway is given. */
  analyzePosts?: boolean
  now?: () => Date
}): Promise<DnaPart & { profile: InstagramProfile }> {
  const lang: AdLanguage = input.language === 'en' ? 'en' : 'es'
  const fetchedAt = (input.now ? input.now() : new Date()).toISOString()
  const profile = await fetchInstagramProfile({ url: input.url, fetchImpl: input.fetchImpl })
  const facts: DnaFact[] = parseBioFacts(profile.bioLines)
  if (profile.name) facts.unshift(makeFact('brand_name', profile.name, 'instagram', `@${profile.handle}`))
  if (profile.externalUrl) facts.push(makeFact('custom:link_in_bio', profile.externalUrl, 'instagram', `@${profile.handle} bio link`))
  const notes: string[] = []
  let costUsd = 0
  let analysis: InstagramPostAnalysis | null = null

  const images = profile.posts.map((p) => p.imageUrl)
  const captions = [...profile.posts.map((p) => p.caption || ''), ...profile.captions].filter(Boolean)
  if (input.gateway && input.analyzePosts !== false && (images.length || captions.length)) {
    try {
      analysis = await analyzeInstagramPosts({ gateway: input.gateway, images, captions, language: lang })
      costUsd += analysis.costUsd
      facts.push(...analysis.facts)
    } catch (err) {
      notes.push(`Instagram post analysis failed: ${errorMessage(err)}`)
    }
  }

  let ok = true
  let note: string
  if (profile.tier === 'none') {
    ok = false
    note = `${IG_UNAVAILABLE_NOTE[lang]} (${profile.errors.join('; ').slice(0, 200)})`
  } else if (!profile.posts.length && !profile.captions.length) {
    note = IG_LIMITED_NOTE[lang]
  } else {
    note = lang === 'en'
      ? `Instagram: bio + ${profile.posts.length} recent posts (${profile.tier}).`
      : `Instagram: bio + ${profile.posts.length} posts recientes (${profile.tier}).`
  }

  return {
    profile,
    source: 'instagram',
    sourceEntry: { kind: 'instagram', url: profile.profileUrl, fetchedAt, ok, note },
    brandName: profile.name,
    oneLiner: profile.bioLines[0] ? stripEmoji(profile.bioLines[0]) : undefined,
    customerPhrases: analysis?.customerPhrases || [],
    facts,
    visual: {
      ...(analysis?.styleNotes ? { styleNotes: analysis.styleNotes } : {}),
      ...(analysis?.formatsSeen.length ? { formatsSeen: analysis.formatsSeen } : {}),
    },
    referenceImageUrls: images.slice(0, MAX_POSTS),
    textSample: [profile.name, profile.categoryName, profile.bio, ...captions.slice(0, 6)].filter(Boolean).join('\n'),
    notes,
    costUsd,
  }
}
