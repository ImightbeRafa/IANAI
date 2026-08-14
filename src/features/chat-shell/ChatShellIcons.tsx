import type { ReactNode } from 'react'
import AdvanceLogo from '../../components/AdvanceLogo'

type IconProps = {
  size?: number
  className?: string
}

function Svg({ size = 16, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  )
}

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function IconAdvanceMark({ size = 16, className }: IconProps) {
  return <AdvanceLogo size={size} className={className} decorative />
}

export function IconPlus({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 3.2 V12.8" {...stroke} />
      <path d="M3.2 8 H12.8" {...stroke} />
    </Svg>
  )
}

export function IconWeb({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="8" cy="8" r="5.2" {...stroke} />
      <path d="M8 2.8 V13.2" {...stroke} />
      <path d="M3.2 8 H12.8" {...stroke} />
      <path d="M4.15 5.1 C5.7 6.05 6.85 6.4 8 6.4 C9.15 6.4 10.3 6.05 11.85 5.1" {...stroke} />
      <path d="M4.15 10.9 C5.7 9.95 6.85 9.6 8 9.6 C9.15 9.6 10.3 9.95 11.85 10.9" {...stroke} />
    </Svg>
  )
}

export function IconDoc({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M5 2.6 H9.2 L12.4 5.8 V13.4 H5 V2.6 Z" {...stroke} />
      <path d="M9.2 2.6 V5.8 H12.4" {...stroke} />
      <path d="M6.6 8.4 H10.8" {...stroke} />
      <path d="M6.6 10.7 H9.6" {...stroke} />
    </Svg>
  )
}

export function IconOffer({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3.2 5.4 L8 3.1 L12.8 5.4 V10.7 L8 13 L3.2 10.7 Z" {...stroke} />
      <path d="M3.2 5.4 L8 7.7 L12.8 5.4" {...stroke} />
      <path d="M8 7.7 V13" {...stroke} />
    </Svg>
  )
}

export function IconVoice({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4.2 6.2 V9.8" {...stroke} />
      <path d="M6.4 4.6 V11.4" {...stroke} />
      <path d="M8.6 5.5 V10.5" {...stroke} />
      <path d="M10.8 3.8 V12.2" {...stroke} />
      <path d="M13 6.8 V9.2" {...stroke} />
    </Svg>
  )
}

export function IconVisual({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="8" cy="8" r="5.1" {...stroke} />
      <circle cx="8" cy="8" r="1.7" {...stroke} />
    </Svg>
  )
}

export function IconImage({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="2.6" y="3.6" width="10.8" height="8.8" rx="1.2" {...stroke} />
      <path d="M2.8 10.4 L5.7 7.6 L8.1 9.7 L10.2 7.4 L13.2 10.6" {...stroke} />
      <circle cx="5.5" cy="6.1" r="0.85" {...stroke} />
    </Svg>
  )
}

export function IconRefs({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="2.4" y="4.2" width="7.6" height="7.6" rx="1" {...stroke} />
      <path d="M6.4 3.2 H12.4 A1 1 0 0 1 13.4 4.2 V10.2" {...stroke} />
    </Svg>
  )
}

export function IconQuick({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M9.4 2.6 L4.2 9.1 H7.7 L6.6 13.4 L11.8 6.9 H8.3 Z" {...stroke} />
    </Svg>
  )
}

export function AdvanceWordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="chat-shell__wordmark">
      <AdvanceLogo variant="wordmark" size={size} />
    </span>
  )
}
