import { supabase } from '../../lib/supabase'
import { compressBase64ForApi, uploadProductImage, urlToBase64 } from '../../utils/imageCompression'
import {
  addMessage,
  createProductImage,
  getSessionOfferImages,
  insertImageMessageArtifact,
  type ProductImage,
} from '../../services/database'
import type { Message, MessageArtifact } from '../../types'
import { buildOptimizeForPostPrompt, type PostTextDensity } from './chatShellImages'
import { isLiveThread } from './chatShellAsync'
import {
  buildShellImageGenerateBody,
  formatImageAssumptions,
  type ShellImagePreferences,
} from './chatShellImageIntent'

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
}): Promise<{ userMessage: Message; assistantMessage: Message; image: ProductImage; artifact: MessageArtifact }> {
  const publicUrl = await uploadProductImage(
    options.userId,
    options.productId,
    options.imageSource,
    `${Date.now()}.webp`
  )

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
  language?: 'en' | 'es'
  scriptText?: string
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
  })

  const sample = await callGenerateImage(body)

  if (!isLiveThread(
    options.activeThreadSessionId,
    options.sessionGen,
    options.originSessionId,
    options.originGen
  )) {
    return null
  }

  const assumptions = formatImageAssumptions(prefs, language)
  return persistShellGeneratedImage({
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
      model: prefs.model,
      density: prefs.density,
      brandKitId: options.brandKitId || null,
    },
  })
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
  originSessionId: string
  originGen: number
  activeThreadSessionId: string | null
  sessionGen: number
}): Promise<{ userMessage: Message; assistantMessage: Message; image: ProductImage } | null> {
  const base64 = await compressBase64ForApi(await urlToBase64(options.imageUrl))
  const sample = await callGenerateImage({
    action: 'edit',
    model: 'nano-banana-pro',
    productId: options.productId,
    sessionId: options.sessionId,
    productImageId: options.productImageId,
    editPrompt: options.editPrompt,
    editImage: base64,
    aspectRatio: '1:1',
  })

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
    label: options.actionType === 'optimize' ? 'Optimized for post' : 'Edited',
    actionType: options.actionType,
    userText: options.userText,
    metadata: {
      source: options.actionType === 'optimize' ? 'shell_optimize' : 'shell_edit',
      source_product_image_id: options.productImageId,
      density: options.density,
    },
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
  originSessionId: string
  originGen: number
  activeThreadSessionId: string | null
  sessionGen: number
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
    'product',
    { sessionId: options.sessionId }
  )
}

export { getSessionOfferImages }
