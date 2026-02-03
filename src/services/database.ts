import { supabase } from '../lib/supabase'
import type { 
  Profile, 
  Team, 
  TeamMember, 
  Client, 
  Product, 
  ChatSession, 
  Message, 
  Script,
  ProductFormData,
  DashboardStats,
  TeamDashboardStats
} from '../types'

// =============================================
// PROFILE FUNCTIONS
// =============================================
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) return null
  return data
}

export async function updateProfile(userId: string, updates: Partial<Profile>): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)

  if (error) throw error
}

// =============================================
// TEAM FUNCTIONS
// =============================================
export async function createTeam(ownerId: string, name: string): Promise<Team> {
  const { data, error } = await supabase
    .from('teams')
    .insert({ owner_id: ownerId, name })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getTeam(userId: string): Promise<Team | null> {
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, teams(*)')
    .eq('user_id', userId)
    .single()

  if (error) return null
  return data?.teams as unknown as Team
}

export async function getTeamMembers(teamId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from('team_members')
    .select('*, profile:profiles(*)')
    .eq('team_id', teamId)

  if (error) throw error
  return data || []
}

export async function inviteTeamMember(teamId: string, email: string): Promise<void> {
  // First check member count
  const { count } = await supabase
    .from('team_members')
    .select('*', { count: 'exact' })
    .eq('team_id', teamId)

  const { data: team } = await supabase
    .from('teams')
    .select('max_members')
    .eq('id', teamId)
    .single()

  if (count && team && count >= team.max_members) {
    throw new Error('Team has reached maximum members')
  }

  // Find user by email
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()

  if (!profile) {
    throw new Error('User not found with that email')
  }

  const { error } = await supabase
    .from('team_members')
    .insert({ team_id: teamId, user_id: profile.id, role: 'member' })

  if (error) throw error
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId)

  if (error) throw error
}

// =============================================
// CLIENT FUNCTIONS (Teams only)
// =============================================
export async function createClient(teamId: string, userId: string, name: string): Promise<Client> {
  const { data, error } = await supabase
    .from('clients')
    .insert({ team_id: teamId, created_by: userId, name })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getClients(teamId: string): Promise<Client[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('team_id', teamId)
    .order('name')

  if (error) throw error
  return data || []
}

export async function getClient(clientId: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single()

  if (error) return null
  return data
}

export async function updateClient(clientId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('clients')
    .update({ name })
    .eq('id', clientId)

  if (error) throw error
}

export async function deleteClient(clientId: string): Promise<void> {
  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', clientId)

  if (error) throw error
}

// =============================================
// PRODUCT FUNCTIONS
// =============================================
export async function createProduct(
  data: ProductFormData,
  ownerId: string,
  clientId?: string
): Promise<Product> {
  const { data: product, error } = await supabase
    .from('products')
    .insert({
      owner_id: ownerId,
      client_id: clientId || null,
      name: data.name,
      type: data.type,
      description: data.description,
      offer: data.offer,
      awareness_level: data.awareness_level,
      market_alternatives: data.market_alternatives,
      customer_values: data.customer_values,
      purchase_reason: data.purchase_reason,
      target_audience: data.target_audience,
      call_to_action: data.call_to_action
    })
    .select()
    .single()

  if (error) throw error
  return product
}

export async function getProducts(userId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('owner_id', userId)
    .is('client_id', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getClientProducts(clientId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getProduct(productId: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .select('*, client:clients(*)')
    .eq('id', productId)
    .single()

  if (error) return null
  return data
}

export async function updateProduct(productId: string, updates: Partial<ProductFormData>): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', productId)

  if (error) throw error
}

export async function deleteProduct(productId: string): Promise<void> {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', productId)

  if (error) throw error
}

export async function assignProductToClient(productId: string, clientId: string): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({ client_id: clientId })
    .eq('id', productId)

  if (error) throw error
}

// =============================================
// CHAT SESSION FUNCTIONS
// =============================================
export async function createChatSession(
  productId: string, 
  userId: string, 
  title: string = 'New Session',
  context?: string
): Promise<ChatSession> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({ product_id: productId, user_id: userId, title, context })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getChatSessions(productId: string): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('product_id', productId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getChatSession(sessionId: string): Promise<ChatSession | null> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*, product:products(*)')
    .eq('id', sessionId)
    .single()

  if (error) return null
  return data
}

export async function updateChatSession(
  sessionId: string, 
  updates: Partial<Pick<ChatSession, 'title' | 'status' | 'context'>>
): Promise<void> {
  const { error } = await supabase
    .from('chat_sessions')
    .update(updates)
    .eq('id', sessionId)

  if (error) throw error
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_sessions')
    .delete()
    .eq('id', sessionId)

  if (error) throw error
}

// =============================================
// MESSAGE FUNCTIONS
// =============================================
export async function addMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ session_id: sessionId, role, content })
    .select()
    .single()

  if (error) throw error

  // Update session timestamp
  await supabase
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  return data
}

