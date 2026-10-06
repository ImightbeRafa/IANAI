import { describe, expect, it } from 'vitest'
import { isProductionAppEnv, resolveAppEnv } from '../api/lib/app-env'

describe('resolveAppEnv', () => {
  it('lowercases and trims APP_ENV', () => {
    expect(resolveAppEnv({ APP_ENV: 'Preview' })).toBe('preview')
  })

  it('falls back to VERCEL_ENV when APP_ENV is unset', () => {
    expect(resolveAppEnv({ VERCEL_ENV: 'production' })).toBe('production')
  })

  it('prefers APP_ENV over VERCEL_ENV when both are set', () => {
    expect(resolveAppEnv({ APP_ENV: 'preview', VERCEL_ENV: 'production' })).toBe('preview')
  })

  it('falls back to VERCEL_ENV when APP_ENV is empty', () => {
    expect(resolveAppEnv({ APP_ENV: '', VERCEL_ENV: 'production' })).toBe('production')
  })

  it('gives an empty string when neither is set', () => {
    expect(resolveAppEnv({})).toBe('')
  })

  it('isProductionAppEnv trims and lowercases', () => {
    expect(isProductionAppEnv({ APP_ENV: ' production ' })).toBe(true)
  })
})
