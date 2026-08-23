import { describe, expect, it } from 'vitest'
import {
  IMAGE_PROVIDER_POLICY,
  resolveImageModelForAction,
} from '../api/lib/image-provider-routing'
import {
  resolveGrokAspectRatio,
  selectGrokEditReferenceUrls,
} from '../api/lib/grok-image-edit'
import {
  listEnabledMcpTools,
  MCP_REGISTRY_VERSION,
  MCP_TOOL_GROUPS,
  getMcpTool,
} from '../api/lib/mcp/tool-registry'

describe('image provider routing', () => {
  it('defaults generate to Grok and allows Nano alternate', () => {
    expect(resolveImageModelForAction({ action: 'generate' })).toBe('grok-imagine')
    expect(resolveImageModelForAction({ action: 'generate', requested: 'nano-banana-pro' })).toBe('nano-banana-pro')
    expect(IMAGE_PROVIDER_POLICY.carousel).toBe('nano-banana-pro')
  })

  it('forces edit/enhance onto Grok even if Nano was requested', () => {
    expect(resolveImageModelForAction({ action: 'edit', requested: 'nano-banana-pro' })).toBe('grok-imagine')
    expect(resolveImageModelForAction({ action: 'enhance', requested: 'nano-banana-pro' })).toBe('grok-imagine')
    expect(resolveImageModelForAction({ action: 'enhance', requested: 'gpt-image-2' })).toBe('gpt-image-2')
  })

  it('keeps carousel on Gemini', () => {
    expect(resolveImageModelForAction({ action: 'carousel', requested: 'grok-imagine' })).toBe('nano-banana-pro')
  })
})

describe('grok edit helpers', () => {
  it('maps 4:5 to a supported Grok ratio and budgets refs', () => {
    expect(resolveGrokAspectRatio('4:5')).toBe('3:4')
    expect(selectGrokEditReferenceUrls({
      baseImageUrl: 'data:base',
      supportUrls: ['data:a', 'data:b', 'data:c'],
    })).toEqual(['data:base', 'data:a', 'data:b'])
  })
})

describe('mcp tool registry', () => {
  it('exposes versioned brand reads only by default (dual-mode guide/execute)', () => {
    expect(MCP_REGISTRY_VERSION).toMatch(/^0\.2\./)
    const enabled = listEnabledMcpTools()
    expect(enabled.map((t) => t.name).sort()).toEqual(['get_brand_context', 'list_brands'])
    expect(enabled.every((t) => !t.consumesAdvanceCredits)).toBe(true)
    expect(getMcpTool('guide_image')?.consumesAdvanceCredits).toBe(false)
    expect(getMcpTool('execute_image_generate')?.consumesAdvanceCredits).toBe(true)
    expect(getMcpTool('execute_image_generate')?.requiresApproval).toBe(true)
    expect(getMcpTool('execute_image_generate')?.enabled).toBe(false)
    expect(MCP_TOOL_GROUPS.guide_studio.defaultEnabled).toBe(true)
    expect(MCP_TOOL_GROUPS.execute_studio.defaultEnabled).toBe(false)
  })

  it('keeps execute tools off even if execute_studio group is flipped on', () => {
    const listed = listEnabledMcpTools({
      groupsEnabled: { execute_studio: true, brand_workspace: true, guide_studio: true },
    })
    expect(listed.some((t) => t.name === 'execute_image_generate')).toBe(false)
    expect(listed.some((t) => t.name === 'list_brands')).toBe(true)
  })
})
