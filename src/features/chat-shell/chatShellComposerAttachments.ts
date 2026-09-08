/** Chat-turn composer attachments (not brand kit). */

export type ComposerAttachmentRole = 'product' | 'logo' | 'context'

export interface ComposerAttachment {
  id: string
  name: string
  dataUrl: string
  role: ComposerAttachmentRole
  mimeType: string
}

export const MAX_COMPOSER_ATTACHMENTS = 4
/** Mirror brand-kit upload cap in `imageStorage.ts` (~10MB). */
export const MAX_COMPOSER_ATTACHMENT_BYTES = 10 * 1024 * 1024

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
])

export type ComposerAttachmentReject = 'type' | 'size'

/** MIME allowlist only — no extension fallback. */
export function isAllowedComposerImage(file: File): boolean {
  return ALLOWED_MIME.has(file.type)
}

/**
 * Gate before any FileReader / data URL work.
 * Returns reject reason or null when the file may be staged.
 */
export function composerAttachmentGate(file: File): ComposerAttachmentReject | null {
  if (!isAllowedComposerImage(file)) return 'type'
  if (file.size > MAX_COMPOSER_ATTACHMENT_BYTES) return 'size'
  return null
}

export function composerAttachmentRejectCopy(
  reason: ComposerAttachmentReject,
  language: 'es' | 'en'
): string {
  if (reason === 'size') {
    return language === 'es'
      ? 'La imagen supera 10 MB. Elegí una más liviana.'
      : 'Image is over 10 MB. Choose a smaller file.'
  }
  return language === 'es'
    ? 'Solo imágenes PNG, JPEG, WebP o GIF.'
    : 'Only PNG, JPEG, WebP, or GIF images.'
}

export function nextComposerAttachmentRole(
  role: ComposerAttachmentRole
): ComposerAttachmentRole {
  switch (role) {
    case 'product':
      return 'logo'
    case 'logo':
      return 'context'
    case 'context':
      return 'product'
    default: {
      const _never: never = role
      return _never
    }
  }
}

export function uploadKindForComposerRole(
  role: ComposerAttachmentRole
): 'product' | 'logo' | 'context' {
  return role
}

export function labelForComposerRole(
  role: ComposerAttachmentRole,
  language: 'es' | 'en'
): string {
  const es = language === 'es'
  switch (role) {
    case 'product':
      return es ? 'Producto' : 'Product'
    case 'logo':
      return es ? 'Logo' : 'Logo'
    case 'context':
      return es ? 'Contexto' : 'Context'
    default: {
      const _never: never = role
      return _never
    }
  }
}

export function defaultRoleForPick(kind: ComposerAttachmentRole): ComposerAttachmentRole {
  return kind
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export async function createComposerAttachment(
  file: File,
  role: ComposerAttachmentRole = 'product'
): Promise<ComposerAttachment | null> {
  // Size + MIME gate MUST run before data URL / FileReader.
  if (composerAttachmentGate(file)) return null
  const dataUrl = await readFileAsDataUrl(file)
  if (!dataUrl.startsWith('data:')) return null
  return {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || 'image',
    dataUrl,
    role,
    mimeType: file.type || 'image/jpeg',
  }
}

export async function collectComposerDropFiles(
  fileList: FileList | File[] | null | undefined,
  existingCount: number,
  role: ComposerAttachmentRole = 'product'
): Promise<{ attachments: ComposerAttachment[]; reject?: ComposerAttachmentReject }> {
  const files = fileList ? Array.from(fileList) : []
  const room = Math.max(0, MAX_COMPOSER_ATTACHMENTS - existingCount)
  if (room <= 0) return { attachments: [] }
  const created: ComposerAttachment[] = []
  let reject: ComposerAttachmentReject | undefined
  for (const file of files.slice(0, room)) {
    const gate = composerAttachmentGate(file)
    if (gate) {
      reject = gate
      continue
    }
    const attachment = await createComposerAttachment(file, role)
    if (attachment) created.push(attachment)
  }
  return { attachments: created, reject }
}

export function composerAttachmentsFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined
): File[] {
  if (!dataTransfer?.files?.length) return []
  return Array.from(dataTransfer.files).filter(isAllowedComposerImage)
}

/**
 * Premise helper: NL campaign clarify must not open Guiones/Pack FlowSheet.
 * Sheet surface = glass Guiones button; thread surface = composer NL.
 */
export function scriptClarifyOpensModal(
  state: { surface?: 'thread' | 'sheet' } | null | undefined
): boolean {
  if (!state) return false
  return state.surface !== 'thread'
}
