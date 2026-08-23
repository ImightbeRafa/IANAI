/**
 * Credit-aware usage banner — prefers Créditos IA remaining when enabled.
 */
import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, X, ShoppingCart } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'
import type { UsageLimits } from '../hooks/useUsageLimits'
import { CREDIT_PACK_UI } from '../lib/creditsCatalog'

interface UsageBannerProps {
  usage: UsageLimits
  resource: 'script' | 'image'
  onBuyBoost?: () => void
}

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

  if (usage.creditsEnabled) {
    const remaining = usage.creditsRemaining
    const softFloor = 50
    const isAtLimit = remaining <= 0
    const isNearLimit = remaining > 0 && remaining <= softFloor
    if (!isNearLimit && !isAtLimit) return null

    const t = {
      es: {
        nearLimit: `Te quedan ${remaining} créditos IA`,
        atLimit: 'Se te acabaron los créditos IA',
        upgrade: 'Ver planes',
        buyMore: CREDIT_PACK_UI.labelEs,
      },
      en: {
        nearLimit: `${remaining} AI credits left`,
        atLimit: "You're out of AI credits",
        upgrade: 'View plans',
        buyMore: CREDIT_PACK_UI.labelEn,
      },
    }
    const labels = t[language]

    return (
      <div className={`mx-3 mb-3 px-4 py-3 rounded-xl flex items-center gap-3 ${
        isAtLimit ? 'bg-amber-900/20 border border-amber-700/30' : 'bg-dark-100/80 border border-dark-200'
      }`}>
        <div className="w-8 h-8 rounded-lg bg-amber-800/30 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-dark-800">
            {isAtLimit ? labels.atLimit : labels.nearLimit}
          </p>
        </div>
        {onBuyBoost && (
          <button type="button" onClick={onBuyBoost} className="text-xs font-medium text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
            <ShoppingCart className="w-3.5 h-3.5" />
            {labels.buyMore}
          </button>
        )}
        <Link to="/settings" className="text-xs font-medium text-dark-500 hover:text-dark-700">{labels.upgrade}</Link>
        <button type="button" onClick={() => setDismissed(true)} className="p-1 text-dark-400 hover:text-dark-600" aria-label="Dismiss">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  const used = resource === 'script' ? usage.scriptsUsed : usage.imagesUsed
  const limit = resource === 'script' ? usage.scriptsLimit : usage.imagesLimit
  if (limit === -1) return null

  const percentage = limit > 0 ? (used / limit) * 100 : 0
  const isAtLimit = used >= limit
  const isNearLimit = percentage >= 70 && !isAtLimit
  if (!isNearLimit && !isAtLimit) return null

  const remaining = Math.max(0, limit - used)
  const resourceLabel = resource === 'script'
    ? (language === 'es' ? 'guiones' : 'scripts')
    : (language === 'es' ? 'diseños' : 'designs')

  const t = {
    es: {
      nearLimit: `Te quedan ${remaining} ${resourceLabel} este mes`,
      atLimit: `Alcanzaste tu límite de ${resourceLabel} este mes`,
      upgrade: 'Ver planes',
      buyMore: CREDIT_PACK_UI.labelEs,
    },
    en: {
      nearLimit: `${remaining} ${resourceLabel} remaining this month`,
      atLimit: `You've reached your ${resourceLabel} limit this month`,
      upgrade: 'View plans',
      buyMore: CREDIT_PACK_UI.labelEn,
    },
  }
  const labels = t[language]
  const showBuyMore = Boolean(onBuyBoost)

  return (
    <div className={`mx-3 mb-3 px-4 py-3 rounded-xl flex items-center gap-3 ${
      isAtLimit ? 'bg-amber-900/20 border border-amber-700/30' : 'bg-dark-100/80 border border-dark-200'
    }`}>
      <div className="w-8 h-8 rounded-lg bg-amber-800/30 flex items-center justify-center flex-shrink-0">
        <Sparkles className="w-4 h-4 text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-dark-800">
          {isAtLimit ? labels.atLimit : <>{labels.nearLimit} (<AnimatedNumber value={remaining} />)</>}
        </p>
      </div>
      {showBuyMore && (
        <button type="button" onClick={onBuyBoost} className="text-xs font-medium text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
          <ShoppingCart className="w-3.5 h-3.5" />
          {labels.buyMore}
        </button>
      )}
      <Link to="/settings" className="text-xs font-medium text-dark-500 hover:text-dark-700">{labels.upgrade}</Link>
      <button type="button" onClick={() => setDismissed(true)} className="p-1 text-dark-400 hover:text-dark-600" aria-label="Dismiss">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
