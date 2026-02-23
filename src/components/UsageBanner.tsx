import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, X, ShoppingCart } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'
import type { UsageLimits } from '../hooks/useUsageLimits'

interface UsageBannerProps {
  usage: UsageLimits
  /** Which resource to show: 'script' or 'image' */
  resource: 'script' | 'image'
  /** Optional callback to buy more images (boost) */
  onBuyBoost?: () => void
}

/**
 * Soft, minimalistic upgrade banner.
 * Shows only when:
 * - User is on free plan AND has used ≥70% of their limit
 * - OR user has hit their limit (any plan)
 * 
 * For premium users near their image limit, shows a "buy more" button.
 * Dismissible per session. Non-blocking — just a gentle nudge.
 */
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0)
  const prevRef = useRef(0)

  useEffect(() => {
    const from = prevRef.current
    const to = value
    if (from === to) { setDisplay(to); return }
    const duration = 400
    const start = performance.now()
    let raf: number
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (to - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    prevRef.current = to
    return () => cancelAnimationFrame(raf)
  }, [value])

  return <>{display}</>
}

export default function UsageBanner({ usage, resource, onBuyBoost }: UsageBannerProps) {
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
    : (language === 'es' ? 'diseños' : 'designs')

  // Premium users (pro) get a "buy more" option for images
  const isPremium = usage.plan === 'pro' || usage.plan === 'meta_advanze'
  const showBuyMore = resource === 'image' && isPremium && onBuyBoost

  const t = {
    es: {
      nearLimit: `Te quedan ${remaining} ${resourceLabel} este mes`,
      atLimit: `Alcanzaste tu límite de ${resourceLabel} este mes`,
      upgrade: 'Ver planes',
      buyMore: '+100 diseños · $14.99',
    },
    en: {
      nearLimit: `${remaining} ${resourceLabel} remaining this month`,
      atLimit: `You've reached your ${resourceLabel} limit this month`,
      upgrade: 'View plans',
      buyMore: '+100 designs · $14.99',
    }
  }

  const labels = t[language]

  if (isAtLimit) {
    return (
      <div className="mx-3 mb-3 px-4 py-3 bg-amber-900/20 border border-amber-700/30 rounded-xl flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-800/30 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-300">{labels.atLimit}</p>
        </div>
        {showBuyMore ? (
          <button
            onClick={onBuyBoost}
            className="px-3 py-1.5 text-xs font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex-shrink-0 flex items-center gap-1.5"
          >
            <ShoppingCart className="w-3 h-3" />
            {labels.buyMore}
          </button>
        ) : (
          <Link
            to="/settings"
            className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex-shrink-0"
          >
            {labels.upgrade}
          </Link>
        )}
      </div>
    )
  }

  // Near limit — subtle, dismissible
  return (
    <div className="mx-3 mb-3 px-4 py-2.5 bg-dark-200 border border-dark-300 rounded-xl flex items-center gap-3">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-xs text-dark-500">
          <AnimatedNumber value={remaining} /> {resourceLabel} {language === 'es' ? 'este mes' : 'this month'}
        </span>
        <div className="flex-1 max-w-[80px] h-1.5 bg-dark-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all duration-700"
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      </div>
      {showBuyMore ? (
        <button
          onClick={onBuyBoost}
          className="text-xs text-primary-600 hover:text-primary-700 font-medium flex-shrink-0 flex items-center gap-1"
        >
          <ShoppingCart className="w-3 h-3" />
          {labels.buyMore}
        </button>
      ) : (
        <Link
          to="/settings"
          className="text-xs text-primary-600 hover:text-primary-700 font-medium flex-shrink-0"
        >
          {labels.upgrade}
        </Link>
      )}
      <button
        onClick={() => setDismissed(true)}
        className="text-dark-300 hover:text-dark-500 flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
