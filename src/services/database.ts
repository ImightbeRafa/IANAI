import { supabase } from '../lib/supabase'
import {
  CHAT_SHELL_MAX_OFFERS,
  normalizeOfferPositions,
  planKeptOfferPositionUpdates,
} from '../features/chat-shell/sessionOffer'
import {
  assertProductDeleteResult,
  planBusinessContentDeletion,
  runBusinessContentDeletion,
} from './businessDelete'
import type { 
  Profile, 
  Team, 
  TeamMember, 
  Product, 
  ChatSession, 
  ChatSessionOffer,
  Message,
  MessageArtifact,
  Script,
  DashboardStats,
  ContextDocument,
  ContextDocumentFormData,
  Business,
  BusinessFormData,
  SuccessCase,
  SuccessCaseFormData,
  UserAiMemory,
  ProductAiMemory,
  AiMemory,
  CustomPostType,
  CustomPostTypeFormData,
  ReplySession,
  ReplyMessage,
  ReplyContextSource,
  BrandKit,
  BrandKitFormData,
  ScriptTemplate
} from '../types'

export function isMissingRpcError(error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined): boolean {
  if (!error) return false
  const blob = `${error.code || ''} ${error.message || ''} ${error.details || ''} ${error.hint || ''}`
  return (
    error.code === 'PGRST202'
    || error.code === '42883'
    || error.code === '404'
    || /could not find the function/i.test(blob)
    || /does not exist/i.test(blob)
    || /not find.*get_usage_limits/i.test(blob)
  )
}

export function isMissingRowError(error: { code?: string; message?: string; details?: string } | null | undefined): boolean {
  if (!error) return false
  const blob = `${error.code || ''} ${error.message || ''} ${error.details || ''}`
  return (
    error.code === 'PGRST116'
    || /0 rows/i.test(blob)
    || /Cannot coerce the result to a single JSON object/i.test(blob)
  )
}

export function isBrandKitFkError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const blob = `${error.code || ''} ${error.message || ''}`
  return (
    error.code === '23503'
    || error.code === '409'
    || /chat_sessions_brand_kit/i.test(blob)
    || /brand_kits/i.test(blob) && /foreign key/i.test(blob)
  )
}

export function isRlsDeniedError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const blob = `${error.code || ''} ${error.message || ''}`
  return (
    error.code === '42501'
    || error.code === 'PGRST301'
    || /row-level security/i.test(blob)
    || /permission denied/i.test(blob)
  )
}

function throwDbError(error: { message?: string } | null | undefined, fallback: string): never {
  throw new Error(error?.message || fallback)
}

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

const BUSINESS_UPDATE_COLUMNS = new Set([
  'name',
  'sales_channels',
  'location',
  'does_shipping',
  'shipping_method',
  'icp_description',
])

