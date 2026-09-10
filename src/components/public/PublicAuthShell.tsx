import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import AdvanceLogo from '../AdvanceLogo'
import SpaceField from './SpaceField'
import './public-auth.css'

type PublicAuthShellProps = {
  children: ReactNode
  subtitle?: string
  /** Compact vertical padding for longer forms (signup) */
  compact?: boolean
}

export default function PublicAuthShell({ children, subtitle, compact = false }: PublicAuthShellProps) {
  return (
    <div className={`public-auth${compact ? ' public-auth--compact' : ''}`}>
      <SpaceField density="auth" className="public-auth__space" />
      <div className="public-auth__inner">
        <div className="public-auth__brand">
          <Link to="/" className="public-auth__brand-link">
            <AdvanceLogo size={40} className="public-auth__logo is-animate" decorative />
            <span className="public-auth__wordmark">Advance AI</span>
          </Link>
          {subtitle ? <p className="public-auth__subtitle">{subtitle}</p> : null}
        </div>
        <div className="public-auth__panel">{children}</div>
      </div>
    </div>
  )
}
