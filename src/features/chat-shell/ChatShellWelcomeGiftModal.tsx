import { Gift, MessageSquare, Sparkles, X } from 'lucide-react'

interface ChatShellWelcomeGiftModalProps {
  credits: number
  granted: boolean
  language?: 'es' | 'en'
  onContinue: () => void
  onDismiss: () => void
}

export default function ChatShellWelcomeGiftModal({
  credits,
  granted,
  language = 'es',
  onContinue,
  onDismiss,
}: ChatShellWelcomeGiftModalProps) {
  const es = language === 'es'
  return (
    <div className="chat-shell__feature-modal" role="dialog" aria-modal="true" aria-labelledby="chat-shell-gift-title">
      <div className="chat-shell__feature-modal-backdrop" onClick={onDismiss} />
      <div className="chat-shell__feature-modal-card chat-shell__gift-card">
        <button type="button" className="chat-shell__feature-modal-close" onClick={onDismiss} aria-label={es ? 'Cerrar' : 'Close'}>
          <X size={16} />
        </button>
        <div className="chat-shell__gift-hero" aria-hidden>
          <span className="chat-shell__gift-orb" />
          <Gift size={28} />
        </div>
        <p className="chat-shell__gift-eyebrow">
          <Sparkles size={12} />
          {es ? 'Nuevo Chat' : 'New Chat'}
        </p>
        <h2 id="chat-shell-gift-title">
          {es ? 'Un chat para todo' : 'One chat for everything'}
        </h2>
        <p className="chat-shell__gift-body">
          {es
            ? (granted
              ? `Te regalamos ${credits} Créditos IA (válidos 12 meses) para que pruebes el nuevo chat: guiones, posts y fotos en el mismo hilo, por marca.`
              : `El nuevo chat une guiones, posts y fotos en un solo hilo por marca. Tus ${credits} créditos de bienvenida ya están en tu billetera (12 meses).`)
            : (granted
              ? `We gifted you ${credits} AI credits (valid 12 months) to try the new chat: scripts, posts, and photos in one thread per brand.`
              : `The new chat unifies scripts, posts, and photos in one thread per brand. Your ${credits} welcome credits are already in your wallet (12 months).`)}
        </p>
        <ul className="chat-shell__gift-points">
          <li>
            <MessageSquare size={14} />
            {es ? 'Pedí lo que necesités en lenguaje natural' : 'Ask for what you need in plain language'}
          </li>
          <li>
            <Sparkles size={14} />
            {es ? 'Podés volver al panel clásico cuando quieras' : 'You can switch back to classic anytime'}
          </li>
        </ul>
        <p className="chat-shell__gift-feedback">
          {es
            ? 'Tu feedback nos ayuda muchísimo — contanos qué funciona y qué no.'
            : 'Your feedback helps a lot — tell us what works and what doesn’t.'}
        </p>
        <div className="chat-shell__feature-modal-actions">
          <button type="button" className="chat-shell__feature-modal-primary" onClick={onContinue}>
            {es ? 'Ver cómo funciona' : 'See how it works'}
          </button>
          <button type="button" className="chat-shell__feature-modal-secondary" onClick={onDismiss}>
            {es ? 'Empezar ya' : 'Start now'}
          </button>
        </div>
      </div>
    </div>
  )
}
