import { useState, useEffect } from 'react'
import { X, MessageCircleHeart } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'

const STORAGE_KEY = 'feedback_toast_last_shown'
const SHOW_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000 // 3 days
const DELAY_BEFORE_SHOW_MS = 8000 // 8 seconds after mount

export default function FeedbackToast() {
  const { language } = useLanguage()
  const [visible, setVisible] = useState(false)

  const t = language === 'es' ? {
    title: 'Tu opinión nos importa mucho',
    body: '¿Cómo ha sido tu experiencia? Nos encantaría escucharte para seguir mejorando.',
    cta: 'Dar feedback',
    dismiss: 'Ahora no',
  } : {
    title: 'Your feedback means a lot to us',
    body: 'How has your experience been? We\'d love to hear from you so we can keep improving.',
    cta: 'Give feedback',
    dismiss: 'Not now',
  }

  useEffect(() => {
    const lastShown = localStorage.getItem(STORAGE_KEY)
    const now = Date.now()

    if (lastShown && now - parseInt(lastShown, 10) < SHOW_INTERVAL_MS) return

    const timer = setTimeout(() => setVisible(true), DELAY_BEFORE_SHOW_MS)
    return () => clearTimeout(timer)
  }, [])

  const dismiss = () => {
    setVisible(false)
    localStorage.setItem(STORAGE_KEY, Date.now().toString())
  }

  const handleFeedback = () => {
    window.location.href = 'mailto:support@advanceai.app?subject=Feedback'
    dismiss()
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm animate-slide-in-up">
      <div className="bg-dark-100 border border-dark-200 rounded-2xl shadow-2xl p-5 relative">
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 p-1 rounded-lg text-dark-400 hover:text-dark-600 hover:bg-dark-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-900/30 flex items-center justify-center flex-shrink-0">
            <MessageCircleHeart className="w-5 h-5 text-primary-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-dark-800">{t.title}</p>
            <p className="text-xs text-dark-500 mt-1 leading-relaxed">{t.body}</p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleFeedback}
                className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 transition-colors"
              >
                {t.cta}
              </button>
              <button
                onClick={dismiss}
                className="px-3 py-1.5 rounded-lg text-dark-500 text-xs font-medium hover:bg-dark-200 transition-colors"
              >
                {t.dismiss}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
