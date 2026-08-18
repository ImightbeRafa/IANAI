/** @vitest-environment happy-dom */
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import AdvanceLogo from '../src/components/AdvanceLogo'
import LandingPresetImg from '../src/pages/LandingPresetImg'
import { landingPresetThumb } from '../src/pages/landingPresetMedia'

const SAMPLE_PNG = '/presets/01_Features_Benefits/020_Access_183.png'

describe('landing and logo media', () => {
  it('maps Home preset PNGs to small WebP thumbs', () => {
    const media = landingPresetThumb(SAMPLE_PNG)
    expect(media.src).toBe('/presets/thumbs/01_Features_Benefits__020_Access_183-360w.webp')
    expect(media.srcSet).toContain('360w')
    expect(media.srcSet).toContain('720w')
    expect(media.src).not.toMatch(/\.png$/)
  })

  it('renders lazy WebP thumbs instead of original PNGs', () => {
    const { container } = render(
      <LandingPresetImg src={SAMPLE_PNG} alt="Features" sizes="110px" />
    )
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toMatch(/\.webp$/)
    expect(img?.getAttribute('src')).not.toMatch(/\.png$/)
    expect(img?.getAttribute('loading')).toBe('lazy')
  })

  it('renders the logo mark from tiny WebP files, not logo.png', () => {
    const { container } = render(<AdvanceLogo size={28} />)
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('/logo-mark-64.webp')
    expect(img?.getAttribute('srcSet')).toContain('/logo-mark-32.webp')
    expect(img?.getAttribute('srcSet')).not.toContain('logo.png')
  })

  it('keeps generated assets well under the original files', () => {
    const thumb = path.join(
      process.cwd(),
      'public/presets/thumbs/01_Features_Benefits__020_Access_183-360w.webp'
    )
    const original = path.join(process.cwd(), 'public/presets/01_Features_Benefits/020_Access_183.png')
    const logoMark = path.join(process.cwd(), 'public/logo-mark-32.webp')
    const logoFull = path.join(process.cwd(), 'public/logo.png')
    expect(existsSync(thumb)).toBe(true)
    expect(existsSync(logoMark)).toBe(true)
    expect(statSync(thumb).size).toBeLessThan(statSync(original).size / 8)
    expect(statSync(logoMark).size).toBeLessThan(statSync(logoFull).size / 20)
  })
})
