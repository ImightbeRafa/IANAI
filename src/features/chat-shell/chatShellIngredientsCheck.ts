import { isGeneratedOfferImage, type ShellImageLike } from './chatShellImages'
import { referenceRoleFromStored } from './chatShellReferenceSelection'

export type IngredientKind = 'productPhoto' | 'logo' | 'style'

export function detectMissingIngredients(options: {
  offerImages: ShellImageLike[]
  productId: string
  brandLogoUrl?: string | null
  /** When 'none', all three count as missing even if the kit/rail already has unused files. */
  referenceMode?: 'use' | 'none'
  /** Product/style refs selected for this generate (ignored when referenceMode is 'none'). */
  selectedReferenceImageIds?: string[]
}): IngredientKind[] {
  if (options.referenceMode === 'none') {
    return ['productPhoto', 'logo', 'style']
  }

  const selectedIds = new Set(options.selectedReferenceImageIds || [])
  const refsForOffer = options.offerImages.filter(
    (img) => img.product_id === options.productId && !isGeneratedOfferImage(img)
  )
  const selectedRefs = selectedIds.size > 0
    ? refsForOffer.filter((img) => selectedIds.has(img.id))
    : refsForOffer

  const hasProductPhoto = selectedRefs.some(
    (img) => referenceRoleFromStored({ kind: img.kind, label: img.label }) === 'product'
  )
  const hasStyle = selectedRefs.some((img) => {
    const role = referenceRoleFromStored({ kind: img.kind, label: img.label })
    return role === 'style'
  })
  const hasLogo = Boolean(options.brandLogoUrl?.trim())

  const missing: IngredientKind[] = []
  if (!hasProductPhoto) missing.push('productPhoto')
  if (!hasLogo) missing.push('logo')
  if (!hasStyle) missing.push('style')
  return missing
}

const INGREDIENT_LABELS_ES: Record<IngredientKind, string> = {
  productPhoto: 'foto de producto',
  logo: 'logo',
  style: 'estilo',
}

const INGREDIENT_LABELS_EN: Record<IngredientKind, string> = {
  productPhoto: 'product photo',
  logo: 'logo',
  style: 'style reference',
}

export function ingredientsPromptCopy(
  missing: IngredientKind[],
  language: 'en' | 'es'
): string {
  const es = language === 'es'
  const labels = es ? INGREDIENT_LABELS_ES : INGREDIENT_LABELS_EN
  const named = missing.map((kind) => labels[kind])
  if (es) {
    if (named.length === 1) {
      return `Todavía falta ${named[0]}. La generación sale mucho mejor con esa pieza. Podés subirla en el rail o seguir sin ${named[0]}.`
    }
    const last = named.pop()
    return `Todavía faltan ${named.join(', ')} y ${last}. La generación sale mucho mejor con esas piezas. Podés subirlas en el rail o seguir sin cada una.`
  }
  if (named.length === 1) {
    return `Still missing ${named[0]}. Generation works much better with it. Upload it in the rail or continue without it.`
  }
  const last = named.pop()
  return `Still missing ${named.join(', ')} and ${last}. Generation works much better with those pieces. Upload in the rail or continue without each one.`
}

export function skipIngredientLabel(kind: IngredientKind, language: 'en' | 'es'): string {
  const es = language === 'es'
  switch (kind) {
    case 'productPhoto':
      return es ? 'Seguir sin foto de producto' : 'Continue without product photo'
    case 'logo':
      return es ? 'Seguir sin logo' : 'Continue without logo'
    case 'style':
      return es ? 'Seguir sin estilo' : 'Continue without style reference'
    default: {
      const _never: never = kind
      return _never
    }
  }
}

export function shouldCheckImageIngredients(styleKind: string | undefined): boolean {
  return styleKind !== 'logo'
}

export function remainingIngredients(
  missing: IngredientKind[],
  skipped: ReadonlySet<IngredientKind>
): IngredientKind[] {
  return missing.filter((kind) => !skipped.has(kind))
}

/**
 * After Confirmá referencias → Generar / Crear sin referencias, soft pieces
 * (style, logo) are implicitly skipped. Never re-ask them post-click.
 * Crear sin referencias also skips productPhoto.
 */
export function ingredientsSkippedAfterRefsConfirm(
  referenceMode: 'use' | 'none'
): IngredientKind[] {
  if (referenceMode === 'none') {
    return ['productPhoto', 'logo', 'style']
  }
  return ['logo', 'style']
}

/** Soft reminder copy for the refs sheet (before Generar) — never after spinner. */
export function refsSoftMissingHint(
  missingSoft: Array<'logo' | 'style'>,
  language: 'en' | 'es'
): string | null {
  if (missingSoft.length === 0) return null
  const es = language === 'es'
  if (missingSoft.length === 2) {
    return es
      ? 'Opcional: subí estilo o logo, o Generá igual — saldrá bien con el producto.'
      : 'Optional: upload style or logo, or Generar anyway — product alone is fine.'
  }
  if (missingSoft[0] === 'style') {
    return es
      ? 'Opcional: subí un estilo de post, o Generá sin estilo.'
      : 'Optional: upload a post style, or Generar without style.'
  }
  return es
    ? 'Opcional: subí un logo, o Generá sin logo.'
    : 'Optional: upload a logo, or Generar without logo.'
}

