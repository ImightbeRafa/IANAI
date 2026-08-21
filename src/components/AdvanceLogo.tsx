import './advance-logo.css'

type AdvanceLogoProps = {
  size?: number
  variant?: 'mark' | 'wordmark'
  className?: string
  alt?: string
  decorative?: boolean
}

export default function AdvanceLogo({
  size = 28,
  variant = 'mark',
  className,
  alt = 'Advance AI',
  decorative = false,
}: AdvanceLogoProps) {
  const classes = ['advance-logo', variant === 'wordmark' ? 'advance-logo--wordmark' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <span className={classes} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : alt}>
      <span className="advance-logo__mark" style={{ width: size, height: size }}>
        <img
          className="advance-logo__img"
          src="/logo-mark-64.webp"
          srcSet="/logo-mark-32.webp 32w, /logo-mark-64.webp 64w, /logo-mark-96.webp 96w"
          sizes={`${size}px`}
          width={size}
          height={size}
          alt=""
          decoding="async"
        />
      </span>
      {variant === 'wordmark' ? (
        <span className="advance-logo__text">
          Advance <em>AI</em>
        </span>
      ) : null}
    </span>
  )
}
