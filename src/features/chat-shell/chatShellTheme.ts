export const CHAT_SHELL_THEME_KEY = 'ianai.chat-shell.theme'

export type ChatShellTheme = 'obsidian-dark' | 'obsidian-light'

export function isChatShellTheme(value: unknown): value is ChatShellTheme {
  return value === 'obsidian-dark' || value === 'obsidian-light'
}

export function resolveChatShellTheme(
  stored: string | null | undefined,
  prefersLight: boolean
): ChatShellTheme {
  if (isChatShellTheme(stored)) return stored
  return prefersLight ? 'obsidian-light' : 'obsidian-dark'
}

export function readStoredChatShellTheme(): string | null {
  try {
    return localStorage.getItem(CHAT_SHELL_THEME_KEY)
  } catch {
    return null
  }
}

export function persistChatShellTheme(theme: ChatShellTheme): void {
  try {
    localStorage.setItem(CHAT_SHELL_THEME_KEY, theme)
  } catch {
    // ignore quota / private mode
  }
}

export function systemPrefersLight(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: light)').matches
}

export function applyChatShellTheme(theme: ChatShellTheme): void {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.classList.add('chat-shell-route')
  root.style.colorScheme = theme === 'obsidian-light' ? 'light' : 'dark'
}

export function clearChatShellTheme(): void {
  const root = document.documentElement
  root.removeAttribute('data-theme')
  root.classList.remove('chat-shell-route')
  root.style.removeProperty('color-scheme')
}

export function getInitialChatShellTheme(): ChatShellTheme {
  return resolveChatShellTheme(readStoredChatShellTheme(), systemPrefersLight())
}
