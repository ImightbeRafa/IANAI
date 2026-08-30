export type SettingsCategoryId =
  | 'general'
  | 'ai'
  | 'brand'
  | 'billing'
  | 'updates'
  | 'admin'
  | 'tickets'

export type SettingsCategoryGroup = 'user' | 'admin'

export interface SettingsCategory {
  id: SettingsCategoryId
  group: SettingsCategoryGroup
  label: { es: string; en: string }
}

const USER_CATEGORIES: SettingsCategory[] = [
  { id: 'general', group: 'user', label: { es: 'General', en: 'General' } },
  { id: 'ai', group: 'user', label: { es: 'Preferencias de IA', en: 'AI Preferences' } },
  { id: 'brand', group: 'user', label: { es: 'Brand Kits', en: 'Brand Kits' } },
  { id: 'billing', group: 'user', label: { es: 'Plan y facturación', en: 'Plan & Billing' } },
  { id: 'updates', group: 'user', label: { es: 'Novedades', en: 'Updates & Feedback' } },
]

const ADMIN_CATEGORIES: SettingsCategory[] = [
  { id: 'admin', group: 'admin', label: { es: 'Admin', en: 'Admin' } },
  { id: 'tickets', group: 'admin', label: { es: 'Tickets', en: 'Tickets' } },
]

export function settingsCategories(isAdmin: boolean, adminResolved = true): SettingsCategory[] {
  const user = USER_CATEGORIES.filter((category) => category.id !== 'ai')
  return isAdmin && adminResolved ? [...user, ...ADMIN_CATEGORIES] : user
}

export function defaultSettingsCategory(): SettingsCategoryId {
  return 'general'
}

export function isSettingsCategoryId(value: unknown): value is SettingsCategoryId {
  return (
    value === 'general'
    || value === 'ai'
    || value === 'brand'
    || value === 'billing'
    || value === 'updates'
    || value === 'admin'
    || value === 'tickets'
  )
}
