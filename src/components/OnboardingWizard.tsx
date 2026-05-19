import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../contexts/LanguageContext'
import type { OnboardingStep } from '../hooks/useOnboarding'
import OnboardingSpotlight from './OnboardingSpotlight'
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  X,
  FileText,
  ImageIcon,
  AlignLeft,
  Settings,
  LayoutDashboard,
  Rocket,
  ChevronRight,
  MessageSquarePlus,
} from 'lucide-react'

interface OnboardingWizardProps {
  currentStep: OnboardingStep
  stepIndex: number
  totalSteps: number
  nextStep: () => void
  prevStep: () => void
  skipAll: () => void
}

interface StepContent {
  title: string
  description: string
  subTip?: string
}

function getStepContent(step: OnboardingStep, language: 'en' | 'es'): StepContent {
  const content: Record<OnboardingStep, { es: StepContent; en: StepContent }> = {
    welcome: {
      es: {
        title: '¡Bienvenido a Advance AI!',
        description: 'Te guiaremos por la plataforma en menos de un minuto. Descubre cómo generar guiones, posts e imágenes con IA para tu negocio.',
      },
      en: {
        title: 'Welcome to Advance AI!',
        description: "We'll walk you through the platform in under a minute. Discover how to generate AI scripts, posts, and images for your business.",
      },
    },
    dashboard: {
      es: {
        title: 'Tu Panel de Inicio',
        description: 'Aquí verás tus estadísticas de uso, guiones recientes, y accesos rápidos a todas las herramientas.',
        subTip: 'Los contadores se actualizan en tiempo real con tu actividad.',
      },
      en: {
        title: 'Your Dashboard',
        description: 'Here you\'ll see your usage stats, recent scripts, and quick access to all tools.',
        subTip: 'Counters update in real-time as you use the platform.',
      },
    },
    scripts: {
      es: {
        title: 'Guiones de Venta',
        description: 'Crea un Negocio → Agrega un Producto → y genera guiones de anuncios con IA adaptados a tu audiencia.',
        subTip: 'Puedes configurar cuántos guiones generar, elegir tipos específicos, agregar notas de voz y pegar links de contexto.',
      },
      en: {
        title: 'Ad Scripts',
        description: 'Create a Business → Add a Product → then generate AI ad scripts tailored to your audience.',
        subTip: 'You can configure how many scripts, choose script types, add voice notes, and paste context links.',
      },
    },
    posts: {
      es: {
        title: 'Posts de Instagram',
        description: 'Transforma tus guiones en imágenes profesionales para redes sociales. Elige estilo visual, paleta de colores y formato.',
        subTip: 'También puedes mejorar o editar imágenes generadas con IA.',
      },
      en: {
        title: 'Instagram Posts',
        description: 'Transform your scripts into professional social media images. Choose a visual style, color palette, and format.',
        subTip: 'You can also enhance or edit generated images with AI.',
      },
    },
    descriptions: {
      es: {
        title: 'Descripciones',
        description: 'Genera descripciones automáticas para tus anuncios y posts de redes sociales a partir de tus guiones.',
        subTip: 'Incluye hashtags relevantes y múltiples variaciones de tono.',
      },
      en: {
        title: 'Descriptions',
        description: 'Auto-generate descriptions for social media ads and posts from your scripts.',
        subTip: 'Includes relevant hashtags and multiple tone variations.',
      },
    },
    settings: {
      es: {
        title: 'Configuración',
        description: 'Cambia tu idioma, administra tu plan de suscripción y revisa tus límites de uso actuales.',
      },
      en: {
        title: 'Settings',
        description: 'Change your language, manage your subscription plan, and check your current usage limits.',
      },
    },
    feedback: {
      es: {
        title: '¡Tu opinión importa!',
        description: 'Usa este botón para reportar bugs, sugerir mejoras o hacer preguntas. Puedes incluso adjuntar capturas de pantalla.',
        subTip: 'Cada feedback nos ayuda a mejorar la plataforma para ti. ¡No dudes en escribirnos!',
      },
      en: {
        title: 'Your feedback matters!',
        description: 'Use this button to report bugs, suggest improvements, or ask questions. You can even attach screenshots.',
        subTip: 'Every piece of feedback helps us improve the platform for you. Don\'t hesitate to reach out!',
      },
    },
    complete: {
      es: {
        title: '¡Todo listo!',
        description: 'Ya conoces las herramientas principales. Empieza creando tu primer Negocio y Producto en Guiones.',
      },
      en: {
        title: "You're all set!",
        description: 'You now know the main tools. Start by creating your first Business and Product in Scripts.',
      },
    },
  }

  return content[step][language]
}

function getStepIcon(step: OnboardingStep) {
  switch (step) {
    case 'welcome': return Sparkles
    case 'dashboard': return LayoutDashboard
    case 'scripts': return FileText
    case 'posts': return ImageIcon
    case 'descriptions': return AlignLeft
    case 'settings': return Settings
    case 'feedback': return MessageSquarePlus
    case 'complete': return Rocket
  }
}

