import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, X } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'
import type { UsageLimits } from '../hooks/useUsageLimits'

interface UsageBannerProps {
  usage: UsageLimits
  /** Which resource to show: 'script' or 'image' */
  resource: 'script' | 'image'
}

/**
 * Soft, minimalistic upgrade banner.
 * Shows only when:
 * - User is on free plan AND has used ≥70% of their limit
 * - OR user has hit their limit (any plan)
 * 
 * Dismissible per session. Non-blocking — just a gentle nudge.
 */
export default function UsageBanner({ usage, resource }: UsageBannerProps) {
  const { language } = useLanguage()
  const [dismissed, setDismissed] = useState(false)

  if (usage.loading || dismissed) return null

  const used = resource === 'script' ? usage.scriptsUsed : usage.imagesUsed
  const limit = resource === 'script' ? usage.scriptsLimit : usage.imagesLimit

  // Unlimited (-1) — never show
  if (limit === -1) return null

  const percentage = limit > 0 ? (used / limit) * 100 : 0
  const isAtLimit = used >= limit
  const isNearLimit = percentage >= 70 && !isAtLimit

  // Only show for near-limit or at-limit
  if (!isNearLimit && !isAtLimit) return null

  const remaining = Math.max(0, limit - used)
  const resourceLabel = resource === 'script'
    ? (language === 'es' ? 'guiones' : 'scripts')
    : (language === 'es' ? 'imágenes' : 'images')

  const t = {
    es: {
      nearLimit: `Te quedan ${remaining} ${resourceLabel} este mes`,
      atLimit: `Alcanzaste tu límite de ${resourceLabel} este mes`,
      upgrade: 'Ver planes',
    },
    en: {
      nearLimit: `${remaining} ${resourceLabel} remaining this month`,
      atLimit: `You've reached your ${resourceLabel} limit this month`,
      upgrade: 'View plans',
    }
  }

  const labels = t[language]

  if (isAtLimit) {
    return (
      <div className="mx-3 mb-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-900">{labels.atLimit}</p>
        </div>
        <Link
          to="/settings"
          className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex-shrink-0"
        >
          {labels.upgrade}
        </Link>
      </div>
    )
  }

  // Near limit — subtle, dismissible
  return (
    <div className="mx-3 mb-3 px-4 py-2.5 bg-dark-50 border border-dark-100 rounded-xl flex items-center gap-3">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-xs text-dark-500">{labels.nearLimit}</span>
        <div className="flex-1 max-w-[80px] h-1.5 bg-dark-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all"
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      </div>
      <Link
        to="/settings"
        className="text-xs text-primary-600 hover:text-primary-700 font-medium flex-shrink-0"
      >
        {labels.upgrade}
      </Link>
      <button
        onClick={() => setDismissed(true)}
        className="text-dark-300 hover:text-dark-500 flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
