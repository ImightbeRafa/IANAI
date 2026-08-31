/**
 * Advance public homepage — locked CoS pixel target (PR #34 Preview).
 * Spanish primary; English mirror for language toggle.
 */

export const HOME_CYAN = '#2de2ff'
export const HOME_BG = '#07090d'

export type HomeFanCard = {
  id: string
  src: string
  alt: string
  /** Desktop fan slot */
  slot: 'far-left' | 'mid-left' | 'front' | 'mid-right' | 'far-right'
  /** Show on mobile 3-card fan */
  mobile: boolean
}

/** Desktop 5-card fan (Casa Luna front). Mobile uses cards with mobile:true. */
export const HOME_FAN_CARDS: HomeFanCard[] = [
  {
    id: 'altura',
    src: '/home/ads/altura.jpg',
    alt: 'Altura Real Estate — Vista al Pacífico',
    slot: 'far-left',
    mobile: false,
  },
  {
    id: 'aura',
    src: '/home/ads/aura.jpg',
    alt: 'Aura — Despierta tu mejor versión',
    slot: 'mid-left',
    mobile: true,
  },
  {
    id: 'casa-luna',
    src: '/home/ads/casa-luna.jpg',
    alt: 'Casa Luna — Reservá esta noche',
    slot: 'front',
    mobile: true,
  },
  {
    id: 'vesper',
    src: '/home/ads/vesper.jpg',
    alt: 'Vesper — Piel que se nota',
    slot: 'mid-right',
    mobile: true,
  },
  {
    id: 'nido',
    src: '/home/ads/nido.jpg',
    alt: 'Nido Hotel — Dormí entre nubes',
    slot: 'far-right',
    mobile: false,
  },
]

export type HomeGalleryItem = {
  src: string
  industry: { es: string; en: string }
  kind: 'Foto' | 'Post' | 'Pack'
}

export const HOME_GALLERY: HomeGalleryItem[] = [
  { src: '/home/ads/casa-luna.jpg', industry: { es: 'Restaurante', en: 'Restaurant' }, kind: 'Post' },
  { src: '/home/ads/aura.jpg', industry: { es: 'Café', en: 'Coffee' }, kind: 'Foto' },
  { src: '/home/ads/vesper.jpg', industry: { es: 'Beauty', en: 'Beauty' }, kind: 'Foto' },
  { src: '/home/ads/altura.jpg', industry: { es: 'Real estate', en: 'Real estate' }, kind: 'Post' },
  { src: '/home/ads/nido.jpg', industry: { es: 'Hotel', en: 'Hotel' }, kind: 'Pack' },
  { src: '/home/ads/dulce-norte.jpg', industry: { es: 'Pastelería', en: 'Bakery' }, kind: 'Post' },
  { src: '/home/ads/forza.jpg', industry: { es: 'Fitness', en: 'Fitness' }, kind: 'Foto' },
  { src: '/home/ads/monte-rojo.jpg', industry: { es: 'Vinos', en: 'Wine' }, kind: 'Pack' },
]

export const HOME_FEATURES = [
  {
    num: '01',
    title: { es: 'Guiones listos para grabar', en: 'Scripts ready to shoot' },
    body: {
      es: 'Estructura gancho → desarrollo → CTA. Pedilos en el chat y salís a grabar.',
      en: 'Hook → development → CTA. Ask in chat and walk out ready to shoot.',
    },
  },
  {
    num: '02',
    title: { es: 'Posts de agencia', en: 'Agency-grade posts' },
    body: {
      es: 'Fotos y creativos con look de estudio — sin plantillas genéricas.',
      en: 'Studio-look photos and creatives — no generic templates.',
    },
  },
  {
    num: '03',
    title: { es: 'Tu marca, no un template', en: 'Your brand, not a template' },
    body: {
      es: 'Kit de marca, tono y ofertas vivos en el chat. Cada pieza habla como vos.',
      en: 'Brand kit, tone, and offers live in chat. Every piece sounds like you.',
    },
  },
] as const

/** Locked list prices — do not retune. */
export const HOME_PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    credits: { es: '150 créditos de bienvenida', en: '150 welcome credits' },
    cta: { es: 'Empezá gratis', en: 'Start free' },
    popular: false,
    contact: false,
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$33',
    credits: { es: '750 créditos / mes', en: '750 credits / month' },
    cta: { es: 'Comenzar', en: 'Get started' },
    popular: false,
    contact: false,
  },
  {
    id: 'premium',
    name: 'Premium',
    price: '$49',
    credits: { es: '1.500 créditos / mes', en: '1,500 credits / month' },
    cta: { es: 'Comenzar', en: 'Get started' },
    popular: true,
    contact: false,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$299',
    credits: { es: '9.600 créditos / mes', en: '9,600 credits / month' },
    cta: { es: 'Contactanos', en: 'Contact us' },
    popular: false,
    contact: true,
  },
] as const

/** Post-login from the public homepage. Stay on classic until invite-all GO. */
export const HOME_AUTH_REDIRECT = '/dashboard'
