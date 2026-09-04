/**
 * Frontend mirror of api/lib/credits/catalog.ts — keep weights/prices in sync.
 */

export const CREDIT_WEIGHTS = {
  guion_oferta: 3,
  guion_edit: 1,
  description: 1,
  reply: 1,
  image_standard: 6,
  image_pro: 24,
  image_edit: 18,
  image_enhance: 18,
} as const

export type FrontendPlanId = 'free' | 'starter' | 'pro' | 'business' | 'enterprise' | 'meta_advanze'

export const PLAN_CATALOG_UI: Record<FrontendPlanId, {
  name: string
  price: number
  credits: number
  welcomeOnce?: number
  kits: number
  color: string
  paymentLink: string | null
  publicUpgrade: boolean
  creditLabelEs: string
  creditLabelEn: string
}> = {
  free: {
    name: 'Free',
    price: 0,
    credits: 0,
    welcomeOnce: 150,
    kits: 1,
    color: 'gray',
    paymentLink: null,
    publicUpgrade: true,
    creditLabelEs: '150 créditos de bienvenida (una vez)',
    creditLabelEn: '150 welcome credits (once)',
  },
  starter: {
    name: 'Starter',
    price: 33,
    credits: 750,
    kits: 2,
    color: 'blue',
    paymentLink: 'https://tp.cr/l/TkRnM01RPT18MQ==',
    publicUpgrade: true,
    creditLabelEs: '750 créditos / mes',
    creditLabelEn: '750 credits / month',
  },
  pro: {
    name: 'Premium',
    price: 49,
    credits: 1500,
    kits: 5,
    color: 'purple',
    paymentLink: 'https://tp.cr/l/TkRnM01nPT18MQ==',
    publicUpgrade: true,
    creditLabelEs: '1,500 créditos / mes',
    creditLabelEn: '1,500 credits / month',
  },
  business: {
    name: 'Business',
    price: 149,
    credits: 4800,
    kits: 20,
    color: 'emerald',
    paymentLink: 'https://tp.cr/l/TmpreE9BPT18MQ==',
    publicUpgrade: true,
    creditLabelEs: '4,800 créditos / mes',
    creditLabelEn: '4,800 credits / month',
  },
  enterprise: {
    name: 'Enterprise',
    price: 299,
    credits: 9600,
    kits: 50,
    color: 'amber',
    paymentLink: 'https://tp.cr/l/TkRrMk53PT18MQ==',
    publicUpgrade: false,
    creditLabelEs: '9,600 créditos / mes',
    creditLabelEn: '9,600 credits / month',
  },
  meta_advanze: {
    name: 'Meta AdVance',
    price: 24,
    credits: 600,
    kits: 5,
    color: 'purple',
    paymentLink: null,
    publicUpgrade: false,
    creditLabelEs: '600 créditos / mes',
    creditLabelEn: '600 credits / month',
  },
}

export const CREDIT_PACK_UI = {
  price: 25,
  credits: 500,
  /** Pack checkout uses TiloPay one-time API (no static link). */
  paymentLink: 'api:one-time' as string | null,
  labelEs: '500 créditos · $25 · válidos 12 meses',
  labelEn: '500 credits · $25 · valid 12 months',
}

export const PUBLIC_BILLING_PLANS: FrontendPlanId[] = ['free', 'starter', 'pro', 'business']

export function planDisplayName(plan: FrontendPlanId, language: 'es' | 'en'): string {
  if (plan === 'free') return language === 'es' ? 'Gratis' : 'Free'
  return PLAN_CATALOG_UI[plan]?.name || plan
}

export const CREDITS_PITCH = {
  es: 'Cada mes te damos créditos. Un guion cuesta 3. Una imagen estándar 6. Una imagen Pro 24. Si se te acaban, compra un paquete o sube de plan.',
  en: 'Each month you get credits. A script costs 3. A standard image 6. A Pro image 24. If you run out, buy a pack or upgrade.',
}
