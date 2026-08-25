import { describe, expect, it } from 'vitest'
import {
  createMemoryMcpApprovalStore,
  issueMcpApprovalRequest,
} from '../api/lib/mcp/approval'
import { mcpConfirmExecute } from '../api/lib/mcp/confirm-execute'
import {
  mcpExecuteCarouselGenerate,
  mcpExecuteImageGenerate,
  mcpExecuteScriptGenerate,
  resolveMcpSourceImage,
} from '../api/lib/mcp/execute-tools'
import { mcpGuideImage, mcpGuideScript } from '../api/lib/mcp/guide-packs'
import type { McpArtifactStore } from '../api/lib/mcp/artifact-store'
import type { McpDbClient } from '../api/lib/mcp/user-tools'

const db: McpDbClient = {
  async listBusinessesForUser() {
    return [{ id: 'b1', name: 'Brand' }]
  },
  async getBusinessForUser(userId, brandId) {
    return userId === 'u1' && brandId === 'b1'
      ? { id: 'b1', name: 'Brand', userId: 'u1' }
      : null
  },
  async listOffersForBrand() {
    return [{ id: 'o1', name: 'Offer', price: '$29' }]
  },
  async getBrandKitForBrand() {
    return { id: 'k1', name: 'Kit' }
  },
}

function artifactStore(): McpArtifactStore {
  return {
    async ensureExecuteSession() {
      return { sessionId: 's1' }
    },
    async saveScriptArtifact() {
      return { messageId: 'm1', scriptId: 'script-new' }
    },
    async saveImageArtifact() {
      return { messageId: 'm1', productImageId: 'img-new', imageUrl: 'https://cdn.example/new.jpg' }
    },
    async saveImageFromPublicUrl(options) {
      return { messageId: 'm1', productImageId: 'img-url', imageUrl: options.imageUrl }
    },
    async saveReferenceImageFromPublicUrl(options) {
      return { productImageId: `img-${options.kind}`, imageUrl: options.imageUrl }
    },
    async linkExistingProductImage() {
      return { messageId: 'm1', productImageId: 'img-existing', imageUrl: 'https://cdn.example/existing.jpg' }
    },
    async getOwnedProductImage({ imageId }) {
      return imageId === 'img-product'
        ? {
            id: imageId,
            imageUrl: 'https://cdn.example/product.webp',
            offerId: 'o1',
            kind: 'product',
          }
        : null
    },
    async getOwnedScript({ scriptId }) {
      return scriptId === 'script-1'
        ? {
            id: scriptId,
            content: 'Hook\nDevelopment\nCTA',
            title: 'Owned script',
            offerId: 'o1',
            sessionId: 's1',
          }
        : null
    },
    async listLatestGeneratedImage() {
      return {
        id: 'img-latest',
        imageUrl: 'https://cdn.example/latest.jpg',
        offerId: 'o1',
        kind: 'generated',
        createdAt: '2026-08-25T01:00:00.000Z',
      }
    },
    async listOwnedAssets() {
      return []
    },
    async saveCarouselSlides() {
      return []
    },
  }
}

