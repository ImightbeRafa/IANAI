import { supabase } from '../lib/supabase'
import type { Conversation, Message, Script, DashboardStats } from '../types'

export async function createConversation(userId: string, title: string): Promise<Conversation> {
  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId, title, status: 'active' })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getConversations(userId: string): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single()

  if (error) return null
  return data
}

export async function updateConversation(
  conversationId: string, 
  updates: Partial<Pick<Conversation, 'title' | 'status'>>
): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) throw error
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const { error: messagesError } = await supabase
    .from('messages')
    .delete()
    .eq('conversation_id', conversationId)

  if (messagesError) throw messagesError

  const { error: scriptsError } = await supabase
    .from('scripts')
    .delete()
    .eq('conversation_id', conversationId)

  if (scriptsError) throw scriptsError

  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)

  if (error) throw error
}

export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role, content })
    .select()
    .single()

  if (error) throw error

  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  return data
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data || []
}

export async function saveScript(
  conversationId: string,
  userId: string,
  title: string,
  content: string,
  angle: Script['angle']
): Promise<Script> {
  const { data, error } = await supabase
    .from('scripts')
    .insert({ conversation_id: conversationId, user_id: userId, title, content, angle })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getScripts(userId: string): Promise<Script[]> {
  const { data, error } = await supabase
    .from('scripts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getScriptsByConversation(conversationId: string): Promise<Script[]> {
  const { data, error } = await supabase
    .from('scripts')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function deleteScript(scriptId: string): Promise<void> {
  const { error } = await supabase
    .from('scripts')
    .delete()
    .eq('id', scriptId)

  if (error) throw error
}

export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const now = new Date()
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [conversationsResult, scriptsResult, activeResult, monthlyScriptsResult] = await Promise.all([
    supabase.from('conversations').select('id', { count: 'exact' }).eq('user_id', userId),
    supabase.from('scripts').select('id', { count: 'exact' }).eq('user_id', userId),
    supabase.from('conversations').select('id', { count: 'exact' }).eq('user_id', userId).eq('status', 'active'),
    supabase.from('scripts').select('id', { count: 'exact' }).eq('user_id', userId).gte('created_at', firstDayOfMonth)
  ])

  return {
    totalConversations: conversationsResult.count || 0,
    totalScripts: scriptsResult.count || 0,
    activeConversations: activeResult.count || 0,
    scriptsThisMonth: monthlyScriptsResult.count || 0
  }
}

export async function searchConversations(userId: string, query: string): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .ilike('title', `%${query}%`)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data || []
}
