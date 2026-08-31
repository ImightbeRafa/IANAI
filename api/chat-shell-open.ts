import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './lib/auth.js'
import { userHasChatShellAccess } from './lib/chat-shell-access.js'
import {
  ensureChatShellOpenGift,
  markChatShellTourDone,
  markChatShellWelcomeSeen,
} from './lib/credits/chat-shell-gift.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await requireAuth(req, res)
  if (!user) return

  const hasAccess = await userHasChatShellAccess(user.id)
  if (!hasAccess) {
    return res.status(403).json({ error: 'Chat is not available for this account' })
  }

  const action = typeof req.body?.action === 'string' ? req.body.action : 'ensure'

  if (action === 'welcome_seen') {
    const ok = await markChatShellWelcomeSeen(user.id)
    return res.status(200).json({ ok, welcomeSeen: ok })
  }

  if (action === 'tour_done') {
    const ok = await markChatShellTourDone(user.id)
    return res.status(200).json({ ok, tourDone: ok, welcomeSeen: ok })
  }

  const result = await ensureChatShellOpenGift(user.id)
  return res.status(200).json(result)
}