export async function updateBusiness(
  businessId: string,
  data: Partial<BusinessFormData>
): Promise<Business> {
  const allowed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!BUSINESS_UPDATE_COLUMNS.has(key) || value === undefined) continue
    allowed[key] = value
  }

  if (Object.keys(allowed).length > 0) {
    const { error } = await supabase
      .from('businesses')
      .update(allowed)
      .eq('id', businessId)
    if (error) throw error
  }

  if (data.target_audiences) {
    const { error: deleteError } = await supabase
      .from('business_target_audiences')
      .delete()
      .eq('business_id', businessId)
    if (deleteError) throw deleteError

    if (data.target_audiences.length > 0) {
      const audienceInserts = data.target_audiences.map((a) => ({
        business_id: businessId,
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
      if (audError) throw audError
    }
  }

  const { data: business, error: fetchError } = await supabase
    .from('businesses')
    .select('*, target_audiences:business_target_audiences(*)')
    .eq('id', businessId)
    .single()

  if (fetchError) throw fetchError
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

export async function deleteBusiness(businessId: string): Promise<void> {
  if (!businessId) {
    throw new Error('Folder delete failed: missing folder id.')
  }

  const { data, error } = await supabase
    .from('businesses')
    .delete()
    .eq('id', businessId)
    .select('id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Folder was not deleted. Refresh and try again.')
  }
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

// =============================================
// PRODUCT FUNCTIONS
// =============================================
const PRODUCT_UPDATE_COLUMNS = new Set([
  'client_id',
  'business_id',
  'name',
  'type',
  'product_description',
  'main_problem',
  'best_customers',
  'failed_attempts',
  'attention_grabber',
  'real_pain',
  'pain_consequences',
  'expected_result',
  'differentiation',
  'key_objection',
  'shipping_info',
  'awareness_level',
  'description',
  'offer',
  'market_alternatives',
  'customer_values',
  'purchase_reason',
  'target_audience',
  'unique_value',
  'call_to_action',
  'product_category',
  'product_category_custom',
  'current_alternatives',
  'alternatives_disadvantages',
  'product_variations',
  'technical_specs',
  'utility',
  'result',
  'has_guarantee',
  'guarantee_details',
  'price_range',
  'stock_limited',
  'ind_article_type',
  'ind_article_type_custom',
  'ind_model_count',
  'ind_variations_description',
  'ind_sizes',
  'ind_main_material',
  'ind_quality_description',
  'ind_accepts_changes',
  'ind_change_policy',
  'ind_customizable',
  'ind_customization_description',
  'ind_product_images',
  'svc_service_type',
  'svc_service_type_custom',
  'svc_problem',
  'svc_current_pain',
  'svc_alternatives_tried',
  'svc_alternatives_failures',
  'svc_concrete_result',
  'svc_result_timeline',
  'svc_life_change',
  'svc_process_steps',
  'svc_service_format',
  'svc_service_duration',
  'svc_differentiation',
  'svc_has_own_method',
  'svc_method_name',
  'svc_main_objection',
  'svc_has_guarantee',
  'svc_guarantee_details',
  'svc_has_success_cases',
  'menu_text',
  'menu_pdf_url',
  'location',
  'schedule',
  'is_new_restaurant',
  're_business_type',
  're_price',
  're_location',
  're_construction_size',
  're_bedrooms',
  're_capacity',
  're_bathrooms',
  're_parking',
  're_highlights',
  're_location_reference',
  're_cta',
  'context_links',
  'context_links_content',
])

function sanitizeProductUpdates(updates: Partial<Product> & Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(updates).filter(([key, value]) => PRODUCT_UPDATE_COLUMNS.has(key) && value !== undefined)
  )
}

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

export async function getBusinessProductIds(businessId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id')
    .eq('business_id', businessId)

  if (error) throw error
  return (data || []).map((row) => row.id as string).filter(Boolean)
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

export async function updateProduct(productId: string, updates: Partial<Product> & Record<string, unknown>): Promise<void> {
  const updatePayload = sanitizeProductUpdates(updates)
  if (Object.keys(updatePayload).length === 0) return

  const { error } = await supabase
    .from('products')
    .update(updatePayload)
    .eq('id', productId)

  if (error) throw error
}

export async function deleteProduct(productId: string): Promise<void> {
  if (!productId) {
    throw new Error('Product delete failed: missing product id.')
  }
  const { data, error } = await supabase
    .from('products')
    .delete()
    .eq('id', productId)
    .select('id')

  if (error) throw error
  assertProductDeleteResult(data)
}

export const QUICK_POST_PRODUCT_NAME = 'Quick Use Image Studio'

export function isQuickPostSentinel(product: { name?: string | null }): boolean {
  return product.name === QUICK_POST_PRODUCT_NAME
}

export async function getOrCreateQuickPostProduct(userId: string): Promise<Product> {
  const { data: existing, error: lookupError } = await supabase
    .from('products')
    .select('*')
    .eq('owner_id', userId)
    .eq('name', QUICK_POST_PRODUCT_NAME)
    .is('business_id', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (lookupError) throw lookupError
  if (existing) return existing

  return createProduct({
    name: QUICK_POST_PRODUCT_NAME,
    type: 'product',
    product_description: 'General quick-use image generation workspace for product photos, organic posts, carousels, and free prompt image generation.',
    target_audience: 'General social media content',
    product_category: 'general'
  }, userId)
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

/** Safe client updates — never includes user_id / business_id / product_id (immutable after insert). */
export type ChatSessionSafeUpdates = Partial<
  Pick<ChatSession, 'title' | 'status' | 'context' | 'primary_channel' | 'awareness_level' | 'brand_kit_id'>
>

export async function updateChatSession(
  sessionId: string,
  updates: ChatSessionSafeUpdates
): Promise<ChatSession> {
  const allowed: ChatSessionSafeUpdates = {}
  if (updates.title !== undefined) allowed.title = updates.title
  if (updates.status !== undefined) allowed.status = updates.status
  if (updates.context !== undefined) allowed.context = updates.context
  if (updates.primary_channel !== undefined) allowed.primary_channel = updates.primary_channel
  if (updates.awareness_level !== undefined) allowed.awareness_level = updates.awareness_level
  if (updates.brand_kit_id !== undefined) allowed.brand_kit_id = updates.brand_kit_id

  const { data, error } = await supabase
    .from('chat_sessions')
    .update(allowed)
    .eq('id', sessionId)
    .select('*')
    .single()

  if (!error && data) return data
  if (error && allowed.brand_kit_id && isBrandKitFkError(error)) {
    console.warn('Session brand kit link skipped:', error.message)
    const { brand_kit_id: _drop, ...rest } = allowed
    if (Object.keys(rest).length === 0) {
      const current = await getChatSession(sessionId)
      if (current) return current
    } else {
      const retry = await supabase
        .from('chat_sessions')
        .update(rest)
        .eq('id', sessionId)
        .select('*')
        .single()
      if (!retry.error && retry.data) return retry.data
    }
  }
  if (error) throw error
  throw new Error('Failed to update session')
}

/**
 * Chat-shell: create a brand/Quick session (product_id null, business_id required).
 * Legacy createChatSession(productId, ...) remains for /scripts UI.
 */
export async function createBrandChatSession(
  businessId: string,
  userId: string,
  title: string = 'New session',
  context?: string,
  brandKitId?: string | null
): Promise<ChatSession> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      business_id: businessId,
      product_id: null,
      user_id: userId,
      title,
      ...(context ? { context } : {}),
      ...(brandKitId ? { brand_kit_id: brandKitId } : {}),
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

/** Chat-shell: list sessions for a brand (includes Quick / product-null rows). */
export async function getBusinessChatSessions(businessId: string): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('business_id', businessId)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data || []
}

/** Every session id for a brand, including archived — required before folder delete. */
export async function getAllBusinessChatSessionIds(businessId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('business_id', businessId)

  if (error) throw error
  return (data || []).map((row) => row.id as string).filter(Boolean)
}

/** Delete chats, then offers/products, then the folder. Fail-closed if any product remains. */
export async function deleteBusinessWithContents(businessId: string): Promise<void> {
  if (!businessId) {
    throw new Error('Folder delete failed: missing folder id.')
  }
  const [sessionIds, productIds] = await Promise.all([
    getAllBusinessChatSessionIds(businessId),
    getBusinessProductIds(businessId),
  ])
  const steps = planBusinessContentDeletion({ businessId, sessionIds, productIds })
  await runBusinessContentDeletion(steps, {
    deleteSession: deleteChatSession,
    deleteProduct,
    getRemainingProductIds: () => getBusinessProductIds(businessId),
    deleteBusinessRow: deleteBusiness,
  })
}

/** Lightweight per-brand session count for collapsed sidebar labels. */
export async function countBusinessChatSessions(businessId: string): Promise<number> {
  const { count, error } = await supabase
    .from('chat_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .neq('status', 'archived')

  if (error) throw error
  return count ?? 0
}

/** One query for all brand session counts (avoids N+1 on hydrate). */
export async function countBusinessChatSessionsBulk(
  businessIds: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const id of businessIds) out[id] = 0
  if (businessIds.length === 0) return out
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('business_id')
    .in('business_id', businessIds)
    .neq('status', 'archived')
  if (error) throw error
  for (const row of data || []) {
    const id = row.business_id as string | null
    if (!id) continue
    out[id] = (out[id] || 0) + 1
  }
  return out
}

export type AppFeatureFlagState = 'enabled' | 'disabled' | 'unreadable'

export interface ChatShellRolloutRow {
  killSwitch: AppFeatureFlagState
  betaAccess: boolean | null
  preferredUi: 'classic' | 'chat' | null
}

export async function getChatShellRollout(userId: string | null | undefined): Promise<ChatShellRolloutRow> {
  const killSwitch = await getAppFeatureFlag('chat_shell')
  if (!userId) {
    return { killSwitch, betaAccess: null, preferredUi: null }
  }
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('chat_beta_access, preferred_ui')
      .eq('id', userId)
      .maybeSingle()
    if (error || !data) {
      return { killSwitch, betaAccess: null, preferredUi: null }
    }
    const preferred = data.preferred_ui === 'chat' || data.preferred_ui === 'classic'
      ? data.preferred_ui
      : null
    return {
      killSwitch,
      betaAccess: data.chat_beta_access === true ? true : data.chat_beta_access === false ? false : null,
      preferredUi: preferred,
    }
  } catch {
    return { killSwitch, betaAccess: null, preferredUi: null }
  }
}

export async function updatePreferredUi(
  userId: string,
  preferredUi: 'classic' | 'chat'
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ preferred_ui: preferredUi })
    .eq('id', userId)
  if (error) throw error
}

export async function assignUnassignedProductToBusiness(
  userId: string,
  productId: string,
  businessId: string
): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .update({ business_id: businessId })
    .eq('id', productId)
    .eq('owner_id', userId)
    .is('business_id', null)
    .select('*')
    .maybeSingle()
  if (error) throw error
  if (!data) {
    throw new Error('Product is already assigned or was not found')
  }
  return data as Product
}

