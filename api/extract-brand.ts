import type { VercelRequest, VercelResponse } from '@vercel/node'
import { logApiUsage } from './lib/usage-logger.js'
import { GoogleGenAI } from '@google/genai'
import { supabaseAdmin as supabase } from './lib/supabase-admin.js'
import { assertPublicHttpUrl, fetchPublicUrl } from './lib/url-safety.js'

// ── Helpers: extract brand hints from raw HTML ──────────────────────
function extractColorsFromHtml(html: string): string[] {
  const colors = new Set<string>()
  // CSS hex colors (3/6 digits)
  const hexMatches = html.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || []
  for (const h of hexMatches) {
    if (h !== '#fff' && h !== '#FFF' && h !== '#ffffff' && h !== '#FFFFFF' &&
        h !== '#000' && h !== '#000000' && h !== '#333' && h !== '#333333' &&
        h !== '#666' && h !== '#666666' && h !== '#999' && h !== '#999999' &&
        h !== '#ccc' && h !== '#CCC' && h !== '#eee' && h !== '#EEE') {
      colors.add(h.toLowerCase())
    }
  }
  // CSS rgb/rgba
  const rgbMatches = html.match(/rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/g) || []
  for (const r of rgbMatches) colors.add(r)
  return Array.from(colors).slice(0, 20)
}

