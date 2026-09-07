export const CHAT_SHELL_TOUR_STEP_COUNT = 5

export type ChatShellTourStepId = 'single' | 'folders' | 'verbs' | 'setup' | 'feedback'
export type ChatShellTourPlacement = 'right' | 'top' | 'bottom' | 'center'

export type ChatShellTourStep = {
  id: ChatShellTourStepId
  target: string
  placement: ChatShellTourPlacement
  title: { es: string; en: string }
  body: { es: string; en: string }
  creditsNote?: { es: string; en: string }
  feedbackCta?: boolean
}

export const CHAT_SHELL_TOUR_STEPS: readonly ChatShellTourStep[] = [
  {
    id: 'single',
    target: '[data-tour="composer"]',
    placement: 'top',
    title: {
      es: 'Un chat para todo',
      en: 'One chat for everything',
    },
    body: {
      es: 'Pedís guiones, posts y fotos en este mismo hilo. Escribí abajo o usá los botones de crear — no hace falta saltar de pantalla.',
      en: 'Ask for scripts, posts, and photos in this same thread. Type below or use the create buttons — no jumping between screens.',
    },
  },
  {
    id: 'folders',
    target: '[data-tour="folders"]',
    placement: 'right',
    title: {
      es: 'Marcas y carpetas',
      en: 'Brands and folders',
    },
    body: {
      es: 'A la izquierda está cada marca y sus chats. Cambiá de carpeta y seguís con ofertas, guiones e imágenes. Crear una marca nueva también vive acá.',
      en: 'Each brand and its chats live on the left. Switch folders and keep offers, scripts, and images. New brands start here too.',
    },
  },
  {
    id: 'verbs',
    target: '[data-tour="verbs"]',
    placement: 'top',
    title: {
      es: 'Guiones, Post, Foto y Pack',
      en: 'Scripts, Post, Photo, and Pack',
    },
    body: {
      es: 'Arriba del texto: Guiones (anuncios), Post (imagen con copy), Foto (producto) y Pack (varios de una). Tocá uno y el chat te guía. También sirve escribir “generame 2 de venta”.',
      en: 'Above the text box: Scripts (ads), Post (image with copy), Photo (product), and Pack (several at once). Tap one and chat guides you. Or type “generate 2 sales scripts”.',
    },
  },
  {
    id: 'setup',
    target: '[data-tour="setup"]',
    placement: 'top',
    title: {
      es: 'Lo que falta, con nombre',
      en: 'Named gaps in setup',
    },
    body: {
      es: 'El chip del kit dice qué falta (Público, Fuentes…). Si hay oferta y el kit está a medias, ves Falta: … y el vidrio sigue usable. Completar el kit mejora el resultado.',
      en: 'The kit chip names what’s missing (Audience, Sources…). If an offer exists and the kit is partial, you see Missing: … and the glass stays usable. Finishing the kit improves results.',
    },
  },
  {
    id: 'feedback',
    target: '[data-onboarding="feedback"]',
    placement: 'top',
    feedbackCta: true,
    title: {
      es: 'Contanos qué mejorar',
      en: 'Tell us what to improve',
    },
    body: {
      es: 'El botón redondo abajo a la derecha abre feedback: bugs, ideas o preguntas, con captura si querés. Se lee de verdad — escribinos cuando quieras, no hace falta que esté perfecto.',
      en: 'The round button at the bottom right opens feedback: bugs, ideas, or questions, with a screenshot if you want. We actually read it — write anytime; it does not need to be perfect.',
    },
    creditsNote: {
      es: 'Los créditos se usan por generación. Si te regalamos bienvenida, ya están en tu cuenta — este recorrido no los toca.',
      en: 'Credits are charged per generation. If we gifted a welcome pack, it is already in your account — this tour does not touch it.',
    },
  },
] as const

export type ChatShellTourStepView = {
  id: ChatShellTourStepId
  target: string
  placement: ChatShellTourPlacement
  title: string
  body: string
  creditsNote?: string
  feedbackCta?: boolean
}

export function chatShellTourSteps(language: 'es' | 'en'): ChatShellTourStepView[] {
  return CHAT_SHELL_TOUR_STEPS.map((step) => ({
    id: step.id,
    target: step.target,
    placement: step.placement,
    title: step.title[language],
    body: step.body[language],
    creditsNote: step.creditsNote?.[language],
    feedbackCta: step.feedbackCta,
  }))
}

/** Kept for callers that still import locale arrays. */
export const CHAT_SHELL_TOUR_STEPS_ES = chatShellTourSteps('es')
export const CHAT_SHELL_TOUR_STEPS_EN = chatShellTourSteps('en')

export function clickChatShellFeedbackControl(): boolean {
  const node = document.querySelector('[data-onboarding="feedback"]')
  if (!(node instanceof HTMLElement)) return false
  node.click()
  return true
}
