import { useState } from 'react'
import {
  FolderKanban,
  LayoutDashboard,
  MessageSquare,
  Package,
  Palette,
  Sparkles,
  X,
} from 'lucide-react'

const STEPS_ES = [
  {
    id: 'single',
    title: 'Un chat para todo',
    body: 'En este espacio pedís guiones, posts y fotos en el mismo hilo. No hace falta saltar entre pantallas: el chat entiende qué querés crear.',
    icon: MessageSquare,
  },
  {
    id: 'folders',
    title: 'Marcas y carpetas',
    body: 'Cada marca vive en su carpeta a la izquierda. Cambiá de marca sin perder el contexto: cada chat guarda ofertas, guiones e imágenes de esa marca.',
    icon: FolderKanban,
  },
  {
    id: 'brandkit',
    title: 'Brand Kit al lado del composer',
    body: 'El Brand Kit (Guiones, Post, Foto, Pack) está a la izquierda del cuadro de texto. Usalo para arrancar rápido. También podés escribir en el chat: “generame 2 de venta”.',
    icon: Package,
  },
  {
    id: 'setup',
    title: 'Setup de marca',
    body: 'La barra de Setup te muestra qué falta: negocio, canales, público, oferta, visual y fuentes. Tocá lo que falte y el chat te guía. Sin oferta clara no se generan guiones — te lo vamos a pedir.',
    icon: Palette,
  },
  {
    id: 'classic',
    title: 'Clásico ↔ Chat',
    body: 'Podés usar Chat como inicio o volver al panel clásico cuando quieras. Nadie te obliga a aprender todo de golpe.',
    icon: LayoutDashboard,
  },
  {
    id: 'credits',
    title: 'Créditos y feedback',
    body: 'Te regalamos créditos para probar. Un guion cuesta 3, una imagen 6, Pro 24. Contanos qué mejorar — leemos el feedback.',
    icon: Sparkles,
  },
] as const

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
  const steps = STEPS_ES
  const step = steps[index]
  const Icon = step.icon
  const last = index === steps.length - 1
  const es = language === 'es'

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
            <div className="chat-shell__tour-mock-kit">
              <span className={step.id === 'brandkit' || step.id === 'single' ? 'is-on' : ''} />
              <span />
              <span />
              <span />
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
