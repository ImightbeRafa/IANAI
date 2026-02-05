import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Verify authentication
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization' })
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Server not configured' })
  }

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  try {
    // Use WHATWG URL API to parse query params (avoids url.parse deprecation)
    const fullUrl = new URL(req.url || '', `https://${req.headers.host}`)
    const videoUrl = fullUrl.searchParams.get('url')

    if (!videoUrl || typeof videoUrl !== 'string') {
      return res.status(400).json({ error: 'Missing video URL' })
    }

    // Validate video URL domain
    let parsedVideoUrl: URL
    try {
      parsedVideoUrl = new URL(videoUrl)
    } catch {
      return res.status(400).json({ error: 'Invalid video URL format' })
    }

    const allowedDomains = ['.x.ai', '.xai.com', '.kwimgs.com', '.klingai.com', '.fal.media', '.fal.ai', '.fal.run']
    const isAllowed = allowedDomains.some(d => parsedVideoUrl.hostname.endsWith(d))
    if (!isAllowed) {
      return res.status(400).json({ error: 'Invalid video URL domain' })
    }

    // Fetch video from xAI
    const videoResponse = await fetch(videoUrl)
    
    if (!videoResponse.ok) {
      console.error('Video fetch failed:', { status: videoResponse.status, url: videoUrl.substring(0, 80) })
      return res.status(videoResponse.status).json({ error: 'Failed to fetch video' })
    }

    const videoBuffer = await videoResponse.arrayBuffer()

    // Set headers for video download
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"')
    res.setHeader('Content-Length', videoBuffer.byteLength)
    res.setHeader('Cache-Control', 'no-cache')

    return res.status(200).send(Buffer.from(videoBuffer))

  } catch (error) {
    console.error('Video proxy error:', error)
    return res.status(500).json({ error: 'Failed to proxy video' })
  }
}
