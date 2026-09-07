import { useEffect, useState } from 'react'
import {
  FolderKanban,
  MessageSquare,
  MessageSquarePlus,
  Package,
  Palette,
  X,
} from 'lucide-react'
import ChatShellTourSpotlight from './ChatShellTourSpotlight'
import {
  chatShellTourSteps,
  type ChatShellTourStepId,
} from './chatShellTourSteps'

interface ChatShellTourWizardProps {
  language?: 'es' | 'en'
  onFinish: () => void
  onSkipForever: () => void
  onStepChange?: (id: ChatShellTourStepId) => void
  onOpenFeedback?: () => void
}

function stepIcon(id: ChatShellTourStepId) {
  switch (id) {
    case 'single':
      return MessageSquare
    case 'folders':
      return FolderKanban
    case 'verbs':
      return Package
    case 'setup':
      return Palette
    case 'feedback':
      return MessageSquarePlus
    default: {
      const _never: never = id
      return _never
    }
  }
}

export default function ChatShellTourWizard({
  language = 'es',
  onFinish,
  onSkipForever,
  onStepChange,
  onOpenFeedback,
}: ChatShellTourWizardProps) {
  const [index, setIndex] = useState(0)
  const steps = chatShellTourSteps(language)
  const step = steps[index]
  const Icon = stepIcon(step.id)
  const last = index === steps.length - 1
  const es = language === 'es'

  useEffect(() => {
    onStepChange?.(step.id)
  }, [onStepChange, step.id])

  const verbLabels = es
    ? ['Guiones', 'Post', 'Foto', 'Pack']
    : ['Scripts', 'Post', 'Photo', 'Pack']

  return (
    <ChatShellTourSpotlight targetSelector={step.target} placement={step.placement}>
      <div
        className="chat-shell__feature-modal-card chat-shell__tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-shell-tour-title"
      >
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
        {step.id === 'verbs' ? (
          <div className="chat-shell__tour-verbs" aria-hidden>
            {verbLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        ) : null}
        {step.creditsNote ? (
          <p className="chat-shell__tour-credits-note">{step.creditsNote}</p>
        ) : null}
        <div className="chat-shell__feature-modal-actions">
          {step.feedbackCta ? (
            <button
              type="button"
              className="chat-shell__feature-modal-primary"
              onClick={() => (onOpenFeedback ? onOpenFeedback() : onFinish())}
            >
              {es ? 'Dejar feedback' : 'Send feedback'}
            </button>
          ) : null}
          {!last ? (
            <button
              type="button"
              className={step.feedbackCta ? 'chat-shell__feature-modal-secondary' : 'chat-shell__feature-modal-primary'}
              onClick={() => setIndex((v) => v + 1)}
            >
              {es ? 'Siguiente' : 'Next'}
            </button>
          ) : (
            <button
              type="button"
              className={step.feedbackCta ? 'chat-shell__feature-modal-secondary' : 'chat-shell__feature-modal-primary'}
              onClick={onFinish}
            >
              {es ? 'Listo, a crear' : 'Done, let’s create'}
            </button>
          )}
          {index > 0 ? (
            <button
              type="button"
              className="chat-shell__tour-back"
              onClick={() => setIndex((v) => Math.max(0, v - 1))}
            >
              {es ? 'Atrás' : 'Back'}
            </button>
          ) : null}
          <button
            type="button"
            className="chat-shell__feature-modal-secondary"
            onClick={onSkipForever}
            title={es ? 'Saltar no borra marcas, kits ni chats' : 'Skip does not delete brands, kits, or chats'}
          >
            {es ? 'Saltar y no volver a mostrar' : 'Skip and never show again'}
          </button>
        </div>
      </div>
    </ChatShellTourSpotlight>
  )
}
