export type ShellCommandId =
  | 'script'
  | 'post'
  | 'product'
  | 'logo'
  | 'brand'
  | 'descriptions'
  | 'replies'

export interface ParsedShellCommand {
  id: ShellCommandId
  rest: string
  href?: string
}

const COMMANDS: Array<{ id: ShellCommandId; aliases: string[]; href?: string }> = [
  { id: 'script', aliases: ['guion', 'guiones', 'script', 'scripts'] },
  { id: 'post', aliases: ['post', 'posts', 'anuncio', 'imagen'] },
  { id: 'product', aliases: ['producto', 'product', 'foto'] },
  { id: 'logo', aliases: ['logo', 'logos', 'marca-logo'] },
  { id: 'brand', aliases: ['marca', 'brand', 'kit'] },
  { id: 'descriptions', aliases: ['descripciones', 'descriptions'], href: '/descriptions' },
  { id: 'replies', aliases: ['respuestas', 'replies', 'dm'], href: '/respuestas' },
]

/**
 * Parse a leading slash command. Unknown commands return null (treat as chat).
 * Settings and Admin stay on the gear / protected routes — not slash commands.
 */
export function parseShellCommand(raw: string): ParsedShellCommand | null {
  const text = raw.trim()
  if (!text.startsWith('/')) return null
  const without = text.slice(1)
  const space = without.search(/\s/)
  const token = (space === -1 ? without : without.slice(0, space)).toLowerCase()
  const rest = (space === -1 ? '' : without.slice(space + 1)).trim()
  if (!token) return null
  const match = COMMANDS.find((c) => c.aliases.includes(token))
  if (!match) return null
  return { id: match.id, rest, href: match.href }
}
