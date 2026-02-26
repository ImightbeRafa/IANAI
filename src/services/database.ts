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
  ContextDocument,
  ContextDocumentFormData,
  Business,
  BusinessFormData,
  SuccessCase,
  SuccessCaseFormData,
  UserAiMemory,
  ProductAiMemory,
  AiMemory,
  AiMemoryStats,
  CustomPostType,
  CustomPostTypeFormData,
  ReplySession,
  ReplyMessage,
  ReplyContextSource,
  BrandKit,
  BrandKitFormData
} from '../types'

// =============================================
// PROFILE FUNCTIONS
// =============================================
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

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

export async function getOnboardingStatus(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('has_completed_onboarding')
    .eq('id', userId)
    .maybeSingle()
  return data?.has_completed_onboarding === true
}

export async function markOnboardingComplete(userId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ has_completed_onboarding: true })
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
// BUSINESS FUNCTIONS
// =============================================
export async function createBusiness(
  ownerId: string,
  data: BusinessFormData,
  clientId?: string
): Promise<Business> {
  const { data: business, error } = await supabase
    .from('businesses')
    .insert({
      owner_id: ownerId,
      client_id: clientId || null,
      name: data.name,
      sales_channels: data.sales_channels,
      location: data.location || null,
      does_shipping: data.does_shipping,
      shipping_method: data.shipping_method || null,
      icp_description: data.icp_description || null,
    })
    .select()
    .single()

  if (error) throw error

  // Create target audiences
  if (data.target_audiences && data.target_audiences.length > 0) {
    const audienceInserts = data.target_audiences.map(a => ({
      business_id: business.id,
      sex: a.sex,
      age_min: a.age_min,
      age_max: a.age_max,
      geographic_scope: a.geographic_scope,
      geographic_scope_custom: a.geographic_scope_custom || null,
      has_specific_profession: a.has_specific_profession,
      profession_description: a.profession_description || null,
    }))

    const { error: audError } = await supabase
      .from('business_target_audiences')
      .insert(audienceInserts)

    if (audError) console.error('Failed to create target audiences:', audError)
  }

  return business
}

export async function getBusinesses(userId: string): Promise<Business[]> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*, target_audiences:business_target_audiences(*)')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getClientBusinesses(clientId: string): Promise<Business[]> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*, target_audiences:business_target_audiences(*)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getBusiness(businessId: string): Promise<Business | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*, target_audiences:business_target_audiences(*)')
    .eq('id', businessId)
    .single()

  if (error) return null
  return data
}

export async function updateBusiness(
  businessId: string,
  data: Partial<BusinessFormData>
): Promise<void> {
  const { target_audiences, ...businessFields } = data
  const updatePayload = { ...businessFields, updated_at: new Date().toISOString() }
  
  const { error } = await supabase
    .from('businesses')
    .update(updatePayload)
    .eq('id', businessId)

  if (error) throw error

  if (target_audiences) {
    await supabase.from('business_target_audiences').delete().eq('business_id', businessId)
    if (target_audiences.length > 0) {
      const inserts = target_audiences.map(a => ({
        business_id: businessId,
        sex: a.sex,
        age_min: a.age_min,
        age_max: a.age_max,
        geographic_scope: a.geographic_scope,
        geographic_scope_custom: a.geographic_scope_custom || null,
        has_specific_profession: a.has_specific_profession,
        profession_description: a.profession_description || null,
      }))
      await supabase.from('business_target_audiences').insert(inserts)
    }
  }
}

export async function deleteBusiness(businessId: string): Promise<void> {
  const { error } = await supabase
    .from('businesses')
    .delete()
    .eq('id', businessId)

  if (error) throw error
}

// =============================================
// SUCCESS CASE FUNCTIONS
// =============================================
export async function getSuccessCases(productId: string): Promise<SuccessCase[]> {
  const { data, error } = await supabase
    .from('service_success_cases')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data || []
}

