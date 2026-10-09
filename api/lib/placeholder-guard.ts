/**
 * Placeholder guard for brand kit / offer text (owner feedback B3).
 *
 * A real test shipped "Hecho para country" because a kit had `audience: "country"`
 * (an enum value that leaked into a free-text field) and the pack added
 * "Personas 18–65, todo el país" from untouched defaults. Values like these must
 * never be written by MCP tools and must be ignored when building the Brand DNA.
 *
 * Pure, dependency-free: safe for the adpack typecheck, the MCP host and tests.
 */

function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whole-value placeholders (normalized: lowercase, no accents). */
const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([
  // Enum leaks / geo defaults
  'country', 'pais', 'todo el pais', 'todo el mundo', 'world', 'worldwide', 'local', 'nationwide', 'national', 'nacional',
  'international', 'internacional', 'global', 'region', 'city', 'ciudad',
  // Empty-ish markers
  'n/a', 'na', 'n.a.', 'none', 'null', 'nil', 'undefined', 'tbd', 'tba', 'todo', 'to do', 'pending', 'pendiente',
  'xxx', 'xx', 'x', '-', '--', '---', '...', '…', '?', '??', 'test', 'testing', 'prueba', 'ejemplo', 'example', 'sample',
  'default', 'placeholder', 'string', 'text', 'texto', 'value', 'valor', 'lorem', 'lorem ipsum', 'asdf', 'foo', 'bar',
  'sin definir', 'no definido', 'por definir', 'no aplica', 'not applicable', 'ninguno', 'ninguna', 'nada', 'unknown', 'desconocido',
  // Single generic words (say nothing about a real audience / brand)
  'audience', 'audiencia', 'publico', 'publico objetivo', 'target', 'target audience', 'personas', 'people', 'gente', 'general',
  'everyone', 'everybody', 'todos', 'todas', 'todo el publico', 'cualquiera', 'anyone', 'varios', 'various', 'otro', 'otros', 'other',
  'cliente', 'clientes', 'customer', 'customers', 'usuarios', 'users', 'adultos', 'adults', 'marca', 'brand', 'producto', 'product',
  'servicio', 'service', 'negocio', 'business', 'empresa', 'company',
])

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^\[.*\]$/, // [audiencia]
  /^\{.*\}$/, // {name}
  /^<.*>$/, // <brand>
  /^\(.*\)$/, // (precio)
  /\blorem ipsum\b/,
  /^(?:tbd|tba|n\/a)\b/,
  /^(?:todo|fixme)\s*:/,
  /^x{2,}$/,
  /^[-_.?…*#]+$/,
  // "Personas 18-65", "People 18-65+", "adultos 18+": no segment, just a default age band.
  /^(?:personas|people|gente|adultos|adults|todos|everyone|hombres y mujeres|men and women)\s*(?:de\s*)?\d{1,2}\s*(?:-|a|to|\+)\s*(?:\d{1,2}\+?)?(?:\s*anos|\s*years)?$/,
  /^\d{1,2}\s*-\s*\d{2}$/, // "18-65"
  /^hecho para (?:country|pais|todo el pais|local|world)$/,
]

/** True when a free-text value is a placeholder / enum leak / generic default. */
export function isPlaceholderValue(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  const value = norm(raw)
  if (!value) return false
  if (PLACEHOLDER_VALUES.has(value)) return true
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(value))) return true
  // "Personas 18-65, todo el país": every comma-separated part is a placeholder.
  const parts = value.split(/\s*[,;|·/]\s*/).filter(Boolean)
  if (parts.length > 1 && parts.every((p) => PLACEHOLDER_VALUES.has(p) || PLACEHOLDER_PATTERNS.some((re) => re.test(p)))) return true
  return false
}

/** Value or '' when it is a placeholder. */
export function stripPlaceholder(raw: string): string {
  return isPlaceholderValue(raw) ? '' : raw
}

/**
 * Drop placeholder segments from a composite line ("Mujeres 25–40, todo el país" →
 * "Mujeres 25–40"). Returns '' when nothing meaningful is left.
 */
export function stripPlaceholderParts(raw: string, separator = ', '): string {
  if (typeof raw !== 'string' || !raw.trim()) return ''
  if (isPlaceholderValue(raw)) return ''
  const parts = raw.split(/\s*,\s*/).filter((p) => p && !isPlaceholderValue(p))
  const out = parts.join(separator).trim()
  return isPlaceholderValue(out) ? '' : out
}

export interface IgnoredPlaceholder {
  field: string
  value: string
}

/** Filter a list, reporting what was dropped under `field`. */
export function filterPlaceholderList(values: string[], field: string, ignored: IgnoredPlaceholder[]): string[] {
  const out: string[] = []
  for (const v of values) {
    if (isPlaceholderValue(v)) ignored.push({ field, value: v })
    else out.push(v)
  }
  return out
}
