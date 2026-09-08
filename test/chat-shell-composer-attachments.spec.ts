// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  collectComposerDropFiles,
  createComposerAttachment,
  isAllowedComposerImage,
  labelForComposerRole,
  MAX_COMPOSER_ATTACHMENTS,
  nextComposerAttachmentRole,
  uploadKindForComposerRole,
} from '../src/features/chat-shell/chatShellComposerAttachments'
import {
  applyPostCampaignScriptDefaults,
  defaultNlPostCampaignImagePreferences,
  parseNlPostCampaignIntent,
  partitionComposerAttachmentRoles,
} from '../src/features/chat-shell/chatShellNlPostCampaign'
import { parseChatShellScriptIntent } from '../src/features/chat-shell/chatShellScriptIntent'
import { DEFAULT_SCRIPT_SETTINGS } from '../src/services/grokApi'

function fakeImageFile(name: string, type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type })
}

describe('chatShellComposerAttachments', () => {
  it('accepts common image types and rejects non-images', () => {
    expect(isAllowedComposerImage(fakeImageFile('a.png'))).toBe(true)
    expect(isAllowedComposerImage(fakeImageFile('b.jpg', 'image/jpeg'))).toBe(true)
    expect(isAllowedComposerImage(fakeImageFile('c.webp', 'image/webp'))).toBe(true)
    expect(isAllowedComposerImage(new File(['x'], 'notes.pdf', { type: 'application/pdf' }))).toBe(false)
  })

  it('cycles typed chips product → logo → context → product', () => {
    expect(nextComposerAttachmentRole('product')).toBe('logo')
    expect(nextComposerAttachmentRole('logo')).toBe('context')
    expect(nextComposerAttachmentRole('context')).toBe('product')
  })

  it('maps chip roles to session upload kinds (not brand kit)', () => {
    expect(uploadKindForComposerRole('product')).toBe('product')
    expect(uploadKindForComposerRole('logo')).toBe('logo')
    expect(uploadKindForComposerRole('context')).toBe('context')
  })

  it('labels roles in Spanish', () => {
    expect(labelForComposerRole('product', 'es')).toBe('Producto')
    expect(labelForComposerRole('logo', 'es')).toBe('Logo')
    expect(labelForComposerRole('context', 'es')).toBe('Contexto')
  })

  it('creates a dataUrl attachment from a file', async () => {
    const attachment = await createComposerAttachment(fakeImageFile('producto.png'), 'product')
    expect(attachment).toBeTruthy()
    expect(attachment!.role).toBe('product')
    expect(attachment!.name).toBe('producto.png')
    expect(attachment!.dataUrl.startsWith('data:')).toBe(true)
  })

  it('caps staged drops at MAX_COMPOSER_ATTACHMENTS', async () => {
    const files = Array.from({ length: 6 }, (_, i) => fakeImageFile(`p${i}.png`))
    const created = await collectComposerDropFiles(files, 0, 'product')
    expect(created).toHaveLength(MAX_COMPOSER_ATTACHMENTS)
    const more = await collectComposerDropFiles(files, MAX_COMPOSER_ATTACHMENTS, 'product')
    expect(more).toHaveLength(0)
  })
})

describe('parseNlPostCampaignIntent', () => {
  it('matches the example NL post ask and skips pure foto/logo', () => {
    const example = parseNlPostCampaignIntent(
      'Generame 5 post para XYZ product, que hable de lo bueno que son en el verano, envio a todo el pais por correos de Costa Rica. CTA Mensajes.',
      'es'
    )
    expect(example.matched).toBe(true)
    expect(example.wantsPosts).toBe(true)

    expect(parseNlPostCampaignIntent('generame una foto de producto', 'es').matched).toBe(false)
    expect(parseNlPostCampaignIntent('quiero crear un logo', 'es').matched).toBe(false)
    expect(parseNlPostCampaignIntent('generame 2 de venta', 'es').matched).toBe(false)
  })

  it('defaults image prefs to venta-directa anuncio for campaign images', () => {
    const prefs = defaultNlPostCampaignImagePreferences()
    expect(prefs.style).toEqual({ kind: 'preset', presetId: 'venta-directa' })
    expect(prefs.aspectRatio).toBe('9:16')
    expect(prefs.density).toBe('hard')
  })

  it('partitions composer roles for product-lock refs', () => {
    const parts = partitionComposerAttachmentRoles([
      { role: 'product', id: '1' },
      { role: 'logo', id: '2' },
      { role: 'context', id: '3' },
      { role: 'product', id: '4' },
    ])
    expect(parts.product.map((p) => p.id)).toEqual(['1', '4'])
    expect(parts.logo.map((p) => p.id)).toEqual(['2'])
    expect(parts.context.map((p) => p.id)).toEqual(['3'])
  })

  it('defaults post campaign scripts to venta_directa when type is missing', () => {
    const base = parseChatShellScriptIntent(
      'Generame 5 post para XYZ. CTA Mensajes.',
      'es',
      DEFAULT_SCRIPT_SETTINGS
    )
    const tuned = applyPostCampaignScriptDefaults(base, DEFAULT_SCRIPT_SETTINGS)
    expect(tuned.matched).toBe(true)
    expect(tuned.hasExplicitType).toBe(true)
    expect(tuned.settings.scriptTypeConfig.venta_directa).toBe(5)
    expect(tuned.expectedCount).toBe(5)
  })
})