export async function createSuccessCase(
  productId: string,
  caseData: SuccessCaseFormData
): Promise<SuccessCase> {
  const { data, error } = await supabase
    .from('service_success_cases')
    .insert({
      product_id: productId,
      ...caseData,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteSuccessCase(caseId: string): Promise<void> {
  const { error } = await supabase
    .from('service_success_cases')
    .delete()
    .eq('id', caseId)

  if (error) throw error
}

export async function replaceSuccessCases(
  productId: string,
  cases: SuccessCaseFormData[]
): Promise<void> {
  await supabase.from('service_success_cases').delete().eq('product_id', productId)
  if (cases.length > 0) {
    const inserts = cases.map(c => ({ product_id: productId, ...c }))
    const { error } = await supabase.from('service_success_cases').insert(inserts)
    if (error) throw error
  }
}

// =============================================
// PRODUCT FUNCTIONS
// =============================================
export async function createProduct(
  data: Record<string, unknown> & { name: string; type: string; business_id?: string },
  ownerId: string,
  clientId?: string
): Promise<Product> {
  const { success_cases, ...insertFields } = data as Record<string, unknown>
  
  const insertData: Record<string, unknown> = {
    owner_id: ownerId,
    client_id: clientId || null,
    ...insertFields,
    context_links: (data.context_links as string[]) || [],
    context_links_content: (data.context_links_content as string) || '',
  }

  const { data: product, error } = await supabase
    .from('products')
    .insert(insertData)
    .select()
    .single()

  if (error) throw error

  // Create success cases for services
  if (data.type === 'service' && success_cases && Array.isArray(success_cases) && success_cases.length > 0) {
    const caseInserts = (success_cases as SuccessCaseFormData[]).map(c => ({
      product_id: product.id,
      ...c,
    }))
    await supabase.from('service_success_cases').insert(caseInserts)
  }

  return product
}

export async function getProducts(userId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getUnassignedProducts(userId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('owner_id', userId)
    .is('business_id', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getBusinessProducts(businessId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('business_id', businessId)
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
    .select('*, client:clients(*), business:businesses(*, target_audiences:business_target_audiences(*))')
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
  content: string,
  systemPrompt?: string
): Promise<Message> {
  const insertData: Record<string, unknown> = { session_id: sessionId, role, content }
  if (systemPrompt) insertData.system_prompt = systemPrompt

  const { data, error } = await supabase
    .from('messages')
    .insert(insertData)
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
  angle?: string,
  opts?: { edit_source?: string; message_id?: string; script_index?: number }
): Promise<Script> {
  const { data, error } = await supabase
    .from('scripts')
    .insert({
      session_id: sessionId,
      product_id: productId,
      title,
      content,
      angle,
      ...(opts?.edit_source ? { edit_source: opts.edit_source } : {}),
      ...(opts?.message_id ? { message_id: opts.message_id } : {}),
      ...(opts?.script_index != null ? { script_index: opts.script_index } : {})
    })
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

export async function rateScript(scriptId: string, rating: number | null): Promise<void> {
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
  content: string,
  editSource?: string,
  editLabel?: string
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
      version: newVersion,
      ...(editSource ? { edit_source: editSource } : {}),
      ...(editLabel ? { edit_label: editLabel } : {})
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getScriptsByMessage(messageId: string): Promise<Script[]> {
  const { data, error } = await supabase
    .from('scripts')
    .select('*')
    .eq('message_id', messageId)
    .is('parent_script_id', null)
    .order('script_index', { ascending: true })

  if (error) throw error
  return data || []
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

  if (productsResult.error || scriptsResult.error || sessionsResult.error || monthlyScriptsResult.error) {
    console.error('Dashboard stats error:', productsResult.error || scriptsResult.error || sessionsResult.error || monthlyScriptsResult.error)
  }

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

  const anyError = clientsResult.error || membersResult.error || productsResult.error || scriptsResult.error || sessionsResult.error || monthlyScriptsResult.error
  if (anyError) {
    console.error('Team dashboard stats error:', anyError)
  }

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
      model: data.model || 'nano-banana-pro',
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

export async function getProductPostsPaginated(
  productId: string,
  limit: number,
  offset: number
): Promise<{ posts: Post[]; total: number }> {
  const { data, error, count } = await supabase
    .from('posts')
    .select('*', { count: 'exact' })
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw error
  return { posts: data || [], total: count || 0 }
}

export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase
    .from('posts')
    .delete()
    .eq('id', postId)

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

// =============================================
// CUSTOM COLOR PALETTE FUNCTIONS
// =============================================
export interface CustomColorPalette {
  id: string
  user_id: string
  name: string
  color_1: string
  color_2: string
  color_3: string
  created_at: string
}

export async function getCustomPalettes(userId: string): Promise<CustomColorPalette[]> {
  const { data, error } = await supabase
    .from('custom_color_palettes')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function createCustomPalette(
  userId: string,
  name: string,
  colors: [string, string, string]
): Promise<CustomColorPalette> {
  const { data, error } = await supabase
    .from('custom_color_palettes')
    .insert({
      user_id: userId,
      name,
      color_1: colors[0],
      color_2: colors[1],
      color_3: colors[2]
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteCustomPalette(paletteId: string): Promise<void> {
  const { error } = await supabase
    .from('custom_color_palettes')
    .delete()
    .eq('id', paletteId)

  if (error) throw error
}

// =============================================
// PRODUCT IMAGES (persistent per-product reference images)
// =============================================
export interface ProductImage {
  id: string
  product_id: string
  user_id: string
  image_url: string
  label: string | null
  created_at: string
}

export async function getProductImages(productId: string): Promise<ProductImage[]> {
  const { data, error } = await supabase
    .from('product_images')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function createProductImage(
  productId: string,
  userId: string,
  imageUrl: string,
  label?: string
): Promise<ProductImage> {
  const { data, error } = await supabase
    .from('product_images')
    .insert({
      product_id: productId,
      user_id: userId,
      image_url: imageUrl,
      label: label || null
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteProductImage(imageId: string): Promise<void> {
  const { error } = await supabase
    .from('product_images')
    .delete()
    .eq('id', imageId)

  if (error) throw error
}

// =============================================
// FEEDBACK TICKETS
// =============================================
export interface FeedbackTicket {
  id: string
  user_id: string
  user_email: string | null
  subject: string
  description: string
  category: 'bug' | 'feature' | 'question' | 'other'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  page_url: string | null
  browser_info: string | null
  screen_size: string | null
  console_errors: unknown[]
  network_errors: { url: string; status: number; statusText: string; timestamp: string }[]
  breadcrumbs: { type: string; target: string; timestamp: string }[]
  screenshot_url: string | null
  product_id: string | null
  product_name: string | null
  user_plan: string | null
  admin_notes: string | null
  notes_history: { text: string; status: string; timestamp: string }[]
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export async function createFeedbackTicket(ticket: {
  user_id: string
  user_email?: string
  subject: string
  description: string
  category: 'bug' | 'feature' | 'question' | 'other'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  page_url?: string
  browser_info?: string
  screen_size?: string
  console_errors?: unknown[]
  screenshot_url?: string
  network_errors?: unknown[]
  breadcrumbs?: unknown[]
  product_id?: string
  product_name?: string
  user_plan?: string
}): Promise<FeedbackTicket> {
  const { data, error } = await supabase
    .from('feedback_tickets')
    .insert(ticket)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getUserTickets(userId: string): Promise<FeedbackTicket[]> {
  const { data, error } = await supabase
    .from('feedback_tickets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getAllTickets(): Promise<FeedbackTicket[]> {
  const { data, error } = await supabase
    .from('feedback_tickets')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function updateTicketStatus(
  ticketId: string,
  status: 'open' | 'in_progress' | 'resolved' | 'closed',
  adminNotes?: string,
  existingHistory?: { text: string; status: string; timestamp: string }[]
): Promise<void> {
  const update: Record<string, unknown> = { status }
  if (adminNotes !== undefined) update.admin_notes = adminNotes
  if (status === 'resolved') update.resolved_at = new Date().toISOString()

  // Append to notes_history
  const history = [...(existingHistory || [])]
  history.push({
    text: adminNotes || '',
    status,
    timestamp: new Date().toISOString(),
  })
  update.notes_history = history

  const { error } = await supabase
    .from('feedback_tickets')
    .update(update)
    .eq('id', ticketId)

  if (error) throw error
}

export async function getRecentFailedLogs(
  userId: string,
  aroundTimestamp: string,
  windowMinutes: number = 30
): Promise<{ id: string; feature: string; model: string; error_message: string | null; created_at: string }[]> {
  const date = new Date(aroundTimestamp)
  const from = new Date(date.getTime() - windowMinutes * 60 * 1000).toISOString()
  const to = new Date(date.getTime() + windowMinutes * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('api_usage_logs')
    .select('id, feature, model, error_message, created_at')
    .eq('user_id', userId)
    .eq('success', false)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw error
  return data || []
}

export async function uploadFeedbackScreenshot(
  userId: string,
  file: Blob
): Promise<string> {
  const fileName = `${userId}/${Date.now()}.png`
  const { error } = await supabase.storage
    .from('feedback-screenshots')
    .upload(fileName, file, { contentType: 'image/png' })

  if (error) throw error

  const { data } = supabase.storage
    .from('feedback-screenshots')
    .getPublicUrl(fileName)

  return data.publicUrl
}

// =============================================
// PRODUCT SHARING / COLLABORATORS
// =============================================

export interface ProductCollaborator {
  id: string
  product_id: string
  user_id: string | null
  invited_email: string
  role: 'viewer' | 'editor'
  invited_by: string
  status: 'pending' | 'accepted'
  created_at: string
  accepted_at: string | null
}

export async function getProductCollaborators(productId: string): Promise<ProductCollaborator[]> {
  const { data, error } = await supabase
    .from('product_collaborators')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function inviteCollaborator(
  productId: string,
  email: string,
  role: 'viewer' | 'editor',
  invitedBy: string
): Promise<ProductCollaborator> {
  // Check if invited user already has an account
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  const insertData: Record<string, unknown> = {
    product_id: productId,
    invited_email: email.toLowerCase(),
    role,
    invited_by: invitedBy,
    status: existingProfile ? 'accepted' : 'pending',
    user_id: existingProfile?.id || null,
    accepted_at: existingProfile ? new Date().toISOString() : null
  }

  const { data, error } = await supabase
    .from('product_collaborators')
    .insert(insertData)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateCollaboratorRole(
  collaboratorId: string,
  role: 'viewer' | 'editor'
): Promise<void> {
  const { error } = await supabase
    .from('product_collaborators')
    .update({ role })
    .eq('id', collaboratorId)

  if (error) throw error
}

export async function removeCollaborator(collaboratorId: string): Promise<void> {
  const { error } = await supabase
    .from('product_collaborators')
    .delete()
    .eq('id', collaboratorId)

  if (error) throw error
}

export async function getSharedProducts(userId: string): Promise<(Product & { shared_role: string; shared_by_email: string })[]> {
  // Get user email for matching pending invites
  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle()

  if (!profile) return []

  const { data, error } = await supabase
    .from('product_collaborators')
    .select('role, product_id, products(*), invited_by_profile:profiles!product_collaborators_invited_by_fkey(email)')
    .or(`user_id.eq.${userId},invited_email.eq.${profile.email}`)
    .eq('status', 'accepted')

  if (error) throw error
  if (!data) return []

  return data
    .filter((d: Record<string, unknown>) => d.products)
    .map((d: Record<string, unknown>) => ({
      ...(d.products as Product),
      shared_role: d.role as string,
      shared_by_email: (d.invited_by_profile as Record<string, string>)?.email || ''
    }))
}

// =============================================
// SUBSCRIPTION & REFERRAL
// =============================================

export async function getSubscription(userId: string): Promise<import('../types').Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) return null
  return data
}

export async function applyReferralCode(userId: string, code: string): Promise<{ success: boolean; error?: string; plan?: string; trial_ends_at?: string }> {
  const { data, error } = await supabase.rpc('apply_referral_code', {
    p_user_id: userId,
    p_code: code
  })

  if (error) return { success: false, error: error.message }
  return data as { success: boolean; error?: string; plan?: string; trial_ends_at?: string }
}

export async function acceptPendingInvites(userId: string, email: string): Promise<void> {
  const { error } = await supabase
    .from('product_collaborators')
    .update({ user_id: userId, status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('invited_email', email.toLowerCase())
    .eq('status', 'pending')

  if (error) console.error('Error accepting pending invites:', error)
}

// =============================================
// AI MEMORY FUNCTIONS
// =============================================

export async function recordAiSignal(
  productId: string,
  signalType: string,
  signalData: Record<string, unknown> = {}
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase.rpc('record_ai_signal', {
      p_user_id: user.id,
      p_product_id: productId,
      p_signal_type: signalType,
      p_signal_data: {
        signal_key: signalType,
        ...signalData
      }
    })

    if (error) {
      console.warn('AI signal recording failed:', error.message)
    } else {
      // Notify listeners (e.g. AI Memory panel) to refresh immediately
      window.dispatchEvent(new CustomEvent('ai-signal-recorded', { detail: { productId, signalType } }))

      // Increment ai_memory_stats + check if reflection should trigger
      try {
        await supabase.rpc('increment_ai_memory_stats', {
          p_user_id: user.id,
          p_product_id: productId
        })

        // High-value signals always trigger reflection
        const HIGH_VALUE_SIGNALS = ['script_rated', 'edit_manual', 'user_explicit']
        const isHighValue = HIGH_VALUE_SIGNALS.includes(signalType) &&
          (signalType !== 'script_rated' || signalData.rating === 'bad' || signalData.rating === 'good')

        if (isHighValue) {
          triggerReflection(productId, true)
        } else {
          // Progressive threshold check
          const { data: stats } = await supabase
            .from('ai_memory_stats')
            .select('total_lifetime_signals, signals_since_last_reflection')
            .eq('user_id', user.id)
            .eq('product_id', productId)
            .maybeSingle()

          if (stats) {
            const threshold = stats.total_lifetime_signals <= 20 ? 4 : 8
            if (stats.signals_since_last_reflection >= threshold) {
              triggerReflection(productId, false)
            }
          }
        }
      } catch (statsErr) {
        console.warn('AI memory stats update failed:', statsErr)
      }
    }
  } catch (err) {
    console.warn('AI signal recording error:', err)
  }
}

function triggerReflection(productId: string, force: boolean): void {
  const apiUrl = import.meta.env.PROD ? '/api/reflect-memory' : 'http://localhost:3000/api/reflect-memory'
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session?.access_token) return
    // Fire-and-forget — don't await, don't block
    fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ productId, force, source: 'frontend' })
    }).then(async (res) => {
      if (res.ok) {
        const data = await res.json()
        if (!data.skipped) {
          window.dispatchEvent(new CustomEvent('ai-memory-reflected', {
            detail: { productId, upserted: data.upserted, deleted: data.deleted, styleDirective: data.style_directive }
          }))
        }
      }
    }).catch(() => { /* fire-and-forget */ })
  })
}

export async function getUserAiMemory(userId: string): Promise<UserAiMemory | null> {
  const { data, error } = await supabase
    .from('user_ai_memory')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null
  return data
}

export async function getProductAiMemory(productId: string, userId: string): Promise<ProductAiMemory | null> {
  const { data, error } = await supabase
    .from('product_ai_memory')
    .select('*')
    .eq('product_id', productId)
    .eq('user_id', userId)
    .single()

  if (error || !data) return null
  return data
}

export async function updateUserAiMemorySummary(userId: string, styleSummary: string): Promise<void> {
  const { error } = await supabase
    .from('user_ai_memory')
    .upsert({
      user_id: userId,
      style_summary: styleSummary,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })

  if (error) throw error
}

export async function updateProductAiMemorySummary(
  productId: string,
  userId: string,
  styleSummary: string
): Promise<void> {
  const { error } = await supabase
    .from('product_ai_memory')
    .upsert({
      product_id: productId,
      user_id: userId,
      style_summary: styleSummary,
      updated_at: new Date().toISOString()
    }, { onConflict: 'product_id,user_id' })

  if (error) throw error
}

export async function resetProductAiMemory(productId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('product_ai_memory')
    .delete()
    .eq('product_id', productId)
    .eq('user_id', userId)

  if (error) throw error
}

export async function resetUserAiMemory(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_ai_memory')
    .delete()
    .eq('user_id', userId)

  if (error) throw error
}

// =============================================
// HYBRID AI MEMORIES (typed, categorized)
// =============================================
export async function getAiMemories(
  userId: string,
  productId?: string | null,
  options?: { types?: string[]; categories?: string[]; limit?: number }
): Promise<AiMemory[]> {
  let query = supabase
    .from('ai_memories')
    .select('*')
    .or(`and(user_id.eq.${userId},product_id.is.null),and(user_id.eq.${userId}${productId ? `,product_id.eq.${productId}` : ''})`)

  if (options?.types && options.types.length > 0) {
    query = query.in('memory_type', options.types)
  }
  if (options?.categories && options.categories.length > 0) {
    query = query.in('category', options.categories)
  }

  const { data, error } = await query
    .order('confidence', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(options?.limit || 15)

  if (error) throw error
  return data || []
}

export async function deleteAiMemory(memoryId: string): Promise<void> {
  const { error } = await supabase
    .from('ai_memories')
    .delete()
    .eq('id', memoryId)

  if (error) throw error
}

export async function getAiMemoryStats(
  userId: string,
  productId: string
): Promise<AiMemoryStats | null> {
  const { data, error } = await supabase
    .from('ai_memory_stats')
    .select('*')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .maybeSingle()

  if (error) return null
  return data
}

export async function upsertAiMemoryStats(
  userId: string,
  productId: string
): Promise<void> {
  const { error } = await supabase.rpc('increment_ai_memory_stats', {
    p_user_id: userId,
    p_product_id: productId
  })
  if (error) {
    // Fallback: direct upsert if RPC doesn't exist yet
    await supabase
      .from('ai_memory_stats')
      .upsert({
        user_id: userId,
        product_id: productId,
        total_lifetime_signals: 1,
        signals_since_last_reflection: 1
      }, { onConflict: 'user_id,product_id' })
  }
}

// =============================================
// CUSTOM POST TYPES
// =============================================
export async function getCustomPostTypes(userId: string): Promise<CustomPostType[]> {
  const { data, error } = await supabase
    .from('custom_post_types')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function createCustomPostType(
  userId: string,
  formData: CustomPostTypeFormData
): Promise<CustomPostType> {
  const { data, error } = await supabase
    .from('custom_post_types')
    .insert({
      user_id: userId,
      name: formData.name,
      description: formData.description || null,
      reference_images: formData.reference_images,
      master_prompt_es: formData.master_prompt_es,
      master_prompt_en: formData.master_prompt_en,
      style_preferences: formData.style_preferences,
      thumbnail_url: formData.thumbnail_url || null
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteCustomPostType(id: string): Promise<void> {
  const { error } = await supabase
    .from('custom_post_types')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// =============================================
// RESPUESTAS (Client Reply Generator)
// =============================================

export async function getReplySessions(productId: string): Promise<ReplySession[]> {
  const { data, error } = await supabase
    .from('reply_sessions')
    .select('*')
    .eq('product_id', productId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function createReplySession(
  productId: string,
  userId: string,
  title: string = 'New conversation'
): Promise<ReplySession> {
  const { data, error } = await supabase
    .from('reply_sessions')
    .insert({ product_id: productId, user_id: userId, title })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteReplySession(id: string): Promise<void> {
  const { error } = await supabase
    .from('reply_sessions')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function getReplyMessages(sessionId: string): Promise<ReplyMessage[]> {
  const { data, error } = await supabase
    .from('reply_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data || []
}

export async function addReplyMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  attachments: Record<string, unknown>[] = []
): Promise<ReplyMessage> {
  const { data, error } = await supabase
    .from('reply_messages')
    .insert({ session_id: sessionId, role, content, attachments })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getReplyContextSources(
  productId: string,
  userId: string
): Promise<ReplyContextSource[]> {
  const { data, error } = await supabase
    .from('reply_context_sources')
    .select('*')
    .eq('product_id', productId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function createReplyContextSource(
  productId: string,
  userId: string,
  sourceType: 'url' | 'text' | 'image',
  title: string,
  content: string | null,
  url: string | null = null,
  metadata: Record<string, unknown> = {}
): Promise<ReplyContextSource> {
  const { data, error } = await supabase
    .from('reply_context_sources')
    .insert({
      product_id: productId,
      user_id: userId,
      source_type: sourceType,
      title,
      content,
      url,
      metadata
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteReplyContextSource(id: string): Promise<void> {
  const { error } = await supabase
    .from('reply_context_sources')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// =============================================
// BRAND KIT (Multi-Kit V3)
// =============================================
export async function getBrandKits(userId: string): Promise<BrandKit[]> {
  const { data, error } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) throw error
  // Sort defaults first client-side (is_default column may not exist yet)
  return (data || []).sort((a, b) => {
    if (a.is_default && !b.is_default) return -1
    if (!a.is_default && b.is_default) return 1
    return 0
  })
}

export async function getBrandKitById(kitId: string): Promise<BrandKit | null> {
  const { data, error } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('id', kitId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getBrandKitForClient(clientId: string): Promise<BrandKit | null> {
  const { data, error } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function createBrandKit(userId: string, kit: BrandKitFormData): Promise<BrandKit> {
  const { user_id: _drop, ...safeKit } = kit as BrandKitFormData & { user_id?: string }

  // Check if user has any kits — if not, make this one default
  const existing = await getBrandKits(userId)
  const isFirst = existing.length === 0

  const { data, error } = await supabase
    .from('brand_kits')
    .insert({
      ...safeKit,
      user_id: userId,
      is_default: isFirst ? true : (safeKit.is_default || false),
      is_active: safeKit.is_active ?? true
    })
    .select()
    .single()

  if (error) {
    // Fallback: migrations 051/052 may not be applied yet — insert core columns only
    console.warn('brand_kits insert failed, trying core columns only:', error.message)
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('brand_kits')
      .insert({
        user_id: userId,
        name: safeKit.name,
        logo_url: safeKit.logo_url || null,
        primary_color: safeKit.primary_color || null,
        secondary_color: safeKit.secondary_color || null,
        accent_color: safeKit.accent_color || null,
        brand_voice: safeKit.brand_voice || null,
        tone_keywords: safeKit.tone_keywords || [],
        must_use_phrases: safeKit.must_use_phrases || [],
        forbidden_phrases: safeKit.forbidden_phrases || [],
        is_active: true
      })
      .select()
      .single()

    if (fallbackError) throw fallbackError
    return fallbackData
  }
  return data
}

export async function updateBrandKit(kitId: string, kit: BrandKitFormData): Promise<BrandKit> {
  const { user_id: _drop, ...safeKit } = kit as BrandKitFormData & { user_id?: string }
  const { data, error } = await supabase
    .from('brand_kits')
    .update({
      ...safeKit,
      updated_at: new Date().toISOString()
    })
    .eq('id', kitId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteBrandKit(kitId: string): Promise<void> {
  const { error } = await supabase
    .from('brand_kits')
    .delete()
    .eq('id', kitId)

  if (error) throw error
}

export async function setDefaultBrandKit(userId: string, kitId: string): Promise<void> {
  const { error } = await supabase.rpc('set_default_brand_kit', {
    p_user_id: userId,
    p_kit_id: kitId
  })

  if (error) throw error
}

// =============================================
// SUBSCRIPTION & PAYMENTS
// =============================================
export async function getPayments(userId: string, limit = 20): Promise<import('../types').Payment[]> {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('user_id', userId)
    .order('paid_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data || []
}

export async function getPaymentTransactions(userId: string, limit = 50): Promise<import('../types').PaymentTransaction[]> {
  const { data, error } = await supabase
    .from('payment_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data || []
}
