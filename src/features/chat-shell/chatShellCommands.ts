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

export interface ShellCommandOption {
  id: ShellCommandId
  aliases: string[]
  insert: string
  href?: string
  label: { es: string; en: string }
  hint: { es: string; en: string }
}

export const SHELL_COMMANDS: ShellCommandOption[] = [
  {
    id: 'script',
    aliases: ['guion', 'guiones', 'script', 'scripts'],
    insert: '/guion ',
    label: { es: 'Guion', en: 'Script' },
    hint: { es: 'Crear guiones de venta', en: 'Create sales scripts' },
  },
  {
    id: 'post',
    aliases: ['post', 'posts', 'anuncio', 'imagen'],
    insert: '/post ',
    label: { es: 'Post', en: 'Post' },
    hint: { es: 'Crear un anuncio o imagen', en: 'Create an ad or image' },
  },
  {
    id: 'product',
    aliases: ['producto', 'product', 'foto'],
    insert: '/producto ',
    label: { es: 'Producto', en: 'Product' },
    hint: { es: 'Foto de producto', en: 'Product photo' },
  },
  {
    id: 'logo',
    aliases: ['logo', 'logos', 'marca-logo'],
    insert: '/logo ',
    label: { es: 'Logo', en: 'Logo' },
    hint: { es: 'Crear o editar un logo', en: 'Create or edit a logo' },
  },
  {
    id: 'brand',
    aliases: ['marca', 'brand', 'kit'],
    insert: '/marca ',
    label: { es: 'Marca', en: 'Brand' },
    hint: { es: 'Abrir el perfil de marca', en: 'Open the brand profile' },
  },
  {
    id: 'descriptions',
    aliases: ['descripciones', 'descriptions'],
    insert: '/descripciones ',
    href: '/descriptions',
    label: { es: 'Descripciones', en: 'Descriptions' },
    hint: { es: 'Ir a descripciones', en: 'Open descriptions' },
  },
  {
    id: 'replies',
    aliases: ['respuestas', 'replies', 'dm'],
    insert: '/respuestas ',
    href: '/respuestas',
    label: { es: 'Respuestas', en: 'Replies' },
    hint: { es: 'Ir a respuestas de chat', en: 'Open chat replies' },
  },
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
  const match = SHELL_COMMANDS.find((c) => c.aliases.includes(token))
  if (!match) return null
  return { id: match.id, rest, href: match.href }
}

/** Token after `/` while the user is still typing a command (no args yet). */
export function slashPaletteQuery(raw: string): string | null {
  if (!raw.startsWith('/')) return null
  const line = raw.split('\n', 1)[0] ?? raw
  const without = line.slice(1)
  if (/\s/.test(without)) return null
  return without.toLowerCase()
}

export function matchSlashCommands(raw: string): ShellCommandOption[] {
  const query = slashPaletteQuery(raw)
  if (query === null) return []
  if (!query) return SHELL_COMMANDS
  return SHELL_COMMANDS.filter((command) =>
    command.aliases.some((alias) => alias.startsWith(query) || alias.includes(query))
  )
}