export async function getAppFeatureFlag(key: string): Promise<AppFeatureFlagState> {
  try {
    const { data, error } = await supabase
      .from('app_feature_flags')
      .select('enabled')
      .eq('key', key)
      .maybeSingle()
    if (error) return 'unreadable'
    if (!data) return 'disabled'
    return data.enabled === true ? 'enabled' : 'disabled'
  } catch {
    return 'unreadable'
  }
}

export interface UsageLimitsRow {
  plan: string
  scriptsUsed: number
  scriptsLimit: number
  imagesUsed: number
  imagesLimit: number
  bonusImages: number
  descriptionsUsed: number
  descriptionsLimit: number
  repliesUsed: number
  repliesLimit: number
}

/** Plan + monthly usage. Prefer RPC `get_usage_limits`; fall back to table reads. */
let usageRpcMissing = false
let usageLimitsInflight: Promise<UsageLimitsRow> | null = null

export async function getUsageLimits(userId: string): Promise<UsageLimitsRow> {
  if (usageLimitsInflight) return usageLimitsInflight
  const pending = loadUsageLimits(userId)
  usageLimitsInflight = pending
  try {
    return await pending
  } finally {
    if (usageLimitsInflight === pending) usageLimitsInflight = null
  }
}

async function loadUsageLimits(userId: string): Promise<UsageLimitsRow> {
  if (!usageRpcMissing) {
    try {
      const { data, error } = await supabase.rpc('get_usage_limits', { p_user_id: userId })
      if (!error && data) {
        return {
          plan: data.plan || 'free',
          scriptsUsed: data.scriptsUsed || 0,
          scriptsLimit: data.scriptsLimit ?? 10,
          imagesUsed: data.imagesUsed || 0,
          imagesLimit: data.imagesLimit ?? 1,
          bonusImages: data.bonusImages || 0,
          descriptionsUsed: data.descriptionsUsed || 0,
          descriptionsLimit: data.descriptionsLimit ?? 10,
          repliesUsed: data.repliesUsed || 0,
          repliesLimit: data.repliesLimit ?? 10,
        }
      }
      if (isMissingRpcError(error)) usageRpcMissing = true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isMissingRpcError({ message }) || /\b404\b/.test(message)) usageRpcMissing = true
    }
  }

  const currentMonth = new Date().toISOString().slice(0, 7) + '-01'
  const [subRes, usageRes, profileRes] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('plan, status')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing'])
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('usage')
      .select('scripts_generated, images_generated, descriptions_generated, enhances_generated, replies_generated')
      .eq('user_id', userId)
      .eq('period_start', currentMonth)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('bonus_images')
      .eq('id', userId)
      .maybeSingle(),
  ])

  const plan = subRes.data?.[0]?.plan || 'free'
  const { data: limits } = await supabase
    .from('plan_limits')
    .select('scripts_per_month, images_per_month, descriptions_per_month, replies_per_month')
    .eq('plan', plan)
    .maybeSingle()

  const usage = usageRes.data
  const bonus = profileRes.data?.bonus_images || 0
  const baseImageLimit = limits?.images_per_month ?? 1

  return {
    plan,
    scriptsUsed: usage?.scripts_generated || 0,
    scriptsLimit: limits?.scripts_per_month ?? 10,
    imagesUsed: (usage?.images_generated || 0) + Math.floor((usage?.enhances_generated || 0) / 2),
    imagesLimit: baseImageLimit === -1 ? -1 : baseImageLimit + bonus,
    bonusImages: bonus,
    descriptionsUsed: usage?.descriptions_generated || 0,
    descriptionsLimit: limits?.descriptions_per_month ?? 10,
    repliesUsed: usage?.replies_generated || 0,
    repliesLimit: limits?.replies_per_month ?? 10,
  }
}

