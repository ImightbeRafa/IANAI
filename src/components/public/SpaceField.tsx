import { useEffect, useMemo, useState } from 'react'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import './space-field.css'

type Star = {
  id: number
  x: number
  y: number
  size: number
  delay: number
  dur: number
  bright: boolean
}

type SpaceFieldProps = {
  /** Desktop star count before mobile reduction */
  density?: 'hero' | 'auth'
  className?: string
  fixed?: boolean
}

function seededStars(count: number, seed: number): Star[] {
  let s = seed
  const next = () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
  return Array.from({ length: count }, (_, i) => {
    const r1 = next()
    const r2 = next()
    const r3 = next()
    const r4 = next()
    const r5 = next()
    return {
      id: i,
      x: r1 * 100,
      y: r2 * 100,
      size: 1.15 + r3 * 2.35,
      delay: r4 * 5.5,
      dur: 2.8 + r5 * 3.4,
      bright: r3 > 0.82,
    }
  })
}

export default function SpaceField({ density = 'hero', className = '', fixed = false }: SpaceFieldProps) {
  const reduced = usePrefersReducedMotion()
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const sync = () => setNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const stars = useMemo(() => {
    const base = density === 'auth' ? 56 : 96
    const count = reduced ? Math.min(28, base) : narrow ? Math.round(base * 0.48) : base
    return seededStars(count, density === 'auth' ? 42 : 17)
  }, [density, narrow, reduced])

  const showShoots = !reduced && !narrow

  const classes = [
    'space-field',
    fixed ? 'space-field--fixed' : '',
    reduced ? '' : 'space-field--twinkle',
    showShoots ? 'space-field--shoot' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} aria-hidden="true">
      <div className="space-field__nebula" />
      <div className="space-field__stars">
        {stars.map((star) => (
          <span
            key={star.id}
            className={`space-field__star${star.bright ? ' space-field__star--bright' : ''}`}
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              ['--twinkle-delay' as string]: `${star.delay}s`,
              ['--twinkle-dur' as string]: `${star.dur}s`,
            }}
          />
        ))}
      </div>
      {showShoots ? (
        <>
          <span
            className="space-field__shoot"
            style={{
              left: '8%',
              top: '18%',
              ['--shoot-delay' as string]: '1.2s',
              ['--shoot-dur' as string]: '8.4s',
            }}
          />
          <span
            className="space-field__shoot space-field__shoot--2"
            style={{
              left: '55%',
              top: '8%',
              ['--shoot-delay' as string]: '4.8s',
              ['--shoot-dur' as string]: '9.6s',
            }}
          />
          <span
            className="space-field__shoot"
            style={{
              left: '22%',
              top: '62%',
              ['--shoot-delay' as string]: '7.1s',
              ['--shoot-dur' as string]: '10.2s',
            }}
          />
        </>
      ) : null}
    </div>
  )
}
