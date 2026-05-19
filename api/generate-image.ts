import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, checkUsageLimit, incrementUsage, deductBonusImage, isAdminUser } from './lib/auth.js'
import { logApiUsage } from './lib/usage-logger.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { GoogleGenAI } from '@google/genai'
import { buildPostPrompt, buildPresetPrompt, buildProductPrompt, buildAnuncioPrompt, buildLogoPrompt, detectProductNiche } from './data/image-presets.js'
import type { PostAspectRatio, LogoArchetype, LogoEnhanceTier, LogoBackground } from './data/image-presets.js'
import { buildOrganicSinglePrompt, type OrganicSingleSubtype, type OrganicAspectRatio } from './data/organic-post-prompts.js'
import type { CTAStrength } from './data/organic-script-prompts.js'
import { findColorPaletteById } from './data/color-palettes.js'
import { getMemoryInjection } from './lib/memory-helpers.js'
import { resolveBrandKit, buildBrandColorOverride, buildBrandVisualPrompt, buildBrandLogoPrompt, fetchBrandLogoAsBase64 } from './lib/brand-kit.js'
import { supabaseAdmin as imgMemSupabase } from './lib/supabase-admin.js'

const GROK_IMAGINE_API_URL = 'https://api.x.ai/v1/images/generations'
const OPENAI_IMAGES_GENERATIONS_URL = 'https://api.openai.com/v1/images/generations'
const OPENAI_IMAGES_EDITS_URL = 'https://api.openai.com/v1/images/edits'
const GEMINI_IMAGE_TIMEOUT_MS = 135_000

// Gemini Image Generation Models (from official SDK documentation)
const GEMINI_IMAGE_MODELS: Record<string, string> = {
  'nano-banana': 'gemini-2.5-flash-image',          // Fast, efficient (1K resolution)
  'nano-banana-pro': 'gemini-3-pro-image-preview'   // High quality, reasoning (up to 4K)
}

type ImageModel = 'nano-banana' | 'nano-banana-pro' | 'grok-imagine' | 'gpt-image-2'
type PostTextDensity = 'hard' | 'medium' | 'standard'

type InlineImageRef = {
  label: string
  mimeType: string
  data: string
}

type OpenAIImageUsage = {
  input_tokens?: number
  input_tokens_details?: {
    image_tokens?: number
    text_tokens?: number
  }
  output_tokens?: number
  total_tokens?: number
}

class UpstreamTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} timed out after ${Math.round(GEMINI_IMAGE_TIMEOUT_MS / 1000)} seconds`)
    this.name = 'UpstreamTimeoutError'
  }
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new UpstreamTimeoutError(label)), GEMINI_IMAGE_TIMEOUT_MS)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof UpstreamTimeoutError
    || (error instanceof Error && error.message.toLowerCase().includes('timed out'))
}

function isTransientGeminiError(error: unknown): boolean {
  if (isTimeoutError(error)) return true
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : NaN
  const message = error instanceof Error ? error.message : String(error)
  return status === 500
    || status === 503
    || status === 504
    || message.includes('INTERNAL')
    || message.includes('UNAVAILABLE')
    || message.includes('RESOURCE_EXHAUSTED')
    || message.includes('429')
    || message.includes('500')
    || message.includes('503')
}

function normalizePostTextDensity(value: unknown): PostTextDensity {
  return value === 'hard' || value === 'standard' || value === 'medium' ? value : 'medium'
}

function buildPostTextDensityPrefix(language: string, density: PostTextDensity): string {
  const isEs = language === 'es'
  const copyRules = {
    hard: isEs
      ? 'MODO TEXTO HARD: usar la menor cantidad de texto posible. Maximo 1 headline corto, 1-2 micro-puntos y 1 CTA corto. No parrafos. No agregar beneficios extra.'
      : 'TEXT MODE HARD: use the least text possible. Maximum 1 short headline, 1-2 micro-points, and 1 short CTA. No paragraphs. Do not add extra benefits.',
    medium: isEs
      ? 'MODO TEXTO MEDIO: post directo y escaneable. Maximo 1 headline, 2-3 puntos cortos y 1 CTA. Priorizar aire visual sobre explicar de mas.'
      : 'TEXT MODE MEDIUM: direct, scannable post. Maximum 1 headline, 2-3 short points, and 1 CTA. Prioritize visual breathing room over extra explanation.',
    standard: isEs
      ? 'MODO TEXTO ESTANDAR: puedes usar el nivel actual de detalle, pero mantenlo limpio. Maximo 1 headline, 3-5 puntos y 1 CTA. No parrafos largos.'
      : 'TEXT MODE STANDARD: you may use the current fuller detail level, but keep it clean. Maximum 1 headline, 3-5 points, and 1 CTA. No long paragraphs.'
  }[density]

  return `INSTRUCCION DE DENSIDAD DE TEXTO (NO RENDERIZAR ESTA INSTRUCCION): ${copyRules}\n\n`
}

function buildProductReferenceStrategyPrefix(language: string, refCount: number, isProductMode: boolean): string {
  if (refCount <= 0) return ''
  const isEs = language === 'es'
  const modeRule = isProductMode
    ? (isEs
      ? 'Como estas en modo fotografia de producto, prioriza una representacion limpia del producto vendible. Si varias imagenes son vistas del mismo item, usalas para fidelidad; si son items distintos, no los mezcles.'
      : 'Because this is product photography mode, prioritize a clean representation of the sellable product. If several images are views of the same item, use them for fidelity; if they are distinct items, do not blend them.')
    : (isEs
      ? 'Como estas creando un post/anuncio, usa las referencias secundarias como prueba visual, contexto o apoyo de composicion sin competir con el producto heroe.'
      : 'Because this is a post/ad, use secondary references as proof, context, or composition support without competing with the hero product.')

  if (refCount === 1) {
    return isEs
      ? `ESTRATEGIA DE REFERENCIA VISUAL (NO RENDERIZAR): Se adjunta 1 imagen de referencia del producto/oferta real. Usala como fuente visual principal. Copia su forma, color, textura, proporcion y detalles sin inventar otro producto.\n\n`
      : `VISUAL REFERENCE STRATEGY (DO NOT RENDER): 1 reference image of the real product/offer is attached. Use it as the main visual source. Copy its shape, color, texture, proportions, and details without inventing another product.\n\n`
  }

  return isEs
    ? `ESTRATEGIA DE REFERENCIAS MULTIPLES (NO RENDERIZAR, MAXIMA PRIORIDAD):
Recibiras ${refCount} imagenes relacionadas con el producto/oferta. NO asumas automaticamente que todas son el mismo objeto ni las fusiones en un hibrido.

Antes de disenar, clasifica mentalmente cada imagen en uno de estos roles:
- PRODUCTO HEROE: el objeto vendible real, empaque, botella, prenda, plato, dispositivo o set que debe protagonizar.
- VARIANTE / SABOR / COLOR: otro producto real de la misma linea. Si aparece, muestralo como item separado o lineup limpio, nunca mezclado con otro.
- RESULTADO / PRUEBA / DETALLE: antes-despues, dientes, piel, textura, close-up, ingrediente, captura o evidencia. Usalo como inset, panel de prueba, textura sutil o contexto visual; NO lo pegues encima del producto ni lo conviertas en parte del empaque.
- CONTEXTO / ESTILO: escena, fondo, mood, lifestyle o composicion. Usalo para ambiente y direccion de arte, no como producto.

${modeRule}

Regla de composicion: el resultado final debe tener UNA idea visual coherente. Elige un producto heroe claro y usa las demas referencias solo en su rol correcto. Prohibido amalgamar fotos distintas en un solo objeto raro. Prohibido poner una foto de resultado dentro del producto salvo que el empaque real ya la tenga. Prohibido ignorar referencias relevantes: si no son producto heroe, deben influir como prueba, detalle, contexto o estilo.\n\n`
    : `MULTI-REFERENCE STRATEGY (DO NOT RENDER, HIGHEST PRIORITY):
You will receive ${refCount} images related to the product/offer. Do NOT automatically assume they are all the same object, and do NOT fuse them into a hybrid.

Before designing, silently classify each image into one of these roles:
- HERO PRODUCT: the real sellable object, package, bottle, garment, dish, device, or set that should lead the ad.
- VARIANT / FLAVOR / COLOR: another real product from the same line. Show it as a separate item or clean lineup, never blended into another product.
- RESULT / PROOF / DETAIL: before-after, teeth, skin, texture, close-up, ingredient, screenshot, or evidence. Use it as an inset, proof panel, subtle texture, or visual context; do NOT paste it onto the product or turn it into packaging.
- CONTEXT / STYLE: scene, background, mood, lifestyle, or composition. Use it for environment and art direction, not as the product.

${modeRule}

Composition rule: the final image must have ONE coherent visual idea. Choose a clear hero product and use the other references only in their correct roles. Do not amalgamate different photos into one strange object. Do not put a result photo inside the product unless the real packaging already contains it. Do not ignore relevant references: if they are not the hero product, they must influence proof, detail, context, or style.\n\n`
}

// Map width/height to aspect ratio string
function getAspectRatio(width: number, height: number): string {
  const ratio = width / height
  if (Math.abs(ratio - 1) < 0.01) return '1:1'
  if (Math.abs(ratio - 4/5) < 0.01) return '4:5'
  if (Math.abs(ratio - 9/16) < 0.01) return '9:16'
  if (Math.abs(ratio - 16/9) < 0.01) return '16:9'
  if (Math.abs(ratio - 4/3) < 0.01) return '4:3'
  if (Math.abs(ratio - 3/4) < 0.01) return '3:4'
  if (Math.abs(ratio - 3/2) < 0.01) return '3:2'
  if (Math.abs(ratio - 2/3) < 0.01) return '2:3'
  return '1:1'
}

function parseDataUrlImage(value: unknown, label: string): InlineImageRef | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return { label, mimeType: match[1], data: match[2] }
}

function dataUrlFromInline(ref: InlineImageRef): string {
  return `data:${ref.mimeType};base64,${ref.data}`
}

function getOpenAIImageSize(width: number, height: number): '1024x1024' | '1024x1536' | '1536x1024' {
  const ratio = width / height
  if (Math.abs(ratio - 1) < 0.1) return '1024x1024'
  return ratio > 1 ? '1536x1024' : '1024x1536'
}

function extractOpenAIUsage(result: Record<string, unknown>): OpenAIImageUsage | null {
  const rootUsage = result.usage
  if (rootUsage && typeof rootUsage === 'object') return rootUsage as OpenAIImageUsage

  const firstData = Array.isArray(result.data) ? result.data[0] : null
  if (firstData && typeof firstData === 'object' && 'usage' in firstData) {
    const usage = (firstData as { usage?: unknown }).usage
    if (usage && typeof usage === 'object') return usage as OpenAIImageUsage
  }

  return null
}

function calculateOpenAIImageCost(usage: OpenAIImageUsage | null): number | undefined {
  if (!usage) return undefined
  const textInputTokens = usage.input_tokens_details?.text_tokens || 0
  const imageInputTokens = usage.input_tokens_details?.image_tokens || 0
  const imageOutputTokens = usage.output_tokens || 0
  if (textInputTokens === 0 && imageInputTokens === 0 && imageOutputTokens === 0) return undefined

  return (textInputTokens / 1_000_000) * 5.00
    + (imageInputTokens / 1_000_000) * 8.00
    + (imageOutputTokens / 1_000_000) * 30.00
}

function buildOpenAIReferencePrompt(basePrompt: string, refs: InlineImageRef[]): string {
  if (refs.length === 0) return basePrompt
  const refGuide = refs.map((ref, index) => `${index + 1}. ${ref.label}`).join('\n')
  return `${basePrompt}