/**
 * Hard-delete a chat session (O1). Authz via existing 062 RLS
 * `chat_sessions_delete` → `can_write_chat_session(id)`.
 *
 * Ordered cleanup first: null `message_id` then `session_id` on posts /
 * product_images in one UPDATE (keeps `product_id` + assets). Required because
 * check `product_images_message_requires_session` rejects session_id-null while
 * message_id remains — which is what chat_sessions ON DELETE SET NULL alone does.
 *
 * Fail-closed cleanup: after UPDATE, re-SELECT remaining rows by session_id;
 * throw if any remain (silent RLS 0-row UPDATE). Then hard delete with
 * `.select('id')` + throw on empty / server error (23503 / 23514).
 *
 * Preview schema defense-in-depth (do not re-apply from tip):
 * - offer FKs ON DELETE SET NULL
 * - trigger `preview_product_images_null_message_with_session`
 *
 * No soft-archive. Do not use `deleteSessionMessages` as hygiene.
 */
export function assertChatSessionDeleteResult(
  data: Array<{ id: string }> | null | undefined
): void {
  if (!data || data.length === 0) {
    throw new Error(
      'Session not deleted (RLS or missing). On Preview, CASCADE children need DELETE/UPDATE policies and offer FK blockers must be cleared first — see docs/operations/chat-shell-preview-rls.md.'
    )
  }
}

/** Fail-closed: leftover session-linked rows mean cleanup UPDATE was blocked (often silent RLS). */
export function assertSessionThreadLinkagesCleared(
  table: 'product_images' | 'posts',
  remaining: Array<{ id: string }> | null | undefined
): void {
  if (remaining == null) {
    throw new Error(
      `Session delete blocked: could not verify ${table} thread cleanup (RLS or missing).`
    )
  }
  if (remaining.length > 0) {
    throw new Error(
      `Session delete blocked: ${table} still linked after cleanup (RLS likely blocked UPDATE). Null message_id + session_id first — see docs/operations/chat-shell-preview-rls.md.`
    )
  }
}

export function formatChatSessionDeleteError(err: unknown): Error {
  if (err instanceof Error && !(err as Error & { code?: string }).code) {
    // Already a clear Error (assert helpers) — keep message for toast.
    return err
  }
  if (err && typeof err === 'object') {
    const row = err as { message?: string; code?: string; details?: string; hint?: string }
    if (row.message || row.code) {
      const code = row.code ? ` [${row.code}]` : ''
      const details = row.details ? ` ${row.details}` : ''
      return new Error(`${row.message || 'Session delete failed'}${code}${details}`.trim())
    }
  }
  if (err instanceof Error) return err
  return new Error(String(err || 'Session delete failed'))
}

/**
 * Clear session/message links before hard delete; preserve product ownership.
 * message_id is listed first so a partial apply cannot leave message_id set
 * with session_id null (check product_images_message_requires_session).
 */
