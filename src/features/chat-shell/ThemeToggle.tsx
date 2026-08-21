import { Moon, Sun } from 'lucide-react'
import type { ChatShellTheme } from './chatShellTheme'

interface ThemeToggleProps {
  theme: ChatShellTheme
  onToggle: () => void
  className?: string
}

export default function ThemeToggle({ theme, onToggle, className }: ThemeToggleProps) {
  const isDark = theme === 'obsidian-dark'
  return (
    <button
      type="button"
      className={['chat-shell__icon-btn', className].filter(Boolean).join(' ')}
      onClick={onToggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light' : 'Dark'}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
