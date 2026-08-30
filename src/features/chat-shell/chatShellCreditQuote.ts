import { CREDIT_WEIGHTS } from '../../lib/creditsCatalog'

export type CreditQuoteKind =
  | 'scripts'
  | 'image_standard'
  | 'image_pro'
  | 'image_edit'
  | 'image_enhance'

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

/** Edit / enhance share the catalog weight (18) — must match server charge. */
export function quoteEditEnhanceCredits(actionType: 'edit' | 'enhance'): number {
  return actionType === 'enhance'
    ? CREDIT_WEIGHTS.image_enhance
    : CREDIT_WEIGHTS.image_edit
}

export function buildCreditQuote(options: {
  kind: CreditQuoteKind
  units?: number
  remaining: number
}): CreditQuote {
  const units = Math.max(1, options.units ?? 1)
  let cost: number
  switch (options.kind) {
    case 'scripts':
      cost = quoteScriptCredits(units)
      break
    case 'image_pro':
      cost = CREDIT_WEIGHTS.image_pro * units
      break
    case 'image_edit':
      cost = CREDIT_WEIGHTS.image_edit * units
      break
    case 'image_enhance':
      cost = CREDIT_WEIGHTS.image_enhance * units
      break
    case 'image_standard':
      cost = CREDIT_WEIGHTS.image_standard * units
      break
    default: {
      const _exhaustive: never = options.kind
      throw new Error(`Unhandled credit quote kind: ${_exhaustive}`)
    }
  }
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
        : quote.kind === 'image_enhance'
          ? `This enhance will cost ${quote.cost} credits.`
          : quote.kind === 'image_edit'
            ? `This edit will cost ${quote.cost} credits.`
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
      : quote.kind === 'image_enhance'
        ? `Esta mejora cuesta ${quote.cost} créditos.`
        : quote.kind === 'image_edit'
          ? `Esta edición cuesta ${quote.cost} créditos.`
          : `Esta imagen cuesta ${quote.cost} créditos.`
  return {
    question: `${what} Te quedan ${quote.remaining}. ¿Seguimos?`,
    confirm: 'Seguir',
    cancel: 'Cancelar',
  }
}
