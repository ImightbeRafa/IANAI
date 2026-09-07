import { Link } from 'react-router-dom'
import { useLanguage } from '../../contexts/LanguageContext'
import { CLASSIC_AUTH_HOME } from './chatShellRollout'
import type { ChatShellTheme } from './chatShellTheme'
import { AdvanceWordmark } from './ChatShellIcons'
import ThemeToggle from './ThemeToggle'

interface ChatShellGateProps {
  onRetry: () => void
  theme: ChatShellTheme
  onToggleTheme: () => void
  reason?: 'unreadable' | 'disabled' | 'invite'
  showThemeToggle?: boolean
}

export default function ChatShellGate({
  onRetry,
  theme,
  onToggleTheme,
  reason = 'disabled',
  showThemeToggle = true,
}: ChatShellGateProps) {
  const { language } = useLanguage()
  const es = language === 'es'
  const title =
    reason === 'unreadable'
      ? (es ? 'No se pudo leer el acceso de chat' : 'Could not read chat access')
      : reason === 'invite'
        ? (es ? 'Chat es por invitación' : 'Chat is invite-only')
        : (es ? 'Chat aún no está habilitado' : 'Chat is not enabled yet')
  const body =
    reason === 'unreadable'
      ? (es
        ? 'El entorno no pudo comprobar el acceso. Usá el panel actual y volvé a intentar.'
        : 'This environment could not confirm chat access. Use the current dashboard and retry.')
      : reason === 'invite'
        ? (es
          ? 'El chat nuevo está activo en este entorno, pero tu cuenta todavía usa el panel clásico. Pedí acceso para probarlo.'
          : 'The new chat is on in this environment, but your account still uses the classic dashboard. Ask for access to try it.')
        : (es
          ? 'El nuevo chat está apagado en este entorno. El panel clásico sigue siendo el inicio.'
          : 'The new chat is off in this environment. Classic remains home.')

  return (
    <div className="chat-shell__gate" data-theme={theme}>
      {showThemeToggle ? (
        <div className="chat-shell__gate-theme">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      ) : null}
      <div className="chat-shell__gate-card">
        <AdvanceWordmark size={22} />
        <h1>{title}</h1>
        <p>{body}</p>
        <div className="chat-shell__gate-actions">
          <Link to={CLASSIC_AUTH_HOME} className="chat-shell__btn chat-shell__btn--primary chat-shell__link-btn">
            {es ? 'Volver al panel' : 'Back to dashboard'}
          </Link>
          <button type="button" className="chat-shell__btn" onClick={onRetry}>
            {es ? 'Volver a comprobar' : 'Check again'}
          </button>
        </div>
      </div>
    </div>
  )
}
