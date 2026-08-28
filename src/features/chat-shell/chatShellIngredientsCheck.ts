import { isGeneratedOfferImage, type ShellImageLike } from './chatShellImages'
import { referenceRoleFromStored } from './chatShellReferenceSelection'

export type IngredientKind = 'productPhoto' | 'logo' | 'style'

export function detectMissingIngredients(options: {
  offerImages: ShellImageLike[]
  productId: string
  brandLogoUrl?: string | null
}): IngredientKind[] {
  const refs = options.offerImages.filter(
    (img) => img.product_id === options.productId && !isGeneratedOfferImage(img)
  )
  const hasProductPhoto = refs.some(
    (img) => referenceRoleFromStored({ kind: img.kind, label: img.label }) === 'product'
  )
  const hasStyle = refs.some((img) => {
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
