import type { ShellCommandOption } from './chatShellCommands'

interface ChatSlashCommandPaletteProps {
  commands: ShellCommandOption[]
  activeIndex: number
  language: 'es' | 'en'
  listId: string
  onHover: (index: number) => void
  onSelect: (command: ShellCommandOption) => void
}

export default function ChatSlashCommandPalette({
  commands,
  activeIndex,
  language,
  listId,
  onHover,
  onSelect,
}: ChatSlashCommandPaletteProps) {
  if (commands.length === 0) return null

  return (
    <div className="chat-shell__slash-palette" id={listId} role="listbox" aria-label={language === 'es' ? 'Comandos' : 'Commands'}>
      {commands.map((command, index) => {
        const optionId = `${listId}-${command.id}`
        const active = index === activeIndex
        return (
          <button
            key={command.id}
            id={optionId}
            type="button"
            role="option"
            aria-selected={active}
            className={`chat-shell__slash-option${active ? ' is-active' : ''}`}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(command)
            }}
          >
            <span className="chat-shell__slash-token">{command.insert.trim()}</span>
            <span className="chat-shell__slash-copy">
              <strong>{command.label[language]}</strong>
              <small>{command.hint[language]}</small>
            </span>
          </button>
        )
      })}
    </div>
  )
}