async function clearSessionThreadLinkages(sessionId: string): Promise<void> {
  await clearTableThreadLinkages('product_images', sessionId)
  await clearTableThreadLinkages('posts', sessionId)
}

async function clearTableThreadLinkages(
  table: 'product_images' | 'posts',
  sessionId: string
): Promise<void> {
  // Prefer message_id first in the payload; both null in one UPDATE so CHECK passes.
  const { error: updateErr } = await supabase
    .from(table)
    .update({ message_id: null, session_id: null })
    .eq('session_id', sessionId)
    .select('id')

  if (updateErr) throw formatChatSessionDeleteError(updateErr)

  const { data: remaining, error: verifyErr } = await supabase
    .from(table)
    .select('id')
    .eq('session_id', sessionId)

  if (verifyErr) throw formatChatSessionDeleteError(verifyErr)
  assertSessionThreadLinkagesCleared(table, remaining)
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  if (!sessionId) {
    throw new Error('Session delete failed: missing session id.')
  }

  try {
    await clearSessionThreadLinkages(sessionId)

    const { data, error } = await supabase
      .from('chat_sessions')
      .delete()
      .eq('id', sessionId)
      .select('id')

    if (error) throw formatChatSessionDeleteError(error)
    assertChatSessionDeleteResult(data)
  } catch (err) {
    throw formatChatSessionDeleteError(err)
  }
}

/** First user-message preview per session (for sidebar titles). */
export async function getFirstUserMessagePreviews(
  sessionIds: string[]
): Promise<Record<string, string>> {
  if (sessionIds.length === 0) return {}
  const { data, error } = await supabase
    .from('messages')
    .select('session_id, content, created_at')
    .in('session_id', sessionIds)
    .eq('role', 'user')
    .order('created_at', { ascending: true })
    .limit(Math.min(sessionIds.length * 4, 200))

  if (error) throw error
  const out: Record<string, string> = {}
  for (const row of data || []) {
    const sid = row.session_id as string
    if (!sid || out[sid]) continue
    const content = typeof row.content === 'string' ? row.content.trim() : ''
    if (content) out[sid] = content
  }
  return out
}

export async function getSessionOffers(sessionId: string): Promise<ChatSessionOffer[]> {
  const { data, error } = await supabase
    .from('chat_session_offers')
    .select('*, product:products(*)')
    .eq('session_id', sessionId)
    .order('position', { ascending: true })

  if (error) throw error
  return data || []
}

/**
 * Single-offer P2: replace session offers with one position-1 product.
 * Requires session.business_id (FK); product must belong to same business.
 */
export async function setSessionPrimaryOffer(
  sessionId: string,
  businessId: string,
  productId: string,
  userId: string
): Promise<ChatSessionOffer> {
  return replaceSessionOffers(sessionId, businessId, [productId], userId).then((rows) => {
    if (!rows[0]) throw new Error('Failed to set primary offer')
    return rows[0]
  })
}

/**
 * Replace session offers with an ordered product list (max 5, gap-free positions).
 * Does not delete offers that already have message_artifacts (cascade would wipe cards).
 * Position rewrite stays inside CHECK (position ∈ [1,5]) — never parks at 100+i.
 */
