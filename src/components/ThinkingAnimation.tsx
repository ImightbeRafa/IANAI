import { useState, useEffect } from 'react'
import { Sparkles } from 'lucide-react'

interface ThinkingAnimationProps {
  language?: 'en' | 'es'
}

const thinkingSteps = {
  en: [
    'Analyzing your input...',
    'Understanding context...',
    'Crafting response...',
    'Refining copy...',
    'Optimizing for conversion...'
  ],
  es: [
    'Analizando tu entrada...',
    'Entendiendo el contexto...',
    'Elaborando respuesta...',
    'Refinando el copy...',
    'Optimizando para conversión...'
  ]
}

export default function ThinkingAnimation({ language = 'en' }: ThinkingAnimationProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [dots, setDots] = useState('')
  const steps = thinkingSteps[language]

  useEffect(() => {
    const stepInterval = setInterval(() => {
      setCurrentStep(prev => (prev + 1) % steps.length)
    }, 2000)

    return () => clearInterval(stepInterval)
  }, [steps.length])

  useEffect(() => {
    const dotInterval = setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : prev + '.'))
    }, 400)

    return () => clearInterval(dotInterval)
  }, [])

  return (
    <div className="bg-white border border-dark-100 rounded-2xl px-5 py-4 max-w-md">
      <div className="flex items-start gap-3">
        <div className="relative">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white animate-pulse" />
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-white animate-pulse" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-primary-600 uppercase tracking-wide">
              {language === 'es' ? 'Pensando' : 'Thinking'}
            </span>
            <div className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-primary-400"
                  style={{
                    animation: 'pulse 1.4s ease-in-out infinite',
                    animationDelay: `${i * 0.2}s`
                  }}
                />
              ))}
            </div>
          </div>
          
          <div className="space-y-1.5">
            {steps.map((step, index) => (
              <div
                key={index}
                className={`flex items-center gap-2 text-sm transition-all duration-300 ${
                  index === currentStep
                    ? 'text-dark-700 opacity-100'
                    : index < currentStep
                    ? 'text-dark-400 opacity-50'
                    : 'text-dark-300 opacity-30'
                }`}
              >
                <div className={`w-1 h-1 rounded-full transition-all duration-300 ${
                  index === currentStep
                    ? 'bg-primary-500 scale-150'
                    : index < currentStep
                    ? 'bg-green-400'
                    : 'bg-dark-200'
                }`} />
                <span className={index === currentStep ? 'font-medium' : ''}>
                  {step}
                  {index === currentStep && <span className="text-primary-500">{dots}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
