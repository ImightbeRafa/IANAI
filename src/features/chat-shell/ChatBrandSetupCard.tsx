import { useState } from 'react'
import { Check, ChevronDown, Settings2 } from 'lucide-react'
import { stepComplete, type BrandSetupStepId } from './chatShellBrandSetup'
import type { useChatBrandSetup } from './useChatBrandSetup'

const STEP_LABEL = {
  es: {
    business: 'Negocio',
    channels: 'Canales',
    audience: 'Público',
    offer: 'Oferta',
    brand: 'Marca visual',
    sources: 'Fuentes',
    skip: 'Saltar',
    title: 'Setup de marca',
    hint: 'Tocá lo que falte — el chat te guía. Desaparece cuando esté completo.',
    open: 'Configurar',
    close: 'Cerrar',
  },
  en: {
    business: 'Business',
    channels: 'Channels',
    audience: 'Audience',
    offer: 'Offer',
    brand: 'Brand look',
    sources: 'Sources',
    skip: 'Skip',
    title: 'Brand setup',
    hint: 'Tap what’s missing — chat guides you. This bar hides when it’s complete.',
    open: 'Configure',
    close: 'Close',
  },
} as const

interface ChatBrandSetupCardProps {
  language?: 'en' | 'es'
  setup: ReturnType<typeof useChatBrandSetup>
}

export default function ChatBrandSetupCard({ language = 'es', setup }: ChatBrandSetupCardProps) {
  const t = STEP_LABEL[language]
  const [expanded, setExpanded] = useState(false)
  if (!setup.trackerVisible) return null
  const doneCount = setup.steps.filter((step) => setup.stepComplete(setup.snapshot, step)).length

  return (
    <div className={`chat-shell__setup-pin${expanded ? ' is-expanded' : ' is-collapsed'}`} aria-label={t.title}>
      <div className="chat-shell__setup-pin-bar">
        <Settings2 size={13} className="chat-shell__setup-pin-icon" />
        <span className="chat-shell__setup-progress">{doneCount}/{setup.steps.length}</span>
        <strong className="chat-shell__setup-pin-title">{t.title}</strong>
        <span className="chat-shell__setup-pin-hint">{t.hint}</span>
        <button
          type="button"
          className="chat-shell__setup-pin-toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? t.close : t.open}<ChevronDown size={13} />
        </button>
      </div>
      {expanded ? (
        <div className="chat-shell__setup-pin-expanded">
          <ul className="chat-shell__setup-pin-steps">
            {setup.steps.map((step: BrandSetupStepId) => {
              const done = stepComplete(setup.snapshot, step)
              return (
                <li key={step}>
                  <button
                    type="button"
                    className={`chat-shell__setup-pin-step${done ? ' is-done' : ''}`}
                    onClick={() => {
                      setExpanded(false)
                      void setup.askStep(step)
                    }}
                    disabled={setup.busy}
                  >
                    <span className={`chat-shell__setup-check${done ? ' is-on' : ''}`} aria-hidden>
                      {done ? <Check size={10} /> : null}
                    </span>
                    {t[step]}
                  </button>
                </li>
              )
            })}
          </ul>
          <button type="button" className="chat-shell__setup-skip" onClick={setup.skip} disabled={setup.busy}>
            {t.skip}
          </button>
        </div>
      ) : null}
    </div>
  )
}
