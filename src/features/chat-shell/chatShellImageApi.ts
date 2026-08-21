import { supabase } from '../../lib/supabase'
import { compressBase64ForApi, uploadProductImage, urlToBase64 } from '../../utils/imageCompression'
import {
  addMessage,
  createProductImage,
  getSessionOfferImages,
  getSessionOffersImages,
  insertImageMessageArtifact,
  nextMessageArtifactOrdinal,
  type ProductImage,
} from '../../services/database'
import type { Message, MessageArtifact } from '../../types'
import { buildOptimizeForPostPrompt, type PostTextDensity } from './chatShellImages'
import { isLiveThread } from './chatShellAsync'
import {
  aspectRatioFromImageUrl,
  buildShellImageGenerateBody,
  formatImageAssumptions,
  type ShellImageAspect,
  type ShellImagePreferences,
} from './chatShellImageIntent'
import {
  buildShellImageEnhanceBody,
  type ShellEnhanceTier,
} from './chatShellImageEnhance'

const IMAGE_API = import.meta.env.PROD
  ? '/api/generate-image'
  : 'http://localhost:3000/api/generate-image'

async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  return session.access_token
}

interface ImageApiResult {
  status?: string
  result?: { sample?: string }
  imageUrl?: string
  error?: string
}

async function callGenerateImage(body: Record<string, unknown>): Promise<string> {
  const token = await getAccessToken()
  const res = await fetch(IMAGE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as ImageApiResult
  if (!res.ok) {
    throw new Error(json.error || 'Image generation failed')
  }
  const sample = json.result?.sample || json.imageUrl
  if (!sample) throw new Error('No image returned')
  return sample
}

export async function persistShellGeneratedImage(options: {
  userId: string
  sessionId: string
  productId: string
  imageSource: string
  label: string
  actionType: MessageArtifact['action_type']
  metadata?: Record<string, unknown>
  userText: string
  workspaceMessageId?: string
}): Promise<{
  userMessage: Message | null
  assistantMessage: Message | null
  image: ProductImage
  artifact: MessageArtifact
  attachedToExisting: boolean
  workspaceMessageId?: string
}> {
  const publicUrl = await uploadProductImage(
    options.userId,
    options.productId,
    options.imageSource,
    `${Date.now()}.webp`
  )

  const workspaceMessageId = options.workspaceMessageId?.trim() || ''
  if (workspaceMessageId) {
    const ordinal = await nextMessageArtifactOrdinal(workspaceMessageId)
    const image = await createProductImage(
      options.productId,
      options.userId,
      publicUrl,
      options.label,
      'generated',
      { sessionId: options.sessionId, messageId: workspaceMessageId }
    )
    const artifact = await insertImageMessageArtifact({
      sessionId: options.sessionId,
      messageId: workspaceMessageId,
      productId: options.productId,
      productImageId: image.id,
      ordinal,
      userId: options.userId,
      actionType: options.actionType,
      metadata: options.metadata || {},
    })
    return {
      userMessage: null,
      assistantMessage: null,
      image,
      artifact,
      attachedToExisting: true,
      workspaceMessageId,
    }
  }

  const userMessage = await addMessage(options.sessionId, 'user', options.userText)
  const assistantMessage = await addMessage(
    options.sessionId,
    'assistant',
    `Image · ${options.label}`
  )

  const image = await createProductImage(
    options.productId,
    options.userId,
    publicUrl,
    options.label,
    'generated',
    { sessionId: options.sessionId, messageId: assistantMessage.id }
  )

  const artifact = await insertImageMessageArtifact({
    sessionId: options.sessionId,
    messageId: assistantMessage.id,
    productId: options.productId,
    productImageId: image.id,
    ordinal: 1,
    userId: options.userId,
    actionType: options.actionType,
    metadata: options.metadata || {},
  })

  return {
    userMessage,
    assistantMessage: { ...assistantMessage, artifacts: [artifact] },
    image,
    artifact,
    attachedToExisting: false,
    workspaceMessageId: assistantMessage.id,
  }
}

export async function generateShellOfferImage(options: {
  userId: string
  sessionId: string
  productId: string
  prompt: string
  preferences: ShellImagePreferences
  /** Offer-scoped product_images ids (refs) — required for Producto mode. */
  productImageIds: string[]
  brandKitId?: string
  customColors?: string[]
  brandLogoUrl?: string
  language?: 'en' | 'es'
  scriptText?: string
  businessContext?: string
  userText?: string
  source?: string
  originSessionId: string
  originGen: number
  activeThreadSessionId: string | null
  sessionGen: number
}): Promise<{ userMessage: Message; assistantMessage: Message; image: ProductImage } | null> {
  const language = options.language || 'es'
  const prefs = options.preferences
  if (!prefs.style) {
    throw new Error('Choose an image style before Generate.')
  }

  if (prefs.style.kind === 'product' && !options.productImageIds.length) {
    throw new Error(
      'Upload at least one product reference image for this offer before Generate.'
    )
  }

  const body = buildShellImageGenerateBody({
    preferences: prefs,
    productId: options.productId,
    sessionId: options.sessionId,
    prompt: options.prompt || options.scriptText || 'Ad image',
    language,
    brandKitId: options.brandKitId,
    productImageIds: options.productImageIds,
    scriptText: options.scriptText,
    businessContext: options.businessContext,
    customColors: options.customColors,
    brandLogoUrl: options.brandLogoUrl,
  })

  let sample: string
  let actualModel = prefs.model
  try {
    sample = await callGenerateImage(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const retryableGeminiFailure = prefs.model !== 'grok-imagine'
      && /no image (?:generated by gemini|returned)|gemini.*(?:empty|blocked|finish)/i.test(message)
    if (!retryableGeminiFailure) throw err
    try {
      sample = await callGenerateImage({ ...body, model: 'grok-imagine' })
      actualModel = 'grok-imagine'
    } catch (fallbackErr) {
      console.error('Gemini image generation and Grok fallback both failed', fallbackErr)
      throw new Error(language === 'es'
        ? 'El proveedor no devolvió una imagen. Conservé el guion, el tipo y las referencias para que puedas reintentar.'
        : 'The provider did not return an image. I kept the script, type, and references so you can retry.')
    }
  }

  if (!isLiveThread(
    options.activeThreadSessionId,
    options.sessionGen,
    options.originSessionId,
    options.originGen
  )) {
    return null
  }

  const actualPreferences = actualModel === prefs.model ? prefs : { ...prefs, model: actualModel }
  const assumptions = formatImageAssumptions(actualPreferences, language)
  const persisted = await persistShellGeneratedImage({
    userId: options.userId,
    sessionId: options.sessionId,
    productId: options.productId,
    imageSource: sample,
    label: assumptions,
    actionType: 'generate',
    userText: options.userText || 'Generate image for offer',
    metadata: {
      source: options.source || 'shell_generate',
      assumptions,
      style: prefs.style,
      aspectRatio: prefs.aspectRatio,
      model: actualModel,
      density: prefs.density,
      brandKitId: options.brandKitId || null,
    },
  })
  if (!persisted.userMessage || !persisted.assistantMessage) return null
  return {
    userMessage: persisted.userMessage,
    assistantMessage: persisted.assistantMessage,
    image: persisted.image,
  }
}

async function compressReferenceUrls(urls: string[] | undefined): Promise<string[]> {
  if (!urls?.length) return []
  const compressed: string[] = []
  for (const url of urls.slice(0, 4)) {
    try {
      const data = await compressBase64ForApi(await urlToBase64(url))
      if (data) compressed.push(data)
    } catch {
      // Skip unreadable product/context refs; the source image still enhances.
    }
  }
  return compressed
}

export async function editShellOfferImage(options: {
  userId: string
  sessionId: string
  productId: string
  productImageId: string
  imageUrl: string
  editPrompt: string
  actionType: MessageArtifact['action_type']
  userText: string
  scriptText?: string
  density?: PostTextDensity
  brandKitId?: string
  brandLogoUrl?: string
  customColors?: string[]
  aspectRatio?: ShellImageAspect
  language?: 'en' | 'es'
  enhanceTier?: ShellEnhanceTier
  editReferenceImages?: string[]
  productReferenceUrls?: string[]
  contextReferenceUrls?: string[]
  originSessionId: string
  originGen: number
  activeThreadSessionId: string | null
  sessionGen: number
  workspaceMessageId?: string
}): Promise<{
  userMessage: Message | null
  assistantMessage: Message | null
  image: ProductImage
  artifact: MessageArtifact
  attachedToExisting: boolean
  workspaceMessageId?: string
} | null> {
  const base64 = await compressBase64ForApi(await urlToBase64(options.imageUrl))
  const inferredAspect = options.aspectRatio || await aspectRatioFromImageUrl(options.imageUrl) || undefined
  const isEnhance = options.actionType === 'enhance'
  const compressedRefs = options.editReferenceImages?.length
    ? (await Promise.all(
      options.editReferenceImages.slice(0, 4).map((image) => compressBase64ForApi(image))
    )).filter(Boolean)
    : []
  const productReferenceImages = isEnhance
    ? await compressReferenceUrls(options.productReferenceUrls)
    : []
  const contextReferenceImages = isEnhance
    ? await compressReferenceUrls(options.contextReferenceUrls)
    : []
  const sample = await callGenerateImage(
    isEnhance
      ? buildShellImageEnhanceBody({
          productId: options.productId,
          sessionId: options.sessionId,
          enhanceImage: base64,
          enhanceTier: options.enhanceTier || 'modernize',
          language: options.language || 'es',
          editPrompt: options.editPrompt,
          brandKitId: options.brandKitId,
          brandLogoUrl: options.brandLogoUrl,
          customColors: options.customColors,
          productReferenceImages,
          contextReferenceImages,
          aspectRatio: inferredAspect,
        })
      : {
          action: 'edit',
          model: 'nano-banana-pro',
          productId: options.productId,
          sessionId: options.sessionId,
          productImageId: options.productImageId,
          editPrompt: options.editPrompt,
          editImage: base64,
          ...(compressedRefs.length ? { editReferenceImages: compressedRefs } : {}),
          ...(inferredAspect ? { aspectRatio: inferredAspect } : {}),
          ...(options.brandKitId ? { brandKitId: options.brandKitId } : {}),
          ...(options.brandLogoUrl ? { brandLogoUrl: options.brandLogoUrl } : {}),
        }
  )

  if (!isLiveThread(
    options.activeThreadSessionId,
    options.sessionGen,
    options.originSessionId,
    options.originGen
  )) {
    return null
  }

  return persistShellGeneratedImage({
    userId: options.userId,
    sessionId: options.sessionId,
    productId: options.productId,
    imageSource: sample,
    label: options.actionType === 'optimize' ? 'Optimized for post' : options.actionType === 'enhance' ? 'Enhanced' : 'Edited',
    actionType: options.actionType,
    userText: options.userText,
    metadata: {
      source: options.actionType === 'optimize' ? 'shell_optimize' : options.actionType === 'enhance' ? 'shell_enhance' : 'shell_edit',
      source_product_image_id: options.productImageId,
      density: options.density,
      brandKitId: options.brandKitId || null,
      brandLogoUrl: options.brandLogoUrl || null,
      enhanceTier: isEnhance ? (options.enhanceTier || 'modernize') : null,
      aspectRatio: inferredAspect || null,
    },
    workspaceMessageId: options.workspaceMessageId,
  })
}

export async function optimizeShellOfferImage(options: {
  userId: string
  sessionId: string
  productId: string
  productImageId: string
  imageUrl: string
  scriptText?: string
  density?: PostTextDensity
  brandKitId?: string
  originSessionId: string
  originGen: number
  activeThreadSessionId: string | null
  sessionGen: number
  workspaceMessageId?: string
}) {
  const editPrompt = buildOptimizeForPostPrompt({
    scriptText: options.scriptText,
    density: options.density || 'medium',
    language: 'es',
  })
  return editShellOfferImage({
    ...options,
    editPrompt,
    actionType: 'optimize',
    userText: 'Optimize image for post',
  })
}

export async function uploadShellOfferImage(options: {
  userId: string
  sessionId: string
  productId: string
  dataUrl: string
  filename?: string
  kind?: 'product' | 'context'
}): Promise<ProductImage> {
  // uploadProductImage always unique-ifies the storage object name.
  // Keep the original filename as the product_images label only.
  const publicUrl = await uploadProductImage(
    options.userId,
    options.productId,
    options.dataUrl,
    options.filename
  )
  return createProductImage(
    options.productId,
    options.userId,
    publicUrl,
    options.filename || 'Upload',
    options.kind || 'product',
    { sessionId: options.sessionId }
  )
}

export async function copyShellOfferImageToProduct(options: {
  userId: string
  source: {
    id: string
    image_url: string
    label?: string | null
    kind: 'product' | 'context'
  }
  targetProductId: string
}): Promise<ProductImage> {
  const dataUrl = await compressBase64ForApi(await urlToBase64(options.source.image_url))
  const publicUrl = await uploadProductImage(
    options.userId,
    options.targetProductId,
    dataUrl,
    `${options.source.id}.webp`
  )
  return createProductImage(
    options.targetProductId,
    options.userId,
    publicUrl,
    options.source.label || 'Reference',
    options.source.kind
  )
}

export { getSessionOfferImages, getSessionOffersImages }
