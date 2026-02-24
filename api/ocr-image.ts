import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { logApiUsage, estimateTokens } from './lib/usage-logger.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { GoogleGenAI } from '@google/genai'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_IMAGE_BASE64_LENGTH = 10_000_000 // ~7.5 MB decoded

const OCR_MODEL = 'gemini-2.5-flash'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  // Rate limit: 20 OCR requests per 60 seconds
  const rateCheck = checkRateLimit(user.id, { maxRequests: 20, windowSeconds: 60 })
  if (!rateCheck.allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded', resetInSeconds: rateCheck.resetInSeconds })
  }

  const geminiApiKey = process.env.GEMINI_API_KEY
  if (!geminiApiKey) {
    return res.status(500).json({ error: 'Gemini API key not configured' })
  }

  try {
    const { image, mimeType = 'image/jpeg' } = req.body as {
      image: string       // base64-encoded image
      mimeType?: string
    }

    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Base64 image is required' })
    }

    if (image.length > MAX_IMAGE_BASE64_LENGTH) {
      return res.status(400).json({ error: 'Image too large. Maximum ~7.5 MB.' })
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return res.status(400).json({ error: `Unsupported image type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` })
    }

    const ai = new GoogleGenAI({ apiKey: geminiApiKey })

    const response = await ai.models.generateContent({
      model: OCR_MODEL,
      contents: [{
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType,
              data: image
            }
          },
          {
            text: `Extract ALL text from this conversation screenshot verbatim. Preserve the message structure — clearly separate each message with the sender label if visible (e.g. "Client:", "Me:", or the contact name shown).

Rules:
- Extract every single message visible in the screenshot
- Preserve line breaks and message boundaries
- If there are timestamps, include them
- If you can identify who sent each message (by position, color, or label), prefix each message accordingly
- Do NOT add any interpretation, summary, or commentary — only the raw extracted text
- If the image is not a conversation screenshot, still extract all visible text`
          }
        ]
      }]
    })

    const extractedText = response.text || ''

    if (!extractedText.trim()) {
      return res.status(200).json({
        success: true,
        text: '',
        warning: 'No text could be extracted from the image'
      })
    }

    // Log usage
    const inputTokens = response.usageMetadata?.promptTokenCount || estimateTokens(image.substring(0, 100))
    const outputTokens = response.usageMetadata?.candidatesTokenCount || estimateTokens(extractedText)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'ocr',
      model: OCR_MODEL,
      inputTokens,
      outputTokens,
      success: true,
      metadata: { mimeType, textLength: extractedText.length }
    })

    return res.status(200).json({
      success: true,
      text: extractedText
    })

  } catch (error) {
    console.error('OCR error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'ocr',
      model: OCR_MODEL,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })

    return res.status(500).json({
      error: 'Failed to extract text from image. Please try again.'
    })
  }
}
