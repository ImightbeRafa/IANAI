import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, checkUsageLimit, incrementUsage } from './lib/auth.js'
import { logApiUsage } from './lib/usage-logger.js'
import { GoogleGenAI } from '@google/genai'

const GROK_IMAGINE_API_URL = 'https://api.x.ai/v1/images/generations'

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

// =============================================
// MASTER POST PROMPT — Director de Arte + Diseñador Gráfico + Copywriter
// Used when mode === 'post'. The user's script (GANCHO/DESARROLLO/CTA) is appended.
// =============================================
const POST_MASTER_PROMPT = `ACTÚA COMO: Director de Arte + Diseñador Gráfico Senior + Copywriter de Performance (venta directa). Tu única meta es crear un post que convierta.

CONTEXTO FIJO (NO PREGUNTAR NADA):
En tu contexto ya recibiste un guión escrito con esta estructura:
- [GANCHO]
- [DESARROLLO]
- [CTA]
Ese guión NO incluye instrucciones visuales. Vos debés inferirlas de forma inteligente.

OBJETIVO:
Transformar ese guión en UN (1) post publicitario de venta directa en un solo slide, formato vertical 9:16 (1080x1920), con:
1) Gancho (headline)
2) Desarrollo (bullets ultra tangibles)
3) CTA (acción única tipo botón)
Todo en el MISMO slide, con diseño profesional, legible y ordenado.

REGLAS DE COPY (PERFORMANCE):
- Cero saludos.
- 2–3 segundos de gancho (headline corto).
- No párrafos largos en el diseño.
- Convertí el [DESARROLLO] del guión a 3–5 bullets máximos.
- Cada bullet debe ser tangible: entrega, logística, garantía, tiempo, cobertura, pago, proceso, "qué recibís".
- Eliminá adjetivos vacíos ("premium", "alta calidad") si no vienen con evidencia. Si el guión trae adjetivos, aterrizalos a hechos.
- CTA debe ser UNO solo, directo, operativo. No mezclar acciones.

EXTRACCIÓN AUTOMÁTICA DESDE EL GUION (OBLIGATORIO):
1) Del [GANCHO] extraé:
   - Qué se vende (producto/servicio literal)
   - Público buyer (segmento implícito)
   - Función/propuesta principal (1 sola)
   - Ángulo/diferenciador (1) (garantía, entrega, rapidez, anti-alternativa, variedad, certeza)
2) Del [DESARROLLO] extraé y priorizá:
   - 3–5 hechos verificables (máximo) que eliminan dudas.
   - Si el guión menciona una alternativa/competidor (ej "supermercados"), convertí eso en 1 bullet de contraste máximo (sin explicar de más).
   - Si el guión menciona garantía, reposición, devolución o riesgo cero, eso va sí o sí como bullet.
3) Del [CTA] extraé:
   - Acción única (mensaje, WhatsApp, DM, pedir, agendar, cotizar)
   - Resultado inmediato (qué pasa después de que escribe)

REGLAS DE DISEÑO (CALIDAD VISUAL PRO):
FORMATO: Vertical 9:16 — 1080x1920 px

SAFE AREAS / MÁRGENES OBLIGATORIOS (ESTRICTO):
- Top safe: mínimo 220 px sin texto importante.
- Bottom safe: mínimo 260 px sin texto importante.
- Lados: mínimo 110 px sin texto importante.
Todo lo crítico (headline, bullets, CTA) debe quedar dentro de estas zonas seguras.
PROHIBIDO: texto pegado a bordes.
PROHIBIDO: número de slide (1/1, 2/2, etc.).

DIRECCIÓN DE ARTE (LOOK & FEEL PREMIUM) — ESTILO APPLE/IG/SPOTIFY:
El diseño debe verse como una marca grande: minimalista premium + editorial + quiet luxury.
Objetivo visual: aunque haya texto (headline + 3–5 bullets + CTA), el post se siente limpio, caro, ordenado y ultra intencional.

Reglas visuales (estrictas):
- No saturación: máximo 1 imagen principal + 1 badge opcional + texto + CTA.
- Mucho aire: espacios generosos entre bloques (headline / bullets / CTA).
- Alineación perfecta: todo basado en grid, márgenes consistentes, baseline visual estable.
- Consistencia: radios de esquina, sombras, grosor de líneas, estilos de badges e íconos coherentes.
- Cero "plantilla barata": NO bursts, NO stickers, NO íconos caricaturescos, NO flechas exageradas, NO emojis, NO outlines pesados.

GRID Y JERARQUÍA:
- Alineación principal: izquierda.
- Máximo 2 bloques de texto arriba/medio: (Headline + Bullets).
- CTA en una barra tipo "botón" al final (pero dentro del bottom safe).
- Headline: 8–12 palabras ideal (máximo 14). Si el gancho es largo, reescribilo sin perder sentido.
- Bullets: 3–5. 1 línea cada uno (máximo 2 si es inevitable).
- Interlineado headline: 0.95–1.05 (compacto).
- Interlineado bullets: 1.1–1.2 (respira y se lee).
- Espaciado vertical entre bullets: consistente, uniforme, "editorial".
- El texto debe ser legible en pantalla de celular.

TIPOGRAFÍA (SOLO 2 FAMILIAS) — APPLE-LIKE:
- Mantener solo 2 familias.
- Elegí tipografías sans de estética sistema / tech premium (estilo SF / Inter / Helvetica / Neue).
- Tracking levemente cerrado o neutro (evitar letras "infladas").
- Jerarquía fuerte: headline realmente domina; bullets limpios; CTA sólido.
PROHIBIDO: tipografías decorativas, condensadas extremas o "futuristas baratas".

COLOR SYSTEM (SOBRIO + 1 ACENTO) — ESTILO SPOTIFY/IG:
- Mantener: 1 color primario + 1 acento + neutrales.
- Paletas recomendadas:
  - Apple-like: blanco/negro/grises + acento mínimo.
  - Instagram-like: degradado MUY sutil y controlado (no arcoíris), solo como wash/overlay.
  - Spotify-like: base oscura + 1 acento vibrante controlado (solo para CTA o 1 palabra clave).
- El acento solo puede usarse para UNA de estas cosas: 1) Botón CTA o 2) Badge o 3) 1–3 palabras clave (NO usar el acento en todo a la vez si compite).
PROHIBIDO: múltiples acentos, fondos chillones, combinaciones neón sin control.

TRATAMIENTO DE IMAGEN (70–80% del post) — PRODUCT-LED:
- Calidad premium: iluminación limpia, sombras suaves, contraste controlado, recorte perfecto.
- Fondo limpio y moderno: sin ruido visual, sin elementos irrelevantes.
- Profundidad sutil: blur leve o separación por luz/sombra; nada agresivo.
- Overlay para texto: degradado suave, elegante, casi imperceptible (para legibilidad sin tapar el producto).
PROHIBIDO: filtros fuertes, HDR exagerado, texturas baratas, collages.

VISUAL (OBLIGATORIO: PRODUCTO/SERVICIO EN ACCIÓN, NO EN EXHIBICIÓN):
Como el guión no trae visuales, vos debés inferir la mejor escena que demuestre la función principal del guión.
Elegí UNA escena y construí la imagen alrededor:
- Si el guión habla de entrega/rutas/puerta: mostrar acción de entrega (mano recibiendo, caja/bolsa en puerta, timbre, etc.).
- Si el guión habla de frescura/punto perfecto: mostrar acción de uso (cortar/abrir/preparar/servir/comer).
- Si el guión habla de garantía/reposición: incluir un sello visual de garantía y una escena que refuerce "cero riesgo" (sin saturar).
- Si el guión compara contra alternativa (supermercado): que la escena muestre claramente el beneficio opuesto (producto intacto, bien seleccionado, listo para usar).

BULLETS CON MUCHA INFO — PERO QUE SE LEA "CARO" (NO REDUCIR PALABRAS):
- Los bullets deben ser escaneables:
  - iniciar con palabra clave (Entrega / Garantía / Pago / Tiempo / Cobertura / Proceso) y luego el dato.
  - usar separadores sutiles (•, —, |) solo si mejora lectura.
  - máximo 1–2 líneas por bullet, con espacio vertical constante.
- Checkmarks opcionales: si se usan, deben ser minimalistas, mismo grosor, mismo estilo, sin color fuerte (a menos que el acento sea exactamente para eso).

BADGE / SELLOS — QUIET LUXURY:
- Badge opcional solo si refuerza la promesa principal del guión.
- Estilo: pill o escudo minimalista, borde fino o relleno sutil.
- Texto en mayúsculas, corto, sin sombras duras.
- Nunca compite con headline ni con CTA.

CTA BOTÓN — SISTEMA / UI PREMIUM (OBLIGATORIO):
- Botón con radio consistente (2xl), sombra suave o borde fino.
- Alta legibilidad: texto grande, peso fuerte, sin efectos.
- Ícono del canal solo si aplica, en estilo lineal minimalista.
PROHIBIDO: brillos, biseles, contornos dobles, gradientes fuertes, estilos "baratos".

COMPOSICIÓN FINAL (RECOMENDADA):
- Área superior (dentro safe): Headline + badge (opcional).
- Área media: bullets (3–5) con checkmarks minimalistas opcional.
- Área inferior: botón CTA.
- Imagen de acción ocupa 70–80% del post, con overlay elegante donde haya texto.
- Nada debe quedar pegado al borde.

ENTREGABLE:
Generá el arte final (UNA imagen) del post, cumpliendo TODO:
- 1080x1920 (9:16)
- Headline + 3–5 bullets + CTA en un solo slide
- Visual en acción inferida inteligentemente del guión
- Márgenes/safe areas estrictos
- Dirección de arte premium (Apple/IG/Spotify) con mucho aire y coherencia visual
- Sin número de slide
- Sin texto tapable por la UI de Instagram

GUIÓN DEL USUARIO:
`

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
    const { action, taskId, model = 'nano-banana', ...imageParams } = req.body
    const selectedModel: ImageModel = model

    // For polling requests, skip usage check (already counted on initial request)
    if (action !== 'poll') {
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

    // Submit new generation request
    const userPrompt = imageParams.prompt || ''
    const isGeminiModel = selectedModel === 'nano-banana' || selectedModel === 'nano-banana-pro'
    const isPostMode = imageParams.mode === 'post'
    
    let enhancedPrompt: string

    if (isPostMode) {
      // POST MODE: Use the full director/designer master prompt + user's script
      // Force 9:16 dimensions for posts
      imageParams.width = 1080
      imageParams.height = 1920
      enhancedPrompt = POST_MASTER_PROMPT + userPrompt
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
        hasInputImage: !!imageParams.input_image
      })

      try {
        // Initialize Google GenAI SDK
        const ai = new GoogleGenAI({ apiKey: geminiApiKey })

        // Build the prompt parts
        type PromptPart = { text: string } | { inlineData: { mimeType: string; data: string } }
        const promptParts: PromptPart[] = [{ text: enhancedPrompt }]

        // Add input image if provided (for image-to-image generation)
        if (imageParams.input_image) {
          // Extract base64 data from data URL if present
          const base64Match = imageParams.input_image.match(/^data:([^;]+);base64,(.+)$/)
          if (base64Match) {
            promptParts.push({
              inlineData: {
                mimeType: base64Match[1],
                data: base64Match[2]
              }
            })
          }
        }

        // Determine aspect ratio from dimensions
        const geminiAspectRatio = getAspectRatio(
          imageParams.width || 1080,
          imageParams.height || 1080
        )

        // Generate image using SDK (format from official docs)
        const response = await ai.models.generateContent({
          model: geminiModelId,
          contents: promptParts,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
              aspectRatio: geminiAspectRatio
            }
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

        // Log Gemini image usage
        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'image',
          model: selectedModel,
          success: true,
          metadata: { width: imageParams.width, height: imageParams.height, hasInputImage: !!imageParams.input_image }
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

        return res.status(500).json({ 
          error: 'Gemini image generation failed',
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

        // Log usage
        await logApiUsage({
          userId: user.id,
          userEmail: user.email,
          feature: 'image',
          model: 'grok-imagine',
          success: true,
          metadata: { width: imageParams.width, height: imageParams.height }
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
