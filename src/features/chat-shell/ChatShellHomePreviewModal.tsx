import { X } from 'lucide-react'

interface ChatShellHomePreviewModalProps {
  language?: 'es' | 'en'
  onConfirm: () => void
  onCancel: () => void
}

/** Cursor-style animated preview before setting chat as home. */
export default function ChatShellHomePreviewModal({
  language = 'es',
  onConfirm,
  onCancel,
}: ChatShellHomePreviewModalProps) {
  const es = language === 'es'
  return (
    <div className="chat-shell__feature-modal" role="dialog" aria-modal="true" aria-labelledby="chat-home-preview-title">
      <div className="chat-shell__feature-modal-backdrop" onClick={onCancel} />
      <div className="chat-shell__feature-modal-card chat-shell__home-preview-card">
        <button type="button" className="chat-shell__feature-modal-close" onClick={onCancel} aria-label={es ? 'Cerrar' : 'Close'}>
          <X size={16} />
        </button>
        <p className="chat-shell__gift-eyebrow">{es ? 'Nueva experiencia' : 'New experience'}</p>
        <h2 id="chat-home-preview-title">
          {es ? 'Usar Chat como inicio' : 'Use Chat as home'}
        </h2>
        <p className="chat-shell__gift-body">
          {es
            ? 'Vas a aterrizar en un solo chat por marca: carpetas a la izquierda, hilo al centro, Brand Kit junto al composer. Podés volver al panel clásico cuando quieras.'
            : 'You’ll land in one chat per brand: folders on the left, thread in the center, Brand Kit beside the composer. You can switch back to classic anytime.'}
        </p>
        <div className="chat-shell__home-preview-stage" aria-hidden>
          <div className="chat-shell__home-preview-shell">
            <aside className="chat-shell__home-preview-nav">
              <div className="chat-shell__home-preview-logo" />
              <div className="chat-shell__home-preview-folder is-active" />
              <div className="chat-shell__home-preview-folder" />
              <div className="chat-shell__home-preview-folder" />
            </aside>
            <main className="chat-shell__home-preview-main">
              <div className="chat-shell__home-preview-topbar" />
              <div className="chat-shell__home-preview-thread">
                <div className="chat-shell__home-preview-msg is-user chat-shell__home-preview-anim" />
                <div className="chat-shell__home-preview-msg is-ai chat-shell__home-preview-anim" />
                <div className="chat-shell__home-preview-card-row chat-shell__home-preview-anim">
                  <span />
                  <span />
                </div>
              </div>
              <div className="chat-shell__home-preview-composer">
                <div className="chat-shell__home-preview-kit">
                  <i className="is-on" />
                  <i />
                  <i />
                  <i />
                </div>
                <div className="chat-shell__home-preview-input" />
              </div>
            </main>
          </div>
        </div>
        <div className="chat-shell__feature-modal-actions">
          <button type="button" className="chat-shell__feature-modal-primary" onClick={onConfirm}>
            {es ? 'Sí, usar Chat como inicio' : 'Yes, make Chat my home'}
          </button>
          <button type="button" className="chat-shell__feature-modal-secondary" onClick={onCancel}>
            {es ? 'Ahora no' : 'Not now'}
          </button>
        </div>
      </div>
    </div>
  )
}
