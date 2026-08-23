/**
 * GUIDE intake validation — URL + up to 5 PDF/image files.
 * Does not download or store; handlers return not-enabled until host unlocks.
 */

import { assertPublicHttpUrl } from '../url-safety.js'

export const MCP_GUIDE_INTAKE_MAX_FILES = 5
export const MCP_GUIDE_INTAKE_ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export type McpGuideIntakeFile = {
  name?: string
  mimeType: string
  sizeBytes?: number
}

export type McpGuideIntakeRequest = {
  brandId?: string
  url?: string | null
  files?: McpGuideIntakeFile[]
}

export type McpGuideIntakeValidation =
  | { ok: true; url: string | null; files: McpGuideIntakeFile[] }
  | { ok: false; error: string }

export function validateMcpGuideIntake(input: McpGuideIntakeRequest): McpGuideIntakeValidation {
  const files = Array.isArray(input.files) ? input.files : []
  if (files.length > MCP_GUIDE_INTAKE_MAX_FILES) {
    return { ok: false, error: `At most ${MCP_GUIDE_INTAKE_MAX_FILES} files allowed` }
  }

  for (const file of files) {
    const mime = (file.mimeType || '').toLowerCase().trim()
    if (!MCP_GUIDE_INTAKE_ALLOWED_MIME.includes(mime as typeof MCP_GUIDE_INTAKE_ALLOWED_MIME[number])) {
      return { ok: false, error: `Unsupported file type: ${file.mimeType || '(missing)'}` }
    }
    if (typeof file.sizeBytes === 'number' && file.sizeBytes < 0) {
      return { ok: false, error: 'Invalid file size' }
    }
  }

  let url: string | null = null
  const rawUrl = typeof input.url === 'string' ? input.url.trim() : ''
  if (rawUrl) {
    try {
      const parsed = assertPublicHttpUrl(rawUrl)
      if (parsed.protocol !== 'https:') {
        return { ok: false, error: 'Only https URLs are allowed for intake' }
      }
      url = parsed.toString()
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Invalid URL' }
    }
  }

  if (!url && files.length === 0) {
    return { ok: false, error: 'Provide at least one https URL or file' }
  }

  return { ok: true, url, files }
}
