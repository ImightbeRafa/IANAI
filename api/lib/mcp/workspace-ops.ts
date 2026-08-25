/**
 * Workspace GUIDE sync writes (no generation credits).
 */

import type { McpAuthUser, McpDbClient } from './user-tools.js'
import { validateMcpGuideIntake } from './guide-intake.js'
import { randomUUID } from 'node:crypto'
import { assertPublicHttpUrl } from '../url-safety.js'
import type { McpArtifactStore } from './artifact-store.js'

export const MCP_SAVE_ARTIFACT_MAX_SCRIPT_CHARS = 80_000

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

function resolveOfferIdForSave(
  offers: Array<{ id: string }>,
  offerId?: string
): string {
  if (offerId) {
    const found = offers.find((o) => o.id === offerId)
    if (!found) throw new Error('Offer not found on this brand')
    return found.id
  }
  if (!offers[0]) throw new Error('Brand has no offers — create an offer before saving an artifact')
  return offers[0].id
}

export async function mcpWorkspaceSaveArtifact(options: {
  db: McpDbClient
  artifactStore: McpArtifactStore
  user: McpAuthUser
  args: Record<string, unknown>
  appOrigin?: string
}): Promise<Record<string, unknown>> {
  const brandId = typeof options.args.brandId === 'string' ? options.args.brandId : ''
  if (!brandId) throw new Error('brandId is required')
  const brand = await options.db.getBusinessForUser(options.user.id, brandId)
  if (!brand) throw new Error('Brand not found')
  const offers = await options.db.listOffersForBrand(options.user.id, brandId)
  const origin = (options.appOrigin || 'https://advanceai.studio').replace(/\/$/, '')
  const kind = options.args.kind === 'script' || options.args.kind === 'image'
    ? options.args.kind
    : null
  if (!kind) throw new Error('kind must be "script" or "image"')

  const offerIdArg = typeof options.args.offerId === 'string' ? options.args.offerId : undefined
  const sessionIdArg = typeof options.args.sessionId === 'string' ? options.args.sessionId : undefined
  const title = typeof options.args.title === 'string' ? options.args.title.slice(0, 200) : undefined
  const content = typeof options.args.content === 'string' ? options.args.content : undefined
  const imageUrl = typeof options.args.imageUrl === 'string' ? options.args.imageUrl.trim() : undefined
  const productImageId = typeof options.args.productImageId === 'string' ? options.args.productImageId : undefined
  const scriptId = typeof options.args.scriptId === 'string' ? options.args.scriptId : undefined

  const libraryLink = `${origin}/chat?brand=${encodeURIComponent(brandId)}`

  if (kind === 'image' && imageUrl && (/^data:/i.test(imageUrl) || imageUrl.length > 8_000)) {
    throw new Error('Do not send base64. Pass an https imageUrl or productImageId already in the workspace.')
  }
  if (kind === 'script' && content && content.length > MCP_SAVE_ARTIFACT_MAX_SCRIPT_CHARS) {
    throw new Error(`Script content exceeds ${MCP_SAVE_ARTIFACT_MAX_SCRIPT_CHARS} characters`)
  }

  const hasDirect = kind === 'image'
    ? Boolean(productImageId || imageUrl)
    : Boolean(scriptId || (content && content.trim()))
  if (!hasDirect) {
    return {
      status: 'deep_link',
      consumesAdvanceCredits: false,
      kind,
      brandId,
      deepLink: `${libraryLink}&intake=artifact&kind=${encodeURIComponent(kind)}`,
      message: 'Open deepLink signed-in to save in the library, or retry with https imageUrl / productImageId / script content.',
    }
  }

  const offerId = resolveOfferIdForSave(offers, offerIdArg)
  const { sessionId } = await options.artifactStore.ensureExecuteSession({
    userId: options.user.id,
    brandId,
    offerId,
    sessionId: sessionIdArg,
    title: title || `MCP save — ${kind}`,
  })

  if (kind === 'image') {
    if (productImageId) {
      const saved = await options.artifactStore.linkExistingProductImage({
        userId: options.user.id,
        brandId,
        offerId,
        sessionId,
        productImageId,
        label: title || 'MCP linked image',
      })
      return {
        status: 'saved',
        consumesAdvanceCredits: false,
        kind,
        brandId,
        offerId,
        sessionId,
        ...saved,
        deepLink: `${origin}/chat?brand=${encodeURIComponent(brandId)}&session=${encodeURIComponent(sessionId)}`,
      }
    }
    const parsed = assertPublicHttpUrl(imageUrl!)
    if (parsed.protocol !== 'https:') throw new Error('Only https imageUrl is allowed')
    const saved = await options.artifactStore.saveImageFromPublicUrl({
      userId: options.user.id,
      brandId,
      offerId,
      sessionId,
      imageUrl: parsed.toString(),
      label: title || 'MCP saved image',
      metadata: { sourceUrl: parsed.toString() },
    })
    return {
      status: 'saved',
      consumesAdvanceCredits: false,
      kind,
      brandId,
      offerId,
      sessionId,
      ...saved,
      deepLink: `${origin}/chat?brand=${encodeURIComponent(brandId)}&session=${encodeURIComponent(sessionId)}`,
    }
  }

  let scriptContent = content?.trim() || ''
  let scriptTitle = title || 'MCP saved script'
  if (scriptId) {
    const existing = await options.artifactStore.getOwnedScript({
      userId: options.user.id,
      brandId,
      scriptId,
    })
    if (!existing) throw new Error('scriptId not found for this brand/user')
    if (!scriptContent) scriptContent = existing.content
    if (!title && existing.title) scriptTitle = existing.title
  }
  if (!scriptContent) throw new Error('Provide script content or scriptId')
  const saved = await options.artifactStore.saveScriptArtifact({
    userId: options.user.id,
    brandId,
    offerId,
    sessionId,
    title: scriptTitle,
    content: scriptContent,
    approvalRequestId: 'workspace_save_artifact',
  })
  return {
    status: 'saved',
    consumesAdvanceCredits: false,
    kind,
    brandId,
    offerId,
    sessionId,
    ...saved,
    deepLink: `${origin}/chat?brand=${encodeURIComponent(brandId)}&session=${encodeURIComponent(sessionId)}`,
  }
}
