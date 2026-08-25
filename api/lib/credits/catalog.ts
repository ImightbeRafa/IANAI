/**
 * Canonical Créditos IA catalog — single source of truth for weights + plans.
 * Frontend mirrors a subset via src/lib/creditsCatalog.ts (keep in sync).
 */

export const CREDIT_COGS_USD = 0.01

/** Locked action weights (deduct only on success). */
export type CreditAction =
  | 'guion_oferta'
  | 'guion_edit'
  | 'description'
  | 'reply'
  | 'image_standard'
  | 'image_pro'
  | 'image_edit'
  | 'image_enhance'
  | 'carousel_slide_standard'
  | 'carousel_slide_pro'
  | 'site_analysis_extra'
  | 'analyze_image'
  | 'transcription_minute'
  | 'pdf_ai_summary'
  | 'url_fetch'
  | 'autofill'
  | 'prompt_condense'
  | 'memory'
  | 'chat_no_artifact'

export const CREDIT_WEIGHTS: Record<CreditAction, number> = {
  guion_oferta: 3,
  guion_edit: 1,
  description: 1,
  reply: 1,
  image_standard: 6,
  image_pro: 24,
  image_edit: 18,
  image_enhance: 18,
  carousel_slide_standard: 6,
  carousel_slide_pro: 24,
  site_analysis_extra: 3,
  analyze_image: 1,
  transcription_minute: 1,
  pdf_ai_summary: 1,
  url_fetch: 0,
  autofill: 0,
  prompt_condense: 0,
  memory: 0,
  chat_no_artifact: 0,
}

export type PlanId =
  | 'free'
  | 'starter'
  | 'pro'
  | 'business'
  | 'meta_advanze'
  | 'enterprise'

export type PlanCatalogEntry = {
  id: PlanId
  nameEs: string
  nameEn: string
  priceUsd: number
  /** Monthly allotment; Free uses welcomeOnce instead. */
  creditsPerMonth: number
  /** Free welcome grant (once). */
  welcomeOnce: number
  kitsMax: number
  productsPerKitMax: number
  publicUpgrade: boolean
  hidden: boolean
  /** Existing TiloPay link or null / PLACEHOLDER. */
  paymentLink: string | null
  billing: 'once' | 'monthly'
}

export const PLAN_CATALOG: Record<PlanId, PlanCatalogEntry> = {
  free: {
    id: 'free',
    nameEs: 'Free',
    nameEn: 'Free',
    priceUsd: 0,
    creditsPerMonth: 0,
    welcomeOnce: 150,
    kitsMax: 1,
    productsPerKitMax: 3,
    publicUpgrade: true,
    hidden: false,
    paymentLink: null,
    billing: 'once',
  },
  starter: {
    id: 'starter',
    nameEs: 'Starter',
    nameEn: 'Starter',
    priceUsd: 33,
    creditsPerMonth: 750,
    welcomeOnce: 0,
    kitsMax: 2,
    productsPerKitMax: 10,
    publicUpgrade: true,
    hidden: false,
    paymentLink: 'https://tp.cr/l/TkRnM01RPT18MQ==',
    billing: 'monthly',
  },
  pro: {
    id: 'pro',
    nameEs: 'Premium',
    nameEn: 'Premium',
    priceUsd: 49,
    creditsPerMonth: 1500,
    welcomeOnce: 0,
    kitsMax: 5,
    productsPerKitMax: 25,
    publicUpgrade: true,
    hidden: false,
    paymentLink: 'https://tp.cr/l/TkRnM01nPT18MQ==',
    billing: 'monthly',
  },
  business: {
    id: 'business',
    nameEs: 'Business',
    nameEn: 'Business',
    priceUsd: 149,
    creditsPerMonth: 4800,
    welcomeOnce: 0,
    kitsMax: 20,
    productsPerKitMax: 100,
    publicUpgrade: true,
    hidden: false,
    paymentLink: 'https://tp.cr/l/TmpreE9BPT18MQ==',
    billing: 'monthly',
  },
  meta_advanze: {
    id: 'meta_advanze',
    nameEs: 'Meta AdVance',
    nameEn: 'Meta AdVance',
    priceUsd: 24,
    creditsPerMonth: 600,
    welcomeOnce: 0,
    kitsMax: 5,
    productsPerKitMax: 25,
    publicUpgrade: false,
    hidden: true,
    paymentLink: null,
    billing: 'monthly',
  },
  enterprise: {
    id: 'enterprise',
    nameEs: 'Enterprise',
    nameEn: 'Enterprise',
    priceUsd: 299,
    creditsPerMonth: 9600,
    welcomeOnce: 0,
    kitsMax: 50,
    productsPerKitMax: 500,
    publicUpgrade: false,
    hidden: true,
    paymentLink: 'https://tp.cr/l/TkRrMk53PT18MQ==',
    billing: 'monthly',
  },
}

export const CREDIT_PACK = {
  id: 'credit_pack' as const,
  nameEs: 'Paquete de créditos',
  nameEn: 'Credit pack',
  priceUsd: 25,
  credits: 500,
  ttlMonths: 12,
  /** One-time via TiloPay processPayment API — no static link. */
  paymentLink: null as string | null,
  /** Legacy boost link — stop selling; convert leftover bonus_images on migrate. */
  legacyBoostLink: 'https://tp.cr/l/MTg3NTc5',
}

/** Image / carousel model → Estándar vs Pro. */
export function resolveImageCreditAction(options: {
  action: 'generate' | 'edit' | 'enhance' | 'carousel'
  model?: string | null
}): CreditAction {
  if (options.action === 'edit') return 'image_edit'
  if (options.action === 'enhance') return 'image_enhance'
  const model = (options.model || '').toLowerCase()
  const isPro =
    model.includes('nano-banana-pro')
    || model.includes('gpt-image')
    || model.includes('gemini-3-pro-image')
    || model.includes('pro-image-preview')
    || model === 'pro'
  if (options.action === 'carousel') {
    return isPro ? 'carousel_slide_pro' : 'carousel_slide_standard'
  }
  return isPro ? 'image_pro' : 'image_standard'
}

export function quoteCredits(action: CreditAction, units = 1): number {
  const per = CREDIT_WEIGHTS[action]
  if (per == null) throw new Error(`Unknown credit action: ${action}`)
  const n = Math.max(0, Math.floor(units))
  return per * n
}

export type LegacyMeterAction = 'script' | 'image' | 'description' | 'enhance' | 'reply' | 'edit'

/** Map legacy checkUsageLimit actions when CREDITS_V1 is on. */
export function legacyActionToCredit(options: {
  action: LegacyMeterAction
  imageModel?: string | null
}): { creditAction: CreditAction; units: number } {
  switch (options.action) {
    case 'script':
      return { creditAction: 'guion_oferta', units: 1 }
    case 'description':
      return { creditAction: 'description', units: 1 }
    case 'reply':
      return { creditAction: 'reply', units: 1 }
    case 'enhance':
      return { creditAction: 'image_enhance', units: 1 }
    case 'edit':
      return { creditAction: 'image_edit', units: 1 }
    case 'image':
      return {
        creditAction: resolveImageCreditAction({
          action: 'generate',
          model: options.imageModel,
        }),
        units: 1,
      }
    default: {
      const _exhaustive: never = options.action
      throw new Error(`Unhandled legacy action: ${_exhaustive}`)
    }
  }
}

export function isCreditsV1Enabled(): boolean {
  const raw = (process.env.CREDITS_V1 || process.env.VITE_CREDITS_V1 || '').toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export const PUBLIC_UPGRADE_PLANS: PlanId[] = ['free', 'starter', 'pro', 'business']