export async function replaceSessionOffers(
  sessionId: string,
  businessId: string,
  productIds: string[],
  userId: string
): Promise<ChatSessionOffer[]> {
  if (!businessId) {
    throw new Error('Session needs a brand (business_id) before attaching offers.')
  }

  if (productIds.length > CHAT_SHELL_MAX_OFFERS) {
    throw new Error(`At most ${CHAT_SHELL_MAX_OFFERS} offers per session`)
  }
  const nextRows = normalizeOfferPositions(productIds)
  const nextIds = new Set(nextRows.map((r) => r.product_id))
  const targetsByProductId: Record<string, number> = {}
  for (const row of nextRows) {
    targetsByProductId[row.product_id] = row.position
  }

  const current = await getSessionOffers(sessionId)
  const toRemove = current.filter((row) => !nextIds.has(row.product_id))

  if (toRemove.length > 0) {
    const removedIds = toRemove.map((r) => r.product_id)
    const { count, error: artErr } = await supabase
      .from('message_artifacts')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .in('product_id', removedIds)
    if (artErr) throw artErr
    if ((count ?? 0) > 0) {
      throw new Error(
        'Cannot remove offers that already have generated scripts in this session.'
      )
    }
    const { error: delError } = await supabase
      .from('chat_session_offers')
      .delete()
      .eq('session_id', sessionId)
      .in('product_id', removedIds)
    if (delError) throw delError
  }

  const kept = current.filter((row) => nextIds.has(row.product_id))
  const keptIds = new Set(kept.map((row) => row.product_id))

  const hasArtifactsForProduct = async (productId: string): Promise<boolean> => {
    const { count, error } = await supabase
      .from('message_artifacts')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('product_id', productId)
    if (error) throw error
    return (count ?? 0) > 0
  }

  let plan = planKeptOfferPositionUpdates(
    kept.map((row) => ({ product_id: row.product_id, position: row.position })),
    Object.fromEntries(
      kept.map((row) => [row.product_id, targetsByProductId[row.product_id]])
    )
  )

  let pivotRow: (typeof kept)[number] | null = null
  if (plan.pivotDeleteId) {
    const pivotCandidates = [
      plan.pivotDeleteId,
      ...kept.map((row) => row.product_id).filter((id) => id !== plan.pivotDeleteId),
    ]
    let pivotId: string | null = null
    for (const candidateId of pivotCandidates) {
      if (!(await hasArtifactsForProduct(candidateId))) {
        pivotId = candidateId
        break
      }
    }
    if (!pivotId) {
      throw new Error(
        'Cannot reorder five offers when every offer already has scripts (no free 1..5 slot or artifact-free pivot).'
      )
    }
    pivotRow = kept.find((row) => row.product_id === pivotId) || null
    if (!pivotRow) {
      throw new Error('Offer reorder pivot missing from kept rows')
    }

    // Open a 1..5 hole by temp-deleting the pivot, then re-plan on the remainder.
    const { error: pivotDelErr } = await supabase
      .from('chat_session_offers')
      .delete()
      .eq('session_id', sessionId)
      .eq('product_id', pivotRow.product_id)
    if (pivotDelErr) throw pivotDelErr

    const remainder = kept.filter((row) => row.product_id !== pivotRow!.product_id)
    plan = planKeptOfferPositionUpdates(
      remainder.map((row) => ({ product_id: row.product_id, position: row.position })),
      Object.fromEntries(
        remainder.map((row) => [row.product_id, targetsByProductId[row.product_id]])
      )
    )
    if (plan.pivotDeleteId) {
      throw new Error('Offer position planner still needs a pivot after opening a hole')
    }
  }

  for (const move of plan.moves) {
    const { error } = await supabase
      .from('chat_session_offers')
      .update({ position: move.position })
      .eq('session_id', sessionId)
      .eq('product_id', move.product_id)
    if (error) throw error
  }

  for (const row of nextRows) {
    if (pivotRow && row.product_id === pivotRow.product_id) {
      const { error } = await supabase.from('chat_session_offers').insert({
        session_id: sessionId,
        business_id: businessId,
        product_id: row.product_id,
        position: row.position,
        created_by: pivotRow.created_by || userId,
      })
      if (error) throw error
      continue
    }
    if (keptIds.has(row.product_id)) {
      // Kept rows already at final positions via planner moves (or were unchanged).
      continue
    }
    const { error } = await supabase.from('chat_session_offers').insert({
      session_id: sessionId,
      business_id: businessId,
      product_id: row.product_id,
      position: row.position,
      created_by: userId,
    })
    if (error) throw error
  }

  return getSessionOffers(sessionId)
}

export async function clearSessionOffers(sessionId: string): Promise<void> {
  const { count, error: artErr } = await supabase
    .from('message_artifacts')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
  if (artErr) throw artErr
  if ((count ?? 0) > 0) {
    throw new Error('Cannot clear offers after scripts were generated for this session.')
  }
  const { error } = await supabase
    .from('chat_session_offers')
    .delete()
    .eq('session_id', sessionId)

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

export async function deleteSessionMessages(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('session_id', sessionId)

  if (error) throw error
}

export async function getMessages(sessionId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) throw error
  const messages = data || []
  if (messages.length === 0) return messages

  const messageIds = messages.map((m) => m.id)
  const { data: artifacts, error: artErr } = await supabase
    .from('message_artifacts')
    .select('*, script:scripts(*), product:products(*), product_image:product_images(*)')
    .eq('session_id', sessionId)
    .in('message_id', messageIds)
    .order('ordinal', { ascending: true })

  if (artErr) throw artErr

  const byMessage = new Map<string, MessageArtifact[]>()
  for (const row of artifacts || []) {
    const list = byMessage.get(row.message_id) || []
    list.push(row as MessageArtifact)
    byMessage.set(row.message_id, list)
  }

  return messages.map((m) => ({
    ...m,
    artifacts: byMessage.get(m.id) || [],
  }))
}

export async function insertScriptMessageArtifact(options: {
  sessionId: string
  messageId: string
  productId: string
  scriptId: string
  ordinal: number
  userId: string
  actionType?: MessageArtifact['action_type']
  metadata?: Record<string, unknown>
}): Promise<MessageArtifact> {
  const { data, error } = await supabase
    .from('message_artifacts')
    .insert({
      session_id: options.sessionId,
      message_id: options.messageId,
      product_id: options.productId,
      artifact_type: 'script',
      script_id: options.scriptId,
      ordinal: options.ordinal,
      action_type: options.actionType || 'generate',
      action_metadata: options.metadata || {},
      created_by: options.userId,
    })
    .select('*, script:scripts(*), product:products(*)')
    .single()

  if (error) throw error
  return data as MessageArtifact
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
  generation_id?: string | null
  error_message?: string
  rating?: number | null
  // Carousel (organic) grouping — NULL for standalone posts.
  carousel_group_id?: string | null
  slide_index?: number | null
  slide_total?: number | null
  carousel_subtype?: string | null
  created_at: string
  updated_at: string
}

