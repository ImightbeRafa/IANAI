import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { fetchPublicImageAsDataUrl } from './lib/fetch-image-data-url.js'
import { assertPublicHttpUrl } from './lib/url-safety.js'

/**
 * Authenticated proxy: fetch a public image server-side and return a data URL.
 * Chat-shell kit/store refs must not be fetched in the browser (CSP connect-src).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
  if (!url) return res.status(400).json({ error: 'URL is required' })

  try {
    assertPublicHttpUrl(url)
  } catch {
    return res.status(400).json({ error: 'Invalid or disallowed URL' })
  }

  const dataUrl = await fetchPublicImageAsDataUrl(url)
  if (!dataUrl) {
    return res.status(400).json({
      error: 'Could not load that image from the server. Re-upload the product photo or logo and try again.',
    })
  }

  return res.status(200).json({ dataUrl })
}
