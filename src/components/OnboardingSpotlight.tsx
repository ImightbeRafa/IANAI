import { useEffect, useState, useRef } from 'react'

interface SpotlightRect {
  top: number
  left: number
  width: number
  height: number
}

interface OnboardingSpotlightProps {
  targetSelector: string
  children: React.ReactNode
  position?: 'right' | 'bottom' | 'top' | 'center'
  padding?: number
}

function isRectVisible(r: SpotlightRect): boolean {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // Element is off-screen or too small
  return r.left + r.width > 0 && r.left < vw && r.top + r.height > 0 && r.top < vh && r.width > 10 && r.height > 10
}

export default function OnboardingSpotlight({
  targetSelector,
  children,
  position = 'right',
  padding = 8,
}: OnboardingSpotlightProps) {
  const [rect, setRect] = useState<SpotlightRect | null>(null)
  const [visible, setVisible] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  useEffect(() => {
    function measure() {
      const el = document.querySelector(targetSelector)
      if (!el) return
      const r = el.getBoundingClientRect()
      const spotRect = {
        top: r.top - padding,
        left: r.left - padding,
        width: r.width + padding * 2,
        height: r.height + padding * 2,
      }
      setRect(spotRect)
      setVisible(isRectVisible(spotRect))
    }

    // Small delay to ensure layout is settled
    const timer = setTimeout(measure, 50)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [targetSelector, padding])

  useEffect(() => {
    if (!tooltipRef.current) return
    const tt = tooltipRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let top = 0
    let left = 0

    // If target is off-screen (mobile sidebar hidden), center the tooltip
    if (!rect || !visible) {
      top = vh / 2 - tt.height / 2
      left = vw / 2 - tt.width / 2
    } else if (position === 'right') {
      top = rect.top + rect.height / 2 - tt.height / 2
      left = rect.left + rect.width + 16
      // If overflows right, try bottom
      if (left + tt.width > vw - 16) {
        left = rect.left + rect.width / 2 - tt.width / 2
        top = rect.top + rect.height + 16
      }
    } else if (position === 'bottom') {
      top = rect.top + rect.height + 16
      left = rect.left + rect.width / 2 - tt.width / 2
    } else if (position === 'top') {
      top = rect.top - tt.height - 16
      left = rect.left + rect.width / 2 - tt.width / 2
      // If overflows left, shift right
      if (left < 16) left = 16
      // If overflows right, shift left
      if (left + tt.width > vw - 16) left = vw - tt.width - 16
    } else {
      top = vh / 2 - tt.height / 2
      left = vw / 2 - tt.width / 2
    }

    // Clamp to viewport
    top = Math.max(16, Math.min(top, vh - tt.height - 16))
    left = Math.max(16, Math.min(left, vw - tt.width - 16))

    setTooltipPos({ top, left })
  }, [rect, position, visible])

  // If target element not found at all, render centered fallback
  if (!rect) {
    return (
      <>
        <div className="fixed inset-0 z-[100] bg-black/65" />
        <div className="fixed inset-0 z-[102] flex items-center justify-center p-4">
          {children}
        </div>
      </>
    )
  }

  // If target is off-screen (e.g. mobile sidebar hidden), show centered modal
  if (!visible) {
    return (
      <>
        <div className="fixed inset-0 z-[100] bg-black/65" />
        <div className="fixed inset-0 z-[102] flex items-center justify-center p-4 animate-fade-in-up">
          {children}
        </div>
      </>
    )
  }

  // Build a polygon clip-path that covers the full viewport with a rectangular hole
  const r = 12
  const clipPath = `polygon(
    0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
    ${rect.left}px ${rect.top + r}px,
    ${rect.left + r}px ${rect.top}px,
    ${rect.left + rect.width - r}px ${rect.top}px,
    ${rect.left + rect.width}px ${rect.top + r}px,
    ${rect.left + rect.width}px ${rect.top + rect.height - r}px,
    ${rect.left + rect.width - r}px ${rect.top + rect.height}px,
    ${rect.left + r}px ${rect.top + rect.height}px,
    ${rect.left}px ${rect.top + rect.height - r}px,
    ${rect.left}px ${rect.top + r}px
  )`

  return (
    <>
      {/* Transparent click blocker — prevents interaction with page through the spotlight hole */}
      <div className="fixed inset-0 z-[99]" />
      {/* Dark overlay with cutout hole */}
      <div
        className="fixed inset-0 z-[100] pointer-events-none transition-all duration-300"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          clipPath,
        }}
      />
      {/* Glow ring around the spotlight target */}
      <div
        className="fixed z-[100] rounded-xl pointer-events-none"
        style={{
          top: rect.top - 2,
          left: rect.left - 2,
          width: rect.width + 4,
          height: rect.height + 4,
          border: '2px solid rgba(2, 132, 199, 0.5)',
          boxShadow: '0 0 20px 4px rgba(2, 132, 199, 0.2)',
        }}
      />
      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        className="fixed z-[102] animate-fade-in-up"
        style={{ top: tooltipPos.top, left: tooltipPos.left }}
      >
        {children}
      </div>
    </>
  )
}
