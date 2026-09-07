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

export default function FloatingCreatives({
  reduced = false,
  railsOnly = false,
  floatiesOnly = false,
}: FloatingCreativesProps) {
  const left = HOME_FLOATING_CREATIVES.filter((c) => c.rail === 'left')
  const right = HOME_FLOATING_CREATIVES.filter((c) => c.rail === 'right')

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
        <div className="home-side-rails" aria-hidden="true">
          <div className="home-side-rail home-side-rail--left">
            <div className="home-side-rail__track">
              {[...left, ...left].map((item, i) => (
                <div key={`L-${item.id}-${i}`} className="home-side-rail__card">
                  <img src={item.src} alt="" loading="lazy" decoding="async" />
                </div>
              ))}
            </div>
          </div>
          <div className="home-side-rail home-side-rail--right">
            <div className="home-side-rail__track">
              {[...right, ...right].map((item, i) => (
                <div key={`R-${item.id}-${i}`} className="home-side-rail__card">
                  <img src={item.src} alt="" loading="lazy" decoding="async" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
