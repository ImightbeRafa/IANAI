import type { ShellImagePreferences } from './chatShellImageIntent'
import { parseChatShellImageIntent } from './chatShellImageIntent'
import type { ComposerAttachment, ComposerAttachmentRole } from './chatShellComposerAttachments'
import type { ChatShellScriptIntent } from './chatShellScriptIntent'
import type { ScriptFramework, ScriptGenerationSettings, ScriptTypeConfig } from '../../types'

export interface NlPostCampaignIntent {
  matched: boolean
  wantsPosts: boolean
}

/**
 * "Generame N posts…" should become scripts → images, not the trapped
 * single-image Post sheet that requires an existing guion.
 */
export function parseNlPostCampaignIntent(
  text: string,
  language: 'es' | 'en' = 'es'
): NlPostCampaignIntent {
  const imageIntent = parseChatShellImageIntent(text, language)
  if (!imageIntent.matched || !imageIntent.wantsImage) {
    return { matched: false, wantsPosts: false }
  }
  if (imageIntent.preferences.style?.kind === 'logo') {
    return { matched: false, wantsPosts: false }
  }
  // Foto / product-photo path stays on the existing image flow.
  if (imageIntent.preferences.style?.kind === 'product') {
    return { matched: false, wantsPosts: false }
  }
  const normalized = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
  const wantsPost = /\b(?:posts?|publicaci[oó]n(?:es)?)\b/.test(normalized)
  if (!wantsPost) {
    return { matched: false, wantsPosts: false }
  }
  return { matched: true, wantsPosts: true }
}

function zeroScriptTypeConfig(): ScriptTypeConfig {
  return {
    venta_directa: 0,
    desvalidar_alternativas: 0,
    mostrar_servicio: 0,
    variedad_productos: 0,
    paso_a_paso: 0,
    reconocimiento: 0,
    educativo: 0,
    storytelling: 0,
    tendencia: 0,
    engagement: 0,
  }
}

/**
 * Posts default to venta_directa when the user did not name a guion type —
 * clarify only count / CTA / offer when still missing.
 */
export function applyPostCampaignScriptDefaults(
  intent: ChatShellScriptIntent,
  fallbackSettings: ScriptGenerationSettings
): ChatShellScriptIntent {
  const count = Math.max(
    1,
    Math.min(10, intent.expectedCount || intent.settings.variations || fallbackSettings.variations || 1)
  )
  if (intent.hasExplicitType) {
    return {
      ...intent,
      matched: true,
      expectedCount: Math.max(intent.expectedCount, count),
    }
  }
  const scriptTypeConfig = zeroScriptTypeConfig()
  scriptTypeConfig.venta_directa = count
  const framework: ScriptFramework = 'venta_directa'
  return {
    ...intent,
    matched: true,
    hasExplicitType: true,
    hasExplicitCount: intent.hasExplicitCount || count > 0,
    orderedTypes: [framework],
    expectedCount: count,
    settings: {
      ...fallbackSettings,
      ...intent.settings,
      generationMode: 'by_type',
      framework,
      variations: count,
      scriptTypeConfig,
      ctaStrength: intent.settings.ctaStrength || 'sales',
    },
  }
}

/** Default anuncio prefs for NL post campaign (skip style/mode sheets). */
export function defaultNlPostCampaignImagePreferences(
  partial?: Partial<ShellImagePreferences>
): ShellImagePreferences {
  return {
    style: partial?.style || { kind: 'preset', presetId: 'venta-directa' },
    aspectRatio: partial?.aspectRatio || '9:16',
    model: partial?.model || 'grok-imagine',
    density: partial?.density || 'hard',
  }
}

export function partitionComposerAttachmentRoles(
  attachments: Array<{ role: ComposerAttachmentRole; id?: string; url?: string }>
): {
  product: typeof attachments
  logo: typeof attachments
  context: typeof attachments
} {
  return {
    product: attachments.filter((item) => item.role === 'product'),
    logo: attachments.filter((item) => item.role === 'logo'),
    context: attachments.filter((item) => item.role === 'context'),
  }
}

export function composerAttachmentPayload(
  attachments: ComposerAttachment[]
): Array<{ dataUrl: string; role: ComposerAttachmentRole; name: string }> {
  return attachments.map((item) => ({
    dataUrl: item.dataUrl,
    role: item.role,
    name: item.name,
  }))
}
