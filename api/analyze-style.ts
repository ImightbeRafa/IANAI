import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { logApiUsage } from './lib/usage-logger.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { GoogleGenAI } from '@google/genai'
import { fetchPublicUrl } from './lib/url-safety.js'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb'
    }
  }
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_IMAGE_BASE64_LENGTH = 10_000_000 // ~7.5 MB decoded
const MAX_DESCRIPTION_LENGTH = 2000
const MAX_PREF_FIELD_LENGTH = 500

const ANALYSIS_MODEL = 'gemini-2.5-flash'

const STYLE_ANALYSIS_SYSTEM_PROMPT = `You are a world-class Art Director and Visual Design Analyst specializing in social media advertising.

Your task: Analyze the reference images provided by the user, combined with their text description and style preferences, to generate a DETAILED master prompt that can be used to create consistent social media ad posts in this exact style.

The master prompt you generate must be as detailed and specific as the following example (this is an existing preset prompt for "Features & Benefits" style):
---
Plantilla de anuncio para redes sociales: Estilo Características y Beneficios. Crea una plantilla de anuncio visualmente atractiva para redes sociales. Diseño: Presenta una imagen principal del producto centrada, ligeramente descentrada. Organiza de 3 a 4 etiquetas de llamada (rectángulos redondeados) alrededor del producto, conectadas por flechas delgadas que apuntan a características específicas. Paleta de colores: Utiliza una paleta de colores pastel suave. El fondo debe ser de un color crema claro sólido (#F5F5DC). Utiliza un azul desaturado (#ADD8E6) para las etiquetas de llamada y un azul ligeramente más oscuro (#87CEEB) para las flechas. Tipografía: Utiliza una fuente sans-serif limpia y moderna como Open Sans o Lato. Título: Negrita, mayúsculas y minúsculas, colocado encima del producto. Texto de la etiqueta de llamada: Peso normal, mayúsculas y minúsculas, descripciones concisas de los beneficios del producto. Elementos visuales: Incluye una foto de alta calidad del producto con iluminación suave. Utiliza iconos simples y minimalistas dentro de las etiquetas de llamada para representar visualmente cada beneficio. Composición: Asegura una jerarquía visual clara. El producto debe ser el punto focal, seguido del título y las etiquetas de llamada. Utiliza el espacio en blanco de manera efectiva para crear una sensación de amplitud. Ambiente: Limpio, moderno, confiable e informativo.
---

YOUR OUTPUT MUST INCLUDE ALL OF THESE SECTIONS (be extremely specific for each):

1. **Layout & Composition**: Exact placement of elements (product, text, CTA, badges). Grid structure. Alignment rules. Spacing between elements. Visual hierarchy order.

2. **Color Palette**: Specific hex codes extracted from the reference images. Background color. Accent colors. Text colors. How colors interact.

3. **Typography**: Font style recommendations (serif/sans-serif, weight, tracking). Headline treatment (size, case, weight). Body text treatment. CTA text style. Maximum 2 font families.

4. **Visual Elements**: Photo style (lighting, angle, depth of field). Overlays, gradients, shadows. Icons, badges, callout labels. Borders, lines, separators. Background treatment.

5. **Mood & Tone**: Overall feeling (luxury, energetic, minimal, bold, etc.). Brand personality conveyed. Target audience impression.

6. **Text Content Structure**: Where headlines go, how many words. Bullet points format. CTA placement and style. Badge/seal content.

7. **Do's and Don'ts**: Specific things TO DO in this style. Specific things to AVOID.

CRITICAL RULES:
- Extract ACTUAL colors from the reference images (provide hex codes)
- Be specific about positioning (top-left, center, bottom-third, etc.)
- Mention specific font style recommendations based on what you see
- The prompt must work as a standalone instruction for an image generation AI
- Output TWO versions: one in Spanish (master_prompt_es) and one in English (master_prompt_en)
- Each prompt should be 150-300 words (be dense and specific, not verbose)
- Do NOT include generic filler — every sentence must add specific visual instruction
- If the user mentions brand safety constraints, typography preferences, or language rules, incorporate them as NON-NEGOTIABLE rules at the top of the prompt

OUTPUT FORMAT (strict JSON):
{
  "master_prompt_es": "...",
  "master_prompt_en": "...",
  "extracted_colors": ["#hex1", "#hex2", "#hex3"],
  "style_name_suggestion": "Short name for this style (2-4 words)",
  "style_description_es": "One-line description in Spanish",
  "style_description_en": "One-line description in English"
}

Return ONLY valid JSON. No markdown fences, no explanation outside the JSON.`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  // Rate limit: 5 style analyses per 60 seconds (expensive vision call)
  const rateCheck = checkRateLimit(user.id, { maxRequests: 5, windowSeconds: 60 })
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'Too many style analysis requests. Please wait before trying again.',
      retryAfter: rateCheck.resetInSeconds
    })
  }

  try {
    const { referenceImages, description, stylePreferences } = req.body

    if (!referenceImages || !Array.isArray(referenceImages) || referenceImages.length === 0) {
      return res.status(400).json({ error: 'At least one reference image is required' })
    }

    if (referenceImages.length > 3) {
      return res.status(400).json({ error: 'Maximum 3 reference images allowed' })
    }

    // Validate and normalize each image: accept both base64 data URLs and regular URLs
    // Regular URLs (e.g. Supabase Storage) are fetched and converted to base64
    const normalizedImages: string[] = []
    for (let i = 0; i < referenceImages.length; i++) {
      let img = referenceImages[i]
      if (typeof img !== 'string') {
        return res.status(400).json({ error: `Reference image ${i + 1} is not a valid string` })
      }

      // If it's a regular URL (not base64), fetch and convert
      if (img.startsWith('http://') || img.startsWith('https://')) {
        try {
          const imgResp = await fetchPublicUrl(img, { timeoutMs: 15000, maxRedirects: 3 })
          if (!imgResp.ok) {
            return res.status(400).json({ error: `Failed to fetch reference image ${i + 1} from URL` })
          }
          const contentType = imgResp.headers.get('content-type') || 'image/webp'
          if (!contentType.startsWith('image/')) {
            return res.status(400).json({ error: `Reference image ${i + 1} URL did not return an image` })
          }
          const buffer = await imgResp.arrayBuffer()
          if (buffer.byteLength > 8_000_000) {
            return res.status(413).json({ error: `Reference image ${i + 1} is too large` })
          }
          const base64 = Buffer.from(buffer).toString('base64')
          img = `data:${contentType.split(';')[0]};base64,${base64}`
        } catch (fetchErr) {
          console.error(`Failed to fetch reference image ${i + 1}:`, fetchErr instanceof Error ? fetchErr.message : 'unknown')
          return res.status(400).json({ error: `Could not load reference image ${i + 1}. Please try re-uploading.` })
        }
      }

      if (img.length > MAX_IMAGE_BASE64_LENGTH) {
        return res.status(413).json({ error: `Reference image ${i + 1} is too large. Max ~7.5 MB per image.` })
      }
      const mimeMatch = img.match(/^data:([^;]+);base64,/)
      if (!mimeMatch) {
        return res.status(400).json({ error: `Reference image ${i + 1} is not valid image data` })
      }
      if (!ALLOWED_MIME_TYPES.includes(mimeMatch[1])) {
        return res.status(400).json({ error: `Reference image ${i + 1} has unsupported format. Use JPEG, PNG, or WebP.` })
      }
      normalizedImages.push(img)
    }

    // Validate description length
    if (description && typeof description === 'string' && description.length > MAX_DESCRIPTION_LENGTH) {
      return res.status(400).json({ error: `Description too long. Maximum ${MAX_DESCRIPTION_LENGTH} characters.` })
    }

    const geminiApiKey = process.env.GEMINI_API_KEY
    if (!geminiApiKey) {
      return res.status(500).json({ error: 'Gemini API key not configured' })
    }

    const ai = new GoogleGenAI({ apiKey: geminiApiKey })

    // Build user message with context
    let userMessage = 'Analyze these reference images and generate a detailed master prompt for this post style.\n\n'

    if (description && typeof description === 'string' && description.trim()) {
      userMessage += `USER DESCRIPTION OF DESIRED STYLE:\n${description.trim()}\n\n`
    }

    if (stylePreferences && typeof stylePreferences === 'object') {
      const prefs = stylePreferences as Record<string, string>
      const prefLines: string[] = []
      // Sanitize: truncate each pref field
      const safePref = (val: string) => (typeof val === 'string' ? val.slice(0, MAX_PREF_FIELD_LENGTH) : '')

      if (prefs.brandColors) prefLines.push(`Brand colors to preserve: ${safePref(prefs.brandColors)}`)
      if (prefs.typography) prefLines.push(`Typography preference: ${safePref(prefs.typography)}`)
      if (prefs.mood) prefLines.push(`Desired mood/tone: ${safePref(prefs.mood)}`)
      if (prefs.textLanguage) prefLines.push(`Text language in posts: ${safePref(prefs.textLanguage)}`)
      if (prefs.avoidElements) prefLines.push(`Elements to AVOID: ${safePref(prefs.avoidElements)}`)
      if (prefs.mustInclude) prefLines.push(`Must ALWAYS include: ${safePref(prefs.mustInclude)}`)
      if (prefs.layoutPreference) prefLines.push(`Layout preference: ${safePref(prefs.layoutPreference)}`)

      if (prefLines.length > 0) {
        userMessage += `STYLE PREFERENCES & BRAND SAFETY:\n${prefLines.join('\n')}\n\n`
      }
    }

    userMessage += 'Generate the master prompt JSON now.'

    // Build prompt parts with images
    type PromptPart = { text: string } | { inlineData: { mimeType: string; data: string } }
    const promptParts: PromptPart[] = [
      { text: STYLE_ANALYSIS_SYSTEM_PROMPT },
      { text: userMessage }
    ]

    // Add reference images (already normalized to base64 data URLs)
    for (const img of normalizedImages) {
      const base64Match = img.match(/^data:([^;]+);base64,(.+)$/)
      if (base64Match) {
        promptParts.push({
          inlineData: { mimeType: base64Match[1], data: base64Match[2] }
        })
      }
    }

    const response = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: promptParts,
      config: {
        temperature: 0.4,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 }
      }
    })

    // Check if response was truncated
    const finishReason = response.candidates?.[0]?.finishReason
    console.log('Gemini style analysis finishReason:', finishReason)
    if (finishReason === 'MAX_TOKENS') {
      console.error('Gemini style analysis response was truncated:', finishReason)
      return res.status(500).json({ error: 'AI response was too long and got cut off. Please try again with fewer images or a shorter description.' })
    }

    const parts = response.candidates?.[0]?.content?.parts || []
    const rawText = parts
      .filter((p) => 'text' in p && (p as { text: string }).text)
      .map((p) => (p as { text: string }).text)
      .join('') || ''

    // Clean up response — strip markdown fences if present
    let cleanJson = rawText.trim()
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    }

    let parsed: {
      master_prompt_es: string
      master_prompt_en: string
      extracted_colors?: string[]
      style_name_suggestion?: string
      style_description_es?: string
      style_description_en?: string
    }

    try {
      parsed = JSON.parse(cleanJson)
    } catch {
      console.error('Failed to parse Gemini style analysis response:', cleanJson.substring(0, 500))
      console.error('finishReason was:', finishReason, '| response length:', cleanJson.length)
      // Detect truncation: incomplete JSON that ends mid-value
      const looksTrauncated = !cleanJson.endsWith('}') || cleanJson.split('{').length > cleanJson.split('}').length
      if (looksTrauncated) {
        return res.status(500).json({ error: 'AI response was truncated and could not be parsed. Please try again — the analysis will retry with less detail.' })
      }
      return res.status(500).json({ error: 'AI returned invalid format. Please try again.' })
    }

    if (!parsed.master_prompt_es || !parsed.master_prompt_en) {
      return res.status(500).json({ error: 'AI did not generate valid prompts. Please try again.' })
    }

    // Log usage
    const usage = response.usageMetadata
    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'style_analysis',
      model: ANALYSIS_MODEL,
      inputTokens: usage?.promptTokenCount || 0,
      outputTokens: usage?.candidatesTokenCount || 0,
      thinkingTokens: usage?.thoughtsTokenCount || 0,
      success: true,
      metadata: { imageCount: normalizedImages.length }
    })

    return res.status(200).json({
      masterPromptEs: parsed.master_prompt_es,
      masterPromptEn: parsed.master_prompt_en,
      extractedColors: parsed.extracted_colors || [],
      styleNameSuggestion: parsed.style_name_suggestion || '',
      styleDescriptionEs: parsed.style_description_es || '',
      styleDescriptionEn: parsed.style_description_en || ''
    })

  } catch (error) {
    console.error('Style analysis error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'style_analysis',
      model: ANALYSIS_MODEL,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })

    return res.status(500).json({
      error: 'Style analysis failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
