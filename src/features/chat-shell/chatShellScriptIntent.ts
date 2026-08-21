import type {
  CTAStrength,
  ScriptFramework,
  ScriptGenerationSettings,
  ScriptTypeConfig,
} from '../../types'
import { ORGANIC_SCRIPT_FRAMEWORKS } from '../../types'

export type ChatShellLanguage = 'en' | 'es'

export interface ChatShellScriptIntent {
  settings: ScriptGenerationSettings
  orderedTypes: ScriptFramework[]
  expectedCount: number
  matched: boolean
  warnings: string[]
  hasExplicitType: boolean
  hasExplicitCount: boolean
  hasExplicitCta: boolean
}

const MAX_SCRIPTS = 10

const EMPTY_TYPE_CONFIG: ScriptTypeConfig = {
  venta_directa: 0,
  desvalidar_alternativas: 0,
  mostrar_servicio: 0,
  variedad_productos: 0,
  paso_a_paso: 0,
  reconocimiento: 0,
  educativo: 0,
  storytelling: 0,
  tendencia: 0,
  engagement: 0,
}

const WORD_COUNTS: Record<string, number> = {
  one: 1,
  un: 1,
  una: 1,
  uno: 1,
  two: 2,
  dos: 2,
  three: 3,
  tres: 3,
  four: 4,
  cuatro: 4,
  five: 5,
  cinco: 5,
  six: 6,
  seis: 6,
  seven: 7,
  siete: 7,
  eight: 8,
  ocho: 8,
  nine: 9,
  nueve: 9,
  ten: 10,
  diez: 10,
}

/** Ordered longest-first so multi-word aliases win. */
const TYPE_ALIASES: Array<{ key: ScriptFramework; patterns: RegExp[] }> = [
  {
    key: 'desvalidar_alternativas',
    patterns: [
      /\bdesvalidar(?:\s+alternativas?)?\b/i,
      /\binvalidate(?:\s+alternatives?)?\b/i,
      /\balternativas?\b/i,
    ],
  },
  {
    key: 'mostrar_servicio',
    patterns: [
      /\bmostrar(?:\s+(?:el\s+)?(?:servicio|producto))?\b/i,
      /\bshow(?:case)?(?:\s+(?:the\s+)?(?:service|product))?\b/i,
      /\bdemostraci[oó]n\b/i,
    ],
  },
  {
    key: 'variedad_productos',
    patterns: [
      /\bvariedad(?:\s+de\s+productos?)?\b/i,
      /\bproduct\s+variety\b/i,
      /\bvariety\b/i,
    ],
  },
  {
    key: 'paso_a_paso',
    patterns: [
      /\bpaso\s*a\s*paso\b/i,
      /\bstep[\s-]*by[\s-]*step\b/i,
    ],
  },
  {
    key: 'reconocimiento',
    patterns: [
      /\breconocimiento\b/i,
      /\bbrand\s+awareness\b/i,
      /\bawareness\b/i,
      /\btof\b/i,
      /\bbranding\b/i,
    ],
  },
  {
    key: 'educativo',
    patterns: [/\beducativ[oa]s?\b/i, /\beducational\b/i, /\beducaci[oó]n\b/i],
  },
  {
    key: 'storytelling',
    patterns: [/\bstorytelling\b/i, /\bhistoria(?:s)?\b/i, /\bstor(?:y|ies)\b/i],
  },
  {
    key: 'tendencia',
    patterns: [/\btendencia(?:s)?\b/i, /\btrend(?:ing|s)?\b/i],
  },
  {
    key: 'engagement',
    patterns: [/\bengagement\b/i, /\binteracci[oó]n\b/i],
  },
  {
    key: 'venta_directa',
    patterns: [
      /\bventa(?:s)?(?:\s+directa(?:s)?)?\b/i,
      /\bdirect(?:\s+sale(?:s)?)?\b/i,
      /\bsales?\b/i,
      /\bguion(?:es)?\s+de\s+venta\b/i,
      /\bscript(?:s)?\s+de\s+venta\b/i,
    ],
  },
]

