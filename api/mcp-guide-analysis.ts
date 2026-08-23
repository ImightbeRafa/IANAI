/**
 * Cron / manual trigger for MCP GUIDE URL analysis worker.
 * Auth: Authorization: Bearer <CRON_SECRET> (or Vercel Cron header).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { processNextMcpUrlIntake } from './lib/mcp/url-analysis-worker.js'

export const maxDuration = 60

function authorizeCron(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.authorization || ''
  if (auth === `Bearer ${secret}`) return true
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when configured
  const vercelCron = req.headers['x-vercel-cron']
  if (vercelCron && auth === `Bearer ${secret}`) return true
  return false
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!authorizeCron(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const result = await processNextMcpUrlIntake()
    res.status(200).json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Worker failed'
    console.error('mcp-guide-analysis', message)
    res.status(500).json({ ok: false, error: message })
  }
}
