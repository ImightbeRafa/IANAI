import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, checkUsageLimit, incrementUsage, deductBonusImage } from './lib/auth.js'
import { logApiUsage } from './lib/usage-logger.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { GoogleGenAI } from '@google/genai'
import { buildPostPrompt, buildPresetPrompt, buildProductPrompt } from './data/image-presets.js'
import type { PostAspectRatio } from './data/image-presets.js'
import { findColorPaletteById } from './data/color-palettes.js'
import { getMemoryInjection } from './lib/memory-helpers.js'
import { resolveBrandKit, buildBrandColorOverride, buildBrandVisualPrompt, buildBrandLogoPrompt, fetchBrandLogoAsBase64 } from './lib/brand-kit.js'

const GROK_IMAGINE_API_URL = 'https://api.x.ai/v1/images/generations'

const imgMemSupabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const imgMemSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const imgMemSupabase = imgMemSupabaseUrl && imgMemSupabaseKey ? createClient(imgMemSupabaseUrl, imgMemSupabaseKey) : null

// Gemini Image Generation Models (from official SDK documentation)
const GEMINI_IMAGE_MODELS: Record<string, string> = {
  'nano-banana': 'gemini-2.5-flash-image',          // Fast, efficient (1K resolution)
  'nano-banana-pro': 'gemini-3-pro-image-preview'   // High quality, reasoning (up to 4K)
}

