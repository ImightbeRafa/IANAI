import { supabase } from '../../lib/supabase'

function apiUrl(path: string): string {
  return import.meta.env.PROD ? path : `http://localhost:3000${path}`
}

export type ChatShellOpenEnsureResult = {
  ok: boolean
  granted: boolean
  already: boolean
  credits: number
  creditsRemaining: number
  showWelcome: boolean
  tourDone: boolean
}

async function authHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  }
}

export async function ensureChatShellOpenGift(): Promise<ChatShellOpenEnsureResult> {
  const headers = await authHeaders()
  const response = await fetch(apiUrl('/api/chat-shell-open'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'ensure' }),
  })
  const json = await response.json().catch(() => ({})) as ChatShellOpenEnsureResult & { error?: string }
  if (!response.ok) {
    throw new Error(json.error || 'Could not open chat gift')
  }
  return json
}

export async function markChatShellWelcomeSeenClient(): Promise<void> {
  const headers = await authHeaders()
  await fetch(apiUrl('/api/chat-shell-open'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'welcome_seen' }),
  })
}

export async function markChatShellTourDoneClient(): Promise<void> {
  const headers = await authHeaders()
  await fetch(apiUrl('/api/chat-shell-open'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'tour_done' }),
  })
}
