import { describe, expect, it } from 'vitest'
import {
  hasPreviewAdminAllowlistAccess,
  isPreviewAdminEmail,
  isVercelPreviewRuntime,
  resolveAdminDashboardAccess,
} from '../api/lib/preview-admin'
import {
  isPreviewDeploy,
  resolveClientAdminAccess,
} from '../src/lib/previewAdmin'

describe('preview admin allowlist (server)', () => {
  it('recognizes invited QA emails only', () => {
    expect(isPreviewAdminEmail('sup.rafa0412@gmail.com')).toBe(true)
    expect(isPreviewAdminEmail('RalAuas@gmail.com')).toBe(true)
    expect(isPreviewAdminEmail('other@example.com')).toBe(false)
    expect(isPreviewAdminEmail(null)).toBe(false)
  })

  it('fail-closes outside VERCEL_ENV=preview', () => {
    expect(isVercelPreviewRuntime({ VERCEL_ENV: 'preview' })).toBe(true)
    expect(isVercelPreviewRuntime({ VERCEL_ENV: 'production' })).toBe(false)
    expect(isVercelPreviewRuntime({ VERCEL_ENV: 'development' })).toBe(false)
    expect(isVercelPreviewRuntime({})).toBe(false)

    expect(hasPreviewAdminAllowlistAccess({
      email: 'sup.rafa0412@gmail.com',
      env: { VERCEL_ENV: 'production' },
    })).toBe(false)
    expect(hasPreviewAdminAllowlistAccess({
      email: 'sup.rafa0412@gmail.com',
      env: { VERCEL_ENV: 'preview' },
    })).toBe(true)
  })

  it('production still requires profiles.is_admin', () => {
    expect(resolveAdminDashboardAccess({
      profileIsAdmin: false,
      email: 'sup.rafa0412@gmail.com',
      env: { VERCEL_ENV: 'production' },
    })).toBe(false)
    expect(resolveAdminDashboardAccess({
      profileIsAdmin: true,
      email: 'anyone@example.com',
      env: { VERCEL_ENV: 'production' },
    })).toBe(true)
  })

  it('preview allows QA email without is_admin', () => {
    expect(resolveAdminDashboardAccess({
      profileIsAdmin: false,
      email: 'sup.rafa0412@gmail.com',
      env: { VERCEL_ENV: 'preview' },
    })).toBe(true)
  })
})

describe('preview admin allowlist (client)', () => {
  it('detects preview via VITE_VERCEL_ENV or git hostname', () => {
    expect(isPreviewDeploy({ vercelEnv: 'preview' })).toBe(true)
    expect(isPreviewDeploy({ vercelEnv: 'production' })).toBe(false)
    expect(isPreviewDeploy({
      vercelEnv: '',
      hostname: 'ianai-git-cursor-chat-shell-idle-723478-rafas-projects-3ea2e797.vercel.app',
    })).toBe(true)
    expect(isPreviewDeploy({
      vercelEnv: '',
      hostname: 'ianai.vercel.app',
    })).toBe(false)
  })

  it('resolves client admin the same way', () => {
    expect(resolveClientAdminAccess({
      profileIsAdmin: false,
      email: 'sup.rafa0412@gmail.com',
      vercelEnv: 'preview',
    })).toBe(true)
    expect(resolveClientAdminAccess({
      profileIsAdmin: false,
      email: 'sup.rafa0412@gmail.com',
      vercelEnv: 'production',
    })).toBe(false)
  })
})
