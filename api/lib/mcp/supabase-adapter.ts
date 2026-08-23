/**
 * Server-only AIIAN adapter for per-user MCP read tools.
 * Uses the admin client with explicit owner/user filters on every query.
 */

import { getSupabaseAdmin } from '../supabase-admin.js'
import type { McpBrandContext, McpBrandSummary, McpDbClient } from './user-tools.js'

export function createMcpSupabaseAdapter(): McpDbClient | null {
  const db = getSupabaseAdmin()
  if (!db) return null

  return {
    async listBusinessesForUser(userId: string): Promise<McpBrandSummary[]> {
      if (!userId) return []
      const { data, error } = await db
        .from('businesses')
        .select('id, name')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        type: null,
      }))
    },

    async getBusinessForUser(userId: string, brandId: string) {
      if (!userId || !brandId) return null
      const { data, error } = await db
        .from('businesses')
        .select('id, name, owner_id')
        .eq('id', brandId)
        .eq('owner_id', userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        id: data.id as string,
        name: data.name as string,
        type: null,
        userId: data.owner_id as string,
      }
    },

    async listOffersForBrand(userId: string, brandId: string) {
      if (!userId || !brandId) return []
      const { data, error } = await db
        .from('products')
        .select('id, name, type')
        .eq('business_id', brandId)
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        type: (row.type as string | null) ?? null,
      }))
    },

    async getBrandKitForBrand(
      userId: string,
      brandId: string
    ): Promise<McpBrandContext['brandKit']> {
      if (!userId || !brandId) return null
      const { data, error } = await db
        .from('brand_kits')
        .select('id, name, primary_color, secondary_color')
        .eq('business_id', brandId)
        .eq('user_id', userId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        id: data.id as string,
        name: data.name as string,
        primaryColor: (data.primary_color as string | null) ?? null,
        secondaryColor: (data.secondary_color as string | null) ?? null,
      }
    },
  }
}
