import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { logApiUsage } from './lib/usage-logger.js'
import {
  runSiteAnalysis,
  SITE_ANALYSIS_MODEL,
  extractPageSignals,
  pickOfficialLogo,
  selectCrawlLinks,
} from './lib/site-analysis.js'

export const maxDuration = 60

export { extractPageSignals, pickOfficialLogo, selectCrawlLinks }
export type { SiteAnalysisResult, SiteFieldEvidence, SiteFieldOrigin } from './lib/site-analysis.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return
  const rate = checkRateLimit(user.id, { maxRequests: 6, windowSeconds: 60 })
  if (!rate.allowed) return res.status(429).json({ error: 'rate_limit', resetInSeconds: rate.resetInSeconds })

  const { url, language = 'es', notes = '' } = req.body || {}
  if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: 'URL is required' })

  let host = 'unknown'
  try {
    const { analysis, usage, normalizedUrl } = await runSiteAnalysis({
      url,
      language: language === 'en' ? 'en' : 'es',
      notes: typeof notes === 'string' ? notes : '',
      rehostLogoForUserId: user.id,
    })
    host = new URL(normalizedUrl).hostname
    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'brand_extraction',
      model: SITE_ANALYSIS_MODEL,
      inputTokens: usage.input,
      outputTokens: usage.output,
      thinkingTokens: usage.thinking,
      success: true,
      metadata: { action: 'analyze_site', host, pages: analysis.pages.length },
    })
    return res.status(200).json({ success: true, analysis })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to analyze website'
    if (/invalid|disallowed|https/i.test(message)) {
      return res.status(400).json({ error: message.includes('https') ? 'Invalid or disallowed URL' : message })
    }
    await logApiUsage({
      userId: user.id,
      userEmail: user.email,
      feature: 'brand_extraction',
      model: SITE_ANALYSIS_MODEL,
      success: false,
      errorMessage: message,
      metadata: { action: 'analyze_site', host },
    })
    return res.status(502).json({ error: message })
  }
}
