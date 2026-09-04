import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useLocation } from 'react-router-dom'
import { createFeedbackTicket, uploadFeedbackScreenshot } from '../services/database'
import { supabase } from '../lib/supabase'
import {
  MessageSquarePlus,
  X,
  Camera,
  Send,
  Loader2,
  CheckCircle,
  Bug,
  Lightbulb,
  HelpCircle,
  MoreHorizontal,
  AlertTriangle,
  Trash2
} from 'lucide-react'
import html2canvas from 'html2canvas'

type Category = 'bug' | 'feature' | 'question' | 'other'
type Priority = 'low' | 'medium' | 'high' | 'urgent'

const consoleErrors: string[] = []
const networkErrors: { url: string; status: number; statusText: string; timestamp: string }[] = []
const breadcrumbs: { type: 'click' | 'navigation' | 'input'; target: string; timestamp: string }[] = []

// Capture console errors for context
const originalConsoleError = console.error
console.error = (...args: unknown[]) => {
  consoleErrors.push(args.map(a => String(a)).join(' ').slice(0, 500))
  if (consoleErrors.length > 20) consoleErrors.shift()
  originalConsoleError.apply(console, args)
}

window.addEventListener('error', (e) => {
  consoleErrors.push(`${e.message} at ${e.filename}:${e.lineno}`)
  if (consoleErrors.length > 20) consoleErrors.shift()
})

// Capture unhandled promise rejections
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason instanceof Error ? `${e.reason.message}\n${e.reason.stack}` : String(e.reason)
  consoleErrors.push(`[UnhandledRejection] ${reason}`.slice(0, 500))
  if (consoleErrors.length > 20) consoleErrors.shift()
})

// Capture failed network requests (4xx/5xx)
const originalFetch = window.fetch
window.fetch = async (...args: Parameters<typeof fetch>) => {
  const response = await originalFetch(...args)
  if (!response.ok) {
    const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : String(args[0])
    networkErrors.push({
      url: url.slice(0, 200),
      status: response.status,
      statusText: response.statusText,
      timestamp: new Date().toISOString(),
    })
    if (networkErrors.length > 15) networkErrors.shift()
  }
  return response
}

// Capture user action breadcrumbs
const pushBreadcrumb = (type: 'click' | 'navigation' | 'input', target: string) => {
  breadcrumbs.push({ type, target: target.slice(0, 120), timestamp: new Date().toISOString() })
  if (breadcrumbs.length > 20) breadcrumbs.shift()
}

document.addEventListener('click', (e) => {
  const el = e.target as HTMLElement
  const tag = el.tagName?.toLowerCase() || ''
  const text = el.textContent?.trim().slice(0, 50) || ''
  const id = el.id ? `#${el.id}` : ''
  const cls = el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''
  pushBreadcrumb('click', `${tag}${id}${cls}${text ? ` "${text}"` : ''}`)
}, { capture: true })

let _lastPath = window.location.pathname
void setInterval(() => {
  if (window.location.pathname !== _lastPath) {
    pushBreadcrumb('navigation', window.location.pathname)
    _lastPath = window.location.pathname
  }
}, 500)

const APP_VERSION = (typeof import.meta.env.VITE_APP_VERSION === 'string' && import.meta.env.VITE_APP_VERSION)
  ? import.meta.env.VITE_APP_VERSION
  : '0.1.7'

const CLASSIC_SURFACES = /^\/(dashboard|scripts|product|settings|posts|descriptions|respuestas|team)(?:\/|$)/

function resolveUiSurface(pathname: string): 'chat' | 'classic' | 'other' {
  if (/^\/chat(?:\/|$)/.test(pathname)) return 'chat'
  if (CLASSIC_SURFACES.test(pathname)) return 'classic'
  return 'other'
}

function resolveViewportClass(): 'mobile' | 'desktop' {
  return window.innerWidth < 768 ? 'mobile' : 'desktop'
}

async function notifyTicketCreated(ticketId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const url = import.meta.env.PROD ? '/api/ticket-events' : 'http://localhost:3000/api/ticket-events'
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ ticketId }),
    })
  } catch {
    // Ticket already saved; the poll endpoint can pick it up.
  }
}

function compressScreenshot(blob: Blob, maxWidth = 1280, quality = 0.7): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let w = img.width
      let h = img.height
      if (w > maxWidth) {
        h = Math.round(h * (maxWidth / w))
        w = maxWidth
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canvas context unavailable'))
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (result) => {
          if (result) resolve(result)
          else reject(new Error('Compression produced empty blob'))
        },
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => reject(new Error('Failed to load image for compression'))
    img.src = URL.createObjectURL(blob)
  })
}