function getTargetSelector(step: OnboardingStep): string | null {
  switch (step) {
    case 'dashboard': return '[data-onboarding="dashboard"]'
    case 'scripts': return '[data-onboarding="scripts"]'
    case 'posts': return '[data-onboarding="posts"]'
    case 'descriptions': return '[data-onboarding="descriptions"]'
    case 'settings': return '[data-onboarding="settings"]'
    case 'feedback': return '[data-onboarding="feedback"]'
    default: return null
  }
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all duration-300 ${
            i === current
              ? 'w-6 h-2 bg-primary-500'
              : i < current
                ? 'w-2 h-2 bg-primary-700'
                : 'w-2 h-2 bg-dark-300'
          }`}
        />
      ))}
    </div>
  )
}

function TooltipCard({
  step,
  stepIndex,
  totalSteps,
  nextStep,
  prevStep,
  language,
}: {
  step: OnboardingStep
  stepIndex: number
  totalSteps: number
  nextStep: () => void
  prevStep: () => void
  language: 'en' | 'es'
}) {
  const content = getStepContent(step, language)
  const Icon = getStepIcon(step)

  return (
    <div className="w-[340px] bg-dark-100 border border-dark-200 rounded-2xl shadow-2xl overflow-hidden">
      {/* Progress bar */}
      <div className="h-1 bg-dark-200">
        <div
          className="h-full bg-primary-600 transition-all duration-500 ease-out"
          style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
        />
      </div>

      <div className="p-5">
        {/* Icon + Title */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary-900/30 flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-primary-500" />
          </div>
          <h3 className="text-base font-semibold text-dark-900">{content.title}</h3>
        </div>

        {/* Description */}
        <p className="text-sm text-dark-600 leading-relaxed mb-1">{content.description}</p>
        {content.subTip && (
          <p className="text-xs text-dark-400 leading-relaxed mt-2">{content.subTip}</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-5 pt-4 border-t border-dark-200">
          <StepDots current={stepIndex} total={totalSteps} />
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                onClick={prevStep}
                className="p-2 text-dark-400 hover:text-dark-700 hover:bg-dark-200 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={nextStep}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
            >
              {language === 'es' ? 'Siguiente' : 'Next'}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function OnboardingWizard({
  currentStep,
  stepIndex,
  totalSteps,
  nextStep,
  prevStep,
  skipAll,
}: OnboardingWizardProps) {
  const { language } = useLanguage()
  const navigate = useNavigate()
  const content = getStepContent(currentStep, language)
  const Icon = getStepIcon(currentStep)

  // Escape key to skip wizard from any step
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skipAll()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [skipAll])

  // Full-screen splash for welcome & complete steps
  if (currentStep === 'welcome' || currentStep === 'complete') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
        {/* Skip button top-right */}
        {currentStep === 'welcome' && (
          <button
            onClick={skipAll}
            className="absolute top-6 right-6 flex items-center gap-1.5 text-sm text-dark-400 hover:text-dark-700 transition-colors"
          >
            <X className="w-4 h-4" />
            {language === 'es' ? 'Saltar todo' : 'Skip all'}
          </button>
        )}

        <div className="animate-fade-in-up w-full max-w-md mx-4">
          <div className="bg-dark-100 border border-dark-200 rounded-2xl shadow-2xl overflow-hidden">
            {/* Progress bar */}
            <div className="h-1 bg-dark-200">
              <div
                className="h-full bg-primary-600 transition-all duration-500 ease-out"
                style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
              />
            </div>

            <div className="p-8 text-center">
              {/* Icon */}
              <div className="w-16 h-16 rounded-2xl bg-primary-900/30 flex items-center justify-center mx-auto mb-5">
                <Icon className="w-8 h-8 text-primary-500" />
              </div>

              {/* Title */}
              <h2 className="text-2xl font-bold text-dark-900 mb-3">{content.title}</h2>
              <p className="text-dark-500 text-sm leading-relaxed mb-8 max-w-sm mx-auto">
                {content.description}
              </p>

              {currentStep === 'welcome' ? (
                <div className="space-y-3">
                  <button
                    onClick={nextStep}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-primary-600 text-white font-medium rounded-xl hover:bg-primary-700 transition-colors"
                  >
                    <Sparkles className="w-5 h-5" />
                    {language === 'es' ? '¡Empecemos!' : "Let's Go!"}
                  </button>
                  <button
                    onClick={skipAll}
                    className="w-full text-sm text-dark-400 hover:text-dark-600 py-2 transition-colors"
                  >
                    {language === 'es' ? 'Saltar configuración' : 'Skip setup'}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    onClick={() => { skipAll(); navigate('/scripts') }}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-primary-600 text-white font-medium rounded-xl hover:bg-primary-700 transition-colors"
                  >
                    <FileText className="w-5 h-5" />
                    {language === 'es' ? 'Ir a Guiones' : 'Go to Scripts'}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { skipAll(); navigate('/dashboard') }}
                    className="w-full text-sm text-dark-400 hover:text-dark-600 py-2 transition-colors"
                  >
                    {language === 'es' ? 'Ir al Dashboard' : 'Go to Dashboard'}
                  </button>
                </div>
              )}

              {/* Step dots */}
              <div className="flex justify-center mt-6">
                <StepDots current={stepIndex} total={totalSteps} />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Spotlight steps (dashboard, scripts, posts, descriptions, settings)
  const selector = getTargetSelector(currentStep)
  if (!selector) return null

  return (
    <>
      {/* Skip button floating top-right */}
      <button
        onClick={skipAll}
        className="fixed top-6 right-6 z-[103] flex items-center gap-1.5 px-3 py-1.5 text-sm text-dark-400 hover:text-white bg-dark-100/80 hover:bg-dark-200 border border-dark-300 rounded-lg backdrop-blur-sm transition-colors"
      >
        <X className="w-3.5 h-3.5" />
        {language === 'es' ? 'Saltar' : 'Skip'}
      </button>

      <OnboardingSpotlight targetSelector={selector} position={currentStep === 'feedback' ? 'top' : 'right'}>
        <TooltipCard
          step={currentStep}
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          nextStep={nextStep}
          prevStep={prevStep}
          language={language}
        />
      </OnboardingSpotlight>
    </>
  )
}