describe('CreativeDirector MCP must-haves', () => {
  it('binds carousel scriptId and resolves its owned content with a five-slide cap', async () => {
    const approvalStore = createMemoryMcpApprovalStore()
    const result = await mcpExecuteCarouselGenerate({
      db,
      approvalStore,
      artifactStore: artifactStore(),
      user: { id: 'u1' },
      args: {
        brandId: 'b1',
        scriptId: 'script-1',
        slideCount: 5,
      },
    })
    expect(result.status).toBe('approval_required')
    const record = await approvalStore.findById(String(result.approvalRequestId))
    expect(record?.inputJson).toMatchObject({
      brandId: 'b1',
      offerId: 'o1',
      scriptId: 'script-1',
      scriptContent: 'Hook\nDevelopment\nCTA',
      slideCount: 5,
    })

    await expect(mcpExecuteCarouselGenerate({
      db,
      approvalStore,
      artifactStore: artifactStore(),
      user: { id: 'u1' },
      args: {
        brandId: 'b1',
        scriptId: 'script-1',
        slideCount: 6,
      },
    })).rejects.toThrow(/slideCount/i)
  })

  it('defaults edit/enhance source resolution to the latest generated offer image', async () => {
    await expect(resolveMcpSourceImage({
      artifactStore: artifactStore(),
      userId: 'u1',
      brandId: 'b1',
      offerId: 'o1',
    })).resolves.toEqual({
      productImageId: 'img-latest',
      imageUrl: 'https://cdn.example/latest.jpg',
    })
  })

  it('returns bound angleIds from confirm_execute for the exact retry', async () => {
    const approvalStore = createMemoryMcpApprovalStore()
    const issued = await issueMcpApprovalRequest(approvalStore, {
      userId: 'u1',
      toolName: 'execute_bulk_posts',
      input: {
        brandId: 'b1',
        offerId: 'o1',
        count: 2,
        angleIds: ['angle-2', 'angle-4'],
        aspectRatio: '4:5',
      },
      quotedCreditCost: 12,
    })
    const confirmed = await mcpConfirmExecute({
      approvalStore,
      user: { id: 'u1' },
      args: { approvalRequestId: issued.approvalRequestId, action: 'approve' },
    })
    expect(confirmed.executeArguments).toMatchObject({
      approvalRequestId: issued.approvalRequestId,
      angleIds: ['angle-2', 'angle-4'],
      aspectRatio: '4:5',
    })
  })

  it('binds existing script and image settings plus guidePrompt before approval', async () => {
    const scriptApprovals = createMemoryMcpApprovalStore()
    const scriptResult = await mcpExecuteScriptGenerate({
      db,
      approvalStore: scriptApprovals,
      artifactStore: artifactStore(),
      user: { id: 'u1' },
      args: {
        brandId: 'b1',
        framework: 'educativo',
        variations: 3,
        generationMode: 'mixed',
        ctaStrength: 'soft',
        buyerStage: 'warm',
        language: 'en',
        guidePrompt: 'Lead with a practical checklist.',
      },
    })
    const scriptRecord = await scriptApprovals.findById(String(scriptResult.approvalRequestId))
    expect(scriptRecord?.inputJson).toMatchObject({
      framework: 'educativo',
      variations: 3,
      generationMode: 'mixed',
      ctaStrength: 'soft',
      buyerStage: 'warm',
      language: 'en',
      guidePrompt: 'Lead with a practical checklist.',
    })

    const imageApprovals = createMemoryMcpApprovalStore()
    const imageResult = await mcpExecuteImageGenerate({
      db,
      approvalStore: imageApprovals,
      artifactStore: artifactStore(),
      user: { id: 'u1' },
      args: {
        brandId: 'b1',
        productImageId: 'img-product',
        scene: 'Bright kitchen counter',
        aspectRatio: '4:5',
        imageModel: 'grok-imagine',
        guidePrompt: 'Keep packaging text legible.',
      },
    })
    const imageRecord = await imageApprovals.findById(String(imageResult.approvalRequestId))
    expect(imageRecord?.inputJson).toMatchObject({
      productImageId: 'img-product',
      referenceImageIds: ['img-product'],
      scene: 'Bright kitchen counter',
      aspectRatio: '4:5',
      imageModel: 'grok-imagine',
      guidePrompt: 'Keep packaging text legible.',
    })
  })

  it('includes known offer price and do-not-claim guidance, with product refs before logo', async () => {
    const guideDb: McpDbClient = {
      ...db,
      async getBrandKitForBrand() {
        return {
          id: 'k1',
          name: 'Kit',
          logoUrl: 'https://cdn.example/logo.png',
          forbiddenPhrases: ['guaranteed cure'],
        }
      },
      async listOfferReferenceImages() {
        return ['https://cdn.example/product.webp']
      },
    }
    const script = await mcpGuideScript(guideDb, { id: 'u1' }, {
      brandId: 'b1',
      language: 'en',
    })
    expect(script).toMatchObject({
      price: '$29',
      doNotClaim: ['guaranteed cure'],
    })
    expect(String(script.prompt)).toContain('Known price: $29')
    expect(String(script.prompt)).toContain('Do not claim: guaranteed cure')

    const image = await mcpGuideImage(guideDb, { id: 'u1' }, { brandId: 'b1' })
    expect(image.referenceUrls).toEqual([
      'https://cdn.example/product.webp',
      'https://cdn.example/logo.png',
    ])
  })
})
