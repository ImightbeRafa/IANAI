import { useEffect, useRef, useState, type RefObject } from 'react'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

/**
 * Tracks how far the hero has scrolled out (0 → 1) and writes
 * `--home-scroll` on the page root for CSS-driven motion.
 * Also toggles `.is-past-hero` so sparse edge ghosts engage.
 * Under prefers-reduced-motion: still toggles past-hero (static ghosts),
 * but adds `.is-reduced-motion` so pop/twinkle stay off.
 *
 * `enabled` must flip true only when `.home-page` / `.home-hero` are mounted
 * (Home early-returns during auth load — without `enabled` the effect never rebinds).
 */
export function useHomeScrollProgress(
  pageRef: RefObject<HTMLElement | null>,
  enabled = true,
) {
  const reduced = usePrefersReducedMotion()
  const [progress, setProgress] = useState(0)
  const [pastHero, setPastHero] = useState(false)
  const rafRef = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const page = pageRef.current
    if (!page) return

    page.classList.toggle('is-reduced-motion', reduced)

    const hero = page.querySelector<HTMLElement>('.home-hero')
    if (!hero) return

    const update = () => {
      rafRef.current = 0
      const rect = hero.getBoundingClientRect()
      const travel = Math.max(rect.height * 0.45, 120)
      const raw = Math.min(1, Math.max(0, -rect.top / travel))
      const next = Math.round(raw * 1000) / 1000
      page.style.setProperty('--home-scroll', String(next))
      const past = -rect.top > 48 || next >= 0.2
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
  }, [pageRef, reduced, enabled])

  return { progress, pastHero, reduced }
}
