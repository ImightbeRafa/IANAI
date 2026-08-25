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
    expect(MCP_REGISTRY_VERSION).toMatch(/^0\.7\./)
    expect(listEnabledMcpTools().some((t) => t.name.startsWith('admin_'))).toBe(false)
    expect(listEnabledMcpTools({ isAdmin: true }).map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'admin_list_tickets',
        'admin_get_ticket',
        'admin_update_ticket',
        'admin_get_usage',
        'admin_request_cursor_fix',
      ])
    )
    const enabled = listEnabledMcpTools()
    const names = enabled.map((t) => t.name).sort()
    expect(names).toContain('list_brands')
    expect(names).toContain('guide_script')
    expect(names).toContain('execute_image_generate')
    expect(names).not.toContain('execute_carousel_generate')
    expect(names).not.toContain('delete_brand')
    expect(enabled.every((t) => t.enabled)).toBe(true)
    expect(getMcpTool('guide_image')?.consumesAdvanceCredits).toBe(false)
    expect(getMcpTool('execute_image_generate')?.consumesAdvanceCredits).toBe(true)
    expect(getMcpTool('execute_image_generate')?.requiresApproval).toBe(true)
    expect(getMcpTool('execute_image_generate')?.enabled).toBe(true)
    expect(getMcpTool('archive_brand')?.enabled).toBe(false)
    expect(getMcpTool('workspace_note_generated_outside')?.consumesAdvanceCredits).toBe(false)
    expect(MCP_TOOL_GROUPS.guide_studio.defaultEnabled).toBe(true)
    expect(MCP_TOOL_GROUPS.execute_studio.defaultEnabled).toBe(true)
  })

  it('keeps execute tools off even if execute_studio group is flipped on', () => {
    const listed = listEnabledMcpTools({
      groupsEnabled: { execute_studio: true, brand_workspace: true, guide_studio: true },
    })
    expect(listed.some((t) => t.name === 'execute_image_generate')).toBe(true)
    expect(listed.some((t) => t.name === 'list_brands')).toBe(true)
  })
})