function extractFontsFromHtml(html: string): string[] {
  const fonts = new Set<string>()
  // font-family declarations
  const fontMatches = html.match(/font-family\s*:\s*["']?([^;"'}\n]+)/gi) || []
  for (const f of fontMatches) {
    const val = f.replace(/font-family\s*:\s*/i, '').replace(/["']/g, '').trim()
    if (val && val.length < 60 && !val.startsWith('inherit') && !val.startsWith('var(')) {
      fonts.add(val.split(',')[0].trim())
    }
  }
  // Google Fonts links
  const gfMatches = html.match(/fonts\.googleapis\.com\/css2?\?family=([^"&]+)/g) || []
  for (const g of gfMatches) {
    const familyMatch = g.match(/family=([^&"]+)/)
    if (familyMatch) {
      const families = decodeURIComponent(familyMatch[1]).split('|')
      for (const fam of families) fonts.add(fam.split(':')[0].replace(/\+/g, ' ').trim())
    }
  }
  return Array.from(fonts).slice(0, 10)
}

function extractMetaAndTitle(html: string): { title: string; description: string; ogImage: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const ogTitleMatch = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:title["']/i)
  const title = ogTitleMatch?.[1]?.trim() || titleMatch?.[1]?.trim() || ''

  const descMatch = html.match(/<meta\s+(?:name|property)=["'](?:description|og:description)["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:name|property)=["'](?:description|og:description)["']/i)
  const description = descMatch?.[1]?.trim() || ''

  const ogImgMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i)
  const ogImage = ogImgMatch?.[1]?.trim() || ''

  return { title, description, ogImage }
}

function extractLogoUrls(html: string, baseUrl: string): string[] {
  const logos: string[] = []
  // Favicons / apple-touch-icon
  const iconMatches = html.match(/<link\s+[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)[^>]*>/gi) || []
  for (const m of iconMatches) {
    const href = m.match(/href=["']([^"']+)["']/i)
    if (href) {
      try { logos.push(new URL(href[1], baseUrl).href) } catch { /* skip */ }
    }
  }
  // Images with "logo" in src/alt/class
  const imgMatches = html.match(/<img\s+[^>]*(?:class|alt|src)=["'][^"']*logo[^"']*["'][^>]*>/gi) || []
  for (const m of imgMatches) {
    const src = m.match(/src=["']([^"']+)["']/i)
    if (src) {
      try { logos.push(new URL(src[1], baseUrl).href) } catch { /* skip */ }
    }
  }
  return logos.slice(0, 5)
}

// ── Main handler ─────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing authorization' })
  if (!supabase) return res.status(500).json({ error: 'Server not configured' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Invalid or expired token' })

  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) return res.status(500).json({ error: 'AI service not configured' })

  try {
    const { url, language = 'es' } = req.body
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' })

    let parsedUrl: URL
    try {
      parsedUrl = assertPublicHttpUrl(url)
    } catch {
      return res.status(400).json({ error: 'Invalid or disallowed URL' })
    }

    // ── 1. Fetch page HTML ───────────────────────────────────────────
    let html = ''
    try {
      const response = await fetchPublicUrl(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
          'Accept-Encoding': 'identity',
        },
        timeoutMs: 15000
      })
      if (!response.ok) throw new Error(`${response.status}`)
      html = await response.text()
    } catch (fetchErr) {
      // Fallback: Jina Reader
      try {
        const jinaResp = await fetch(`https://r.jina.ai/${url}`, {
          headers: { 'Accept': 'text/plain', 'X-Return-Format': 'text' },
          signal: AbortSignal.timeout(20000)
        })
        if (jinaResp.ok) html = await jinaResp.text()
      } catch { /* ignore */ }
      if (!html) {
        return res.status(400).json({ error: `Failed to fetch URL: ${fetchErr instanceof Error ? fetchErr.message : 'unknown'}` })
      }
    }

    // ── 2. Extract hints from HTML ───────────────────────────────────
    const colors = extractColorsFromHtml(html)
    const fonts = extractFontsFromHtml(html)
    const meta = extractMetaAndTitle(html)
    const logos = extractLogoUrls(html, url)

    // Strip HTML for text content
    let bodyText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ').trim()
    if (bodyText.length > 6000) bodyText = bodyText.substring(0, 6000) + '...'

    // ── 3. AI brand extraction ───────────────────────────────────────
    const systemPrompt = language === 'es'
      ? `Eres un analista de branding experto. Extraes la identidad de marca de un sitio web.
Responde SOLO con un JSON válido (sin markdown, sin backticks) con estos campos:
{
  "brand_name": "nombre de la marca",
  "tagline": "eslogan o frase clave (null si no hay)",
  "primary_color": "#hex (color dominante de marca)",
  "secondary_color": "#hex (segundo color, null si no hay)",
  "accent_color": "#hex (color de acento/CTA, null si no hay)",
  "font_primary": "fuente principal (null si no se detecta)",
  "font_secondary": "fuente secundaria (null si no se detecta)",
  "voice_tone": "descripción breve del tono (ej: profesional, cercano, elegante)",
  "key_phrases": ["frase 1", "frase 2", "frase 3"],
  "style_notes": "notas de estilo visual (ej: minimalista, uso de gradientes, fotografía lifestyle)"
}`
      : `You are an expert branding analyst. Extract the brand identity from a website.
Respond ONLY with valid JSON (no markdown, no backticks) with these fields:
{
  "brand_name": "brand name",
  "tagline": "tagline or key phrase (null if none)",
  "primary_color": "#hex (dominant brand color)",
  "secondary_color": "#hex (second color, null if none)",
  "accent_color": "#hex (accent/CTA color, null if none)",
  "font_primary": "primary font (null if not detected)",
  "font_secondary": "secondary font (null if not detected)",
  "voice_tone": "brief tone description (e.g. professional, friendly, elegant)",
  "key_phrases": ["phrase 1", "phrase 2", "phrase 3"],
  "style_notes": "visual style notes (e.g. minimalist, gradient use, lifestyle photography)"
}`

    const userContent = `Website: ${url}
Title: ${meta.title}
Description: ${meta.description}
Colors found in CSS: ${colors.join(', ') || 'none'}
Fonts found: ${fonts.join(', ') || 'none'}
Logo URLs: ${logos.join(', ') || 'none'}
OG Image: ${meta.ogImage || 'none'}

Page text (first 6000 chars):
${bodyText}`

    const ai = new GoogleGenAI({ apiKey: geminiKey })
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.3,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    })

    const rawText = result.candidates?.[0]?.content?.parts?.[0]
    const aiText = rawText && 'text' in rawText ? rawText.text || '' : ''

    // Parse JSON from AI response (strip any accidental markdown wrapping)
    let brandData: Record<string, unknown> = {}
    try {
      const cleaned = aiText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      brandData = JSON.parse(cleaned)
    } catch {
      // Attempt JSON repair: close truncated strings/objects/arrays
      try {
        let repaired = aiText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
        // Remove trailing comma if present
        repaired = repaired.replace(/,\s*$/, '')
        // Close any unclosed string
        const quoteCount = (repaired.match(/"/g) || []).length
        if (quoteCount % 2 !== 0) repaired += '"'
        // Track bracket/brace nesting in order to close properly
        const stack: string[] = []
        for (const ch of repaired) {
          if (ch === '{') stack.push('}')
          else if (ch === '[') stack.push(']')
          else if (ch === '}' || ch === ']') stack.pop()
        }
        // Close in reverse order
        while (stack.length > 0) repaired += stack.pop()
        brandData = JSON.parse(repaired)
        console.log('Repaired truncated AI brand JSON successfully')
      } catch {
        console.warn('Failed to parse AI brand extraction:', aiText.substring(0, 500))
        return res.status(200).json({
          success: false,
          error: 'AI could not extract brand data from this URL'
        })
      }
    }

    // Token usage
    const usage = result.usageMetadata
    const inputTokens = usage?.promptTokenCount || 0
    const outputTokens = usage?.candidatesTokenCount || 0
    const thinkingTokens = usage?.thoughtsTokenCount || 0

    await logApiUsage({
      userId: user.id,
      userEmail: user.email || undefined,
      feature: 'brand_extraction',
      model: 'gemini-2.5-flash',
      inputTokens,
      outputTokens,
      thinkingTokens,
      success: true,
      metadata: { action: 'extract_brand', url: parsedUrl.hostname }
    })

    return res.status(200).json({
      success: true,
      brand: {
        ...brandData,
        logo_url: logos[0] || meta.ogImage || null,
        css_colors: colors.slice(0, 10),
        source_url: url
      }
    })

  } catch (error) {
    console.error('Brand extraction error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email || undefined,
      feature: 'brand_extraction',
      model: 'gemini-2.5-flash',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      metadata: { action: 'extract_brand' }
    })

    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to extract brand data'
    })
  }
}
