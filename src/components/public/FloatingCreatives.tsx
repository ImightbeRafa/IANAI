import { HOME_RAIL_SRCS } from '../../pages/homeContent'
import './floating-creatives.css'

export type FloatingCreative = {
  id: string
  src: string
  /** Hero float slot — CSS data-slot */
  slot: string
  mobile: boolean
}

/**
 * Hero orbital floaties — irregular, accidental, NOT mirrored columns.
 * Desktop only (hidden on mobile so the fan stays tight).
 */
export const HOME_FLOATING_CREATIVES: FloatingCreative[] = [
  { id: 'float-dulce', src: '/home/ads/dulce-norte.jpg', slot: 'a', mobile: false },
  { id: 'float-forza', src: '/home/ads/forza.jpg', slot: 'b', mobile: false },
  { id: 'float-monte', src: '/home/ads/monte-rojo.jpg', slot: 'c', mobile: false },
  { id: 'float-nido', src: '/home/ads/nido.jpg', slot: 'd', mobile: false },
  { id: 'float-altura', src: '/home/ads/altura.jpg', slot: 'e', mobile: false },
  { id: 'float-aura', src: '/home/ads/aura.jpg', slot: 'f', mobile: false },
]

/**
 * Sparse edge ghosts after scroll — max ~5, irregular spawn, quiet.
 * NOT neat vertical rails / product shelves.
 */
const EDGE_GHOSTS = [
  { id: 'g0', src: HOME_RAIL_SRCS[0], slot: 'g0' },
  { id: 'g1', src: HOME_RAIL_SRCS[1], slot: 'g1' },
  { id: 'g2', src: HOME_RAIL_SRCS[3], slot: 'g2' },
  { id: 'g3', src: HOME_RAIL_SRCS[4], slot: 'g3' },
  { id: 'g4', src: HOME_RAIL_SRCS[6], slot: 'g4' },
] as const

type FloatingCreativesProps = {
  reduced?: boolean
  /** Fixed-layer edge ghosts (post-hero, quiet) */
  edgesOnly?: boolean
  /** Hero orbital floaties only */
  floatiesOnly?: boolean
}

export default function FloatingCreatives({
  reduced = false,
  edgesOnly = false,
  floatiesOnly = false,
}: FloatingCreativesProps) {
  return (
    <>
      {!edgesOnly ? (
        <div className={`home-floaties${reduced ? ' is-reduced' : ''}`} aria-hidden="true">
          {HOME_FLOATING_CREATIVES.map((item) => (
            <div
              key={item.id}
              className="home-floaty home-floaty--desktop-only"
              data-slot={item.slot}
            >
              <img src={item.src} alt="" loading="lazy" decoding="async" />
            </div>
          ))}
        </div>
      ) : null}

      {!floatiesOnly ? (
        <aside
          className={`home-edge-ghosts${reduced ? ' is-reduced' : ''}`}
          aria-hidden="true"
        >
          {EDGE_GHOSTS.map((item) => (
            <div key={item.id} className="home-edge-ghost" data-slot={item.slot}>
              <img src={item.src} alt="" loading="lazy" decoding="async" />
            </div>
          ))}
        </aside>
      ) : null}
    </>
  )
}