type ImageModel = 'nano-banana' | 'nano-banana-pro' | 'grok-imagine'

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

    const VALID_MODELS: ImageModel[] = ['nano-banana', 'nano-banana-pro', 'grok-imagine']
    if (!VALID_MODELS.includes(model)) {
      return res.status(400).json({ error: `Invalid model. Must be one of: ${VALID_MODELS.join(', ')}` })
    }
    const selectedModel: ImageModel = model

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
        const editAR = imageParams.aspectRatio === '3:4' ? '3:4' : '9:16'

        const response = await ai.models.generateContent({
          model: editModelId,
          contents: promptParts,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
              imageSize: '2K',
              aspectRatio: editAR
            }
          }
        })

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
          metadata: { action: 'edit', editPrompt: editPrompt.substring(0, 100) }
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
          metadata: { action: 'edit' }
        })

        return res.status(500).json({
          error: 'Image edit failed',
          details: editError instanceof Error ? editError.message : 'Unknown error'
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

      const ENHANCE_SYSTEM_PROMPT = `${productRefRule}
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

ACTÚA COMO:
Director Creativo + Director de Arte Senior + Diseñador Editorial de marcas globales (Apple / Aesop / Jacquemus / Nike Campaign Level).

TAREA:
Vas a REINTERPRETAR el diseño que te paso.
No es solo "mejorarlo".
Es llevarlo a una versión más inteligente, más conceptual, más coherente visualmente y con mayor impacto creativo.

Puedes:
- Cambiar composición
- Cambiar estructura visual
- Cambiar jerarquía
- Cambiar distribución de elementos
- Cambiar dirección de arte
- Proponer una narrativa visual diferente

No puedes:
- Cambiar el mensaje central
- Cambiar el texto
- Alterar la intención comercial

Tu objetivo es que el diseño tenga:
- Más intención
- Más concepto
- Más carácter
- Más tensión visual
- Más autoridad

---

ENFOQUE CREATIVO (OBLIGATORIO)

1) Primero analiza:
   - ¿Qué quiere comunicar realmente esta pieza?
   - ¿Es aspiracional? ¿Es técnico? ¿Es emocional? ¿Es agresivo?
   - ¿La composición actual refleja eso o es genérica?

2) Luego elige UNA dirección creativa clara:
   Ejemplos posibles (elige la más lógica según el diseño):
   - Editorial de revista de lujo
   - Minimalismo brutalista
   - High-fashion campaign
   - Tech futurista limpio
   - Conceptual con uso fuerte de espacio negativo
   - Layout modular tipo sistema de diseño
   - Composición asimétrica dinámica
   - Enfoque tipográfico dominante
   - Imagen dominante con microcopy sutil
   - Dirección artística cinematográfica

3) El diseño debe sentirse intencional.
Nada centrado por default.
Nada simétrico porque sí.
Nada "Canva vibes".

---

REGLAS DE ALTO NIVEL

* Diseña con concepto, no con decoración.
* El espacio negativo es parte activa del diseño.
* El contraste genera jerarquía.
* La tipografía debe tener personalidad.
* Si todo destaca, nada destaca.
* El diseño debe tener un punto focal claro.
* Menos elementos, pero más poder.

---

PERMITE CAMBIOS ESTRUCTURALES

- Puedes eliminar elementos que no aporten.
- Puedes cambiar proporciones.
- Puedes convertir bullets en bloques visuales.
- Puedes usar texto como elemento gráfico.
- Puedes romper la cuadrícula si tiene intención.
- Puedes crear tensión entre bloques.
- Puedes usar sobreposición inteligente.
- Puedes introducir ritmo visual.

---

TIPOGRAFÍA

No te limites a Inter.
Explora:
- Serif moderna para contraste elegante
- Sans ultra bold para impacto
- Condensed para carácter
- Tracking intencional
- Uso de mayúsculas estratégico
- Escalas tipográficas marcadas

Máximo 2 familias.

---

COLOR

Puedes:
- Simplificar a monocromático
- Usar contraste dramático
- Usar un acento inesperado
- Trabajar con bloques sólidos
- Crear un mood más definido

Evita:
- Colores corporativos sin intención
- Degradados genéricos
- Saturación innecesaria

---

REGLA CRÍTICA — PRODUCTO INTACTO (NO NEGOCIABLE):
${hasProductRef ? 'Se proporcionan imágenes de referencia del producto real. USA ESAS REFERENCIAS para mantener el producto fiel a la realidad.' : 'La forma del producto NO se modifica bajo ninguna circunstancia.'}
- No rediseñar la silueta, proporciones, ángulos ni detalles físicos.
- No "stylize", no cartoon, no 3D fake, no reinterpretación del objeto.
- El producto debe mantenerse EXACTAMENTE como está${hasProductRef ? ' en las imágenes de referencia' : ' en el input'} (misma forma real).
- Solo se permite: mejora de recorte/limpieza, iluminación/contraste, nitidez, corrección de color, sombra sutil realista y fondo/entorno.
Si el producto no está en imagen y es un vector: NO lo redibujes, solo optimiza su presentación (escala, ubicación, márgenes, halo/sombra suave).

---

REGLA DE FORMATO (NO NEGOCIABLE):
- La imagen de salida debe mantener EXACTAMENTE el mismo aspect ratio que la imagen de entrada.
- NO cambies de vertical a horizontal ni viceversa.

---

OBJETIVO FINAL

Que esta pieza no se vea como:
- Un diseño hecho por IA.
- Una plantilla de Canva.
- Un post genérico de Instagram.

Debe verse como:
Una campaña real de marca grande.
Algo que alguien guardaría en Pinterest.
Algo que podría estar en Behance.
Algo que tenga identidad.
Algo que tenga carácter.
Algo creativo de verdad.

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
        let productRefCount = 0
        if (hasProductRef) {
          promptParts.push({ text: '══ IMÁGENES DE REFERENCIA DEL PRODUCTO REAL ══\nEstas son fotos REALES del producto del usuario. El producto en el diseño mejorado DEBE verse EXACTAMENTE como en estas fotos. NO inventes, NO modifiques, NO reimagines la apariencia del producto. Usa ESTAS imágenes como la ÚNICA fuente de verdad:' })
          for (const refImg of imageParams.productReferenceImages!.slice(0, 4)) {
            const refMatch = refImg.match(/^data:([^;]+);base64,(.+)$/)
            if (refMatch) {
              promptParts.push({ inlineData: { mimeType: refMatch[1], data: refMatch[2] } })
              productRefCount++
            }
          }
          console.log(`Enhance: ${productRefCount} product reference images injected BEFORE enhance image`)
        }

        // Brand Kit: inject logo so it is preserved/reinforced during enhancement
        if (brandKit && brandKit.logo_url) {
          try {
            const logoData = await fetchBrandLogoAsBase64(brandKit)
            if (logoData) {
              promptParts.push({ text: `══ LOGO DE MARCA "${brandKit.name}" ══\nSi el logo aparece en la imagen original, MANTENLO exactamente igual. Si NO aparece, AGRÉGALO en una posición prominente (esquina superior). Reprodúcelo fielmente de la referencia adjunta:` })
              promptParts.push({ inlineData: { mimeType: logoData.mimeType, data: logoData.data } })
              console.log(`Brand logo injected in enhance for "${brandKit.name}"`)
            }
          } catch (logoErr) {
            console.warn('Failed to inject brand logo in enhance:', logoErr)
          }
        }

        // NOW add the image to enhance (AFTER product refs + logo so model has truth established)
        promptParts.push({ text: '══ IMAGEN A MEJORAR ══\nEsta es la imagen de diseño que debes reinterpretar y mejorar. Aplica las reglas anteriores:' })
        promptParts.push({ inlineData: { mimeType: base64Match[1], data: base64Match[2] } })

        // Closing reinforcement if product refs were provided
        if (productRefCount > 0) {
          promptParts.push({ text: 'RECORDATORIO FINAL: El producto en la imagen mejorada DEBE ser IDÉNTICO a las fotos de referencia del producto proporcionadas arriba. NO inventes otro producto. NO cambies forma, color, silueta ni textura. Copia el producto EXACTAMENTE de las referencias.' })
        }

        // Map request aspect ratio to Gemini-compatible string (default 9:16)
        const enhanceAR = imageParams.aspectRatio === '3:4' ? '3:4' : '9:16'

        // Retry once on transient 503 errors
        let response: Awaited<ReturnType<typeof ai.models.generateContent>>
        try {
          response = await ai.models.generateContent({
            model: enhanceModelId,
            contents: promptParts,
            config: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig: { imageSize: '2K', aspectRatio: enhanceAR }
            }
          })
        } catch (firstTry) {
          const is503 = firstTry instanceof Error && (firstTry.message.includes('503') || firstTry.message.includes('UNAVAILABLE'))
          if (!is503) throw firstTry
          console.warn('Gemini enhance 503 — retrying once after 2s...')
          await new Promise(r => setTimeout(r, 2000))
          response = await ai.models.generateContent({
            model: enhanceModelId,
            contents: promptParts,
            config: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig: { imageSize: '2K', aspectRatio: enhanceAR }
            }
          })
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
          metadata: { action: 'enhance' }
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
        const isTransient = errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')

        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'enhance',
          model: 'nano-banana-pro',
          success: false,
          errorMessage: errMsg,
          metadata: { action: 'enhance', transient: isTransient }
        })

        if (isTransient) {
          return res.status(503).json({
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
    
    let enhancedPrompt: string

    // Detect whether product reference images are provided
    const hasProductImages = !!(imageParams.input_image)
    const postLanguage: string = imageParams.language || 'es'

    if (isPostMode) {
      // POST MODE: Use the appropriate master prompt based on postStyle
      // Determine aspect ratio from request (default 9:16 for backward compat)
      const postAspectRatio: PostAspectRatio = imageParams.aspectRatio === '3:4' ? '3:4' : '9:16'
      const postStyle: string = imageParams.postStyle || 'venta-directa'
      const isProductMode = postStyle === 'product'

      if (imageParams.aspectRatio === '1:1' && isProductMode) {
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

      // Resolve color palette override (if any)
      // Priority: custom colors > predefined palette > brand kit colors > none
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
      let visualMemoryPrefix = ''
      try {
        const visualMemory = await getMemoryInjection(
          user.id,
          imageParams.productId as string || null,
          (postLanguage as 'es' | 'en') || 'es',
          { types: ['visual_style', 'preference', 'anti_pattern'], limit: 10 }
        )
        if (visualMemory) {
          visualMemoryPrefix = visualMemory + '\n\n'
        }
      } catch { /* ignore */ }

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (isProductMode) {
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
        const productPrompt = buildProductPrompt(
          productSubStyle,
          productAR,
          postLanguage,
          bgDesc
        )
        if (productPrompt) {
          enhancedPrompt = colorPrefix + brandVisualPrefix + productPrompt
        } else {
          enhancedPrompt = colorPrefix + brandVisualPrefix + buildProductPrompt('studio-hero', productAR, postLanguage)!
        }
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
            enhancedPrompt = presetLangPrefix + presetProductPrefix + aspectRatioPrefix + visualMemoryPrefix + colorPrefix + brandVisualPrefix + brandLogoPrefix + customMasterPrompt + '\n\nProducto/servicio del usuario:\n' + userPrompt
          } else {
            // Fallback to venta directa if custom type not found
            enhancedPrompt = aspectRatioPrefix + visualMemoryPrefix + colorPrefix + brandVisualPrefix + brandLogoPrefix + buildPostPrompt(postAspectRatio, postLanguage, hasProductImages) + userPrompt
          }
        } catch {
          enhancedPrompt = aspectRatioPrefix + visualMemoryPrefix + colorPrefix + brandVisualPrefix + brandLogoPrefix + buildPostPrompt(postAspectRatio, postLanguage, hasProductImages) + userPrompt
        }
      } else if (postStyle === 'preset' && imageParams.presetId) {
        // PRESET MODE: uses buildPresetPrompt (same assembly pattern as Venta Directa — language/product rules built into the prompt)
        const presetPrompt = buildPresetPrompt(imageParams.presetId as string, postAspectRatio, postLanguage, hasProductImages)
        if (presetPrompt) {
          enhancedPrompt = aspectRatioPrefix + visualMemoryPrefix + colorPrefix + brandVisualPrefix + brandLogoPrefix + presetPrompt + userPrompt
        } else {
          enhancedPrompt = aspectRatioPrefix + visualMemoryPrefix + colorPrefix + brandVisualPrefix + brandLogoPrefix + buildPostPrompt(postAspectRatio, postLanguage, hasProductImages) + userPrompt
        }
      } else {
        // VENTA DIRECTA (default)
        enhancedPrompt = aspectRatioPrefix + visualMemoryPrefix + colorPrefix + brandVisualPrefix + brandLogoPrefix + buildPostPrompt(postAspectRatio, postLanguage, hasProductImages) + userPrompt
      }
    } else {
      // GENERIC IMAGE MODE: Use Gemini prefix (all models now support text)
      enhancedPrompt = GEMINI_PROMPT_PREFIX + userPrompt
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

      console.log('Submitting to Gemini Image API:', { 
        model: geminiModelId,
        prompt: enhancedPrompt.substring(0, 100) + '...',
        hasInputImage: !!imageParams.input_image,
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
        if (brandKit && brandKit.logo_url && isPostMode) {
          try {
            const logoData = await fetchBrandLogoAsBase64(brandKit)
            if (logoData) {
              promptParts.push({ text: `══ LOGO OFICIAL DE LA MARCA "${brandKit.name}" ══\nEsta es la imagen del logo que DEBES incluir en el diseño. Reprodúcelo FIELMENTE, sin modificar, en una posición prominente (esquina superior o centrado arriba).` })
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
        const inputImageKeys = ['input_image', 'input_image_2', 'input_image_3', 'input_image_4']
        const productImageParts: PromptPart[] = []
        for (const key of inputImageKeys) {
          const img = imageParams[key]
          if (img && typeof img === 'string') {
            const base64Match = img.match(/^data:([^;]+);base64,(.+)$/)
            if (base64Match) {
              productImageParts.push({
                inlineData: {
                  mimeType: base64Match[1],
                  data: base64Match[2]
                }
              })
            }
          }
        }
        if (productImageParts.length > 0 && isPostMode) {
          promptParts.push({ text: '══ IMÁGENES DE REFERENCIA DEL PRODUCTO REAL ══\nEstas son fotos REALES del producto del usuario. El producto en el diseño DEBE verse EXACTAMENTE como en estas fotos. NO inventes, NO modifiques, NO reimagines la apariencia del producto. Usa ESTAS imágenes como la ÚNICA fuente de verdad:' })
        }
        promptParts.push(...productImageParts)

        // Closing reinforcement if product images were provided
        if (productImageParts.length > 0 && isPostMode) {
          promptParts.push({ text: 'RECORDATORIO: El producto en el diseño DEBE ser IDÉNTICO a las fotos de referencia proporcionadas arriba. NO inventes otro producto. Copia forma, color, silueta y textura EXACTAMENTE de las referencias.' })
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

        const response = await ai.models.generateContent({
          model: geminiModelId,
          contents: promptParts,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig
          }
        })

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
          feature: 'image',
          model: selectedModel,
          inputTokens: genInputTokens,
          outputTokens: genOutputTokens,
          thinkingTokens: genThinkingTokens,
          success: true,
          metadata: { width: imageParams.width, height: imageParams.height, hasInputImage: !!imageParams.input_image, brandKitId: brandKit?.id, brandKitName: brandKit?.name }
        })

        // Return immediately (no polling needed for Gemini)
        // No textWarning for Gemini - it CAN render text in images
        return res.status(200).json({
          status: 'Ready',
          result: { sample: imageUrl },
          model: selectedModel,
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
          success: false,
          errorMessage: geminiError instanceof Error ? geminiError.message : 'Unknown error',
          metadata: { hasInputImage: !!imageParams.input_image }
        })

        // Pass through quota/rate limit errors with proper status code
        const isQuotaError = geminiError instanceof Error && 
          (geminiError.message.includes('RESOURCE_EXHAUSTED') || geminiError.message.includes('429'))
        const statusCode = isQuotaError ? 429 : 500
        const userMessage = isQuotaError 
          ? 'El servicio de generación de imágenes ha alcanzado su límite temporal. Por favor intenta de nuevo en unos minutos.'
          : 'Gemini image generation failed'

        return res.status(statusCode).json({ 
          error: userMessage,
          details: geminiError instanceof Error ? geminiError.message : 'Unknown error'
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
