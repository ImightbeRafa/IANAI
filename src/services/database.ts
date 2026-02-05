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
  TeamDashboardStats,
  ICP,
  ICPFormData,
  ContextDocument,
  ContextDocumentFormData
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
  data: ProductFormData & {
    menu_text?: string
    menu_pdf_url?: string
    location?: string
    schedule?: string
    is_new_restaurant?: boolean
    // Real estate fields
    re_business_type?: string
    re_price?: string
    re_location?: string
    re_construction_size?: string
    re_bedrooms?: string
    re_capacity?: string
    re_bathrooms?: string
    re_parking?: string
    re_highlights?: string
    re_location_reference?: string
    re_cta?: string
  },
  ownerId: string,
  clientId?: string
): Promise<Product> {
  const insertData: Record<string, unknown> = {
    owner_id: ownerId,
    client_id: clientId || null,
    name: data.name,
    type: data.type,
    // New form fields
    product_description: data.product_description,
    main_problem: data.main_problem,
    best_customers: data.best_customers,
    failed_attempts: data.failed_attempts,
    attention_grabber: data.attention_grabber,
    real_pain: data.real_pain,
    pain_consequences: data.pain_consequences,
    expected_result: data.expected_result,
    differentiation: data.differentiation,
    key_objection: data.key_objection,
    shipping_info: data.shipping_info,
    awareness_level: data.awareness_level,
    // Legacy fields for backward compatibility
    description: data.description,
    offer: data.offer,
    market_alternatives: data.market_alternatives,
    customer_values: data.customer_values,
    purchase_reason: data.purchase_reason,
    target_audience: data.target_audience,
    call_to_action: data.call_to_action
  }

  // Add restaurant-specific fields if present
  if (data.type === 'restaurant') {
    insertData.menu_text = data.menu_text
    insertData.menu_pdf_url = data.menu_pdf_url
    insertData.location = data.location
    insertData.schedule = data.schedule
    insertData.is_new_restaurant = data.is_new_restaurant
  }

  // Add real estate-specific fields if present
  if (data.type === 'real_estate') {
    insertData.re_business_type = data.re_business_type
    insertData.re_price = data.re_price
    insertData.re_location = data.re_location
    insertData.re_construction_size = data.re_construction_size
    insertData.re_bedrooms = data.re_bedrooms
    insertData.re_capacity = data.re_capacity
    insertData.re_bathrooms = data.re_bathrooms
    insertData.re_parking = data.re_parking
    insertData.re_highlights = data.re_highlights
    insertData.re_location_reference = data.re_location_reference
    insertData.re_cta = data.re_cta
  }

  const { data: product, error } = await supabase
    .from('products')
    .insert(insertData)
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

// =============================================
// POST FUNCTIONS (AI Image Generation)
// =============================================

export interface Post {
  id: string
  product_id: string
  created_by: string
  prompt: string
  input_images?: string[]
  generated_image_url?: string
  flux_task_id?: string
  status: 'pending' | 'generating' | 'completed' | 'failed'
  width: number
  height: number
  output_format: string
  model?: string
  error_message?: string
  created_at: string
  updated_at: string
}

export async function createPost(
  productId: string,
  userId: string,
  data: {
    prompt: string
    input_images?: string[]
    width?: number
    height?: number
    output_format?: string
    flux_task_id?: string
    model?: string
  }
): Promise<Post> {
  const { data: post, error } = await supabase
    .from('posts')
    .insert({
      product_id: productId,
      created_by: userId,
      prompt: data.prompt,
      input_images: data.input_images || [],
      width: data.width || 1080,
      height: data.height || 1080,
      output_format: data.output_format || 'jpeg',
      flux_task_id: data.flux_task_id,
      model: data.model || 'flux',
      status: 'generating'
    })
    .select()
    .single()

  if (error) throw error
  return post
}

export async function updatePostStatus(
  postId: string,
  status: 'pending' | 'generating' | 'completed' | 'failed',
  imageUrl?: string,
  errorMessage?: string
): Promise<void> {
  const updateData: Record<string, unknown> = { status }
  if (imageUrl) updateData.generated_image_url = imageUrl
  if (errorMessage) updateData.error_message = errorMessage

  const { error } = await supabase
    .from('posts')
    .update(updateData)
    .eq('id', postId)

  if (error) throw error
}

export async function getProductPosts(productId: string): Promise<Post[]> {
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase
    .from('posts')
    .delete()
    .eq('id', postId)

  if (error) throw error
}

// =============================================
// ICP (Ideal Client Profile) FUNCTIONS
// =============================================
export async function getICPs(userId: string): Promise<ICP[]> {
  const { data, error } = await supabase
    .from('icps')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getICP(icpId: string): Promise<ICP | null> {
  const { data, error } = await supabase
    .from('icps')
    .select('*')
    .eq('id', icpId)
    .single()

  if (error) return null
  return data
}

export async function createICP(userId: string, icpData: ICPFormData): Promise<ICP> {
  const { data, error } = await supabase
    .from('icps')
    .insert({
      owner_id: userId,
      ...icpData
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateICP(icpId: string, updates: Partial<ICPFormData>): Promise<ICP> {
  const { data, error } = await supabase
    .from('icps')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', icpId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteICP(icpId: string): Promise<void> {
  const { error } = await supabase
    .from('icps')
    .delete()
    .eq('id', icpId)

  if (error) throw error
}

// =============================================
// CONTEXT DOCUMENTS FUNCTIONS
// =============================================
export async function getContextDocuments(sessionId: string): Promise<ContextDocument[]> {
  const { data, error } = await supabase
    .from('context_documents')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function createContextDocument(
  sessionId: string,
  userId: string,
  docData: ContextDocumentFormData
): Promise<ContextDocument> {
  const { data, error } = await supabase
    .from('context_documents')
    .insert({
      session_id: sessionId,
      owner_id: userId,
      ...docData
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteContextDocument(docId: string): Promise<void> {
  const { error } = await supabase
    .from('context_documents')
    .delete()
    .eq('id', docId)

  if (error) throw error
}
