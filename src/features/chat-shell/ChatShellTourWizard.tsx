import { useState } from 'react'
import {
  FolderKanban,
  MessageSquare,
  Package,
  Palette,
  Sparkles,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  CHAT_SHELL_TOUR_STEPS_EN,
  CHAT_SHELL_TOUR_STEPS_ES,
} from './chatShellTourSteps'

const STEP_ICONS = {
  single: MessageSquare,
  folders: FolderKanban,
  verbs: Package,
  setup: Palette,
  keep: ShieldCheck,
  credits: Sparkles,
} as const

interface ChatShellTourWizardProps {
  language?: 'es' | 'en'
  onFinish: () => void
  onSkipForever: () => void
}

export default function ChatShellTourWizard({
  language = 'es',
  onFinish,
  onSkipForever,
}: ChatShellTourWizardProps) {
  const [index, setIndex] = useState(0)
  const steps = language === 'en' ? CHAT_SHELL_TOUR_STEPS_EN : CHAT_SHELL_TOUR_STEPS_ES
  const step = steps[index]
  const Icon = STEP_ICONS[step.id]
  const last = index === steps.length - 1
  const es = language === 'es'
  const verbsOn = step.id === 'verbs' || step.id === 'single'

  return (
    <div className="chat-shell__feature-modal" role="dialog" aria-modal="true" aria-labelledby="chat-shell-tour-title">
      <div className="chat-shell__feature-modal-backdrop" />
      <div className="chat-shell__feature-modal-card chat-shell__tour-card">
        <button
          type="button"
          className="chat-shell__feature-modal-close"
          onClick={onSkipForever}
          aria-label={es ? 'Cerrar' : 'Close'}
        >
          <X size={16} />
        </button>
        <div className="chat-shell__tour-progress" aria-hidden>
          {steps.map((item, i) => (
            <span key={item.id} className={i <= index ? 'is-on' : ''} />
          ))}
        </div>
        <div className="chat-shell__tour-icon" aria-hidden>
          <Icon size={22} />
        </div>
        <p className="chat-shell__gift-eyebrow">
          {es ? `Paso ${index + 1} de ${steps.length}` : `Step ${index + 1} of ${steps.length}`}
        </p>
        <h2 id="chat-shell-tour-title">{step.title}</h2>
        <p className="chat-shell__gift-body">{step.body}</p>
        <div className="chat-shell__tour-mock" aria-hidden>
          <div className="chat-shell__tour-mock-sidebar" />
          <div className="chat-shell__tour-mock-stage">
            <div className="chat-shell__tour-mock-bubble is-user" />
            <div className="chat-shell__tour-mock-bubble is-ai" />
            <div className="chat-shell__tour-mock-kit" data-tour-verbs={step.id === 'verbs' ? 'on' : 'off'}>
              <span className={verbsOn ? 'is-on' : ''}>{es ? 'Guiones' : 'Scripts'}</span>
              <span className={step.id === 'verbs' ? 'is-on' : ''}>Post</span>
              <span className={step.id === 'verbs' ? 'is-on' : ''}>{es ? 'Foto' : 'Photo'}</span>
              <span className={step.id === 'verbs' ? 'is-on' : ''}>Pack</span>
            </div>
          </div>
        </div>
        <div className="chat-shell__feature-modal-actions">
          {!last ? (
            <button type="button" className="chat-shell__feature-modal-primary" onClick={() => setIndex((v) => v + 1)}>
              {es ? 'Siguiente' : 'Next'}
            </button>
          ) : (
            <button type="button" className="chat-shell__feature-modal-primary" onClick={onFinish}>
              {es ? 'Listo, a crear' : 'Done, let’s create'}
            </button>
          )}
          <button type="button" className="chat-shell__feature-modal-secondary" onClick={onSkipForever}>
            {es ? 'Saltar y no volver a mostrar' : 'Skip and never show again'}
          </button>
        </div>
        <p className="chat-shell__gift-feedback">
          {es
            ? 'Feedback apreciado — usá el botón de feedback cuando quieras.'
            : 'Feedback appreciated — use the feedback button anytime.'}
        </p>
      </div>
    </div>
  )
}
