import { useState } from 'react'
import { HOME_RAIL_SRCS } from '../../pages/homeContent'
import './floating-creatives.css'

export type FloatingCreative = {
  id: string
  src: string
  /** Hero float slot — CSS data-slot */
  slot: string
  /** Side rail after scroll organize */
  rail: 'left' | 'right'
  mobile: boolean
}

/** Background creatives — not the hero fan focus cards. */
export const HOME_FLOATING_CREATIVES: FloatingCreative[] = [
  { id: 'float-dulce', src: '/home/ads/dulce-norte.jpg', slot: 'a', rail: 'left', mobile: true },
  { id: 'float-forza', src: '/home/ads/forza.jpg', slot: 'b', rail: 'right', mobile: false },
  { id: 'float-monte', src: '/home/ads/monte-rojo.jpg', slot: 'c', rail: 'left', mobile: true },
  { id: 'float-nido', src: '/home/ads/nido.jpg', slot: 'd', rail: 'right', mobile: false },
  { id: 'float-altura', src: '/home/ads/altura.jpg', slot: 'e', rail: 'left', mobile: false },
  { id: 'float-aura', src: '/home/ads/aura.jpg', slot: 'f', rail: 'right', mobile: true },
]

type FloatingCreativesProps = {
  reduced?: boolean
  /** When true, only render the post-hero side rails */
  railsOnly?: boolean
  /** When true, only render hero floaties */
  floatiesOnly?: boolean
}

function RailCard({ src, delayMs }: { src: string; delayMs: number }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div
      className={`home-side-rail__card${loaded ? ' is-loaded' : ''}`}
      style={{ ['--rail-delay' as string]: `${delayMs}ms` }}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}

export default function FloatingCreatives({
  reduced = false,
  railsOnly = false,
  floatiesOnly = false,
}: FloatingCreativesProps) {
  const leftBase = HOME_RAIL_SRCS.filter((_, i) => i % 2 === 0).map((src, i) => ({
    id: `L-${i}`,
    src,
  }))
  const rightBase = HOME_RAIL_SRCS.filter((_, i) => i % 2 === 1).map((src, i) => ({
    id: `R-${i}`,
    src,
  }))
  const left = [...leftBase, ...leftBase]
  const right = [...rightBase, ...rightBase]

  return (
    <>
      {!railsOnly ? (
        <div className={`home-floaties${reduced ? ' is-reduced' : ''}`} aria-hidden="true">
          {HOME_FLOATING_CREATIVES.map((item) => (
            <div
              key={item.id}
              className={[
                'home-floaty',
                item.mobile ? '' : 'home-floaty--desktop-only',
              ]
                .filter(Boolean)
                .join(' ')}
              data-slot={item.slot}
              data-rail={item.rail}
            >
              <img src={item.src} alt="" loading="lazy" decoding="async" />
            </div>
          ))}
        </div>
      ) : null}

      {!floatiesOnly ? (
        <aside className="home-side-rails" aria-hidden="true">
          <div className="home-side-rail home-side-rail--left">
            <div className="home-side-rail__track">
              {left.map((item, i) => (
                <RailCard key={`${item.id}-${i}`} src={item.src} delayMs={(i % leftBase.length) * 70} />
              ))}
            </div>
          </div>
          <div className="home-side-rail home-side-rail--right">
            <div className="home-side-rail__track">
              {right.map((item, i) => (
                <RailCard key={`${item.id}-${i}`} src={item.src} delayMs={(i % rightBase.length) * 70} />
              ))}
            </div>
          </div>
        </aside>
      ) : null}
    </>
  )
}
