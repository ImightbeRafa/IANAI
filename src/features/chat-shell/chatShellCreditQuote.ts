import { CREDIT_WEIGHTS } from '../../lib/creditsCatalog'

export type CreditQuoteKind = 'scripts' | 'image_standard' | 'image_pro'

export interface CreditQuote {
  kind: CreditQuoteKind
  units: number
  cost: number
  remaining: number
}

export function quoteScriptCredits(offerCount: number): number {
  const n = Math.max(1, Math.floor(offerCount) || 1)
  return n * CREDIT_WEIGHTS.guion_oferta
}

export function quoteImageCredits(model: string | null | undefined): number {
  const normalized = (model || '').toLowerCase()
  if (normalized.includes('pro') || normalized.includes('gpt-image') || normalized === 'openai') {
    return CREDIT_WEIGHTS.image_pro
  }
  return CREDIT_WEIGHTS.image_standard
}

export function buildCreditQuote(options: {
  kind: CreditQuoteKind
  units?: number
  remaining: number
}): CreditQuote {
  const units = Math.max(1, options.units ?? 1)
  const cost =
    options.kind === 'scripts'
      ? quoteScriptCredits(units)
      : options.kind === 'image_pro'
        ? CREDIT_WEIGHTS.image_pro
        : CREDIT_WEIGHTS.image_standard
  return {
    kind: options.kind,
    units,
    cost,
    remaining: Math.max(0, options.remaining),
  }
}

export function creditQuoteCopy(
  quote: CreditQuote,
  language: 'es' | 'en'
): { question: string; confirm: string; cancel: string } {
  if (language === 'en') {
    const what =
      quote.kind === 'scripts'
        ? `This will cost ${quote.cost} credits (${CREDIT_WEIGHTS.guion_oferta} × ${quote.units} offer${quote.units === 1 ? '' : 's'}).`
        : `This image will cost ${quote.cost} credits.`
    return {
      question: `${what} You have ${quote.remaining} left. Continue?`,
      confirm: 'Continue',
      cancel: 'Cancel',
    }
  }
  const what =
    quote.kind === 'scripts'
      ? `Esto cuesta ${quote.cost} créditos (${CREDIT_WEIGHTS.guion_oferta} × ${quote.units} oferta${quote.units === 1 ? '' : 's'}).`
      : `Esta imagen cuesta ${quote.cost} créditos.`
  return {
    question: `${what} Te quedan ${quote.remaining}. ¿Seguimos?`,
    confirm: 'Seguir',
    cancel: 'Cancelar',
  }
}
