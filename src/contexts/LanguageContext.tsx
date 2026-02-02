import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type Language = 'en' | 'es'

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string) => string
}

const translations: Record<Language, Record<string, string>> = {
  en: {
    // Settings
    'settings.title': 'Settings',
    'settings.subtitle': 'Manage your account settings',
    'settings.profile': 'Profile Information',
    'settings.email': 'Email',
    'settings.emailNote': 'Email cannot be changed',
    'settings.fullName': 'Full Name',
    'settings.save': 'Save Changes',
    'settings.saving': 'Saving...',
    'settings.success': 'Profile updated successfully!',
    'settings.account': 'Account',
    'settings.created': 'Account Created',
    'settings.subscription': 'Subscription',
    'settings.freePlan': 'Free Plan',
    'settings.comingSoon': 'Coming Soon',
    'settings.preferences': 'Preferences',
    'settings.language': 'AI Language',
    'settings.languageNote': 'Language for AI conversations and generated scripts',
    
    // Languages
    'lang.en': 'English',
    'lang.es': 'Spanish',
  },
  es: {
    // Settings
    'settings.title': 'Configuración',
    'settings.subtitle': 'Administra la configuración de tu cuenta',
    'settings.profile': 'Información del Perfil',
    'settings.email': 'Correo Electrónico',
    'settings.emailNote': 'El correo no se puede cambiar',
    'settings.fullName': 'Nombre Completo',
    'settings.save': 'Guardar Cambios',
    'settings.saving': 'Guardando...',
    'settings.success': '¡Perfil actualizado exitosamente!',
    'settings.account': 'Cuenta',
    'settings.created': 'Cuenta Creada',
    'settings.subscription': 'Suscripción',
    'settings.freePlan': 'Plan Gratuito',
    'settings.comingSoon': 'Próximamente',
    'settings.preferences': 'Preferencias',
    'settings.language': 'Idioma del AI',
    'settings.languageNote': 'Idioma para conversaciones y scripts generados por IA',
    
    // Languages
    'lang.en': 'Inglés',
    'lang.es': 'Español',
  }
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('ai-language')
    return (saved as Language) || 'en'
  })

  useEffect(() => {
    localStorage.setItem('ai-language', language)
  }, [language])

  const setLanguage = (lang: Language) => {
    setLanguageState(lang)
  }

  const t = (key: string): string => {
    return translations[language][key] || key
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