const GENERATION_HINT =
  /\b(?:genera(?:me|r)?|generate|dame|quiero|necesito|haz(?:me)?|create|make|script|scripts|gui[oó]n(?:es)?|guion(?:es)?)\b/i

/** Count/type glue words — must not block "2 script de venta" → count 2. */
const SCRIPT_NOISE_TOKEN =
  /\b(?:scripts?|guiones?|guion)\b/gi

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '')
}

function normalizeText(text: string): string {
  return stripDiacritics(text)
    .toLowerCase()
    .replace(/[¡!¿?.,;:"'`´]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Remove script/guion filler so numeric count stays adjacent to type words.
 * "generame 2 script de venta" → "generame 2 de venta"
 */
export function stripScriptNoiseTokens(normalized: string): string {
  return normalized
    .replace(SCRIPT_NOISE_TOKEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cloneSettings(defaults: Readonly<ScriptGenerationSettings>): ScriptGenerationSettings {
  return {
    ...defaults,
    scriptTypeConfig: { ...defaults.scriptTypeConfig },
  }
}

function zeroConfig(): ScriptTypeConfig {
  return { ...EMPTY_TYPE_CONFIG }
}

function sumConfig(config: ScriptTypeConfig): number {
  return Object.values(config).reduce((sum, n) => sum + n, 0)
}

function parseCountToken(token: string): number | null {
  if (/^\d{1,2}$/.test(token)) {
    const n = Number(token)
    return n >= 1 ? n : null
  }
  return WORD_COUNTS[token] ?? null
}

function clampCount(n: number, warnings: string[]): number {
  if (n > MAX_SCRIPTS) {
    warnings.push(`capped_at_${MAX_SCRIPTS}`)
    return MAX_SCRIPTS
  }
  return Math.max(1, n)
}

/**
 * Extract a count only when it sits near generation/script language or a type word.
 * Avoids prices like "2x1", "$2", or "hace 2 años".
 */
function extractGlobalCount(normalized: string): number | null {
  if (/\b\d+x\d+\b/.test(normalized)) return null
  if (/\$\s*\d+/.test(normalized)) return null

  const patterns = [
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:gui[oó]n(?:es)?|guion(?:es)?|script(?:s)?|de)\b/i,
    /\b(?:gui[oó]n(?:es)?|guion(?:es)?|script(?:s)?)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i,
    /\b(?:genera(?:me|r)?|generate|dame|quiero|haz(?:me)?|create|make)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i,
  ]

  // Note: accented "guión" is normalized before this runs.

  for (const re of patterns) {
    const m = normalized.match(re)
    if (!m) continue
    const token = (m[1] || '').toLowerCase()
    const n = parseCountToken(token)
    if (n != null) return n
  }

  // "2 de venta" / "2 of sales"
  const deType = normalized.match(
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:de|of)\s+/i
  )
  if (deType && GENERATION_HINT.test(normalized)) {
    const n = parseCountToken(deType[1].toLowerCase())
    if (n != null) return n
  }

  return null
}

function findTypeMentions(normalized: string): Array<{ key: ScriptFramework; index: number; length: number }> {
  const hits: Array<{ key: ScriptFramework; index: number; length: number }> = []
  const occupied: Array<{ start: number; end: number }> = []

  const overlaps = (start: number, end: number) =>
    occupied.some((r) => start < r.end && end > r.start)

  for (const entry of TYPE_ALIASES) {
    for (const pattern of entry.patterns) {
      const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
      const global = new RegExp(pattern.source, flags)
      let match: RegExpExecArray | null
      while ((match = global.exec(normalized)) !== null) {
        const start = match.index
        const end = start + match[0].length
        if (overlaps(start, end)) continue
        hits.push({ key: entry.key, index: start, length: match[0].length })
        occupied.push({ start, end })
      }
    }
  }

  return hits.sort((a, b) => a.index - b.index)
}

function localCountBefore(normalized: string, typeIndex: number): number | null {
  // Allow filler between count and type: "2 script de" / "2 guiones de"
  const before = stripScriptNoiseTokens(normalized.slice(0, typeIndex)).trimEnd()
  const m = before.match(
    /(?:^|\s)(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)(?:\s+(?:de|of))?$/i
  )
  if (!m) return null
  return parseCountToken(m[1].toLowerCase())
}

function parseCtaStrength(normalized: string): CTAStrength | null {
  if (/\b(?:sin\s+cta|no\s+cta|without\s+cta|sin\s+llamado)\b/.test(normalized)) return 'none'
  if (/\b(?:cta\s+suave|soft\s+cta|suave)\b/.test(normalized)) return 'soft'
  if (/\b(?:menci[oó]n\s+de\s+marca|brand\s+mention)\b/.test(normalized)) return 'brand_mention'
  if (/\b(?:cta\s+de\s+venta|sales\s+cta|cta\s+fuerte|hard\s+cta)\b/.test(normalized)) return 'sales'
  return null
}

function wantsFreshAngles(normalized: string): boolean {
  return /\b(?:angulos?\s+frescos?|fresh\s+angles?|nuevos?\s+[aá]ngulos?|diverse\s+angles?|[aá]ngulos?\s+diversos?|fuerza\s+angulos?|force\s+fresh)\b/.test(
    normalized
  )
}

function defaultCtaForTypes(types: ScriptFramework[]): CTAStrength {
  if (types.length === 0) return 'sales'
  const onlyRecognition = types.every((t) => t === 'reconocimiento')
  if (onlyRecognition) return 'none'
  const onlyOrganic = types.every((t) =>
    (ORGANIC_SCRIPT_FRAMEWORKS as readonly string[]).includes(t)
  )
  if (onlyOrganic) return 'soft'
  return 'sales'
}

function distributeCounts(
  types: ScriptFramework[],
  localCounts: Array<number | null>,
  globalCount: number | null
): ScriptTypeConfig {
  const config = zeroConfig()
  if (types.length === 0) return config

  const hasAnyLocal = localCounts.some((n) => n != null)
  if (hasAnyLocal) {
    types.forEach((key, i) => {
      config[key] += localCounts[i] ?? 1
    })
    return config
  }

  if (globalCount != null && globalCount > 0) {
    if (types.length === 1) {
      config[types[0]] = globalCount
      return config
    }
    const base = Math.floor(globalCount / types.length)
    let rem = globalCount % types.length
    for (const key of types) {
      const add = base + (rem > 0 ? 1 : 0)
      if (rem > 0) rem -= 1
      config[key] += Math.max(1, add)
    }
    // If globalCount < types.length, floor is 0 — ensure at least 1 each then trim? Prefer 1 each.
    if (sumConfig(config) === 0) {
      for (const key of types) config[key] = 1
    }
    return config
  }

  for (const key of types) config[key] = 1
  return config
}

/**
 * Parse natural-language script generation intent into ScriptGenerationSettings.
 * Always returns a fresh clone — never mutates `defaults`.
 */
export function parseChatShellScriptIntent(
  text: string,
  _language: ChatShellLanguage,
  defaults: Readonly<ScriptGenerationSettings>
): ChatShellScriptIntent {
  const warnings: string[] = []
  const normalizedRaw = normalizeText(text || '')
  const base = cloneSettings(defaults)

  if (!normalizedRaw) {
    return {
      settings: base,
      orderedTypes: [],
      expectedCount: sumConfig(base.scriptTypeConfig) || base.variations,
      matched: false,
      warnings,
      hasExplicitType: false,
      hasExplicitCount: false,
      hasExplicitCta: false,
    }
  }

  // Strip script/guion filler so "2 script de venta" parses like "2 de venta".
  const generationHint = GENERATION_HINT.test(normalizedRaw)
  const normalized = stripScriptNoiseTokens(normalizedRaw)

  const mentions = findTypeMentions(normalized)
  const orderedTypes = mentions.map((m) => m.key)
  // Dedupe while preserving first-mention order for framework selection
  const uniqueOrdered: ScriptFramework[] = []
  for (const t of orderedTypes) {
    if (!uniqueOrdered.includes(t)) uniqueOrdered.push(t)
  }

  const rawGlobalCount = extractGlobalCount(normalized)
  const localCounts = mentions.map((m) => localCountBefore(normalized, m.index))
  const ctaExplicit = parseCtaStrength(normalizedRaw)
  const fresh = wantsFreshAngles(normalizedRaw)
  const globalCount =
    rawGlobalCount != null ? clampCount(rawGlobalCount, warnings) : null

  const generationCue =
    generationHint
    || uniqueOrdered.length > 0
    || rawGlobalCount != null
    || ctaExplicit != null
    || fresh

  if (!generationCue) {
    return {
      settings: base,
      orderedTypes: [],
      expectedCount: sumConfig(base.scriptTypeConfig) || base.variations,
      matched: false,
      warnings,
      hasExplicitType: false,
      hasExplicitCount: false,
      hasExplicitCta: false,
    }
  }

  let settings = cloneSettings(defaults)

  if (uniqueOrdered.length > 0) {
    // Prefer first mention's local count per type.
    const firstLocalByType = new Map<ScriptFramework, number | null>()
    mentions.forEach((m, i) => {
      if (!firstLocalByType.has(m.key)) {
        const raw = localCounts[i]
        firstLocalByType.set(m.key, raw != null ? clampCount(raw, warnings) : null)
      }
    })
    let locals = uniqueOrdered.map((t) => firstLocalByType.get(t) ?? null)

    // "generame 3 venta y educativo" — the verb count sticks to the first type;
    // when other types lack local counts, treat it as a global distribute.
    if (
      uniqueOrdered.length > 1
      && globalCount != null
      && locals[0] === globalCount
      && locals.slice(1).every((n) => n == null)
    ) {
      locals = uniqueOrdered.map(() => null)
    }

    const config = distributeCounts(uniqueOrdered, locals, globalCount)
    let total = sumConfig(config)
    if (total > MAX_SCRIPTS) {
      if (!warnings.includes(`capped_at_${MAX_SCRIPTS}`)) {
        warnings.push(`capped_at_${MAX_SCRIPTS}`)
      }
      const capped = zeroConfig()
      let remaining = MAX_SCRIPTS
      for (const key of uniqueOrdered) {
        if (remaining <= 0) break
        const take = Math.min(config[key], remaining)
        capped[key] = take
        remaining -= take
      }
      settings = {
        ...settings,
        generationMode: 'by_type',
        scriptTypeConfig: capped,
        variations: MAX_SCRIPTS,
        framework: uniqueOrdered[0],
      }
      total = MAX_SCRIPTS
    } else {
      settings = {
        ...settings,
        generationMode: 'by_type',
        scriptTypeConfig: config,
        variations: Math.max(1, total),
        framework: uniqueOrdered[0],
      }
    }

    settings.ctaStrength = ctaExplicit ?? defaultCtaForTypes(uniqueOrdered)
  } else if (globalCount != null) {
    settings = {
      ...settings,
      generationMode: 'mixed',
      variations: globalCount,
      scriptTypeConfig: { ...settings.scriptTypeConfig },
    }
    settings.ctaStrength = ctaExplicit ?? settings.ctaStrength ?? 'sales'
  } else {
    settings = cloneSettings(defaults)
    settings.ctaStrength = ctaExplicit ?? settings.ctaStrength ?? 'sales'
  }

  if (fresh) {
    settings.forceFreshAngles = true
    settings.useStructuredPipeline = true
  }

  const expectedCount =
    settings.generationMode === 'by_type'
      ? sumConfig(settings.scriptTypeConfig)
      : settings.variations

  return {
    settings,
    orderedTypes: uniqueOrdered,
    expectedCount,
    matched: true,
    warnings,
    hasExplicitType: uniqueOrdered.length > 0,
    hasExplicitCount: rawGlobalCount != null || localCounts.some((count) => count != null),
    hasExplicitCta: ctaExplicit != null,
  }
}
