/**
 * Persist GUIDE URL intake as pending_analysis (no fetch/credits).
 */

import type { McpAuthUser, McpDbClient } from './user-tools.js'
import { validateMcpGuideIntake } from './guide-intake.js'

export type McpUrlIntakeRow = {
  id: string
  businessId: string
  sourceUrl: string
  status: 'pending_analysis'
  deepLink: string
}

export type McpUrlIntakeStore = {
  insertPendingUrlIntake: (row: {
    userId: string
    businessId: string
    sourceUrl: string
  }) => Promise<{ id: string }>
}

export async function saveMcpUrlContext(options: {
  db: McpDbClient
  store: McpUrlIntakeStore
  user: McpAuthUser
  brandId: string
  url: string
  appOrigin?: string
}): Promise<McpUrlIntakeRow> {
  if (!options.user?.id) throw new Error('Authentication required')
  if (!options.brandId) throw new Error('brandId is required')

  const validated = validateMcpGuideIntake({ url: options.url, files: [] })
  if (!validated.ok || !validated.url) throw new Error(validated.ok ? 'URL required' : validated.error)

  const brand = await options.db.getBusinessForUser(options.user.id, options.brandId)
  if (!brand) throw new Error('Brand not found')

  const inserted = await options.store.insertPendingUrlIntake({
    userId: options.user.id,
    businessId: options.brandId,
    sourceUrl: validated.url,
  })

  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  return {
    id: inserted.id,
    businessId: options.brandId,
    sourceUrl: validated.url,
    status: 'pending_analysis',
    deepLink: `${origin}/chat?brandId=${encodeURIComponent(options.brandId)}&intake=${encodeURIComponent(inserted.id)}`,
  }
}