export interface CarouselSlideInsert {
  prompt: string
  generated_image_url: string
  width: number
  height: number
  slide_index: number
  slide_total: number
  carousel_subtype: string
}

/**
 * Persist all slides of a carousel as linked `posts` rows sharing a `carousel_group_id`.
 * Returns the inserted rows sorted by slide_index ascending.
 */
export async function createCarouselPosts(
  productId: string,
  userId: string,
  carouselGroupId: string,
  slides: CarouselSlideInsert[],
  model: string = 'nano-banana-pro'
): Promise<Post[]> {
  if (!slides.length) return []
  const rows = slides.map(s => ({
    product_id: productId,
    created_by: userId,
    prompt: s.prompt,
    generated_image_url: s.generated_image_url,
    status: 'completed' as const,
    width: s.width,
    height: s.height,
    output_format: 'jpeg',
    model,
    carousel_group_id: carouselGroupId,
    slide_index: s.slide_index,
    slide_total: s.slide_total,
    carousel_subtype: s.carousel_subtype,
  }))
  const { data, error } = await supabase
    .from('posts')
    .insert(rows)
    .select()
  if (error) throw error
  return (data || []).sort((a, b) => (a.slide_index ?? 0) - (b.slide_index ?? 0))
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
    generation_id?: string
  }
): Promise<Post> {
  const insertPayload = {
    product_id: productId,
    created_by: userId,
    prompt: data.prompt,
    input_images: data.input_images || [],
    width: data.width || 1080,
    height: data.height || 1080,
    output_format: data.output_format || 'jpeg',
    model: data.model || 'nano-banana-pro',
    generation_id: data.generation_id || null,
    status: 'generating'
  }

  let { data: post, error } = await supabase
    .from('posts')
    .insert(insertPayload)
    .select()
    .single()

  if (error && /generation_id/i.test(error.message || '')) {
    const { generation_id: _generationId, ...fallbackPayload } = insertPayload
    const retry = await supabase
      .from('posts')
      .insert(fallbackPayload)
      .select()
      .single()
    post = retry.data
    error = retry.error
  }

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

export async function ratePost(postId: string, rating: number | null): Promise<void> {
  const { error } = await supabase
    .from('posts')
    .update({ rating })
    .eq('id', postId)

  if (error) throw error
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
  kind: 'product' | 'context' | 'generated'
  session_id?: string | null
  message_id?: string | null
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

/** Session-aware list: refs for product + generated images for this session. */
export async function getSessionOfferImages(
  productId: string,
  sessionId: string
): Promise<ProductImage[]> {
  const { data, error } = await supabase
    .from('product_images')
    .select('*')
    .eq('product_id', productId)
    .or(`session_id.is.null,session_id.eq.${sessionId}`)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function createProductImage(
  productId: string,
  _userId: string,
  imageUrl: string,
  label?: string,
  kind: 'product' | 'context' | 'generated' = 'product',
  opts?: { sessionId?: string; messageId?: string }
): Promise<ProductImage> {
  // RLS WITH CHECK requires user_id = auth.uid(). Never trust a React prop that
  // can diverge from the JWT (INSERT … RETURNING fails with "violates RLS").
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) {
    throw new Error('Not authenticated')
  }
  const userId = authData.user.id

  if (opts?.sessionId) {
    const { data: offer, error: offerErr } = await supabase
      .from('chat_session_offers')
      .select('product_id')
      .eq('session_id', opts.sessionId)
      .eq('product_id', productId)
      .maybeSingle()
    if (offerErr) throw offerErr
    if (!offer) {
      throw new Error(
        'This product is not an offer on the session; cannot upload a session-scoped image.'
      )
    }
  }

  const insert: Record<string, unknown> = {
    product_id: productId,
    user_id: userId,
    image_url: imageUrl,
    label: label || null,
    kind,
  }
  if (opts?.sessionId) insert.session_id = opts.sessionId
  if (opts?.messageId) insert.message_id = opts.messageId

  const { data, error } = await supabase
    .from('product_images')
    .insert(insert)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteProductImage(imageId: string): Promise<void> {
  const { data: image, error: loadError } = await supabase
    .from('product_images')
    .select('id, image_url, user_id')
    .eq('id', imageId)
    .single()

  if (loadError) throw loadError

  const marker = '/storage/v1/object/public/post-images/'
  const markerIndex = image.image_url.indexOf(marker)
  if (markerIndex >= 0) {
    const objectPath = decodeURIComponent(image.image_url.slice(markerIndex + marker.length).split('?')[0])
    if (objectPath.startsWith(`${image.user_id}/`)) {
      const { error: storageError } = await supabase.storage.from('post-images').remove([objectPath])
      if (storageError && !/not found/i.test(storageError.message || '')) throw storageError
    }
  }

  const { error } = await supabase
    .from('product_images')
    .delete()
    .eq('id', imageId)

  if (error) throw error
}

export async function insertImageMessageArtifact(options: {
  sessionId: string
  messageId: string
  productId: string
  productImageId: string
  ordinal: number
  userId: string
  actionType?: MessageArtifact['action_type']
  metadata?: Record<string, unknown>
}): Promise<MessageArtifact> {
  const { data, error } = await supabase
    .from('message_artifacts')
    .insert({
      session_id: options.sessionId,
      message_id: options.messageId,
      product_id: options.productId,
      artifact_type: 'image',
      product_image_id: options.productImageId,
      ordinal: options.ordinal,
      action_type: options.actionType || 'generate',
      action_metadata: options.metadata || {},
      created_by: options.userId,
    })
    .select('*, product_image:product_images(*), product:products(*)')
    .single()

  if (error) throw error
  return data as MessageArtifact
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
  const fileName = `${userId}/${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from('feedback-screenshots')
    .upload(fileName, file, { contentType: 'image/jpeg' })

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
        const HIGH_VALUE_SIGNALS = ['script_rated', 'post_rated', 'edit_manual', 'user_explicit']
        const isHighValue = HIGH_VALUE_SIGNALS.includes(signalType) &&
          (!['script_rated', 'post_rated'].includes(signalType) || signalData.rating === 'bad' || signalData.rating === 'good')

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
    .maybeSingle()

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
function brandKitApiUrl(): string {
  return import.meta.env.PROD ? '/api/brand-kit' : 'http://localhost:3000/api/brand-kit'
}

async function brandKitAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  return { Authorization: `Bearer ${session.access_token}` }
}

async function listBrandKitsViaApi(): Promise<BrandKit[]> {
  const headers = await brandKitAuthHeader()
  const response = await fetch(brandKitApiUrl(), { headers })
  const json = await response.json().catch(() => ({})) as { kits?: BrandKit[]; error?: string }
  if (!response.ok) throw new Error(json.error || 'Could not load brand kits')
  return json.kits || []
}

async function saveBrandKitViaApi(kit: Record<string, unknown>): Promise<BrandKit> {
  const headers = await brandKitAuthHeader()
  const response = await fetch(brandKitApiUrl(), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(kit),
  })
  const json = await response.json().catch(() => ({})) as { kit?: BrandKit; error?: string }
  if (!response.ok || !json.kit) throw new Error(json.error || 'Could not save brand kit')
  return json.kit
}

export async function getBrandKits(userId: string): Promise<BrandKit[]> {
  const { data, error } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) {
    if (isRlsDeniedError(error)) {
      try {
        return (await listBrandKitsViaApi()).sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)))
      } catch (apiErr) {
        console.warn('Brand kits API fallback failed:', apiErr)
        return []
      }
    }
    throwDbError(error, 'Failed to load brand kits')
  }
  return (data || []).sort((a, b) => {
    if (a.is_default && !b.is_default) return -1
    if (!a.is_default && b.is_default) return 1
    return 0
  })
}

export async function createBrandKit(userId: string, kit: BrandKitFormData): Promise<BrandKit> {
  const { user_id: _drop, ...safeKit } = kit as BrandKitFormData & { user_id?: string }

  // Check if user has any kits — if not, make this one default
  const existing = await getBrandKits(userId)
  const isFirst = existing.length === 0

  const payload = {
    ...safeKit,
    user_id: userId,
    is_default: isFirst ? true : (safeKit.is_default || false),
    is_active: safeKit.is_active ?? true
  }

  const { data, error } = await supabase
    .from('brand_kits')
    .insert(payload)
    .select()
    .single()

  if (!error && data) return data

  if (isRlsDeniedError(error)) {
    return saveBrandKitViaApi(payload)
  }

  // Fallback: migrations 051/052 may not be applied yet — insert core columns only
  console.warn('brand_kits insert failed, trying core columns only:', error?.message)
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

  if (fallbackError || !fallbackData) {
    throwDbError(fallbackError, 'Brand kit could not be saved.')
  }
  return fallbackData
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

  if (!error && data) return data
  if (isMissingRowError(error) || isRlsDeniedError(error)) {
    if (isRlsDeniedError(error) && !isMissingRowError(error)) {
      try {
        return await saveBrandKitViaApi({ id: kitId, ...safeKit })
      } catch (apiErr) {
        console.warn('Brand kit update via API failed, creating a new kit:', apiErr)
      }
    }
    return saveBrandKitViaApi(safeKit)
  }
  if (error) throw error
  throw new Error('Brand kit could not be updated.')
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

// =============================================
// SCRIPT TEMPLATES
// =============================================
export async function getScriptTemplates(userId: string): Promise<ScriptTemplate[]> {
  const { data, error } = await supabase
    .from('script_templates')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function createScriptTemplate(
  userId: string,
  name: string,
  content: string
): Promise<ScriptTemplate> {
  const trimmed = content.slice(0, 10000)
  const { data, error } = await supabase
    .from('script_templates')
    .insert({ user_id: userId, name, content: trimmed })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function toggleScriptTemplateActive(
  templateId: string,
  isActive: boolean
): Promise<void> {
  const { error } = await supabase
    .from('script_templates')
    .update({ is_active: isActive })
    .eq('id', templateId)

  if (error) throw error
}

export async function deleteScriptTemplate(templateId: string): Promise<void> {
  const { error } = await supabase
    .from('script_templates')
    .delete()
    .eq('id', templateId)

  if (error) throw error
}

