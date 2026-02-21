import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { logApiUsage } from './lib/usage-logger.js'
import { checkRateLimit } from './lib/rate-limit.js'

const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  // Rate limit: 10 transcriptions per 60 seconds per user
  const rateCheck = checkRateLimit(`voice:${user.id}`, { maxRequests: 10, windowSeconds: 60 })
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'Demasiadas solicitudes de audio',
      message: `Por favor espera ${rateCheck.resetInSeconds} segundos.`,
      retryAfter: rateCheck.resetInSeconds
    })
  }

  try {
    const { audio, mimeType = 'audio/webm', language = 'es' } = req.body

    if (!audio || typeof audio !== 'string') {
      return res.status(400).json({ error: 'Audio data (base64) is required' })
    }

    const openaiApiKey = process.env.OPENAI_API_KEY
    if (!openaiApiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' })
    }

    // Convert base64 to Buffer
    const audioBuffer = Buffer.from(audio, 'base64')

    // Validate size (max 25MB — OpenAI Whisper limit)
    if (audioBuffer.length > 25 * 1024 * 1024) {
      return res.status(400).json({ error: 'Audio file too large (max 25MB)' })
    }

    // Determine file extension from MIME type
    const extMap: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/mp4': 'mp4',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/x-m4a': 'm4a',
      'audio/mp4;codecs=opus': 'mp4'
    }
    const ext = extMap[mimeType] || 'webm'

    // Build multipart form data for OpenAI Whisper API
    const boundary = '----VoiceBoundary' + Date.now()
    const formParts: Buffer[] = []

    // File field
    formParts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    ))
    formParts.push(audioBuffer)
    formParts.push(Buffer.from('\r\n'))

    // Model field — whisper-1 is OpenAI's production Whisper model
    formParts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
    ))

    // Language field
    formParts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language === 'es' ? 'es' : 'en'}\r\n`
    ))

    // Response format
    formParts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n`
    ))

    // Close boundary
    formParts.push(Buffer.from(`--${boundary}--\r\n`))

    const formBody = Buffer.concat(formParts)

    const startTime = Date.now()

    const response = await fetch(OPENAI_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: formBody
    })

    const latency = Date.now() - startTime

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI Whisper error:', { status: response.status, error: errorText, latency })

      await logApiUsage({
        userId: user.id,
        userEmail: user.email,
        feature: 'voice_transcription',
        model: 'whisper-1',
        success: false,
        errorMessage: errorText,
        metadata: { latency, audioSizeBytes: audioBuffer.length }
      })

      return res.status(response.status).json({
        error: 'Transcription failed',
        details: errorText
      })
    }

    const result = await response.json()
    const text = result.text?.trim() || ''

    // Estimate audio duration from file size (rough: ~16kbps for webm/opus)
    const estimatedDurationSec = Math.max(1, Math.round(audioBuffer.length / 2000))

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'voice_transcription',
      model: 'whisper-1',
      success: true,
      metadata: {
        latency,
        audioSizeBytes: audioBuffer.length,
        estimatedDurationSec,
        textLength: text.length,
        language
      }
    })

    return res.status(200).json({ text })

  } catch (error) {
    console.error('Transcription error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'voice_transcription',
      model: 'whisper-1',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })

    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
