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

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
])

export function isAllowedComposerImage(file: File): boolean {
  if (ALLOWED_MIME.has(file.type)) return true
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name)
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
  if (!isAllowedComposerImage(file)) return null
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
): Promise<ComposerAttachment[]> {
  const files = fileList ? Array.from(fileList) : []
  const room = Math.max(0, MAX_COMPOSER_ATTACHMENTS - existingCount)
  if (room <= 0) return []
  const created: ComposerAttachment[] = []
  for (const file of files.slice(0, room)) {
    const attachment = await createComposerAttachment(file, role)
    if (attachment) created.push(attachment)
  }
  return created
}

export function composerAttachmentsFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined
): File[] {
  if (!dataTransfer?.files?.length) return []
  return Array.from(dataTransfer.files).filter(isAllowedComposerImage)
}
