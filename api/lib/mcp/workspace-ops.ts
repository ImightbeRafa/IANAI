/**
 * Workspace GUIDE sync writes (no generation credits).
 */

import type { McpAuthUser, McpDbClient } from './user-tools.js'
import { validateMcpGuideIntake } from './guide-intake.js'
import { randomUUID } from 'node:crypto'

export type McpWorkspaceStore = {
  insertProvenanceNote: (row: {
    userId: string
    businessId: string
    kind: string
    note: string
    metadata: Record<string, unknown>
  }) => Promise<{ id: string }>
  insertFileIntakePlaceholder: (row: {
    userId: string
    businessId: string
    fileName: string
    mimeType: string
    requestId?: string
  }) => Promise<{ id: string }>
}

export async function mcpWorkspaceNoteGeneratedOutside(options: {
  db: McpDbClient
  store: McpWorkspaceStore
  user: McpAuthUser
  brandId: string
  kind?: string
  note?: string
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  if (!options.brandId) throw new Error('brandId is required')
  const brand = await options.db.getBusinessForUser(options.user.id, options.brandId)
  if (!brand) throw new Error('Brand not found')
  const kind = (options.kind || 'image').trim() || 'image'
  const note = (options.note || 'Generated outside Advance (Grok); binary not imported.').slice(0, 2000)
  const inserted = await options.store.insertProvenanceNote({
    userId: options.user.id,
    businessId: options.brandId,
    kind,
    note,
    metadata: { provenance: 'generated_outside', source: 'mcp' },
  })
  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  return {
    status: 'recorded',
    id: inserted.id,
    provenance: 'generated_outside',
    importedBinary: false,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(options.brandId)}`,
    message: 'Noted in Advance. External Grok binaries are never imported.',
  }
}

export async function mcpWorkspaceIngestFile(options: {
  db: McpDbClient
  store: McpWorkspaceStore
  user: McpAuthUser
  brandId: string
  files?: Array<{ name?: string; mimeType: string; sizeBytes?: number }>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const validated = validateMcpGuideIntake({
    brandId: options.brandId,
    files: options.files || [],
  })
  if (!validated.ok) throw new Error(validated.error)
  if (!validated.files.length) {
    throw new Error('Provide 1–5 PDF/image file descriptors (mimeType required)')
  }
  const brand = await options.db.getBusinessForUser(options.user.id, options.brandId)
  if (!brand) throw new Error('Brand not found')

  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  const requestId = randomUUID()
  const placeholders = []
  for (const file of validated.files) {
    const row = await options.store.insertFileIntakePlaceholder({
      userId: options.user.id,
      businessId: options.brandId,
      fileName: file.name || 'upload',
      mimeType: file.mimeType,
      requestId,
    })
    placeholders.push(row)
  }

  return {
    status: 'upload_required',
    consumesAdvanceCredits: false,
    message:
      'MCP JSON cannot carry file binaries reliably. Open the Advance upload link signed-in as this user, attach the files, then call get_brand_context.',
    brandId: options.brandId,
    acceptedDescriptors: validated.files,
    intakeIds: placeholders.map((p) => p.id),
    requestId,
    uploadDeepLink: `${origin}/chat?brand=${encodeURIComponent(options.brandId)}&intake=files&request=${encodeURIComponent(requestId)}`,
  }
}

export async function mcpWorkspaceImportAsset(options: {
  db: McpDbClient
  user: McpAuthUser
  brandId: string
  assetUrl?: string
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brand = await options.db.getBusinessForUser(options.user.id, options.brandId)
  if (!brand) throw new Error('Brand not found')
  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  // Refuse to fetch arbitrary URLs as "Grok outputs"; require Advance UI upload for binaries.
  if (options.assetUrl) {
    throw new Error(
      'Direct URL import of external assets is disabled (no Grok binary import). Open uploadDeepLink and upload from the web app.'
    )
  }
  return {
    status: 'upload_required',
    uploadDeepLink: `${origin}/chat?brand=${encodeURIComponent(options.brandId)}&intake=asset`,
    message: 'Upload product/context references in Advance (not external Grok outputs).',
  }
}
