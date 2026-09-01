import { supabase } from '../../lib/supabase'
import { compressBase64ForApi, uploadGeneratedImageJpeg, uploadProductImage, urlToBase64 } from '../../utils/imageCompression'
import {
  addMessage,
  createPost,
  createProductImage,
  getSessionOfferImages,
  getSessionOffersImages,
  insertImageMessageArtifact,
  nextMessageArtifactOrdinal,
  updatePostStatus,
  type ProductImage,
} from '../../services/database'
import type { Message, MessageArtifact } from '../../types'
import { buildOptimizeForPostPrompt, type PostTextDensity } from './chatShellImages'
import { isLiveThread } from './chatShellAsync'
import {
  aspectRatioFromImageUrl,
  buildShellImageGenerateBody,
  formatImageAssumptions,
  requiresProductReferences,
  type ShellImageAspect,
  type ShellImagePreferences,
} from './chatShellImageIntent'
import {
  buildShellImageEnhanceBody,
  type ShellEnhanceTier,
} from './chatShellImageEnhance'
import {
  dbKindForReferenceRole,
  labelForReferenceRole,
  type ReferenceRole,
} from './chatShellReferenceSelection'
import { friendlyImageError } from './chatShellImageErrors'
import { mintShellGenerationId } from './shellGenerationId'

export function shellImageActionLabel(
  actionType: MessageArtifact['action_type'],
  language: 'en' | 'es' = 'es'
): string {
  if (actionType === 'optimize') {
    return language === 'es' ? 'Optimizada para post' : 'Optimized for post'
  }
  if (actionType === 'enhance') {
    return language === 'es' ? 'Mejorada' : 'Enhanced'
  }
  if (actionType === 'edit') {
    return language === 'es' ? 'Editada' : 'Edited'
  }
  return language === 'es' ? 'Generada' : 'Generated'
}

const IMAGE_API = import.meta.env.PROD
  ? '/api/generate-image'
  : 'http://localhost:3000/api/generate-image'

const FETCH_IMAGE_API = import.meta.env.PROD
  ? '/api/fetch-image'
  : 'http://localhost:3000/api/fetch-image'

async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  return session.access_token
}

/** Browser fetch is CSP-limited (self / supabase). Store kit URLs must go through /api/fetch-image. */
export function canBrowserFetchImageUrl(url: string): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:')) return true
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'https://localhost')
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) return true
    return parsed.hostname.endsWith('.supabase.co')
  } catch {
    return false
  }
}

async function fetchRemoteImageAsDataUrl(url: string): Promise<string> {
  const token = await getAccessToken()
  const res = await fetch(FETCH_IMAGE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url }),
  })
  const json = await res.json().catch(() => ({})) as { dataUrl?: string; error?: string }
  if (!res.ok || !json.dataUrl) {
    throw new Error(json.error || 'Could not load that reference image')
  }
  return json.dataUrl
}

export async function shellImageUrlToDataUrl(url: string): Promise<string> {
  if (canBrowserFetchImageUrl(url)) return urlToBase64(url)
  return fetchRemoteImageAsDataUrl(url)
}

type ImageApiResult = {
  result?: { sample?: string }
  imageUrl?: string
  error?: string
  details?: string
  code?: string
  model?: string
  providerModel?: string
  generationId?: string
}

async function callGenerateImageDetailed(body: Record<string, unknown>): Promise<{
  sample: string
  model?: string
  providerModel?: string
  generationId?: string
}> {
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
    const language = body.language === 'en' ? 'en' : 'es'
    const raw = [json.error, json.details, json.code].filter(Boolean).join(' ')
    throw new Error(friendlyImageError(raw || 'Image generation failed', language))
  }
  const sample = json.result?.sample || json.imageUrl
  if (!sample) {
    const language = body.language === 'en' ? 'en' : 'es'
    throw new Error(friendlyImageError('No image returned', language))
  }
  return {
    sample,
    model: json.model,
    providerModel: json.providerModel,
    generationId: json.generationId,
  }
}

async function callGenerateImage(body: Record<string, unknown>): Promise<string> {
  const detailed = await callGenerateImageDetailed(body)
  return detailed.sample
}

