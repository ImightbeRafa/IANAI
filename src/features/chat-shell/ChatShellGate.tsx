import { Link } from 'react-router-dom'
import type { ChatShellTheme } from './chatShellTheme'
import ThemeToggle from './ThemeToggle'

interface ChatShellGateProps {
  onRetry: () => void
  theme: ChatShellTheme
  onToggleTheme: () => void
}

export default function ChatShellGate({ onRetry, theme, onToggleTheme }: ChatShellGateProps) {
  return (
    <div className="chat-shell__gate" data-theme={theme}>
      <div className="chat-shell__gate-theme">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      <div className="chat-shell__gate-card">
        <div className="chat-shell__gate-brand">Advance AI</div>
        <h1>Chat aún no está habilitado</h1>
        <p>
          El nuevo shell de chat está desactivado en este entorno.
          Usá el panel actual mientras el flag <code>chat_shell</code> permanezca apagado.
        </p>
        <div className="chat-shell__gate-actions">
          <Link to="/dashboard" className="chat-shell__btn chat-shell__btn--primary chat-shell__link-btn">
            Volver al panel
          </Link>
          <button type="button" className="chat-shell__btn" onClick={onRetry}>
            Volver a comprobar
          </button>
        </div>
      </div>
    </div>
  )
}