export default function FeedbackButton() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const location = useLocation()

  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<Category>('bug')
  const [priority, setPriority] = useState<Priority>('medium')
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [screenshotBlob, setScreenshotBlob] = useState<Blob | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const modalRef = useRef<HTMLDivElement>(null)

  const t = language === 'es' ? {
    title: 'Enviar Feedback',
    subject: 'Asunto',
    subjectPlaceholder: 'Resumen breve del problema o idea',
    description: 'Descripción',
    descriptionPlaceholder: 'Describe el problema con detalle, qué esperabas y qué pasó...',
    category: 'Categoría',
    bug: 'Bug',
    feature: 'Idea',
    question: 'Pregunta',
    other: 'Otro',
    priority: 'Prioridad',
    low: 'Baja',
    medium: 'Media',
    high: 'Alta',
    urgent: 'Urgente',
    screenshot: 'Captura de pantalla',
    capture: 'Capturar pantalla',
    removeScreenshot: 'Quitar',
    submit: 'Enviar',
    submitting: 'Enviando...',
    success: '¡Feedback enviado! Gracias.',
    error: 'Error al enviar. Intenta de nuevo.',
    close: 'Cerrar'
  } : {
    title: 'Send Feedback',
    subject: 'Subject',
    subjectPlaceholder: 'Brief summary of the issue or idea',
    description: 'Description',
    descriptionPlaceholder: 'Describe the problem in detail, what you expected and what happened...',
    category: 'Category',
    bug: 'Bug',
    feature: 'Feature',
    question: 'Question',
    other: 'Other',
    priority: 'Priority',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    urgent: 'Urgent',
    screenshot: 'Screenshot',
    capture: 'Capture screen',
    removeScreenshot: 'Remove',
    submit: 'Submit',
    submitting: 'Submitting...',
    success: 'Feedback sent! Thank you.',
    error: 'Failed to send. Please try again.',
    close: 'Close'
  }

  const categories: { id: Category; label: string; icon: typeof Bug }[] = [
    { id: 'bug', label: t.bug, icon: Bug },
    { id: 'feature', label: t.feature, icon: Lightbulb },
    { id: 'question', label: t.question, icon: HelpCircle },
    { id: 'other', label: t.other, icon: MoreHorizontal },
  ]

  const priorities: { id: Priority; label: string; color: string }[] = [
    { id: 'low', label: t.low, color: 'text-dark-500 border-dark-300' },
    { id: 'medium', label: t.medium, color: 'text-blue-400 border-blue-500' },
    { id: 'high', label: t.high, color: 'text-amber-400 border-amber-500' },
    { id: 'urgent', label: t.urgent, color: 'text-red-400 border-red-500' },
  ]

  // Close on escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

  const handleCapture = async () => {
    setCapturing(true)
    // Temporarily hide the feedback modal for clean capture
    if (modalRef.current) modalRef.current.style.display = 'none'

    try {
      const canvas = await html2canvas(document.body, {
        scale: 1,
        useCORS: true,
        logging: false,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
      })

      const rawBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png')
      )
      if (rawBlob) {
        const compressed = await compressScreenshot(rawBlob)
        setScreenshotBlob(compressed)
        setScreenshot(URL.createObjectURL(compressed))
      }
    } catch (err) {
      console.error('Screenshot capture failed:', err)
    } finally {
      if (modalRef.current) modalRef.current.style.display = ''
      setCapturing(false)
    }
  }

  const handleSubmit = async () => {
    if (!user || !subject.trim() || !description.trim()) return
    setSubmitting(true)
    setError('')

    try {
      let screenshotUrl: string | undefined

      if (screenshotBlob) {
        screenshotUrl = await uploadFeedbackScreenshot(user.id, screenshotBlob)
      }

      // Fetch plan & product context at submit time
      let userPlan = 'free'
      let productId: string | undefined
      let productName: string | undefined

      try {
        const { data: subData } = await supabase
          .from('subscriptions')
          .select('plan')
          .eq('user_id', user.id)
          .in('status', ['active', 'trialing'])
          .maybeSingle()
        if (subData?.plan) userPlan = subData.plan
      } catch { /* ignore */ }

      // Extract product ID from URL if on a product page
      const productMatch = location.pathname.match(/\/product\/([^/]+)/)
      if (productMatch) {
        productId = productMatch[1]
        try {
          const { data: prodData } = await supabase
            .from('products')
            .select('name')
            .eq('id', productId)
            .maybeSingle()
          if (prodData?.name) productName = prodData.name
        } catch { /* ignore */ }
      }

      const created = await createFeedbackTicket({
        user_id: user.id,
        user_email: user.email || undefined,
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority,
        page_url: `${location.pathname}${location.search}`,
        ui_surface: resolveUiSurface(location.pathname),
        app_version: APP_VERSION,
        locale: language,
        viewport: resolveViewportClass(),
        browser_info: navigator.userAgent,
        screen_size: `${window.innerWidth}x${window.innerHeight}`,
        console_errors: consoleErrors.slice(-10),
        screenshot_url: screenshotUrl,
        network_errors: networkErrors.slice(-10),
        breadcrumbs: breadcrumbs.slice(-15),
        product_id: productId,
        product_name: productName,
        user_plan: userPlan,
      })
      if (created?.id) {
        void notifyTicketCreated(created.id)
      }

      setSubmitted(true)
      setTimeout(() => {
        setOpen(false)
        setSubmitted(false)
        setSubject('')
        setDescription('')
        setCategory('bug')
        setPriority('medium')
        setScreenshot(null)
        setScreenshotBlob(null)
      }, 2000)
    } catch (err) {
      setError(t.error)
      console.error('Feedback submission error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const onChat = /^\/chat(?:\/|$)/.test(location.pathname)

  if (!user) return null

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        data-onboarding="feedback"
        className={
          onChat
            ? 'chat-shell-feedback-fab'
            : 'fixed bottom-20 right-4 lg:bottom-6 lg:right-6 z-40 w-12 h-12 bg-primary-600 hover:bg-primary-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center group'
        }
        title={t.title}
      >
        <MessageSquarePlus className="w-5 h-5 group-hover:scale-110 transition-transform" />
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !submitting && setOpen(false)} />

          {/* Modal */}
          <div
            ref={modalRef}
            className="relative w-full max-w-lg bg-dark-100 rounded-2xl shadow-2xl border border-dark-200 overflow-hidden max-h-[90vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-dark-200">
              <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
                <MessageSquarePlus className="w-5 h-5 text-primary-500" />
                {t.title}
              </h2>
              <button
                onClick={() => !submitting && setOpen(false)}
                className="p-1.5 hover:bg-dark-50 rounded-lg text-dark-400 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Success state */}
            {submitted ? (
              <div className="p-12 flex flex-col items-center justify-center gap-3">
                <CheckCircle className="w-12 h-12 text-green-500" />
                <p className="text-dark-800 font-medium">{t.success}</p>
              </div>
            ) : (
              <>
                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                  {/* Category */}
                  <div>
                    <label className="text-xs font-semibold text-dark-500 uppercase tracking-wide mb-2 block">{t.category}</label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {categories.map(cat => {
                        const Icon = cat.icon
                        return (
                          <button
                            key={cat.id}
                            onClick={() => setCategory(cat.id)}
                            className={`flex flex-col items-center gap-1 p-2.5 rounded-lg text-[11px] font-medium transition-all ${
                              category === cat.id
                                ? 'bg-primary-900/20 text-primary-400 border border-primary-500'
                                : 'bg-dark-50 text-dark-500 border border-transparent hover:bg-dark-200'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            {cat.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="text-xs font-semibold text-dark-500 uppercase tracking-wide mb-1.5 block">{t.subject}</label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder={t.subjectPlaceholder}
                      className="w-full px-3 py-2.5 bg-dark-50 text-dark-900 border border-dark-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-400"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="text-xs font-semibold text-dark-500 uppercase tracking-wide mb-1.5 block">{t.description}</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t.descriptionPlaceholder}
                      rows={4}
                      className="w-full px-3 py-2.5 bg-dark-50 text-dark-900 border border-dark-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-dark-400"
                    />
                  </div>

                  {/* Priority */}
                  <div>
                    <label className="text-xs font-semibold text-dark-500 uppercase tracking-wide mb-2 block">{t.priority}</label>
                    <div className="flex gap-1.5">
                      {priorities.map(p => (
                        <button
                          key={p.id}
                          onClick={() => setPriority(p.id)}
                          className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                            priority === p.id
                              ? `${p.color} bg-dark-50`
                              : 'text-dark-500 border-transparent bg-dark-50 hover:bg-dark-200'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Screenshot */}
                  <div>
                    <label className="text-xs font-semibold text-dark-500 uppercase tracking-wide mb-2 block">{t.screenshot}</label>
                    {screenshot ? (
                      <div className="relative group">
                        <img
                          src={screenshot}
                          alt="Screenshot"
                          className="w-full h-40 object-cover rounded-lg border border-dark-200"
                        />
                        <button
                          onClick={() => { setScreenshot(null); setScreenshotBlob(null) }}
                          className="absolute top-2 right-2 p-2 bg-dark-100/90 rounded-lg text-dark-400 hover:text-red-500 transition-colors opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={handleCapture}
                        disabled={capturing}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-dark-50 border border-dashed border-dark-300 rounded-lg text-sm text-dark-500 hover:border-primary-500 hover:text-primary-400 transition-colors disabled:opacity-50"
                      >
                        {capturing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Camera className="w-4 h-4" />
                        )}
                        {t.capture}
                      </button>
                    )}
                  </div>

                  {/* Auto-captured info badge */}
                  <div className="flex items-center gap-1.5 text-[10px] text-dark-400">
                    <AlertTriangle className="w-3 h-3" />
                    {language === 'es'
                      ? 'Se adjuntará automáticamente: página actual, navegador, errores de consola'
                      : 'Auto-attached: current page, browser info, console errors'}
                  </div>

                  {error && (
                    <p className="text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>
                  )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-dark-200 flex justify-end gap-3">
                  <button
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                    className="px-4 py-2.5 text-sm font-medium text-dark-500 hover:bg-dark-50 rounded-lg transition-colors"
                  >
                    {t.close}
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || !subject.trim() || !description.trim()}
                    className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
                  >
                    {submitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    {submitting ? t.submitting : t.submit}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
