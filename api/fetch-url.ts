import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { logApiUsage } from './lib/usage-logger.js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

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
    const { url } = req.body

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' })
    }

    // Validate URL format
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Invalid protocol')
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' })
    }

    // SSRF protection: block internal/private IPs and localhost
    const hostname = parsedUrl.hostname.toLowerCase()
    const blockedPatterns = [
      'localhost', '127.0.0.1', '0.0.0.0', '::1',
      '169.254.', '10.', '172.16.', '172.17.', '172.18.', '172.19.',
      '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
      '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
      '192.168.', 'metadata.google', '169.254.169.254'
    ]
    if (blockedPatterns.some(p => hostname.startsWith(p) || hostname === p)) {
      return res.status(400).json({ error: 'URL not allowed' })
    }

    // Fetch URL content
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AdvanceAI/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    })

    if (!response.ok) {
      return res.status(400).json({ error: `Failed to fetch URL: ${response.status}` })
    }

    const contentType = response.headers.get('content-type') || ''
    const html = await response.text()

    // Extract text content from HTML
    let textContent = html
      // Remove scripts
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      // Remove styles
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      // Remove HTML tags
      .replace(/<[^>]+>/g, ' ')
      // Decode HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()

    // Limit content length to prevent token overflow
    const maxLength = 8000
    if (textContent.length > maxLength) {
      textContent = textContent.substring(0, maxLength) + '...[truncated]'
    }

    // Extract page title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : parsedUrl.hostname

    // Log usage - URL fetching is tracked as a utility feature
    await logApiUsage({
      userId: user.id,
      userEmail: user.email || undefined,
      feature: 'url_fetch',
      model: 'web-scraper',
      success: true,
      metadata: { 
        url: parsedUrl.hostname,
        contentLength: textContent.length,
        contentType
      }
    })

    return res.status(200).json({
      success: true,
      title,
      content: textContent,
      url: url,
      contentType
    })

  } catch (error) {
    console.error('URL fetch error:', error)
    
    // Log failed usage
    await logApiUsage({
      userId: user.id,
      userEmail: user.email || undefined,
      feature: 'url_fetch',
      model: 'web-scraper',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })
    
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch URL content'
    })
  }
}
