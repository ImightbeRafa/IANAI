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
    const { url } = req.query

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing video URL' })
    }

    // Only allow xAI video URLs
    if (!url.startsWith('https://vidgen.x.ai/')) {
      return res.status(400).json({ error: 'Invalid video URL' })
    }

    // Fetch video from xAI
    const videoResponse = await fetch(url)
    
    if (!videoResponse.ok) {
      return res.status(videoResponse.status).json({ error: 'Failed to fetch video' })
    }

    const videoBuffer = await videoResponse.arrayBuffer()

    // Set headers for video download
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"')
    res.setHeader('Content-Length', videoBuffer.byteLength)

    return res.status(200).send(Buffer.from(videoBuffer))

  } catch (error) {
    console.error('Video proxy error:', error)
    return res.status(500).json({ error: 'Failed to proxy video' })
  }
}
