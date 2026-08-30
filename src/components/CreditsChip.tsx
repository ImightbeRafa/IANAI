import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'
import type { UsageLimits } from '../hooks/useUsageLimits'

interface CreditsChipProps {
  usage: UsageLimits
}

export default function CreditsChip({ usage }: CreditsChipProps) {
  const { language } = useLanguage()
  if (usage.loading || !usage.creditsEnabled) return null
  const label = language === 'es'
    ? `${usage.creditsRemaining} créditos IA`
    : `${usage.creditsRemaining} AI credits`
  return (
    <Link to="/settings" className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-800 hover:bg-primary-100">
      <Sparkles size={12} aria-hidden />
      {label}
    </Link>
  )
}
