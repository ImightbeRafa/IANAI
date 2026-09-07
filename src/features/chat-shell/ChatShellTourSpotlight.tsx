import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatShellTourPlacement } from './chatShellTourSteps'

type SpotRect = {
  top: number
  left: number
  width: number
  height: number
}

interface ChatShellTourSpotlightProps {
  targetSelector: string
  placement: ChatShellTourPlacement
  children: ReactNode
}

function isOnScreen(rect: SpotRect): boolean {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return rect.left + rect.width > 0
    && rect.left < vw
    && rect.top + rect.height > 0
    && rect.top < vh
    && rect.width > 10
    && rect.height > 10
}

function measureTarget(selector: string, padding: number): SpotRect | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    top: r.top - padding,
    left: r.left - padding,
    width: r.width + padding * 2,
    height: r.height + padding * 2,
  }
}

export default function ChatShellTourSpotlight({
  targetSelector,
  placement,
  children,
}: ChatShellTourSpotlightProps) {
  const [rect, setRect] = useState<SpotRect | null>(null)
  const [visible, setVisible] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltipPos, setTooltipPos] = useState({ top: 24, left: 24 })

  useEffect(() => {
    const padding = 8
    const run = () => {
      const next = measureTarget(targetSelector, padding)
      setRect(next)
      setVisible(Boolean(next && isOnScreen(next)))
    }
    run()
    const timers = [80, 200, 400].map((ms) => window.setTimeout(run, ms))
    window.addEventListener('resize', run)
    window.addEventListener('scroll', run, true)
    return () => {
      timers.forEach((id) => window.clearTimeout(id))
      window.removeEventListener('resize', run)
      window.removeEventListener('scroll', run, true)
    }
  }, [targetSelector])

  useLayoutEffect(() => {
    const tt = tooltipRef.current?.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const tw = tt?.width || 360
    const th = tt?.height || 280

    let top = vh / 2 - th / 2
    let left = vw / 2 - tw / 2

    if (rect && visible) {
      switch (placement) {
        case 'right':
          top = rect.top + rect.height / 2 - th / 2
          left = rect.left + rect.width + 16
          if (left + tw > vw - 16) {
            left = rect.left + rect.width / 2 - tw / 2
            top = rect.top + rect.height + 16
          }
          break
        case 'bottom':
          top = rect.top + rect.height + 16
          left = rect.left + rect.width / 2 - tw / 2
          break
        case 'top':
          top = rect.top - th - 16
          left = rect.left + rect.width / 2 - tw / 2
          break
        case 'center':
          break
        default: {
          const _never: never = placement
          void _never
        }
      }
    }

    top = Math.max(16, Math.min(top, vh - th - 16))
    left = Math.max(16, Math.min(left, vw - tw - 16))
    setTooltipPos({ top, left })
  }, [rect, visible, placement])

  const hole = rect && visible ? rect : null
  const r = 12
  const clipPath = hole
    ? `polygon(
    0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
    ${hole.left}px ${hole.top + r}px,
    ${hole.left + r}px ${hole.top}px,
    ${hole.left + hole.width - r}px ${hole.top}px,
    ${hole.left + hole.width}px ${hole.top + r}px,
    ${hole.left + hole.width}px ${hole.top + hole.height - r}px,
    ${hole.left + hole.width - r}px ${hole.top + hole.height}px,
    ${hole.left + r}px ${hole.top + hole.height}px,
    ${hole.left}px ${hole.top + hole.height - r}px,
    ${hole.left}px ${hole.top + r}px
  )`
    : undefined

  return (
    <div className="chat-shell__tour-spot" data-tour-has-hole={hole ? '1' : '0'}>
      <div className="chat-shell__tour-spot-block" />
      <div
        className="chat-shell__tour-spot-dim"
        style={clipPath ? { clipPath } : undefined}
      />
      {hole ? (
        <div
          className="chat-shell__tour-spot-ring"
          style={{
            top: hole.top - 2,
            left: hole.left - 2,
            width: hole.width + 4,
            height: hole.height + 4,
          }}
        />
      ) : null}
      <div
        ref={tooltipRef}
        className="chat-shell__tour-spot-card-wrap"
        style={{ top: tooltipPos.top, left: tooltipPos.left }}
      >
        {children}
      </div>
    </div>
  )
}
