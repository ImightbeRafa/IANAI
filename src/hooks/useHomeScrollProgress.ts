import { useEffect, useRef, useState, type RefObject } from 'react'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

/**
 * Tracks how far the hero has scrolled out (0 → 1) and writes
 * `--home-scroll` on the page root for CSS-driven motion.
 */
export function useHomeScrollProgress(pageRef: RefObject<HTMLElement | null>) {
  const reduced = usePrefersReducedMotion()
  const [progress, setProgress] = useState(0)
  const [pastHero, setPastHero] = useState(false)
  const rafRef = useRef(0)

  useEffect(() => {
    const page = pageRef.current
    if (!page) return

    if (reduced) {
      page.style.setProperty('--home-scroll', '0')
      page.classList.remove('is-past-hero')
      setProgress(0)
      setPastHero(false)
      return
    }

    const hero = page.querySelector<HTMLElement>('.home-hero')
    if (!hero) return

    const update = () => {
      rafRef.current = 0
      const rect = hero.getBoundingClientRect()
      const travel = Math.max(rect.height * 0.72, 1)
      const raw = Math.min(1, Math.max(0, -rect.top / travel))
      const next = Math.round(raw * 1000) / 1000
      page.style.setProperty('--home-scroll', String(next))
      const past = next >= 0.55
      page.classList.toggle('is-past-hero', past)
      setProgress(next)
      setPastHero(past)
    }

    const onScroll = () => {
      if (rafRef.current) return
      rafRef.current = window.requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
    }
  }, [pageRef, reduced])

  return { progress, pastHero, reduced }
}
