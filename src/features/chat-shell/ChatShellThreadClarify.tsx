import type { ScriptFramework } from '../../types'
import type { ScriptCtaChannel } from './chatShellCtaMix'
import type { ScriptClarifyAnswer, ScriptClarifyState } from './useChatSessionThread'

interface ChatShellThreadClarifyProps {
  language: 'es' | 'en'
  state: ScriptClarifyState
  onAnswer: (answer: ScriptClarifyAnswer) => void
  onCancel: () => void
}

/**
 * In-thread clarify chips for NL post/guion campaigns.
 * Never mounts ChatShellFlowSheet / modal-root.
 */
export default function ChatShellThreadClarify({
  language,
  state,
  onAnswer,
  onCancel,
}: ChatShellThreadClarifyProps) {
  const es = language === 'es'
  const question =
    state.step === 'type'
      ? (es ? '¿Qué tipo de guion?' : 'Which script type?')
      : state.step === 'count'
        ? (es ? '¿Cuántos?' : 'How many?')
        : (es ? '¿CTA web, mensaje o sin CTA?' : 'CTA: web, message, or none?')

  return (
    <div
      className="chat-shell__clarify"
      role="group"
      data-testid="thread-nl-clarify"
      aria-label={es ? 'Aclaración en el hilo' : 'In-thread clarification'}
    >
      <p className="chat-shell__clarify-question">{question}</p>
      <div className="chat-shell__clarify-chips">
        {state.step === 'type' ? (
          ([
            ['venta_directa', es ? 'Venta directa' : 'Direct sale'],
            ['educativo', es ? 'Educativo' : 'Educational'],
            ['storytelling', 'Storytelling'],
            ['reconocimiento', es ? 'Reconocimiento' : 'Awareness'],
            ['mixed', es ? 'Mezcla inteligente' : 'Smart mix'],
          ] as Array<[ScriptFramework | 'mixed', string]>).map(([type, label]) => (
            <button
              key={type}
              type="button"
              className="chat-shell__btn chat-shell__btn--pill"
              onClick={() => onAnswer({ type })}
            >
              {label}
            </button>
          ))
        ) : null}
        {state.step === 'count' ? (
          [1, 2, 3, 5].map((count) => (
            <button
              key={count}
              type="button"
              className="chat-shell__btn chat-shell__btn--pill"
              onClick={() => onAnswer({ count })}
            >
              {count}
            </button>
          ))
        ) : null}
        {state.step === 'cta' ? (
          ([
            ['website', es ? 'Comprar en web' : 'Buy on website'],
            ['messages', es ? 'Enviar mensaje' : 'Send a message'],
            ['none', es ? 'Sin CTA' : 'No CTA'],
          ] as Array<[ScriptCtaChannel, string]>).map(([channel, label]) => (
            <button
              key={channel}
              type="button"
              className="chat-shell__btn chat-shell__btn--pill"
              onClick={() => onAnswer({ ctaChannel: channel })}
            >
              {label}
            </button>
          ))
        ) : null}
        <button type="button" className="chat-shell__btn chat-shell__btn--ghost" onClick={onCancel}>
          {es ? 'Cancelar' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}