OPENAI REFERENCE IMAGE ORDER (DO NOT RENDER THIS TEXT):
${refGuide}

Use each attached image only for its stated role. Preserve sellable product/package references as product truth. Use proof, detail, context, and logo references as separate supporting information. Do not fuse multiple references into one hybrid object.`
}

// System prompt for Gemini (CAN render text) — used for generic image gen only
const GEMINI_PROMPT_PREFIX = `Crea una imagen profesional de alta calidad para marketing en redes sociales.
NO crees una captura de pantalla o mockup de Instagram u otra red social.
Enfócate en: composición limpia, iluminación profesional, colores vibrantes, atractivo comercial.
Estilo: Fotografía de producto moderna, imágenes lifestyle, contenido promocional.
Puedes incluir texto legible si el usuario lo solicita.

Solicitud del usuario: `

// PostAspectRatio type and buildPostPrompt (Venta Directa) imported from ./data/image-presets.js

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Verify user authentication
  const user = await requireAuth(req, res)
  if (!user) return // Response already sent by requireAuth

  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Request body is required' })
    }

    const { action, taskId, model = 'nano-banana', ...imageParams } = req.body

    const VALID_ACTIONS = ['generate', 'edit', 'enhance', 'poll', 'post']
    if (action && !VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` })
    }

    const VALID_MODELS: ImageModel[] = ['nano-banana', 'nano-banana-pro', 'grok-imagine', 'gpt-image-2']
    if (!VALID_MODELS.includes(model)) {
      return res.status(400).json({ error: `Invalid model. Must be one of: ${VALID_MODELS.join(', ')}` })
    }
    const selectedModel: ImageModel = model

    if (selectedModel === 'gpt-image-2' && !(await isAdminUser(user.id))) {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const incomingGenerationId = typeof imageParams.generationId === 'string' ? imageParams.generationId : ''
    const generationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(incomingGenerationId)
      ? incomingGenerationId
      : (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)

    const MAX_PROMPT_LENGTH = 50_000
    if (imageParams.prompt && typeof imageParams.prompt === 'string' && imageParams.prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters` })
    }

    // For polling requests, skip usage check and rate limit (already counted on initial request)
    if (action !== 'poll') {
      // Rate limit: 15 requests per 60 seconds per user
      const rateCheck = checkRateLimit(`img:${user.id}`, { maxRequests: 15, windowSeconds: 60 })
      if (!rateCheck.allowed) {
        return res.status(429).json({
          error: 'Demasiadas solicitudes',
          message: `Por favor espera ${rateCheck.resetInSeconds} segundos antes de intentar de nuevo.`,
          retryAfter: rateCheck.resetInSeconds
        })
      }

      // Check usage limits for new generation requests
      const { allowed, remaining, limit } = await checkUsageLimit(user.id, 'image')
      if (!allowed) {
        return res.status(429).json({ 
          error: 'Límite de imágenes alcanzado',
          message: `Has alcanzado el límite de ${limit} imágenes este mes. Actualiza tu plan para continuar.`,
          limit,
          remaining: 0
        })
      }
    }

    // =============================================
    // IMAGE EDIT MODE (Gemini only)
    // Send existing image + edit instruction → get edited image back
    // =============================================
    if (action === 'edit') {
      const geminiApiKey = process.env.GEMINI_API_KEY
      if (!geminiApiKey) {
        return res.status(500).json({ error: 'Gemini API key not configured' })
      }

      const editPrompt = imageParams.editPrompt || ''
      const editImage = imageParams.editImage || ''

      if (!editPrompt || !editImage) {
        return res.status(400).json({ error: 'editPrompt and editImage are required for edit action' })
      }

      // Always use Gemini 3 Pro for edits (best quality + reasoning)
      const editModelId = GEMINI_IMAGE_MODELS['nano-banana-pro']

      const editRefImages: string[] = Array.isArray(imageParams.editReferenceImages) ? imageParams.editReferenceImages : []
      const hasRefs = editRefImages.length > 0

      const systemEditPrompt = `You are an expert image editor. You will receive an image to edit and an edit instruction.${hasRefs ? ' You will also receive reference images — use them as visual guidance for the requested change.' : ''}
Your task: Apply ONLY the requested change to the image while preserving everything else exactly as-is.
Keep the same composition, layout, colors, style, typography, and overall look.
Make the minimum change necessary to fulfill the user's request.${hasRefs ? '\nUse the reference images to understand what the user wants — match their style, colors, elements, or content as needed.' : ''}
Return the edited image.

Edit instruction: ${editPrompt}`

      try {
        const ai = new GoogleGenAI({ apiKey: geminiApiKey })

        // Extract base64 from data URL
        const base64Match = editImage.match(/^data:([^;]+);base64,(.+)$/)
        if (!base64Match) {
          return res.status(400).json({ error: 'Invalid image format — expected base64 data URL' })
        }

        type PromptPart = { text: string } | { inlineData: { mimeType: string; data: string } }
        const promptParts: PromptPart[] = [
          { text: systemEditPrompt },
          { inlineData: { mimeType: base64Match[1], data: base64Match[2] } }
        ]

        // Add reference images if provided (up to 4)
        for (const refImg of editRefImages.slice(0, 4)) {
          const refMatch = refImg.match(/^data:([^;]+);base64,(.+)$/)
          if (refMatch) {
            promptParts.push({ inlineData: { mimeType: refMatch[1], data: refMatch[2] } })
          }
        }

        // Map request aspect ratio to Gemini-compatible string (default 9:16)
        const editAR = imageParams.aspectRatio === '1:1' ? '1:1' : imageParams.aspectRatio === '3:4' ? '3:4' : '9:16'

        // Retry once on transient errors (503, 500, etc.)
        let response: Awaited<ReturnType<typeof ai.models.generateContent>>
        try {
          response = await withTimeout(ai.models.generateContent({
            model: editModelId,
            contents: promptParts,
            config: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig: {
                imageSize: '2K',
                aspectRatio: editAR
              }
            }
          }), 'Gemini edit')
        } catch (firstErr) {
          console.warn('Gemini edit first attempt failed, retrying:', firstErr instanceof Error ? firstErr.message : firstErr)
          await new Promise(r => setTimeout(r, 2000))
          response = await withTimeout(ai.models.generateContent({
            model: editModelId,
            contents: promptParts,
            config: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig: {
                imageSize: '2K',
                aspectRatio: editAR
              }
            }
          }), 'Gemini edit retry')
        }

        const candidates = response.candidates || []
        const parts = candidates[0]?.content?.parts || []

        let imageUrl: string | null = null
        for (const part of parts) {
          if ('inlineData' in part && part.inlineData?.data) {
            const mimeType = part.inlineData.mimeType || 'image/png'
            imageUrl = `data:${mimeType};base64,${part.inlineData.data}`
            break
          }
        }

        if (!imageUrl) {
          console.error('No image in Gemini edit response:', JSON.stringify(response, null, 2))
          return res.status(500).json({ error: 'Gemini did not return an edited image' })
        }

        // Count edit as image usage
        await incrementUsage(user.id, 'image')
        await deductBonusImage(user.id)

        // Extract token usage from Gemini response
        const editUsage = response.usageMetadata
        const editInputTokens = editUsage?.promptTokenCount || 0
        const editOutputTokens = editUsage?.candidatesTokenCount || 0
        const editThinkingTokens = editUsage?.thoughtsTokenCount || 0

        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'edit',
          model: 'nano-banana-pro',
          inputTokens: editInputTokens,
          outputTokens: editOutputTokens,
          thinkingTokens: editThinkingTokens,
          success: true,
          metadata: {
            action: 'edit',
            provider: 'google',
            providerModel: editModelId,
            rawUsage: editUsage,
            imageSize: '2K',
            editPrompt: editPrompt.substring(0, 100)
          }
        })

        return res.status(200).json({
          status: 'Ready',
          result: { sample: imageUrl },
          model: 'nano-banana-pro',
          textWarning: false,
          edited: true
        })

      } catch (editError) {
        console.error('Gemini edit error:', editError)

        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'edit',
          model: 'nano-banana-pro',
          success: false,
          errorMessage: editError instanceof Error ? editError.message : 'Unknown error',
          metadata: { action: 'edit', provider: 'google', providerModel: editModelId, costSource: 'unavailable' }
        })

        return res.status(isTimeoutError(editError) ? 504 : 500).json({
          error: 'Image edit failed',
          details: editError instanceof Error ? editError.message : 'Unknown error',
          retryable: isTimeoutError(editError)
        })
      }
    }

    // Brand Kit: resolve by explicit ID or fallback to user default
    // Hoisted before enhance + generation so logo is available in both paths
    const brandKitIdParam = imageParams.brandKitId as string | undefined
    let brandKit: Awaited<ReturnType<typeof resolveBrandKit>> = null
    try {
      brandKit = await resolveBrandKit(user.id, brandKitIdParam)
    } catch { /* ignore */ }

    // =============================================
    // MAGIC WAND ENHANCE MODE (Gemini only)
    // Sends existing image + creative-director mega-prompt → upgraded design
    // =============================================
    if (action === 'enhance') {
      // Check usage limit (enhance costs 0.5 image credit)
      const enhanceUsage = await checkUsageLimit(user.id, 'enhance')
      if (!enhanceUsage.allowed) {
        return res.status(403).json({ error: 'Image limit reached. Upgrade your plan for more.' })
      }

      const geminiApiKey = process.env.GEMINI_API_KEY
      if (!geminiApiKey) {
        return res.status(500).json({ error: 'Gemini API key not configured' })
      }

      const enhanceImage = imageParams.enhanceImage || ''
      if (!enhanceImage) {
        return res.status(400).json({ error: 'enhanceImage is required for enhance action' })
      }

      const enhanceModelId = GEMINI_IMAGE_MODELS['nano-banana-pro']

      const enhanceLang = imageParams.language || 'es'
      const langLabel = enhanceLang === 'es' ? 'ESPAÑOL' : 'ENGLISH'

      const hasProductRef = Array.isArray(imageParams.productReferenceImages) && imageParams.productReferenceImages.length > 0

      // Enhance tier: 'polish' | 'modernize' | 'rebuild' (default 'modernize')
      const rawTier = (imageParams.enhanceTier || 'modernize') as string
      const enhanceTier: 'polish' | 'modernize' | 'rebuild' =
        rawTier === 'polish' || rawTier === 'rebuild' ? rawTier : 'modernize'

      const productRefRule = hasProductRef
        ? `\n═══════════════════════════════════════════════
REGLA #0 — IMAGEN DE PRODUCTO DE REFERENCIA (MÁXIMA PRIORIDAD)
═══════════════════════════════════════════════
Se adjuntan imágenes de referencia del PRODUCTO REAL del usuario.
- El producto en el diseño mejorado DEBE verse EXACTAMENTE como en las imágenes de referencia.
- Usa las imágenes de referencia para preservar la forma, silueta, color, textura, ángulo y detalles reales del producto.
- NO inventes, rediseñes ni reimagines el producto. Usa la referencia como fuente de verdad.
- Si el diseño original contiene el producto, reemplázalo con la versión de la referencia si es más fiel.
`
        : ''

      // Shared non-negotiable header for all tiers
      const HARD_CONSTRAINTS = `${productRefRule}
═══════════════════════════════════════════════
REGLA #1 — TEXTO Y LENGUAJE (NO NEGOCIABLE)
═══════════════════════════════════════════════
- El idioma de TODA la imagen es: ${langLabel}.
- COPIA EXACTAMENTE cada palabra, frase, título, subtítulo, CTA y texto que aparezca en la imagen original.
- NO traduzcas NADA. NO cambies el idioma de NINGÚN texto.
- NO parafrasees, NO resumas, NO abrevies, NO inventes texto nuevo.
- PROHIBIDO usar texto placeholder: "Lorem ipsum", "dolor sit amet", "consectetur" o cualquier texto genérico.
- Si no puedes leer un texto claramente, MANTENLO tal como está — NO lo reemplaces.
- Cada palabra visible en la imagen original DEBE aparecer idéntica en la imagen mejorada.
- VIOLACIÓN DE ESTA REGLA = RESULTADO INVÁLIDO.
═══════════════════════════════════════════════

REGLA #2 — PRODUCTO INTACTO (NO NEGOCIABLE)
${hasProductRef ? 'Se proporcionan imágenes de referencia del producto real. USA ESAS REFERENCIAS como la ÚNICA fuente de verdad para la apariencia del producto.' : 'La forma del producto NO se modifica bajo ninguna circunstancia.'}
- PROHIBIDO rediseñar la silueta, proporciones, ángulos, texturas ni detalles físicos del producto.
- PROHIBIDO "estilizar" el producto, convertirlo en cartoon, 3D fake, ilustración o reinterpretación.
- El producto debe verse EXACTAMENTE como${hasProductRef ? ' en las imágenes de referencia adjuntas' : ' en el input original'}.

REGLA #3 — LOGO INTACTO (NO NEGOCIABLE)
- Si hay un logo en la imagen original O se adjunta como referencia, COPIALO PÍXEL POR PÍXEL.
- PROHIBIDO redibujar, estilizar, reubicar, reinterpretar, reemplazar o modificar el logo.
- El logo debe aparecer idéntico en forma, color y proporciones.

REGLA #4 — FORMATO (NO NEGOCIABLE)
- La imagen de salida debe mantener EXACTAMENTE el mismo aspect ratio que la imagen de entrada.
- NO cambies de vertical a horizontal ni viceversa.
═══════════════════════════════════════════════
`

      // Tier-specific creative direction
      const POLISH_BODY = `
MODO: POLISH (pulido quirúrgico — cambio mínimo, máxima fidelidad).

Tu tarea NO es rediseñar. Es PULIR ejecución conservando el diseño original al 100%.

PERMITIDO (y esperado):
- Refinar tipografía (kerning, tracking, jerarquía sutil, eliminar rarezas).
- Mejorar espaciado y alineación (grillas más limpias, márgenes consistentes).
- Ajustar contraste, balance de color, saturación, luminosidad (mantener paleta original).
- Limpiar fondo (eliminar artefactos, ruido, suciedad de IA).
- Mejorar iluminación y sombras sutiles del producto (manteniendo su apariencia).
- Corregir imperfecciones de renderizado (bordes sucios, halos, compresión).

PROHIBIDO:
- Cambiar composición, layout, jerarquía o distribución de elementos.
- Mover, redimensionar o reorganizar elementos.
- Agregar, eliminar o reemplazar elementos.
- Cambiar la dirección de arte, el mood o el concepto.
- Cambiar familias tipográficas (solo refinar las existentes).
- Cambiar la paleta de colores (solo ajustar balance).
- Reinterpretar el producto, el logo o las imágenes.

OBJETIVO: El usuario debe poder comparar antes/después y decir "es el mismo diseño, pero mejor ejecutado".
`

      const MODERNIZE_BODY = `
MODO: MODERNIZE (actualización significativa conservando identidad).

Tu tarea es llevar el diseño a un nivel de ejecución actual, preservando su concepto, mensaje y elementos clave.

PERMITIDO:
- Refinar composición sin alterar la jerarquía principal (ajustes de balance, ritmo, respiración).
- Actualizar tipografía (cambiar una familia si la actual es genérica/dated; máximo 2 familias total).
- Mejorar jerarquía visual y punto focal.
- Ajustar paleta para mayor carácter (mismo mood, mejor ejecución).
- Mejorar tratamiento de fondo, sombras, iluminación.
- Refinar tratamiento de texto (peso, tracking, escala).
- Modernizar estilos dated (degradados genéricos, biseles, efectos 2010).

PROHIBIDO:
- Cambiar el concepto, el mensaje o la intención del diseño.
- Eliminar elementos clave (producto, CTA, título principal, logo).
- Redibujar o reinterpretar el producto o el logo.
- Cambiar el texto (cada palabra se copia idéntica).
- Cambiar el aspect ratio.
- "Canva vibes" — todo debe sentirse intencional.

OBJETIVO: El resultado debe sentirse "fresco pero familiar" — el mismo diseño, traducido al lenguaje de diseño actual.
`

      const REBUILD_BODY = `
MODO: REBUILD (reinterpretación creativa agresiva).

ACTÚA COMO: Director Creativo + Director de Arte Senior de marcas globales (Apple / Aesop / Jacquemus / Nike Campaign Level).

Vas a REINTERPRETAR el diseño. Llevalo a una versión más inteligente, más conceptual, con mayor impacto creativo.

PERMITIDO (con los límites de las reglas #1-4 arriba):
- Cambiar composición, estructura visual, jerarquía, distribución de elementos.
- Cambiar dirección de arte, mood, narrativa visual.
- Eliminar elementos decorativos que no aporten.
- Convertir bullets en bloques visuales; usar texto como elemento gráfico.
- Romper la cuadrícula con intención; crear tensión entre bloques.
- Simplificar a monocromático o usar contraste dramático.
- Explorar tipografía (serif moderna, sans ultra bold, condensed, tracking intencional).

PROHIBIDO (sin excepción):
- Cambiar, traducir, parafrasear o reescribir CUALQUIER texto (Regla #1).
- Rediseñar, estilizar o reinterpretar el producto (Regla #2).
- Modificar el logo en forma, color o estilo (Regla #3).
- Cambiar el aspect ratio (Regla #4).

ENFOQUE:
1) Analizá qué quiere comunicar la pieza (aspiracional / técnico / emocional / agresivo).
2) Elegí UNA dirección creativa clara (editorial de lujo / minimalismo brutalista / high-fashion / tech futurista / conceptual con espacio negativo / asimétrica dinámica / tipográfica dominante / cinematográfica).
3) El diseño debe sentirse intencional. Nada centrado por default. Nada "Canva vibes".

OBJETIVO: Una campaña real de marca grande. Algo que alguien guardaría en Pinterest o en Behance.
`

      const TIER_BODY = enhanceTier === 'polish' ? POLISH_BODY : enhanceTier === 'rebuild' ? REBUILD_BODY : MODERNIZE_BODY

      const ENHANCE_SYSTEM_PROMPT = `${HARD_CONSTRAINTS}
${TIER_BODY}

GENERA LA IMAGEN MEJORADA. NO generes texto descriptivo ni justificación. Devuelve SOLO la imagen resultante.`

      try {
        const ai = new GoogleGenAI({ apiKey: geminiApiKey })

        const base64Match = enhanceImage.match(/^data:([^;]+);base64,(.+)$/)
        if (!base64Match) {
          return res.status(400).json({ error: 'Invalid image format — expected base64 data URL' })
        }

        type PromptPart = { text: string } | { inlineData: { mimeType: string; data: string } }
        const promptParts: PromptPart[] = [
          { text: ENHANCE_SYSTEM_PROMPT }
        ]

        // PRODUCT REFERENCE IMAGES FIRST — Gemini must see product truth BEFORE the design
        // IMPORTANT: interleave a labeled text part BEFORE each image so Gemini treats them as
        // distinct references instead of anchoring on the first one.
        let productRefCount = 0
        if (hasProductRef) {
          // Pre-parse valid refs so we know the real count for labels
          const parsedRefs: { mimeType: string; data: string }[] = []
          for (const refImg of imageParams.productReferenceImages!.slice(0, 4)) {
            const refMatch = refImg.match(/^data:([^;]+);base64,(.+)$/)
            if (refMatch) parsedRefs.push({ mimeType: refMatch[1], data: refMatch[2] })
          }
          const total = parsedRefs.length
          if (total > 0) {
            promptParts.push({ text: `PRODUCT/OFFER VISUAL REFERENCES (${total}) - USE BY ROLE, DO NOT AMALGAMATE\n${total > 1 ? `These ${total} images are real references related to the user's product or offer. They may show different roles: hero product, packaging, variant, result/proof, detail, ingredient, texture, lifestyle, or style context. You MUST inspect every image, but you MUST NOT fuse unrelated images into one hybrid object.` : 'This is a real visual reference for the user product/offer.'}\n\nPreserve the real product/package when a reference shows it. Use result/proof/detail/context images only as supporting evidence, inset, mood, or art-direction cues. Do not invent another product.` })
            parsedRefs.forEach((ref, idx) => {
              const label = total > 1
                ? `REFERENCE ${idx + 1} of ${total}: analyze independently and assign a role (hero product, variant, proof/result, detail, context, or style). Use it only in that role.`
                : 'PRODUCT/OFFER REFERENCE'
              promptParts.push({ text: label })
              promptParts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } })
              productRefCount++
            })
          }
          console.log(`Enhance: ${productRefCount} product reference images injected BEFORE enhance image`)
        }

        // Brand Kit: inject logo so it is preserved/reinforced during enhancement
        if (brandKit && brandKit.logo_url) {
          try {
            const logoData = await fetchBrandLogoAsBase64(brandKit)
            if (logoData) {
              promptParts.push({ text: `══ LOGO OFICIAL DE LA MARCA "${brandKit.name}" (NO NEGOCIABLE) ══\nEste es el logo REAL y OFICIAL del usuario. Reglas absolutas:\n1. Si el logo aparece en la imagen original, REEMPLÁZALO con esta versión oficial, COPIÁNDOLA PÍXEL POR PÍXEL.\n2. Si el logo NO aparece en la imagen original, AGRÉGALO en una posición prominente (esquina superior), COPIÁNDOLO PÍXEL POR PÍXEL desde esta referencia.\n3. PROHIBIDO redibujar, estilizar, reinterpretar, rediseñar, recolorear, rotar, deformar o modificar el logo de CUALQUIER forma.\n4. PROHIBIDO cambiar el tipo de letra, la forma, el color, las proporciones o el espaciado del logo.\n5. El logo debe aparecer IDÉNTICO a la referencia adjunta — como si lo hubieras pegado directamente desde la imagen de referencia.` })
              promptParts.push({ inlineData: { mimeType: logoData.mimeType, data: logoData.data } })
              console.log(`Brand logo injected in enhance for "${brandKit.name}"`)
            }
          } catch (logoErr) {
            console.warn('Failed to inject brand logo in enhance:', logoErr)
          }
        }

        // CONTEXT / INSPIRATION images for enhance — mood, audience, scene (not product truth)
        let ctxRefCount = 0
        if (Array.isArray(imageParams.contextReferenceImages) && imageParams.contextReferenceImages.length > 0) {
          const parsedCtx: { mimeType: string; data: string }[] = []
          for (const ctxImg of imageParams.contextReferenceImages.slice(0, 4)) {
            if (typeof ctxImg === 'string') {
              const m = ctxImg.match(/^data:([^;]+);base64,(.+)$/)
              if (m) parsedCtx.push({ mimeType: m[1], data: m[2] })
            }
          }
          if (parsedCtx.length > 0) {
            promptParts.push({ text: `══ ${parsedCtx.length} IMÁGEN${parsedCtx.length > 1 ? 'ES' : ''} DE CONTEXTO / INSPIRACIÓN (NO ES EL PRODUCTO) ══\nEstas imágenes NO son el producto. Son referencia de AMBIENTE, AUDIENCIA, ESCENA, MOOD o ESTILO DE VIDA.\nUSO: inspirarte en el tipo de personas, ambiente, iluminación, emoción o contexto de uso.\nPROHIBIDO copiar el producto de estas imágenes. PROHIBIDO inventar variaciones del producto basándote en ellas. Tratálas como moodboard — extraé el ESPÍRITU, no los objetos físicos.` })
            parsedCtx.forEach((ref, idx) => {
              const label = parsedCtx.length > 1
                ? `── INSPIRACIÓN ${idx + 1} de ${parsedCtx.length} (moodboard — ambiente/audiencia/escena, NO el producto) ──`
                : '── INSPIRACIÓN (moodboard — ambiente/audiencia/escena, NO el producto) ──'
              promptParts.push({ text: label })
              promptParts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } })
              ctxRefCount++
            })
            console.log(`Enhance: ${ctxRefCount} context reference images injected`)
          }
        }

        // NOW add the image to enhance (AFTER product refs + logo + context so model has truth & mood established)
        promptParts.push({ text: '══ IMAGEN A MEJORAR ══\nEsta es la imagen de diseño sobre la que debes aplicar la mejora. Respeta TODAS las reglas no negociables (#1 texto, #2 producto, #3 logo, #4 formato) declaradas arriba, y aplica SOLO los cambios permitidos por el tier seleccionado:' })
        promptParts.push({ inlineData: { mimeType: base64Match[1], data: base64Match[2] } })

        // Closing reinforcement if product refs were provided
        if (productRefCount > 0) {
          promptParts.push({ text: 'FINAL PRODUCT REFERENCE CHECK: Use every provided reference intelligently, by role. If a reference is the sellable product or package, preserve its real shape, color, silhouette, texture, and details. If a reference is a result/proof/detail/context image, use it as supporting evidence, inset, mood, or background cue. Do NOT blend multiple references into a strange single object.' })
        }
        if (ctxRefCount > 0 && productRefCount > 0) {
          promptParts.push({ text: `SEPARACIÓN CLARA: El PRODUCTO se copia EXACTAMENTE de las fotos de referencia del producto. La ESCENA / AUDIENCIA / MOOD se inspira en las ${ctxRefCount} imagen${ctxRefCount > 1 ? 'es' : ''} de contexto. NO mezcles: no inventes productos parecidos a los de las imágenes de contexto.` })
        } else if (ctxRefCount > 0) {
          promptParts.push({ text: 'RECORDATORIO: Las imágenes de contexto son moodboard (ambiente, audiencia, escena). No son el producto.' })
        }

        // Map request aspect ratio to Gemini-compatible string (default 9:16)
        const enhanceAR = imageParams.aspectRatio === '1:1' ? '1:1' : imageParams.aspectRatio === '3:4' ? '3:4' : '9:16'

        // Retry once on transient 503 errors
        let response: Awaited<ReturnType<typeof ai.models.generateContent>>
        try {
          response = await withTimeout(ai.models.generateContent({
            model: enhanceModelId,
            contents: promptParts,
            config: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig: { imageSize: '2K', aspectRatio: enhanceAR }
            }
          }), 'Gemini enhance')
        } catch (firstTry) {
          if (!isTransientGeminiError(firstTry)) throw firstTry
          console.warn('Gemini enhance transient error — retrying once after 2s:', firstTry instanceof Error ? firstTry.message : firstTry)
          await new Promise(r => setTimeout(r, 2000))
          response = await withTimeout(ai.models.generateContent({
            model: enhanceModelId,
            contents: promptParts,
            config: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig: { imageSize: '2K', aspectRatio: enhanceAR }
            }
          }), 'Gemini enhance retry')
        }

        const candidates = response.candidates || []
        const parts = candidates[0]?.content?.parts || []

        let imageUrl: string | null = null
        for (const part of parts) {
          if ('inlineData' in part && part.inlineData?.data) {
            const mimeType = part.inlineData.mimeType || 'image/png'
            imageUrl = `data:${mimeType};base64,${part.inlineData.data}`
            break
          }
        }

        if (!imageUrl) {
          console.error('No image in Gemini enhance response:', JSON.stringify(response, null, 2))
          return res.status(500).json({ error: 'Gemini did not return an enhanced image' })
        }

        await incrementUsage(user.id, 'enhance')

        // Extract token usage from Gemini response
        const enhanceUsage = response.usageMetadata
        const enhanceInputTokens = enhanceUsage?.promptTokenCount || 0
        const enhanceOutputTokens = enhanceUsage?.candidatesTokenCount || 0
        const enhanceThinkingTokens = enhanceUsage?.thoughtsTokenCount || 0

        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'enhance',
          model: 'nano-banana-pro',
          inputTokens: enhanceInputTokens,
          outputTokens: enhanceOutputTokens,
          thinkingTokens: enhanceThinkingTokens,
          success: true,
          metadata: {
            action: 'enhance',
            provider: 'google',
            providerModel: enhanceModelId,
            rawUsage: enhanceUsage,
            imageSize: '2K'
          }
        })

        return res.status(200).json({
          status: 'Ready',
          result: { sample: imageUrl },
          model: 'nano-banana-pro',
          textWarning: false,
          enhanced: true
        })

      } catch (enhanceError) {
        console.error('Gemini enhance error:', enhanceError)

        const errMsg = enhanceError instanceof Error ? enhanceError.message : 'Unknown error'
        const isTransient = isTransientGeminiError(enhanceError)

        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'enhance',
          model: 'nano-banana-pro',
          success: false,
          errorMessage: errMsg,
          metadata: { action: 'enhance', transient: isTransient, provider: 'google', providerModel: enhanceModelId, costSource: 'unavailable' }
        })

        if (isTransient) {
          return res.status(isTimeoutError(enhanceError) ? 504 : 503).json({
            error: 'El servicio de IA está temporalmente saturado. Intenta de nuevo en unos segundos.',
            retryable: true
          })
        }

        return res.status(500).json({
          error: 'Image enhance failed',
          details: errMsg
        })
      }
    }

    // Submit new generation request
    const userPrompt = imageParams.prompt || ''
    const isGeminiModel = selectedModel === 'nano-banana' || selectedModel === 'nano-banana-pro'
    const isPostMode = imageParams.mode === 'post'
    const isProductMode = isPostMode && (imageParams.postStyle || '') === 'product'
    const isLogoMode = isPostMode && (imageParams.postStyle || '') === 'logo'
    
    let enhancedPrompt: string

    // Detect whether product reference images are provided
    const productReferenceCount = ['input_image', 'input_image_2', 'input_image_3', 'input_image_4']
      .filter(k => typeof imageParams[k] === 'string' && imageParams[k].length > 0).length
    const hasProductImages = productReferenceCount > 0
    const postLanguage: string = imageParams.language || 'es'
    const postTextDensity = normalizePostTextDensity(imageParams.textDensity)

    if (isPostMode) {
      // POST MODE: Use the appropriate master prompt based on postStyle
      // Determine aspect ratio from request (default 9:16 for backward compat)
      const postAspectRatio: PostAspectRatio = imageParams.aspectRatio === '3:4' ? '3:4' : '9:16'
      const postStyle: string = imageParams.postStyle || 'venta-directa'

      if (isLogoMode) {
        // Force 1:1 for logos regardless of incoming aspectRatio
        imageParams.width = 1024
        imageParams.height = 1024
      } else if (imageParams.aspectRatio === '1:1' && isProductMode) {
        imageParams.width = 1080
        imageParams.height = 1080
      } else if (postAspectRatio === '9:16') {
        imageParams.width = 1080
        imageParams.height = 1920
      } else {
        imageParams.width = 1080
        imageParams.height = 1440
      }

      // Explicit aspect ratio enforcement prefix
      const arLabel = postAspectRatio === '9:16' ? '9:16 vertical (1080×1920)' : '3:4 vertical (1080×1440)'
      const aspectRatioPrefix = `FORMATO OBLIGATORIO: La imagen DEBE ser exactamente ${arLabel}. No uses otro aspect ratio.\n\n`
      const productReferenceStrategyPrefix = buildProductReferenceStrategyPrefix(postLanguage, productReferenceCount, isProductMode)

      // Resolve color palette override (if any)
      // Priority: custom colors > predefined palette > brand kit colors > none
      const textDensityPrefix = buildPostTextDensityPrefix(postLanguage, postTextDensity)
      let colorPrefix = ''
      if (imageParams.customColors && Array.isArray(imageParams.customColors) && imageParams.customColors.length > 0) {
        // Custom user-defined palette: array of hex strings
        const hexList = (imageParams.customColors as string[]).slice(0, 3).join(', ')
        colorPrefix = `IMPORTANTE: USA SOLO ESTOS COLORES: ${hexList}. Ignora cualquier otro color mencionado en las instrucciones siguientes.\n\n`
      } else if (imageParams.colorPaletteId) {
        const colorPalette = findColorPaletteById(imageParams.colorPaletteId as string)
        if (colorPalette && colorPalette.promptEs) {
          colorPrefix = 'IMPORTANTE: ' + colorPalette.promptEs + ' Ignora cualquier otro color mencionado en las instrucciones siguientes.\n\n'
        }
      }

      // Brand Kit: auto-inject brand colors when no explicit palette is selected
      if (!colorPrefix && brandKit) {
        const bkColorOverride = buildBrandColorOverride(brandKit)
        if (bkColorOverride) {
          colorPrefix = 'IMPORTANTE: ' + bkColorOverride + '\n\n'
        }
      }

      // Brand Kit: inject visual style (fonts, AI-extracted style notes)
      let brandVisualPrefix = ''
      if (brandKit) {
        const bvp = buildBrandVisualPrompt(brandKit)
        if (bvp) brandVisualPrefix = bvp + '\n\n'
      }

      // Brand Kit: inject logo prompt for image generation
      let brandLogoPrefix = ''
      if (brandKit) {
        const blp = buildBrandLogoPrompt(brandKit)
        if (blp) brandLogoPrefix = blp + '\n\n'
      }

      // Language enforcement prefix for preset mode (presets lack built-in language rules)
      const langLabel = postLanguage === 'es' ? 'ESPAÑOL' : 'ENGLISH'
      const presetLangPrefix = `REGLA DE IDIOMA (NO NEGOCIABLE): TODOS los textos visibles en la imagen DEBEN estar en ${langLabel}. COPIA el texto del guión TAL CUAL — NO traduzcas, NO cambies el idioma. PROHIBIDO mezclar idiomas.\n\n`
      const presetProductPrefix = hasProductImages
        ? 'REGLA DE PRODUCTO (NO NEGOCIABLE): Se adjuntan fotos del PRODUCTO REAL del usuario. El producto DEBE verse EXACTAMENTE como en las fotos de referencia. NO inventes ni reimagines el producto. Usa las referencias como fuente de verdad.\n\n'
        : ''

      // Load structured visual style memory from hybrid AI memory system
      // When explicit colors are active (brand kit or palette), exclude color/visual memories
      // to prevent learned color preferences from overriding the user's explicit choice
      const hasExplicitColors = !!colorPrefix
      let visualMemoryPrefix = ''
      try {
        const visualMemory = await getMemoryInjection(
          user.id,
          imageParams.productId as string || null,
          (postLanguage as 'es' | 'en') || 'es',
          {
            types: ['visual_style', 'preference', 'anti_pattern'],
            excludeCategories: hasExplicitColors ? ['color', 'visual'] : undefined,
            limit: 10
          }
        )
        if (visualMemory) {
          visualMemoryPrefix = visualMemory + '\n\n'
        }
      } catch { /* ignore */ }

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (isLogoMode) {
        // LOGO GENERATOR MODE: premium brand identity design with archetypes
        const VALID_ARCHETYPES = ['wordmark', 'lettermark', 'pictorial', 'abstract', 'emblem', 'auto']
        const VALID_TIERS = ['refine', 'modernize', 'rebuild']
        const VALID_BGS = ['transparent', 'white', 'dark']
        const logoMode = imageParams.logoMode === 'enhance' ? 'enhance' : 'generate'
        const rawArch = (imageParams.logoArchetype as string) || 'auto'
        const archetype = (VALID_ARCHETYPES.includes(rawArch) ? rawArch : 'auto') as LogoArchetype
        const rawTier = (imageParams.logoEnhanceTier as string) || 'modernize'
        const enhanceTier = (VALID_TIERS.includes(rawTier) ? rawTier : 'modernize') as LogoEnhanceTier
        const rawBg = (imageParams.logoBackground as string) || 'transparent'
        const background = (VALID_BGS.includes(rawBg) ? rawBg : 'transparent') as LogoBackground

        // Resolve business name: explicit param > brand kit > product name
        let resolvedBusinessName = typeof imageParams.logoBusinessName === 'string' && imageParams.logoBusinessName.trim()
          ? imageParams.logoBusinessName.trim()
          : (brandKit?.name || '')
        let resolvedIndustry = typeof imageParams.logoIndustry === 'string' && imageParams.logoIndustry.trim()
          ? imageParams.logoIndustry.trim()
          : (brandKit?.industry || '')
        let resolvedDescription: string | undefined
        let resolvedBrandValues: string | undefined = brandKit?.tone_keywords?.join(', ')
        let resolvedTargetAudience: string | undefined = brandKit?.target_audience || undefined

        // Pull from product if we still need context
        if (imageParams.productId && imgMemSupabase && (!resolvedBusinessName || !resolvedIndustry || !resolvedDescription)) {
          try {
            const { data: prod } = await imgMemSupabase
              .from('products')
              .select('name, type, product_category, product_category_custom, product_description, description, target_audience, svc_service_type, svc_service_type_custom')
              .eq('id', imageParams.productId)
              .single()
            if (prod) {
              if (!resolvedBusinessName) resolvedBusinessName = prod.name || ''
              if (!resolvedIndustry) {
                resolvedIndustry = prod.product_category_custom || prod.product_category || prod.svc_service_type_custom || prod.svc_service_type || prod.type || ''
              }
              resolvedDescription = prod.product_description || prod.description || undefined
              if (!resolvedTargetAudience) resolvedTargetAudience = prod.target_audience || undefined
            }
          } catch { /* ignore */ }
        }

        const isEnhance = logoMode === 'enhance'
        if (isEnhance && !hasProductImages) {
          return res.status(400).json({
            error: postLanguage === 'es'
              ? 'Se requiere subir una imagen del logo existente para usar el modo Mejorar.'
              : 'You must upload the existing logo image to use Enhance mode.'
          })
        }

        const logoPrompt = buildLogoPrompt({
          mode: logoMode as 'generate' | 'enhance',
          businessName: resolvedBusinessName,
          industry: resolvedIndustry || undefined,
          description: resolvedDescription,
          brandValues: resolvedBrandValues,
          targetAudience: resolvedTargetAudience,
          archetype,
          stylePreference: typeof imageParams.logoStyle === 'string' ? imageParams.logoStyle : undefined,
          colorPreferences: typeof imageParams.logoColorPreferences === 'string' ? imageParams.logoColorPreferences : undefined,
          avoid: typeof imageParams.logoAvoid === 'string' ? imageParams.logoAvoid : undefined,
          background,
          enhanceTier,
          userKeeps: typeof imageParams.logoUserKeeps === 'string' ? imageParams.logoUserKeeps : undefined,
          userChanges: typeof imageParams.logoUserChanges === 'string' ? imageParams.logoUserChanges : undefined,
          language: postLanguage
        })

        // Force 1:1 formatting prefix (overrides the aspectRatioPrefix built earlier)
        const logoFormatPrefix = `FORMATO OBLIGATORIO: La imagen DEBE ser exactamente 1:1 cuadrada (1024×1024 o mayor). No uses otro aspect ratio.\n\n`
        // Logos: respect user colors if provided; ignore brand kit visual style/logo injection (we're DESIGNING a logo, not placing an existing one)
        // Also skip visual memory (learned post styles don't apply to logo design)
        // Skip tail user prompt concatenation — buildLogoPrompt is self-contained.
        const userExtra = userPrompt.trim() ? `\n\nINSTRUCCIONES ADICIONALES DEL USUARIO:\n${userPrompt.trim()}\n` : ''
        enhancedPrompt = logoFormatPrefix + colorPrefix + logoPrompt + userExtra
      } else if (isProductMode) {
        // PRODUCT PHOTOGRAPHY MODE: high-quality product images without text overlays
        if (!hasProductImages) {
          return res.status(400).json({ error: postLanguage === 'es' ? 'Se requiere al menos una imagen del producto para el modo Producto.' : 'At least one product image is required for Product mode.' })
        }
        const VALID_SUB_STYLES = ['studio-hero', 'lifestyle', 'background-swap', 'pure-enhance', 'splash-action', 'podium']
        const rawSubStyle = (imageParams.productSubStyle as string) || 'studio-hero'
        const productSubStyle = VALID_SUB_STYLES.includes(rawSubStyle) ? rawSubStyle : 'studio-hero'
        const productAR = imageParams.aspectRatio === '1:1' ? '1:1' : postAspectRatio
        const bgDesc = typeof imageParams.backgroundDescription === 'string'
          ? imageParams.backgroundDescription.slice(0, 500)
          : undefined

        // Load product context + detect niche so the prompt adapts to the actual product
        let productContext: {
          name?: string
          category?: string
          description?: string
          targetAudience?: string
          niche?: 'physical' | 'food' | 'service' | 'fashion' | 'digital'
        } = {}
        if (imageParams.productId && imgMemSupabase) {
          try {
            const { data: prod } = await imgMemSupabase
              .from('products')
              .select('name, type, product_category, product_category_custom, product_description, description, target_audience, svc_service_type, svc_service_type_custom')
              .eq('id', imageParams.productId)
              .single()
            if (prod) {
              productContext = {
                name: prod.name || undefined,
                category: prod.product_category_custom || prod.product_category || prod.svc_service_type_custom || prod.svc_service_type || prod.type || undefined,
                description: prod.product_description || prod.description || undefined,
                targetAudience: prod.target_audience || undefined,
                niche: detectProductNiche(prod),
              }
            }
          } catch { /* fallback: no context */ }
        }

        // Force 1:1 format prefix (supersedes aspectRatioPrefix) or fall back to the standard prefix
        const productFormatPrefix = imageParams.aspectRatio === '1:1'
          ? `FORMATO OBLIGATORIO: La imagen DEBE ser exactamente 1:1 cuadrado (1080×1080). No uses otro aspect ratio.\n\n`
          : aspectRatioPrefix

        // Filter out the generic frontend fallback string so it doesn't become "user instructions"
        const rawUserPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : ''
        const PRODUCT_FALLBACK_PROMPTS = new Set(['Professional product photograph', 'professional product photograph'])
        const userInstr = PRODUCT_FALLBACK_PROMPTS.has(rawUserPrompt) ? '' : rawUserPrompt
        const productOpts = { backgroundDescription: bgDesc, productContext, userInstructions: userInstr }

        const productPrompt = buildProductPrompt(productSubStyle, productAR, postLanguage, productOpts)
          || buildProductPrompt('studio-hero', productAR, postLanguage, productOpts)!

        enhancedPrompt = productFormatPrefix + productReferenceStrategyPrefix + colorPrefix + visualMemoryPrefix + brandVisualPrefix + brandLogoPrefix + productPrompt
      } else if (postStyle === 'custom-type' && imageParams.customPostTypeId && imgMemSupabase && UUID_RE.test(imageParams.customPostTypeId as string)) {
        // CUSTOM POST TYPE MODE: load master prompt from DB
        try {
          const { data: customType } = await imgMemSupabase
            .from('custom_post_types')
            .select('master_prompt_es, master_prompt_en')
            .eq('id', imageParams.customPostTypeId)
            .eq('user_id', user.id)
            .single()

          if (customType) {
            const customMasterPrompt = postLanguage === 'es' ? customType.master_prompt_es : customType.master_prompt_en
            enhancedPrompt = presetLangPrefix + presetProductPrefix + aspectRatioPrefix + productReferenceStrategyPrefix + textDensityPrefix + colorPrefix + visualMemoryPrefix + brandVisualPrefix + brandLogoPrefix + customMasterPrompt + '\n\nProducto/servicio del usuario:\n' + userPrompt
          } else {
            // Fallback to venta directa if custom type not found
            enhancedPrompt = aspectRatioPrefix + productReferenceStrategyPrefix + textDensityPrefix + colorPrefix + visualMemoryPrefix + brandVisualPrefix + brandLogoPrefix + buildPostPrompt(postAspectRatio, postLanguage, hasProductImages) + userPrompt
          }
        } catch {
          enhancedPrompt = aspectRatioPrefix + productReferenceStrategyPrefix + textDensityPrefix + colorPrefix + visualMemoryPrefix + brandVisualPrefix + brandLogoPrefix + buildPostPrompt(postAspectRatio, postLanguage, hasProductImages) + userPrompt
        }
      } else if (postStyle === 'anuncio-conversion') {
        // ANUNCIO DE CONVERSIÓN MODE: high-conversion Instagram ad with niche-adaptive prompt
        let niche: 'physical' | 'food' | 'service' | 'fashion' | 'digital' = 'physical'
        if (imageParams.productId && imgMemSupabase) {
          try {
            const { data: prod } = await imgMemSupabase
              .from('products')
              .select('type, product_category, product_category_custom, product_description, svc_service_type')
              .eq('id', imageParams.productId)
              .single()
            if (prod) niche = detectProductNiche(prod)
          } catch { /* fallback to physical */ }
        }
        const anuncioAR: PostAspectRatio = imageParams.aspectRatio === '1:1' ? '3:4' : postAspectRatio
        if (imageParams.aspectRatio === '1:1') {
          imageParams.width = 1080
          imageParams.height = 1080
        }
        const anuncioFormatPrefix = imageParams.aspectRatio === '1:1'
          ? `FORMATO OBLIGATORIO: La imagen DEBE ser exactamente 1:1 cuadrado (1080×1080). No uses otro aspect ratio.\n\n`
          : aspectRatioPrefix
        const anuncioPrompt = buildAnuncioPrompt(anuncioAR, postLanguage, hasProductImages, niche)
        enhancedPrompt = anuncioFormatPrefix + productReferenceStrategyPrefix + textDensityPrefix + colorPrefix + visualMemoryPrefix + brandVisualPrefix + brandLogoPrefix + anuncioPrompt + userPrompt
      } else if (postStyle === 'preset' && imageParams.presetId) {
        // PRESET MODE: uses buildPresetPrompt (same assembly pattern as Venta Directa — language/product rules built into the prompt)
        const presetPrompt = buildPresetPrompt(imageParams.presetId as string, postAspectRatio, postLanguage, hasProductImages)
        if (presetPrompt) {
          enhancedPrompt = aspectRatioPrefix + productReferenceStrategyPrefix + textDensityPrefix + colorPrefix + visualMemoryPrefix + brandVisualPrefix + brandLogoPrefix + presetPrompt + userPrompt
        } else {
          enhancedPrompt = aspectRatioPrefix + productReferenceStrategyPrefix + textDensityPrefix + colorPrefix + visualMemoryPrefix + brandVisualPrefix + brandLogoPrefix + buildPostPrompt(postAspectRatio, postLanguage, hasProductImages) + userPrompt
        }
      } else if (postStyle === 'organic-single' && imageParams.organicSubtype) {
        // ORGANIC SINGLE IMAGE MODE — top-of-funnel aesthetic post (quote, infographic, showcase, aesthetic).
        // Supports 1:1 natively (most common for organic on IG feed). Honors brand_voice for style direction.
        const organicSubtypeRaw = (imageParams.organicSubtype as string) || ''
        const VALID_ORGANIC_SINGLE: OrganicSingleSubtype[] = ['quote-motivational', 'infographic', 'product-showcase-organic', 'aesthetic-brand']
        const organicSubtype: OrganicSingleSubtype = (VALID_ORGANIC_SINGLE as string[]).includes(organicSubtypeRaw)
          ? (organicSubtypeRaw as OrganicSingleSubtype)
          : 'aesthetic-brand'
        // Resolve aspect ratio: allow 1:1 for organic posts even though PostAspectRatio doesn't include it natively.
        const rawAR = imageParams.aspectRatio as string | undefined
        const organicAR: OrganicAspectRatio = rawAR === '1:1' ? '1:1' : rawAR === '4:5' ? '4:5' : rawAR === '3:4' ? '3:4' : '9:16'
        // Reset width/height if 1:1 was requested (earlier block only branches 1:1 on product mode).
        if (rawAR === '1:1') { imageParams.width = 1080; imageParams.height = 1080 }
        else if (rawAR === '4:5') { imageParams.width = 1080; imageParams.height = 1350 }

        const organicCTA: CTAStrength = ((): CTAStrength => {
          const raw = (imageParams.ctaStrength as string | undefined) || 'soft'
          return (['none', 'soft', 'brand_mention', 'sales'] as CTAStrength[]).includes(raw as CTAStrength)
            ? (raw as CTAStrength) : 'soft'
        })()

        const organicPrompt = buildOrganicSinglePrompt({
          subtype: organicSubtype,
          aspectRatio: organicAR,
          language: postLanguage === 'en' ? 'en' : 'es',
          hasProductImages,
          brandVoice: brandKit?.brand_voice ?? null,
          ctaStrength: organicCTA,
          content: {
            headline: typeof imageParams.organicHeadline === 'string' ? imageParams.organicHeadline : undefined,
            body: typeof imageParams.organicBody === 'string' ? imageParams.organicBody : undefined,
            quote: typeof imageParams.organicQuote === 'string' ? imageParams.organicQuote : undefined,
            attribution: typeof imageParams.organicAttribution === 'string' ? imageParams.organicAttribution : undefined,
          },
          scriptContext: typeof imageParams.scriptContext === 'string' ? imageParams.scriptContext : undefined,
        })

        // Organic builds its own language / aspect-ratio rules internally; skip the sales aspectRatioPrefix.
        enhancedPrompt = productReferenceStrategyPrefix + textDensityPrefix + colorPrefix + visualMemoryPrefix + brandVisualPrefix + brandLogoPrefix + organicPrompt + userPrompt
      } else {
        // VENTA DIRECTA (default)
        enhancedPrompt = aspectRatioPrefix + productReferenceStrategyPrefix + textDensityPrefix + colorPrefix + visualMemoryPrefix + brandVisualPrefix + brandLogoPrefix + buildPostPrompt(postAspectRatio, postLanguage, hasProductImages) + userPrompt
      }
    } else {
      // GENERIC IMAGE MODE: Use Gemini prefix (all models now support text)
      enhancedPrompt = GEMINI_PROMPT_PREFIX + userPrompt
    }

    // =============================================
    // OPENAI GPT IMAGE GENERATION (admin only)
    // =============================================
    if (selectedModel === 'gpt-image-2') {
      const openAiApiKey = process.env.OPENAI_API_KEY
      if (!openAiApiKey) {
        return res.status(500).json({ error: 'OpenAI API key not configured' })
      }

      const providerModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2'
      const references: InlineImageRef[] = []

      if (brandKit && brandKit.logo_url && isPostMode && !isProductMode && !isLogoMode) {
        try {
          const logoData = await fetchBrandLogoAsBase64(brandKit)
          if (logoData) {
            references.push({
              label: `Official brand logo for "${brandKit.name}". Copy exactly if a logo is needed; do not redraw or restyle it.`,
              mimeType: logoData.mimeType,
              data: logoData.data
            })
          }
        } catch (logoErr) {
          console.warn('Failed to inject brand logo for OpenAI image generation:', logoErr)
        }
      }

      const inputImageKeys = ['input_image', 'input_image_2', 'input_image_3', 'input_image_4']
      inputImageKeys.forEach((key, idx) => {
        const ref = parseDataUrlImage(
          imageParams[key],
          isLogoMode
            ? `Existing user logo image ${idx + 1}. Use only as logo source material for the requested logo task.`
            : `Product/offer reference ${idx + 1}. Classify independently as hero product, variant, proof/result, detail, or context and use only in that role.`
        )
        if (ref) references.push(ref)
      })

      if (Array.isArray(imageParams.contextImages) && isPostMode && !isLogoMode) {
        imageParams.contextImages.slice(0, 4).forEach((ctxImg: unknown, idx: number) => {
          const ref = parseDataUrlImage(
            ctxImg,
            `Context/inspiration image ${idx + 1}. Use for audience, scene, mood, lighting, or lifestyle only; do not copy product objects from it.`
          )
          if (ref) references.push(ref)
        })
      }

      const imageSize = getOpenAIImageSize(imageParams.width || 1080, imageParams.height || 1080)
      const prompt = buildOpenAIReferencePrompt(enhancedPrompt, references)
      const hasReferences = references.length > 0
      const requestBody: Record<string, unknown> = {
        model: providerModel,
        prompt,
        n: 1,
        size: imageSize,
        quality: 'medium',
        output_format: 'png'
      }
      if (hasReferences) {
        requestBody.images = references.slice(0, 16).map(ref => ({ image_url: dataUrlFromInline(ref) }))
      }

      try {
        const response = await withTimeout(fetch(hasReferences ? OPENAI_IMAGES_EDITS_URL : OPENAI_IMAGES_GENERATIONS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openAiApiKey}`
          },
          body: JSON.stringify(requestBody)
        }), 'OpenAI image generation')

        const responseText = await response.text()
        let result: Record<string, unknown>
        try {
          result = JSON.parse(responseText) as Record<string, unknown>
        } catch {
          result = { raw: responseText }
        }

        if (!response.ok) {
          const errorMessage = typeof result.error === 'object' && result.error && 'message' in result.error
            ? String((result.error as { message?: unknown }).message)
            : responseText

          await logApiUsage({
            userId: user.id,
            userEmail: user.email,
            feature: isLogoMode ? 'logo' : 'image',
            model: selectedModel,
            generationId,
            success: false,
            errorMessage,
            metadata: {
              provider: 'openai',
              providerModel,
              endpoint: hasReferences ? 'images.edits' : 'images.generations',
              referenceCount: references.length,
              size: imageSize,
              quality: 'medium',
              costSource: 'unavailable'
            }
          })

          return res.status(response.status).json({
            error: 'OpenAI image generation failed',
            details: errorMessage
          })
        }

        const firstData = Array.isArray(result.data) ? result.data[0] as Record<string, unknown> | undefined : undefined
        const b64Data = typeof firstData?.b64_json === 'string'
          ? firstData.b64_json
          : typeof result.b64_json === 'string'
            ? result.b64_json
            : null
        const hostedUrl = typeof firstData?.url === 'string' ? firstData.url : null

        if (!b64Data && !hostedUrl) {
          throw new Error('No image data in OpenAI response')
        }

        const imageUrl = b64Data ? `data:image/png;base64,${b64Data}` : hostedUrl!
        const openAIUsage = extractOpenAIUsage(result)
        const inputTokens = openAIUsage?.input_tokens || 0
        const outputTokens = openAIUsage?.output_tokens || 0
        const costOverrideUsd = calculateOpenAIImageCost(openAIUsage)

        await incrementUsage(user.id, 'image')
        await deductBonusImage(user.id)

        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: isLogoMode ? 'logo' : 'image',
          model: selectedModel,
          inputTokens,
          outputTokens,
          generationId,
          costOverrideUsd,
          costSource: costOverrideUsd === undefined ? 'unavailable' : 'provider_usage',
          success: true,
          metadata: {
            provider: 'openai',
            providerModel,
            endpoint: hasReferences ? 'images.edits' : 'images.generations',
            rawUsage: openAIUsage,
            textInputTokens: openAIUsage?.input_tokens_details?.text_tokens || 0,
            imageInputTokens: openAIUsage?.input_tokens_details?.image_tokens || 0,
            imageOutputTokens: outputTokens,
            width: imageParams.width,
            height: imageParams.height,
            size: imageSize,
            quality: 'medium',
            referenceCount: references.length,
            brandKitId: brandKit?.id,
            brandKitName: brandKit?.name,
            ...(isLogoMode ? { logoMode: imageParams.logoMode, archetype: imageParams.logoArchetype } : {})
          }
        })

        return res.status(200).json({
          status: 'Ready',
          result: { sample: imageUrl },
          model: selectedModel,
          providerModel,
          generationId,
          textWarning: false
        })
      } catch (openAIError) {
        console.error('OpenAI image generation error:', openAIError)

        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: isLogoMode ? 'logo' : 'image',
          model: selectedModel,
          generationId,
          success: false,
          errorMessage: openAIError instanceof Error ? openAIError.message : 'Unknown error',
          metadata: {
            provider: 'openai',
            providerModel,
            referenceCount: references.length,
            size: imageSize,
            quality: 'medium',
            costSource: 'unavailable'
          }
        })

        return res.status(isTimeoutError(openAIError) ? 504 : 500).json({
          error: isTimeoutError(openAIError) ? 'OpenAI image generation timed out' : 'OpenAI image generation failed',
          details: openAIError instanceof Error ? openAIError.message : 'Unknown error',
          retryable: isTimeoutError(openAIError)
        })
      }
    }

    // =============================================
    // GEMINI IMAGE GENERATION (Nano Banana models)
    // =============================================
    if (selectedModel === 'nano-banana' || selectedModel === 'nano-banana-pro') {
      const geminiApiKey = process.env.GEMINI_API_KEY
      if (!geminiApiKey) {
        return res.status(500).json({ error: 'Gemini API key not configured' })
      }

      const geminiModelId = GEMINI_IMAGE_MODELS[selectedModel]

      const receivedImageCount = ['input_image', 'input_image_2', 'input_image_3', 'input_image_4']
        .filter(k => typeof imageParams[k] === 'string' && imageParams[k].length > 0).length
      console.log('Submitting to Gemini Image API:', { 
        model: geminiModelId,
        prompt: enhancedPrompt.substring(0, 100) + '...',
        hasInputImage: !!imageParams.input_image,
        productImageCount: receivedImageCount,
        language: postLanguage,
        hasProductImages
      })

      try {
        // Initialize Google GenAI SDK
        const ai = new GoogleGenAI({ apiKey: geminiApiKey })

        // Build the prompt parts
        type PromptPart = { text: string } | { inlineData: { mimeType: string; data: string } }
        const promptParts: PromptPart[] = [{ text: enhancedPrompt }]

        // Brand Kit: inject logo as FIRST inline image (highest visual priority for Gemini)
        // Skip in product/logo modes — product uses its own refs; logo mode IS the logo design
        if (brandKit && brandKit.logo_url && isPostMode && !isProductMode && !isLogoMode) {
          try {
            const logoData = await fetchBrandLogoAsBase64(brandKit)
            if (logoData) {
              promptParts.push({ text: `══ LOGO OFICIAL DE LA MARCA "${brandKit.name}" (NO NEGOCIABLE) ══\nDEBES incluir este logo EXACTO en el diseño, COPIÁNDOLO PÍXEL POR PÍXEL desde la referencia adjunta. Reglas absolutas:\n1. Ubícalo en una posición prominente (esquina superior o centrado arriba).\n2. PROHIBIDO redibujar, estilizar, reinterpretar, rediseñar, recolorear, rotar o deformar el logo.\n3. PROHIBIDO cambiar el tipo de letra, la forma, el color, las proporciones o el espaciado del logo.\n4. El logo debe aparecer IDÉNTICO a la referencia — como si lo hubieras pegado directamente.` })
              promptParts.push({ inlineData: { mimeType: logoData.mimeType, data: logoData.data } })
              console.log(`Brand logo injected inline for "${brandKit.name}" (${logoData.mimeType}, ${Math.round(logoData.data.length / 1024)}KB)`)
            } else {
              console.warn(`Brand logo fetch returned null for kit "${brandKit.name}" (url: ${brandKit.logo_url})`)
            }
          } catch (logoErr) {
            console.warn('Failed to inject brand logo inline:', logoErr)
          }
        }

        // Add ALL product reference images (input_image, input_image_2, input_image_3, input_image_4)
        // IMPORTANT: Interleave a labeled text part BEFORE each image. Gemini 3 Pro Image tends
        // to anchor on the first image when multiple inlineData parts are stacked consecutively.
        // Labeling each image explicitly forces the model to treat them as distinct references.
        const inputImageKeys = ['input_image', 'input_image_2', 'input_image_3', 'input_image_4']
        type ProductImg = { mimeType: string; data: string }
        const productImages: ProductImg[] = []
        for (const key of inputImageKeys) {
          const img = imageParams[key]
          if (img && typeof img === 'string') {
            const base64Match = img.match(/^data:([^;]+);base64,(.+)$/)
            if (base64Match) {
              productImages.push({ mimeType: base64Match[1], data: base64Match[2] })
            }
          }
        }
        const refCount = productImages.length

        if (refCount > 0 && isPostMode && !isLogoMode) {
          // Master header for all references
          promptParts.push({ text: `PRODUCT/OFFER VISUAL REFERENCES (${refCount}) - USE BY ROLE, DO NOT AMALGAMATE\n${refCount > 1 ? `These ${refCount} images are real references related to the user's product or offer. They may show different roles: hero product, packaging, variant, result/proof, detail, ingredient, texture, lifestyle, or style context. You MUST inspect every image, but you MUST NOT fuse unrelated images into one hybrid object.\n\nClassify each image silently before rendering. Pick one coherent hero product/offer. Use secondary references only as separate variants, proof panels, detail insets, contextual mood, or art-direction cues as appropriate.` : `This is a real visual reference for the user's product/offer. Use it as visual truth.`}\n\nThe final design must look coherent and intentional. Do not invent another product. Do not paste a result/detail photo onto the product unless it is actually printed on the real packaging.` })

          // Interleave a per-image label before each inlineData so Gemini tokenizes each one independently
          productImages.forEach((img, idx) => {
            const label = refCount > 1
              ? `REFERENCE ${idx + 1} of ${refCount}: analyze independently and assign a role (hero product, variant, proof/result, detail, context, or style). Use it only in that role.`
              : 'PRODUCT/OFFER REFERENCE'
            promptParts.push({ text: label })
            promptParts.push({ inlineData: { mimeType: img.mimeType, data: img.data } })
          })
        } else if (refCount > 0 && isLogoMode) {
          promptParts.push({ text: '══ LOGO EXISTENTE DEL USUARIO (PARA ANALIZAR Y MEJORAR) ══\nEsta es la imagen del logo ACTUAL del usuario. Analizalo y aplicá la estrategia de mejora solicitada. Preservá el equity de marca (nombre, iniciales, símbolo clave si aplica) pero mejorá la ejecución según el nivel pedido.' })
          productImages.forEach((img) => {
            promptParts.push({ inlineData: { mimeType: img.mimeType, data: img.data } })
          })
        }

        // Closing reinforcement if product images were provided
        if (refCount > 0 && isPostMode && !isLogoMode) {
          promptParts.push({ text: `FINAL PRODUCT REFERENCE CHECK: Use every provided reference intelligently, by role. If a reference is the sellable product or package, preserve its real shape, color, silhouette, texture, and details. If a reference is a result/proof/detail/context image, use it as supporting evidence, inset, mood, or background cue. Do NOT blend multiple references into a strange single object. Do NOT ignore relevant references.` })
        }

        // CONTEXT / INSPIRATION images — distinct from product truth.
        // Used for mood, audience, scene, lifestyle. The product must NOT be copied from these.
        type ContextImg = { mimeType: string; data: string }
        const contextImages: ContextImg[] = []
        if (Array.isArray(imageParams.contextImages) && isPostMode && !isLogoMode) {
          for (const ctxImg of imageParams.contextImages.slice(0, 4)) {
            if (typeof ctxImg === 'string') {
              const m = ctxImg.match(/^data:([^;]+);base64,(.+)$/)
              if (m) contextImages.push({ mimeType: m[1], data: m[2] })
            }
          }
        }
        const ctxCount = contextImages.length

        if (ctxCount > 0) {
          promptParts.push({ text: `══ ${ctxCount} IMÁGEN${ctxCount > 1 ? 'ES' : ''} DE CONTEXTO / INSPIRACIÓN (NO ES EL PRODUCTO) ══\nEstas imágenes NO son el producto. Son referencia de AMBIENTE, AUDIENCIA, ESCENA, ESTILO DE VIDA, EMOCIÓN o MOOD.\n\nUSO PERMITIDO:\n- Inspirarte en el tipo de personas (edad, composición familiar, expresiones, estilo).\n- Captar el ambiente, la iluminación, la atmósfera, la paleta emocional.\n- Entender el escenario o contexto de uso (hogar, exterior, cocina, oficina, etc.).\n- Replicar el mood, el momento, la energía, la interacción humana.\n\nPROHIBIDO:\n- Copiar el producto desde estas imágenes (el producto real está en las referencias del producto arriba).\n- Inventar variaciones del producto basándote en estas imágenes.\n- Ignorarlas: SÍ deben influir en el diseño final vía escena/mood/audiencia.\n\nTratá estas imágenes como un moodboard: extraé el ESPÍRITU, no los objetos físicos.` })

          contextImages.forEach((img, idx) => {
            const label = ctxCount > 1
              ? `── INSPIRACIÓN ${idx + 1} de ${ctxCount} (moodboard — ambiente/audiencia/escena, NO el producto) ──`
              : '── INSPIRACIÓN (moodboard — ambiente/audiencia/escena, NO el producto) ──'
            promptParts.push({ text: label })
            promptParts.push({ inlineData: { mimeType: img.mimeType, data: img.data } })
          })

          // Closing reinforcement that ties product truth vs context inspiration together
          if (refCount > 0) {
            promptParts.push({ text: `SEPARACIÓN CLARA: El PRODUCTO se copia EXACTAMENTE de las ${refCount} foto${refCount > 1 ? 's' : ''} de referencia del producto. La ESCENA / AUDIENCIA / MOOD se inspira en las ${ctxCount} imagen${ctxCount > 1 ? 'es' : ''} de contexto. NO mezcles: no inventes productos parecidos a los de las imágenes de contexto, y no ignores el ambiente/personas que muestran.` })
          } else {
            promptParts.push({ text: `RECORDATORIO: Usá estas imágenes como moodboard (ambiente, personas, escena). No son el producto.` })
          }
        }

        // Determine aspect ratio from dimensions
        const geminiAspectRatio = getAspectRatio(
          imageParams.width || 1080,
          imageParams.height || 1080
        )

        // Generate image using SDK (format from official docs)
        // nano-banana-pro supports imageSize: '1K' | '2K' | '4K' (default 1K)
        const imageConfig: Record<string, string> = { aspectRatio: geminiAspectRatio }
        if (selectedModel === 'nano-banana-pro') {
          imageConfig.imageSize = '2K'
        }

        let response: Awaited<ReturnType<typeof ai.models.generateContent>>
        try {
          response = await withTimeout(ai.models.generateContent({
            model: geminiModelId,
            contents: promptParts,
            config: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig
            }
          }), 'Gemini image generation')
        } catch (firstTry) {
          if (!isTransientGeminiError(firstTry)) throw firstTry
          console.warn('Gemini image transient error — retrying once after 2s:', firstTry instanceof Error ? firstTry.message : firstTry)
          await new Promise(r => setTimeout(r, 2000))
          response = await withTimeout(ai.models.generateContent({
            model: geminiModelId,
            contents: promptParts,
            config: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig
            }
          }), 'Gemini image generation retry')
        }

        // Extract image from response
        const candidates = response.candidates || []
        const parts = candidates[0]?.content?.parts || []
        
        let imageUrl: string | null = null
        
        for (const part of parts) {
          if ('inlineData' in part && part.inlineData?.data) {
            const mimeType = part.inlineData.mimeType || 'image/png'
            imageUrl = `data:${mimeType};base64,${part.inlineData.data}`
            break
          }
        }

        if (!imageUrl) {
          console.error('No image in Gemini response:', JSON.stringify(response, null, 2))
          return res.status(500).json({ error: 'No image generated by Gemini' })
        }

        // Increment usage counter after successful generation
        await incrementUsage(user.id, 'image')
        await deductBonusImage(user.id)

        // Extract token usage from Gemini response
        const genUsage = response.usageMetadata
        const genInputTokens = genUsage?.promptTokenCount || 0
        const genOutputTokens = genUsage?.candidatesTokenCount || 0
        const genThinkingTokens = genUsage?.thoughtsTokenCount || 0

        // Log Gemini image usage with accurate token-based cost
        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: isLogoMode ? 'logo' : 'image',
          model: selectedModel,
          inputTokens: genInputTokens,
          outputTokens: genOutputTokens,
          thinkingTokens: genThinkingTokens,
          generationId,
          success: true,
          metadata: {
            provider: 'google',
            providerModel: geminiModelId,
            rawUsage: genUsage,
            imageSize: imageConfig.imageSize || '1K',
            width: imageParams.width,
            height: imageParams.height,
            hasInputImage: !!imageParams.input_image,
            brandKitId: brandKit?.id,
            brandKitName: brandKit?.name,
            ...(isLogoMode ? { logoMode: imageParams.logoMode, archetype: imageParams.logoArchetype } : {})
          }
        })

        // Return immediately (no polling needed for Gemini)
        // No textWarning for Gemini - it CAN render text in images
        return res.status(200).json({
          status: 'Ready',
          result: { sample: imageUrl },
          model: selectedModel,
          providerModel: geminiModelId,
          generationId,
          textWarning: false
        })

      } catch (geminiError) {
        console.error('Gemini SDK error:', geminiError)
        
        // Log failed attempt
        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'image',
          model: selectedModel,
          generationId,
          success: false,
          errorMessage: geminiError instanceof Error ? geminiError.message : 'Unknown error',
          metadata: { provider: 'google', providerModel: geminiModelId, hasInputImage: !!imageParams.input_image, costSource: 'unavailable' }
        })

        // Pass through quota/rate limit errors with proper status code
        const isQuotaError = geminiError instanceof Error && 
          (geminiError.message.includes('RESOURCE_EXHAUSTED') || geminiError.message.includes('429'))
        const statusCode = isTimeoutError(geminiError) ? 504 : isQuotaError ? 429 : 500
        const userMessage = isQuotaError 
          ? 'El servicio de generación de imágenes ha alcanzado su límite temporal. Por favor intenta de nuevo en unos minutos.'
          : isTimeoutError(geminiError)
            ? 'La generación de imágenes tardó demasiado y fue detenida. Intenta de nuevo en unos segundos.'
          : 'Gemini image generation failed'

        return res.status(statusCode).json({ 
          error: userMessage,
          details: geminiError instanceof Error ? geminiError.message : 'Unknown error',
          retryable: isTimeoutError(geminiError) || isQuotaError
        })
      }
    }

    // =============================================
    // GROK IMAGINE IMAGE GENERATION
    // =============================================
    if (selectedModel === 'grok-imagine') {
      const xaiApiKey = process.env.GROK_API_KEY
      if (!xaiApiKey) {
        return res.status(500).json({ error: 'xAI API key not configured' })
      }

      console.log('Submitting to Grok Imagine API:', { 
        prompt: enhancedPrompt.substring(0, 100) + '...',
        hasInputImage: !!imageParams.input_image
      })

      try {
        // Use b64_json to avoid CORS issues with xAI's image hosting
        // Model: grok-2-image-1212 ($0.07/image, 300 rpm)
        // Determine aspect ratio from dimensions
        // Grok supports: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2
        // Map unsupported ratios to closest supported ones (e.g. 4:5 → 3:4)
        const GROK_SUPPORTED_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2']
        const GROK_RATIO_FALLBACK: Record<string, string> = { '4:5': '3:4', '5:4': '4:3' }
        let grokAspectRatio = getAspectRatio(
          imageParams.width || 1080,
          imageParams.height || 1080
        )
        if (!GROK_SUPPORTED_RATIOS.includes(grokAspectRatio)) {
          grokAspectRatio = GROK_RATIO_FALLBACK[grokAspectRatio] || '1:1'
        }

        const grokRequest: Record<string, unknown> = {
          model: 'grok-2-image-1212',
          prompt: enhancedPrompt,
          n: 1,
          response_format: 'b64_json',
          aspect_ratio: grokAspectRatio
        }

        const response = await fetch(GROK_IMAGINE_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${xaiApiKey}`
          },
          body: JSON.stringify(grokRequest)
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.error('Grok Imagine API error:', errorText)
          
          await logApiUsage({
            userId: user.id,
            userEmail: user.email,
            feature: 'image',
            model: 'grok-imagine',
            success: false,
            errorMessage: errorText,
            metadata: { hasInputImage: !!imageParams.input_image }
          })

          return res.status(response.status).json({ 
            error: 'Grok Imagine generation failed',
            details: errorText
          })
        }

        const result = await response.json()
        
        // Handle base64 response format
        const b64Data = result.data?.[0]?.b64_json
        if (!b64Data) {
          throw new Error('No image data in response')
        }
        
        // Convert to data URL for client consumption
        const imageUrl = `data:image/jpeg;base64,${b64Data}`

        // Increment usage counter
        await incrementUsage(user.id, 'image')
        await deductBonusImage(user.id)

        // Log usage
        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'image',
          model: 'grok-imagine',
          success: true,
          metadata: { width: imageParams.width, height: imageParams.height, brandKitId: brandKit?.id, brandKitName: brandKit?.name }
        })

        // Return immediately (Grok Imagine is synchronous)
        return res.status(200).json({
          status: 'Ready',
          result: { sample: imageUrl },
          model: selectedModel,
          textWarning: false
        })

      } catch (grokError) {
        console.error('Grok Imagine error:', grokError)
        
        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'image',
          model: 'grok-imagine',
          success: false,
          errorMessage: grokError instanceof Error ? grokError.message : 'Unknown error',
          metadata: { hasInputImage: !!imageParams.input_image }
        })

        return res.status(500).json({ 
          error: 'Grok Imagine generation failed',
          details: grokError instanceof Error ? grokError.message : 'Unknown error'
        })
      }
    }

    // Unsupported model fallback
    return res.status(400).json({ error: `Unsupported model: ${selectedModel}` })

  } catch (error) {
    console.error('Image generation error:', error)
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
