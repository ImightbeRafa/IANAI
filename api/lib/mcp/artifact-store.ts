/**
 * Persist MCP EXECUTE outputs into chat session + library (service role).
 */

import { randomUUID } from 'node:crypto'
import { encodeGeneratedImageJpeg } from '../generated-image-jpeg.js'
import { getSupabaseAdmin } from '../supabase-admin.js'

export type McpOwnedImage = {
  id: string
  imageUrl: string
  offerId: string
  sessionId?: string | null
  label?: string | null
  kind?: 'product' | 'context' | 'generated'
  createdAt?: string | null
}

export type McpOwnedScript = {
  id: string
  content: string
  title: string | null
  offerId: string | null
  sessionId: string | null
}

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
    actionType?: 'generate' | 'edit' | 'enhance'
  }) => Promise<{ messageId: string; productImageId: string; imageUrl: string }>
  saveImageFromPublicUrl: (options: {
    userId: string
    brandId: string
    offerId: string
    sessionId: string
    imageUrl: string
    label?: string
    kind?: 'generated'
    metadata?: Record<string, unknown>
  }) => Promise<{ messageId: string; productImageId: string; imageUrl: string }>
  saveReferenceImageFromPublicUrl: (options: {
    userId: string
    brandId: string
    offerId: string
    imageUrl: string
    kind: 'product' | 'context'
    label?: string
  }) => Promise<{ productImageId: string; imageUrl: string }>
  linkExistingProductImage: (options: {
    userId: string
    brandId: string
    offerId: string
    sessionId: string
    productImageId: string
    label?: string
  }) => Promise<{ messageId: string; productImageId: string; imageUrl: string }>
  getOwnedProductImage: (options: {
    userId: string
    brandId: string
    imageId: string
    offerId?: string
  }) => Promise<McpOwnedImage | null>
  getOwnedScript: (options: {
    userId: string
    brandId: string
    scriptId: string
  }) => Promise<McpOwnedScript | null>
  listOwnedScripts: (options: {
    userId: string
    brandId: string
    offerId?: string
    sessionId?: string
    limit?: number
  }) => Promise<Array<McpOwnedScript & { createdAt?: string | null }>>
  listLatestGeneratedImage: (options: {
    userId: string
    brandId: string
    offerId: string
  }) => Promise<McpOwnedImage | null>
  listOwnedAssets: (options: {
    userId: string
    brandId: string
    offerId?: string
    kind?: 'product' | 'context' | 'generated'
  }) => Promise<McpOwnedImage[]>
  saveCarouselSlides: (options: {
    userId: string
    brandId: string
    offerId: string
    sessionId: string
    carouselGroupId: string
    subtype: string
    slides: Array<{ index: number; imageDataUrl: string; headline?: string; role?: string }>
    approvalRequestId: string
  }) => Promise<Array<{ index: number; messageId: string; productImageId: string; imageUrl: string; postId?: string }>>
}

