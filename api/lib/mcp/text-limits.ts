/**
 * #19 — one place for MCP text limits, and no silent truncation: input over a limit is a clear
 * BAD_INPUT ("label is 212 characters; the maximum is 160"), and derived text that has to be
 * shortened is reported as `truncated: [{ field, from, to }]`.
 */
export const LABEL_MAX = 160
export const SUMMARY_MAX = 200
export const TECHNICAL_SPECS_MAX = 2_000
/** Free part name stored in product_images.role (e.g. "control tipo gamepad"). */
export const PART_NAME_MAX = 160

export interface TruncationNotice {
  field: string
  from: number
  to: number
}

export class TextLimitError extends Error {
  readonly code = 'BAD_INPUT'
}

/** Throws a clear BAD_INPUT when `value` is longer than `max` (nothing is cut). */
export function assertMaxLength(field: string, value: string, max: number): string {
  if (value.length > max) throw new TextLimitError(`${field} is ${value.length} characters; the maximum is ${max} (nothing was saved — shorten it)`)
  return value
}

/**
 * Shorten derived text visibly: keeps the start and the meaningful end with "…" in the middle and
 * records a notice. Returns the value unchanged when it fits.
 */
export function clipWithNotice(field: string, value: string, max: number, notices: TruncationNotice[]): string {
  if (value.length <= max) return value
  notices.push({ field, from: value.length, to: max })
  const cut = value.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * Stored file names keep the meaningful TAIL (and the extension): long names are shortened in the
 * middle ("foto-avion-rc-…-armado-final.jpg"), never cut at the front or the end.
 */
export function middleTruncate(name: string, max: number): string {
  if (name.length <= max) return name
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : ''
  const stem = ext ? name.slice(0, dot) : name
  const room = max - ext.length - 1
  const head = Math.ceil(room / 2)
  const tail = Math.floor(room / 2)
  return `${stem.slice(0, head).replace(/[-.]+$/, '')}-${stem.slice(stem.length - tail).replace(/^[-.]+/, '')}${ext}`
}
