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

    // Fetch URL content with realistic browser headers
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000) // 15 second timeout
    })

    if (!response.ok) {
      return res.status(400).json({ error: `Failed to fetch URL: ${response.status} ${response.statusText}` })
    }

    const contentType = response.headers.get('content-type') || ''
    const html = await response.text()

    // --- Extract structured data first (more reliable for SPAs) ---
    const extracted: string[] = []

    // Extract meta description
    const metaDescMatch = html.match(/<meta\s+(?:name|property)=["'](?:description|og:description|twitter:description)["']\s+content=["']([^"']+)["']/gi)
    if (metaDescMatch) {
      for (const m of metaDescMatch) {
        const contentMatch = m.match(/content=["']([^"']+)["']/i)
        if (contentMatch) extracted.push(contentMatch[1])
      }
    }
    // Also match reversed attribute order: content before name
    const metaDescReversed = html.match(/<meta\s+content=["']([^"']+)["']\s+(?:name|property)=["'](?:description|og:description|twitter:description)["']/gi)
    if (metaDescReversed) {
      for (const m of metaDescReversed) {
        const contentMatch = m.match(/content=["']([^"']+)["']/i)
        if (contentMatch) extracted.push(contentMatch[1])
      }
    }

    // Extract JSON-LD structured data
    const jsonLdMatches = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        try {
          const jsonContent = match.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim()
          const parsed = JSON.parse(jsonContent)
          // Extract useful fields from JSON-LD
          const fields = ['name', 'description', 'headline', 'articleBody', 'text', 
                         'about', 'abstract', 'price', 'priceCurrency', 'address',
                         'telephone', 'openingHours', 'servesCuisine', 'menu',
                         'aggregateRating', 'review', 'offers']
          const extractFromObj = (obj: Record<string, unknown>, depth = 0): string => {
            if (depth > 3) return ''
            const parts: string[] = []
            for (const field of fields) {
              if (obj[field]) {
                if (typeof obj[field] === 'string') {
                  parts.push(`${field}: ${obj[field]}`)
                } else if (typeof obj[field] === 'object') {
                  parts.push(`${field}: ${JSON.stringify(obj[field])}`)
                }
              }
            }
            // Recurse into arrays (e.g. @graph)
            if (Array.isArray(obj['@graph'])) {
              for (const item of obj['@graph'] as Record<string, unknown>[]) {
                parts.push(extractFromObj(item, depth + 1))
              }
            }
            return parts.filter(Boolean).join('\n')
          }
          const ldText = extractFromObj(parsed)
          if (ldText) extracted.push(ldText)
        } catch {
          // Invalid JSON-LD, skip
        }
      }
    }

    // --- Then extract body text as fallback/supplement ---
    let bodyText = html
      // Remove scripts
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      // Remove styles
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      // Remove nav, header, footer (usually boilerplate)
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, '')
      // Remove HTML tags
      .replace(/<[^>]+>/g, ' ')
      // Decode HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_m: string, code: string) => String.fromCharCode(parseInt(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_m: string, code: string) => String.fromCharCode(parseInt(code, 16)))
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()

    // Combine structured data + body text
    let textContent = ''
    if (extracted.length > 0) {
      textContent = '=== Structured Data ===\n' + extracted.join('\n\n') + '\n\n=== Page Content ===\n' + bodyText
    } else {
      textContent = bodyText
    }

    // Limit content length to prevent token overflow
    const maxLength = 10000
    if (textContent.length > maxLength) {
      textContent = textContent.substring(0, maxLength) + '...[truncated]'
    }

    // If we got almost nothing, fallback to Jina Reader (renders JS, free API)
    if (textContent.replace(/\s/g, '').length < 50) {
      try {
        console.log('Direct fetch got minimal content, falling back to Jina Reader for:', url)
        const jinaResponse = await fetch(`https://r.jina.ai/${url}`, {
          headers: {
            'Accept': 'text/plain',
            'X-Return-Format': 'text'
          },
          signal: AbortSignal.timeout(20000)
        })
        if (jinaResponse.ok) {
          let jinaText = await jinaResponse.text()
          if (jinaText.length > 10000) {
            jinaText = jinaText.substring(0, 10000) + '...[truncated]'
          }
          if (jinaText.replace(/\s/g, '').length > 50) {
            const jinaTitleMatch = jinaText.match(/^Title:\s*(.+)$/m)
            const jinaTitle = jinaTitleMatch?.[1]?.trim() || parsedUrl.hostname

            await logApiUsage({
              userId: user.id,
              userEmail: user.email || undefined,
              feature: 'url_fetch',
              model: 'web-scraper',
              success: true,
              metadata: { url: parsedUrl.hostname, contentLength: jinaText.length, fallback: 'jina-reader' }
            })

            return res.status(200).json({
              success: true,
              title: jinaTitle,
              content: jinaText,
              url,
              contentType,
              source: 'jina-reader'
            })
          }
        }
      } catch (jinaErr) {
        console.warn('Jina Reader fallback failed:', jinaErr)
      }

      // Both direct fetch and Jina failed
      return res.status(200).json({
        success: true,
        title: parsedUrl.hostname,
        content: `[Minimal content extracted from ${parsedUrl.hostname}. The site may require JavaScript rendering or block automated access.]`,
        url,
        contentType,
        warning: 'minimal_content'
      })
    }

    // Extract page title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const ogTitleMatch = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:title["']/i)
    const title = ogTitleMatch?.[1]?.trim() || titleMatch?.[1]?.trim() || parsedUrl.hostname

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