async function mirrorShellImageAsPost(options: {
  userId: string
  sessionId: string
  productId: string
  messageId: string
  publicUrl: string
  label: string
  userText: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const styleKind =
    options.metadata
    && typeof options.metadata === 'object'
    && options.metadata.style
    && typeof options.metadata.style === 'object'
    && 'kind' in (options.metadata.style as object)
      ? String((options.metadata.style as { kind?: unknown }).kind || '')
      : ''
  if (styleKind !== 'preset' && styleKind !== 'organic') return

  const generationId =
    typeof options.metadata?.generationId === 'string'
      ? options.metadata.generationId
      : undefined
  const model =
    typeof options.metadata?.model === 'string'
      ? options.metadata.model
      : 'grok-imagine'
  const post = await createPost(options.productId, options.userId, {
    prompt: options.label || options.userText,
    model,
    generation_id: generationId,
    session_id: options.sessionId,
    message_id: options.messageId,
  })
  await updatePostStatus(post.id, 'completed', options.publicUrl)
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
  const publicUrl = await uploadGeneratedImageJpeg(
    options.userId,
    options.productId,
    options.imageSource,
    `${Date.now()}.jpg`
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
    try {
      await mirrorShellImageAsPost({
        userId: options.userId,
        sessionId: options.sessionId,
        productId: options.productId,
        messageId: workspaceMessageId,
        publicUrl,
        label: options.label,
        userText: options.userText,
        metadata: options.metadata,
      })
    } catch (mirrorError) {
      console.error('Failed to auto-save shell image as post', mirrorError)
    }
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

  try {
    await mirrorShellImageAsPost({
      userId: options.userId,
      sessionId: options.sessionId,
      productId: options.productId,
      messageId: assistantMessage.id,
      publicUrl,
      label: options.label,
      userText: options.userText,
      metadata: options.metadata,
    })
  } catch (mirrorError) {
    console.error('Failed to auto-save shell image as post', mirrorError)
  }

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
  referenceMode?: 'use' | 'none'
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

  if (prefs.style.kind === 'product' && requiresProductReferences(prefs.style) && !options.productImageIds.length) {
    throw new Error(
      'Upload at least one product reference image for this offer before Generate.'
    )
  }

  const apiPrompt = prefs.style.kind === 'product'
    ? ''
    : (options.prompt || options.scriptText || 'Ad image')

  const generationId = mintShellGenerationId()

  const body = buildShellImageGenerateBody({
    preferences: prefs,
    productId: options.productId,
    sessionId: options.sessionId,
    prompt: apiPrompt,
    language,
    brandKitId: options.brandKitId,
    productImageIds: options.productImageIds,
    scriptText: options.scriptText,
    businessContext: options.businessContext,
    customColors: options.customColors,
    brandLogoUrl: options.brandLogoUrl,
    generationId,
    referenceMode: options.referenceMode,
  })

  let sample: string
  let actualModel = prefs.model
  let providerModel: string | undefined
  let returnedGenerationId: string | undefined
  try {
    const result = await callGenerateImageDetailed(body)
    sample = result.sample
    returnedGenerationId = result.generationId
    providerModel = result.providerModel
    if (result.model) actualModel = result.model as typeof prefs.model
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Do not silently switch providers — manual model comparison requires the chosen model.
    if (/no image (?:generated by gemini|returned)|gemini.*(?:empty|blocked|finish)/i.test(message)) {
      throw new Error(language === 'es'
        ? 'El proveedor no devolvió una imagen. Conservé el guion, el tipo y las referencias para que puedas reintentar con el mismo modelo o elegir otro.'
        : 'The provider did not return an image. I kept the script, type, and references so you can retry with the same model or pick another.')
    }
    throw err
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
      providerModel: providerModel || null,
      generationId: returnedGenerationId || generationId,
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
  const failures: string[] = []
  for (const url of urls.slice(0, 4)) {
    try {
      const data = await compressBase64ForApi(await shellImageUrlToDataUrl(url))
      if (data) compressed.push(data)
    } catch {
      failures.push(url)
    }
  }
  if (urls.length > 0 && compressed.length === 0) {
    throw new Error('Could not load product or logo reference images. Re-upload kit photos and try again.')
  }
  if (failures.length) {
    console.warn('Skipped unreadable reference URLs', failures.length)
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
  const base64 = await compressBase64ForApi(await shellImageUrlToDataUrl(options.imageUrl))
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
  const generationId = mintShellGenerationId()
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
          generationId,
        })
      : {
          action: 'edit',
          model: 'grok-imagine',
          productId: options.productId,
          sessionId: options.sessionId,
          productImageId: options.productImageId,
          editPrompt: options.editPrompt,
          editImage: base64,
          generationId,
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
    label: shellImageActionLabel(options.actionType, options.language || 'es'),
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
  kind?: 'product' | 'context' | 'scene' | 'style' | 'logo'
}): Promise<ProductImage> {
  const role: ReferenceRole =
    options.kind === 'style'
      ? 'style'
      : options.kind === 'logo'
        ? 'logo'
        : options.kind === 'scene' || options.kind === 'context'
          ? 'scene'
          : 'product'
  const dbKind = dbKindForReferenceRole(role)
  const label = labelForReferenceRole(role, 'es')
  // uploadProductImage always unique-ifies the storage object name.
  // Keep the role label as the product_images label for scene/style/logo classification.
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
    label,
    dbKind,
    { sessionId: options.sessionId }
  )
}

export async function copyShellOfferImageToProduct(options: {
  userId: string
  source: {
    id: string
    image_url: string
    label?: string | null
    kind: 'product' | 'context' | 'scene' | 'style' | 'logo'
  }
  targetProductId: string
}): Promise<ProductImage> {
  const role: ReferenceRole =
    options.source.kind === 'style'
      ? 'style'
      : options.source.kind === 'logo'
        ? 'logo'
        : options.source.kind === 'scene' || options.source.kind === 'context'
          ? 'scene'
          : 'product'
  const dataUrl = await compressBase64ForApi(await shellImageUrlToDataUrl(options.source.image_url))
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
    options.source.label || labelForReferenceRole(role, 'es'),
    dbKindForReferenceRole(role)
  )
}

export { getSessionOfferImages, getSessionOffersImages }