async function jpegBytesForGeneratedUpload(imageSource: string): Promise<{
  bytes: Buffer
  contentType: 'image/jpeg'
  extension: 'jpg'
}> {
  const jpeg = await encodeGeneratedImageJpeg(imageSource)
  return {
    bytes: jpeg.bytes,
    contentType: jpeg.contentType,
    extension: jpeg.extension,
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
      // Always JPEG for generated ads — avoids 5 MiB Storage failures on 2k PNG and never stores blobs in jobs.
      const jpeg = await jpegBytesForGeneratedUpload(options.imageDataUrl)
      const path = `${options.userId}/${options.offerId}/product-refs/mcp-${randomUUID()}.${jpeg.extension}`
      const { error: upErr } = await db.storage.from('post-images').upload(path, jpeg.bytes, {
        contentType: jpeg.contentType,
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
        action_type: options.actionType || 'generate',
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

    async saveReferenceImageFromPublicUrl(options) {
      const { data: product, error: productErr } = await db
        .from('products')
        .select('id')
        .eq('id', options.offerId)
        .eq('business_id', options.brandId)
        .eq('owner_id', options.userId)
        .maybeSingle()
      if (productErr) throw productErr
      if (!product) throw new Error('Offer not found for this brand/user')

      const { data, error } = await db
        .from('product_images')
        .insert({
          product_id: options.offerId,
          user_id: options.userId,
          image_url: options.imageUrl,
          label: options.label || `MCP ${options.kind} reference`,
          kind: options.kind,
        })
        .select('id')
        .single()
      if (error) throw error
      return {
        productImageId: data.id as string,
        imageUrl: options.imageUrl,
      }
    },

    async saveImageFromPublicUrl(options) {
      const { data: message, error: msgErr } = await db
        .from('messages')
        .insert({
          session_id: options.sessionId,
          role: 'assistant',
          content: options.label || 'MCP saved image',
        })
        .select('id')
        .single()
      if (msgErr) throw msgErr

      const { data: productImage, error: imgErr } = await db
        .from('product_images')
        .insert({
          product_id: options.offerId,
          user_id: options.userId,
          image_url: options.imageUrl,
          label: options.label || 'MCP save',
          kind: options.kind || 'generated',
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
          kind: 'workspace_save_artifact',
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
        imageUrl: options.imageUrl,
      }
    },

    async linkExistingProductImage(options) {
      const owned = await this.getOwnedProductImage({
        userId: options.userId,
        brandId: options.brandId,
        imageId: options.productImageId,
        offerId: options.offerId,
      })
      if (!owned) throw new Error('productImageId not found for this brand/user')

      const { data: message, error: msgErr } = await db
        .from('messages')
        .insert({
          session_id: options.sessionId,
          role: 'assistant',
          content: options.label || 'MCP linked image',
        })
        .select('id')
        .single()
      if (msgErr) throw msgErr

      const { error: artErr } = await db.from('message_artifacts').insert({
        session_id: options.sessionId,
        message_id: message.id,
        product_id: options.offerId,
        artifact_type: 'image',
        product_image_id: owned.id,
        ordinal: 1,
        action_type: 'generate',
        action_metadata: {
          source: 'mcp',
          kind: 'workspace_save_artifact',
          linkedExisting: true,
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
        productImageId: owned.id,
        imageUrl: owned.imageUrl,
      }
    },

    async getOwnedProductImage(options) {
      const { data, error } = await db
        .from('product_images')
        .select('id, image_url, product_id, session_id, label, user_id, kind, created_at')
        .eq('id', options.imageId)
        .eq('user_id', options.userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      if (options.offerId && data.product_id !== options.offerId) return null
      const { data: product, error: productErr } = await db
        .from('products')
        .select('id, business_id, owner_id')
        .eq('id', data.product_id)
        .eq('business_id', options.brandId)
        .eq('owner_id', options.userId)
        .maybeSingle()
      if (productErr) throw productErr
      if (!product) return null
      return {
        id: data.id as string,
        imageUrl: data.image_url as string,
        offerId: data.product_id as string,
        sessionId: (data.session_id as string | null) ?? null,
        label: (data.label as string | null) ?? null,
        kind: data.kind as McpOwnedImage['kind'],
        createdAt: (data.created_at as string | null) ?? null,
      }
    },

    async getOwnedScript(options) {
      const { data, error } = await db
        .from('scripts')
        .select('id, content, title, product_id, session_id')
        .eq('id', options.scriptId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      if (data.product_id) {
        const { data: product } = await db
          .from('products')
          .select('id')
          .eq('id', data.product_id)
          .eq('business_id', options.brandId)
          .eq('owner_id', options.userId)
          .maybeSingle()
        if (!product) return null
      } else if (data.session_id) {
        const { data: session } = await db
          .from('chat_sessions')
          .select('id')
          .eq('id', data.session_id)
          .eq('business_id', options.brandId)
          .eq('user_id', options.userId)
          .maybeSingle()
        if (!session) return null
      } else {
        return null
      }
      return {
        id: data.id as string,
        content: String(data.content || ''),
        title: (data.title as string | null) ?? null,
        offerId: (data.product_id as string | null) ?? null,
        sessionId: (data.session_id as string | null) ?? null,
      }
    },

    async listOwnedScripts(options) {
      const limit = Math.min(Math.max(options.limit ?? 25, 1), 50)

      // Authorize session ownership before reading any script rows.
      if (options.sessionId) {
        const { data: session, error: sessionErr } = await db
          .from('chat_sessions')
          .select('id')
          .eq('id', options.sessionId)
          .eq('business_id', options.brandId)
          .eq('user_id', options.userId)
          .maybeSingle()
        if (sessionErr) throw sessionErr
        if (!session) return []

        const { data, error } = await db
          .from('scripts')
          .select('id, content, title, product_id, session_id, created_at')
          .eq('session_id', options.sessionId)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (error) throw error
        return (data || []).map((row) => ({
          id: row.id as string,
          content: String(row.content || ''),
          title: (row.title as string | null) ?? null,
          offerId: (row.product_id as string | null) ?? null,
          sessionId: (row.session_id as string | null) ?? null,
          createdAt: (row.created_at as string | null) ?? null,
        }))
      }

      let productQuery = db
        .from('products')
        .select('id')
        .eq('business_id', options.brandId)
        .eq('owner_id', options.userId)
      if (options.offerId) productQuery = productQuery.eq('id', options.offerId)
      const { data: products, error: productErr } = await productQuery
      if (productErr) throw productErr
      const offerIds = (products || []).map((row) => row.id as string)
      if (!offerIds.length) return []

      let query = db
        .from('scripts')
        .select('id, content, title, product_id, session_id, created_at')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (options.offerId) {
        query = query.eq('product_id', options.offerId)
      } else {
        query = query.in('product_id', offerIds)
      }

      const { data, error } = await query
      if (error) throw error

      return (data || []).map((row) => ({
        id: row.id as string,
        content: String(row.content || ''),
        title: (row.title as string | null) ?? null,
        offerId: (row.product_id as string | null) ?? null,
        sessionId: (row.session_id as string | null) ?? null,
        createdAt: (row.created_at as string | null) ?? null,
      }))
    },

    async listLatestGeneratedImage(options) {
      const assets = await this.listOwnedAssets({
        userId: options.userId,
        brandId: options.brandId,
        offerId: options.offerId,
        kind: 'generated',
      })
      return assets[0] || null
    },

    async listOwnedAssets(options) {
      let productQuery = db
        .from('products')
        .select('id')
        .eq('business_id', options.brandId)
        .eq('owner_id', options.userId)
      if (options.offerId) productQuery = productQuery.eq('id', options.offerId)
      const { data: products, error: productErr } = await productQuery
      if (productErr) throw productErr
      const offerIds = (products || []).map((row) => row.id as string)
      if (!offerIds.length) return []

      let imageQuery = db
        .from('product_images')
        .select('id, image_url, product_id, session_id, label, kind, created_at')
        .eq('user_id', options.userId)
        .in('product_id', offerIds)
      if (options.kind) imageQuery = imageQuery.eq('kind', options.kind)
      const { data, error } = await imageQuery
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []).map((row) => ({
        id: row.id as string,
        imageUrl: row.image_url as string,
        offerId: row.product_id as string,
        sessionId: (row.session_id as string | null) ?? null,
        label: (row.label as string | null) ?? null,
        kind: row.kind as McpOwnedImage['kind'],
        createdAt: (row.created_at as string | null) ?? null,
      }))
    },

    async saveCarouselSlides(options) {
      const saved: Array<{ index: number; messageId: string; productImageId: string; imageUrl: string; postId?: string }> = []
      for (const slide of options.slides) {
        const image = await this.saveImageArtifact({
          userId: options.userId,
          brandId: options.brandId,
          offerId: options.offerId,
          sessionId: options.sessionId,
          imageDataUrl: slide.imageDataUrl,
          label: slide.headline ? `Carousel ${slide.index}: ${slide.headline}` : `Carousel slide ${slide.index}`,
          approvalRequestId: options.approvalRequestId,
          actionType: 'generate',
          metadata: {
            carouselGroupId: options.carouselGroupId,
            slideIndex: slide.index,
            subtype: options.subtype,
            role: slide.role,
          },
        })
        let postId: string | undefined
        try {
          const { data: post, error: postErr } = await db
            .from('posts')
            .insert({
              product_id: options.offerId,
              created_by: options.userId,
              prompt: slide.headline || `Carousel slide ${slide.index}`,
              generated_image_url: image.imageUrl,
              status: 'completed',
              model: 'nano-banana-pro',
              carousel_group_id: options.carouselGroupId,
              slide_index: slide.index,
              slide_total: options.slides.length,
              carousel_subtype: options.subtype,
              session_id: options.sessionId,
              message_id: image.messageId,
            })
            .select('id')
            .single()
          if (!postErr) postId = post.id as string
        } catch {
          // posts insert is best-effort; chat library save already succeeded
        }
        saved.push({ ...image, index: slide.index, postId })
      }
      return saved
    },
  }
}
