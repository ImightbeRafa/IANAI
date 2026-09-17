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
      size: 1 + r3 * 2.1,
      delay: r4 * 6,
      dur: 3 + r5 * 4,
      bright: r3 > 0.84,
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

  const { far, near } = useMemo(() => {
    const baseFar = density === 'auth' ? 36 : 70
    const baseNear = density === 'auth' ? 18 : 36
    const farCount = reduced
      ? Math.min(18, baseFar)
      : narrow
        ? Math.round(baseFar * 0.45)
        : baseFar
    const nearCount = reduced
      ? Math.min(10, baseNear)
      : narrow
        ? Math.round(baseNear * 0.4)
        : baseNear
    return {
      far: seededStars(farCount, density === 'auth' ? 11 : 17).map((s) => ({
        ...s,
        size: Math.max(0.9, s.size * 0.7),
      })),
      near: seededStars(nearCount, density === 'auth' ? 29 : 41).map((s) => ({
        ...s,
        size: s.size * 1.15,
      })),
    }
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
      <div className="space-field__stars space-field__stars--far">
        {far.map((star) => (
          <span
            key={`f-${star.id}`}
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
      <div className="space-field__stars space-field__stars--near">
        {near.map((star) => (
          <span
            key={`n-${star.id}`}
            className={`space-field__star${star.bright ? ' space-field__star--bright' : ''}`}
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              ['--twinkle-delay' as string]: `${star.delay}s`,
              ['--twinkle-dur' as string]: `${star.dur * 0.85}s`,
            }}
          />
        ))}
      </div>
      {showShoots ? (
        <>
          <span
            className="space-field__shoot"
            style={{
              left: '6%',
              top: '16%',
              ['--shoot-delay' as string]: '1.4s',
              ['--shoot-dur' as string]: '11s',
            }}
          />
          <span
            className="space-field__shoot space-field__shoot--2"
            style={{
              left: '58%',
              top: '10%',
              ['--shoot-delay' as string]: '5.6s',
              ['--shoot-dur' as string]: '13s',
            }}
          />
          <span
            className="space-field__shoot space-field__shoot--3"
            style={{
              left: '24%',
              top: '68%',
              ['--shoot-delay' as string]: '8.8s',
              ['--shoot-dur' as string]: '12.5s',
            }}
          />
        </>
      ) : null}
    </div>
  )
}
