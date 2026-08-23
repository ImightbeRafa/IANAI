import { useEffect, useState } from 'react'
import { IconAdvanceMark } from './ChatShellIcons'
import type { ImageModel, ScriptFramework } from '../../types'
import type { ShellImageAspect } from './chatShellImageIntent'

export type ChatShellProgressKind = 'setup' | 'script' | 'image'

export type ChatShellProgressContext = {
  scriptType?: ScriptFramework | 'mixed' | string | null
  offerName?: string | null
}

const SETUP_STEPS = {
  es: [
    'Leyendo el sitio y el texto…',
    'Extrayendo el negocio y la oferta…',
    'Armando el resumen…',
  ],
  en: [
    'Reading the site and your text…',
    'Extracting the business and offer…',
    'Drafting the summary…',
  ],
} as const

function scriptStepsFor(
  language: 'en' | 'es',
  scriptType?: string | null
): readonly string[] {
  const type = (scriptType || '').toLowerCase()
  const sales = type === 'venta_directa' || type === 'desvalidar' || type === 'mixed' || type === 'venta-directa'
  if (language === 'es') {
    if (type === 'educativo') {
      return ['Entendiendo qué enseñar…', 'Eligiendo el ejemplo…', 'Escribiendo la lección…', 'Cerrando con la acción…']
    }
    if (type === 'storytelling') {
      return ['Eligiendo la historia…', 'Armando el conflicto…', 'Llevando al giro…', 'Cerrando con la marca…']
    }
    if (sales) {
      return ['Leyendo la oferta y el ángulo…', 'Escribiendo el gancho…', 'Armando prueba y beneficios…', 'Cerrando con el CTA…']
    }
    return ['Analizando tu pedido…', 'Eligiendo el ángulo…', 'Escribiendo el guion…', 'Ajustando el cierre…']
  }
  if (type === 'educativo') {
    return ['Deciding what to teach…', 'Picking the example…', 'Writing the lesson…', 'Closing with the action…']
  }
  if (type === 'storytelling') {
    return ['Choosing the story…', 'Building the conflict…', 'Landing the turn…', 'Closing with the brand…']
  }
  if (sales) {
    return ['Reading the offer and angle…', 'Writing the hook…', 'Building proof and benefits…', 'Closing with the CTA…']
  }
  return ['Reading your ask…', 'Choosing the angle…', 'Writing the script…', 'Tightening the close…']
}

export function progressStepsFor(
  kind: ChatShellProgressKind,
  language: 'en' | 'es',
  context?: ChatShellProgressContext
): readonly string[] {
  switch (kind) {
    case 'setup':
      return SETUP_STEPS[language]
    case 'script':
      return scriptStepsFor(language, context?.scriptType)
    case 'image':
      return []
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

function imageLabel(language: 'en' | 'es'): string {
  return language === 'es' ? 'Generando post…' : 'Generating post…'
}

function headingFor(
  kind: ChatShellProgressKind,
  language: 'en' | 'es',
  context?: ChatShellProgressContext
): string {
  switch (kind) {
    case 'setup':
      return language === 'es' ? 'Leyendo el sitio' : 'Reading the site'
    case 'script': {
      const type = (context?.scriptType || '').toLowerCase()
      if (type === 'educativo') return language === 'es' ? 'Escribiendo educativo' : 'Writing educational'
      if (type === 'storytelling') return language === 'es' ? 'Escribiendo storytelling' : 'Writing storytelling'
      if (type === 'venta_directa' || type === 'venta-directa' || type === 'desvalidar' || type === 'mixed') {
        return language === 'es' ? 'Escribiendo venta directa' : 'Writing a direct-sale script'
      }
      return language === 'es' ? 'Escribiendo guion' : 'Writing script'
    }
    case 'image':
      return language === 'es' ? 'Generando' : 'Generating'
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

interface ChatShellProgressProps {
  kind: ChatShellProgressKind
  language?: 'en' | 'es'
  subtitle?: string
  imageModel?: ImageModel
  aspectRatio?: ShellImageAspect
  context?: ChatShellProgressContext
}

export default function ChatShellProgress({
  kind,
  language = 'es',
  subtitle,
  imageModel = 'grok-imagine',
  aspectRatio = '9:16',
  context,
}: ChatShellProgressProps) {
  const steps = progressStepsFor(kind, language, context)
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    setCurrentStep(0)
  }, [kind, language, context?.scriptType])

  useEffect(() => {
    if (steps.length < 2) return
    const id = window.setInterval(() => {
      setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1))
    }, 2200)
    return () => window.clearInterval(id)
  }, [steps.length, kind, language, context?.scriptType])

  if (kind === 'image') {
    const cssRatio = aspectRatio.replace(':', '/')
    return (
      <div className="chat-shell__msg chat-shell__msg--ai" role="status" aria-live="polite">
        <span className="chat-shell__who">Advance AI</span>
        <div
          className="chat-shell__gen-frame"
          style={{ aspectRatio: cssRatio }}
        >
          <IconAdvanceMark size={32} className="chat-shell__gen-icon" />
          <p className="chat-shell__gen-label">{imageLabel(language)}</p>
          <p className="chat-shell__gen-sub">{subtitle || imageModel}</p>
          <span className="chat-shell__gen-dots" aria-hidden>
            <i /><i /><i />
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-shell__msg chat-shell__msg--ai" role="status" aria-live="polite">
      <span className="chat-shell__who">Advance AI</span>
      <div className="chat-shell__think">
        <div className="chat-shell__think-head">
          <span className="chat-shell__think-mark">
            <IconAdvanceMark size={13} />
          </span>
          <span className="chat-shell__think-kicker">{headingFor(kind, language, context)}</span>
          {subtitle ? <span className="chat-shell__think-sub">{subtitle}</span> : null}
        </div>
        <ul className="chat-shell__think-steps">
          {steps.map((step, index) => (
            <li
              key={step}
              className={
                index === currentStep
                  ? 'is-active'
                  : index < currentStep
                    ? 'is-done'
                    : undefined
              }
            >
              {step}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
