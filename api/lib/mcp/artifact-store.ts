/**
 * Persist MCP EXECUTE outputs into chat session + library (service role).
 */

import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin } from '../supabase-admin.js'

export type McpArtifactStore = {
  ensureExecuteSession: (options: {
    userId: string
    brandId: string
    offerId: string
    title?: string
    sessionId?: string | null
  }) => Promise<{ sessionId: string }>
  saveScriptArtifact: (options: {
    userId: string
    brandId: string
    offerId: string
    sessionId: string
    title: string
    content: string
    approvalRequestId: string
  }) => Promise<{ messageId: string; scriptId: string }>
  saveImageArtifact: (options: {
    userId: string
    brandId: string
    offerId: string
    sessionId: string
    imageDataUrl: string
    label?: string
    approvalRequestId: string
    metadata?: Record<string, unknown>
  }) => Promise<{ messageId: string; productImageId: string; imageUrl: string }>
}

function parseDataUrl(dataUrl: string): { contentType: string; bytes: Buffer } {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) throw new Error('Expected image data URL')
  return {
    contentType: match[1] || 'image/png',
    bytes: Buffer.from(match[2], 'base64'),
  }
}

export function createMcpArtifactStore(): McpArtifactStore | null {
  const db = getSupabaseAdmin()
  if (!db) return null

  return {
    async ensureExecuteSession(options) {
      if (options.sessionId) {
        const { data, error } = await db
          .from('chat_sessions')
          .select('id, business_id, user_id')
          .eq('id', options.sessionId)
          .eq('user_id', options.userId)
          .eq('business_id', options.brandId)
          .maybeSingle()
        if (error) throw error
        if (!data) throw new Error('sessionId not found for this brand/user')
        // Ensure offer linked
        const { data: link } = await db
          .from('chat_session_offers')
          .select('product_id')
          .eq('session_id', options.sessionId)
          .eq('product_id', options.offerId)
          .maybeSingle()
        if (!link) {
          const { error: linkErr } = await db.from('chat_session_offers').insert({
            session_id: options.sessionId,
            product_id: options.offerId,
            business_id: options.brandId,
            created_by: options.userId,
            position: 1,
          })
          if (linkErr && linkErr.code !== '23505') throw linkErr
        }
        return { sessionId: options.sessionId }
      }

      const { data: session, error } = await db
        .from('chat_sessions')
        .insert({
          business_id: options.brandId,
          product_id: null,
          user_id: options.userId,
          title: options.title || 'MCP EXECUTE',
        })
        .select('id')
        .single()
      if (error) throw error

      const { error: linkErr } = await db.from('chat_session_offers').insert({
        session_id: session.id,
        product_id: options.offerId,
        business_id: options.brandId,
        created_by: options.userId,
        position: 1,
      })
      if (linkErr) throw linkErr
      return { sessionId: session.id as string }
    },

    async saveScriptArtifact(options) {
      const { data: message, error: msgErr } = await db
        .from('messages')
        .insert({
          session_id: options.sessionId,
          role: 'assistant',
          content: options.content,
        })
        .select('id')
        .single()
      if (msgErr) throw msgErr

      const { data: script, error: scriptErr } = await db
        .from('scripts')
        .insert({
          session_id: options.sessionId,
          product_id: options.offerId,
          title: options.title,
          content: options.content,
          edit_source: 'mcp_execute',
          message_id: message.id,
          script_index: 0,
        })
        .select('id')
        .single()
      if (scriptErr) throw scriptErr

      const { error: artErr } = await db.from('message_artifacts').insert({
        session_id: options.sessionId,
        message_id: message.id,
        product_id: options.offerId,
        artifact_type: 'script',
        script_id: script.id,
        ordinal: 1,
        action_type: 'generate',
        action_metadata: {
          source: 'mcp',
          approvalRequestId: options.approvalRequestId,
        },
        created_by: options.userId,
      })
      if (artErr) throw artErr

      await db
        .from('chat_sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', options.sessionId)

      return { messageId: message.id as string, scriptId: script.id as string }
    },

    async saveImageArtifact(options) {
      const parsed = parseDataUrl(options.imageDataUrl)
      const ext = parsed.contentType.includes('jpeg') || parsed.contentType.includes('jpg')
        ? 'jpg'
        : parsed.contentType.includes('webp')
          ? 'webp'
          : 'png'
      const path = `${options.userId}/${options.offerId}/product-refs/mcp-${randomUUID()}.${ext}`
      const { error: upErr } = await db.storage.from('post-images').upload(path, parsed.bytes, {
        contentType: parsed.contentType,
        upsert: false,
      })
      if (upErr) throw upErr
      const { data: pub } = db.storage.from('post-images').getPublicUrl(path)
      const imageUrl = pub.publicUrl

      const { data: message, error: msgErr } = await db
        .from('messages')
        .insert({
          session_id: options.sessionId,
          role: 'assistant',
          content: options.label || 'MCP generated image',
        })
        .select('id')
        .single()
      if (msgErr) throw msgErr

      const { data: productImage, error: imgErr } = await db
        .from('product_images')
        .insert({
          product_id: options.offerId,
          user_id: options.userId,
          image_url: imageUrl,
          label: options.label || 'MCP generate',
          kind: 'generated',
          session_id: options.sessionId,
          message_id: message.id,
        })
        .select('id')
        .single()
      if (imgErr) throw imgErr

      const { error: artErr } = await db.from('message_artifacts').insert({
        session_id: options.sessionId,
        message_id: message.id,
        product_id: options.offerId,
        artifact_type: 'image',
        product_image_id: productImage.id,
        ordinal: 1,
        action_type: 'generate',
        action_metadata: {
          source: 'mcp',
          approvalRequestId: options.approvalRequestId,
          ...(options.metadata || {}),
        },
        created_by: options.userId,
      })
      if (artErr) throw artErr

      await db
        .from('chat_sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', options.sessionId)

      return {
        messageId: message.id as string,
        productImageId: productImage.id as string,
        imageUrl,
      }
    },
  }
}