export async function getMessages(sessionId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data || []
}

// =============================================
// SCRIPT FUNCTIONS
// =============================================
export async function saveScript(
  sessionId: string,
  productId: string,
  title: string,
  content: string,
  angle?: string
): Promise<Script> {
  const { data, error } = await supabase
    .from('scripts')
    .insert({ session_id: sessionId, product_id: productId, title, content, angle })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getScripts(productId: string): Promise<Script[]> {
  const { data, error } = await supabase
    .from('scripts')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getAllUserScripts(userId: string): Promise<Script[]> {
  const { data, error } = await supabase
    .from('scripts')
    .select('*, product:products!inner(*)')
    .eq('product.owner_id', userId)
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

export async function toggleScriptFavorite(scriptId: string, isFavorite: boolean): Promise<void> {
  const { error } = await supabase
    .from('scripts')
    .update({ is_favorite: isFavorite })
    .eq('id', scriptId)

  if (error) throw error
}

export async function rateScript(scriptId: string, rating: number): Promise<void> {
  const { error } = await supabase
    .from('scripts')
    .update({ rating })
    .eq('id', scriptId)

  if (error) throw error
}

export async function getScriptVersions(parentScriptId: string): Promise<Script[]> {
  const { data, error } = await supabase
    .from('scripts')
    .select('*')
    .eq('parent_script_id', parentScriptId)
    .order('version', { ascending: false })

  if (error) throw error
  return data || []
}

export async function createScriptVersion(
  originalScriptId: string,
  sessionId: string,
  productId: string,
  title: string,
  content: string
): Promise<Script> {
  // Get the latest version number
  const { data: existing } = await supabase
    .from('scripts')
    .select('version')
    .or(`id.eq.${originalScriptId},parent_script_id.eq.${originalScriptId}`)
    .order('version', { ascending: false })
    .limit(1)
    .single()

  const newVersion = (existing?.version || 1) + 1

  const { data, error } = await supabase
    .from('scripts')
    .insert({ 
      session_id: sessionId, 
      product_id: productId, 
      title: `${title} (v${newVersion})`, 
      content,
      parent_script_id: originalScriptId,
      version: newVersion
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// =============================================
// DASHBOARD STATS
// =============================================
export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const now = new Date()
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [productsResult, scriptsResult, sessionsResult, monthlyScriptsResult] = await Promise.all([
    supabase.from('products').select('id', { count: 'exact' }).eq('owner_id', userId),
    supabase.from('scripts').select('id, product:products!inner(owner_id)', { count: 'exact' }).eq('product.owner_id', userId),
    supabase.from('chat_sessions').select('id', { count: 'exact' }).eq('user_id', userId),
    supabase.from('scripts').select('id, product:products!inner(owner_id)', { count: 'exact' }).eq('product.owner_id', userId).gte('created_at', firstDayOfMonth)
  ])

  return {
    totalProducts: productsResult.count || 0,
    totalScripts: scriptsResult.count || 0,
    totalSessions: sessionsResult.count || 0,
    scriptsThisMonth: monthlyScriptsResult.count || 0
  }
}

export async function getTeamDashboardStats(teamId: string): Promise<TeamDashboardStats> {
  const now = new Date()
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [clientsResult, membersResult, productsResult, scriptsResult, sessionsResult, monthlyScriptsResult] = await Promise.all([
    supabase.from('clients').select('id', { count: 'exact' }).eq('team_id', teamId),
    supabase.from('team_members').select('id', { count: 'exact' }).eq('team_id', teamId),
    supabase.from('products').select('id, client:clients!inner(team_id)', { count: 'exact' }).eq('client.team_id', teamId),
    supabase.from('scripts').select('id, product:products!inner(client:clients!inner(team_id))', { count: 'exact' }).eq('product.client.team_id', teamId),
    supabase.from('chat_sessions').select('id, product:products!inner(client:clients!inner(team_id))', { count: 'exact' }).eq('product.client.team_id', teamId),
    supabase.from('scripts').select('id, product:products!inner(client:clients!inner(team_id))', { count: 'exact' }).eq('product.client.team_id', teamId).gte('created_at', firstDayOfMonth)
  ])

  return {
    totalClients: clientsResult.count || 0,
    totalMembers: membersResult.count || 0,
    totalProducts: productsResult.count || 0,
    totalScripts: scriptsResult.count || 0,
    totalSessions: sessionsResult.count || 0,
    scriptsThisMonth: monthlyScriptsResult.count || 0
  }
}
