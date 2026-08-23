/**
 * Versioned MCP tool registry for Grok bot (primary) and later Codex.
 * Enable/disable groups without rewriting the host.
 */

export type McpToolRisk = 'read' | 'write_low' | 'generate' | 'admin'

export type McpToolGroupId =
  | 'brand_workspace'
  | 'creative_context'
  | 'script_studio'
  | 'visual_studio'
  | 'carousel_studio'
  | 'post_reply_studio'
  | 'library_sessions'
  | 'account_team'

export type McpToolDefinition = {
  name: string
  group: McpToolGroupId
  risk: McpToolRisk
  description: string
  /** When false, tool is hidden from MCP listTools (still in registry for tests). */
  enabled: boolean
  /** Generate/mutate tools require a server-verified approval token once product chooses UX. */
  requiresApproval: boolean
}

export const MCP_REGISTRY_VERSION = '0.1.0'

export const MCP_TOOL_GROUPS: Record<McpToolGroupId, {
  title: string
  summary: string
  defaultEnabled: boolean
}> = {
  brand_workspace: {
    title: 'Brand Workspace',
    summary: 'Brands, offers, brand kits, palettes, product assets.',
    defaultEnabled: true,
  },
  creative_context: {
    title: 'Creative Context',
    summary: 'Uploads, site/PDF/image analysis, memories.',
    defaultEnabled: false,
  },
  script_studio: {
    title: 'Script Studio',
    summary: 'Generate, revise, list, version, rate scripts.',
    defaultEnabled: false,
  },
  visual_studio: {
    title: 'Visual Studio',
    summary: 'Generate, edit, enhance, list and rate images (Grok default).',
    defaultEnabled: false,
  },
  carousel_studio: {
    title: 'Carousel Studio',
    summary: 'Plan/generate carousels (Gemini render).',
    defaultEnabled: false,
  },
  post_reply_studio: {
    title: 'Post & Reply Studio',
    summary: 'Post copy, organic formats, customer replies.',
    defaultEnabled: false,
  },
  library_sessions: {
    title: 'Library & Sessions',
    summary: 'Histories, artifacts, templates, session context.',
    defaultEnabled: false,
  },
  account_team: {
    title: 'Account & Team',
    summary: 'Usage, limits, subscription; role-gated admin.',
    defaultEnabled: false,
  },
}

/** Seed tools — expand via registry only; host reads listEnabledMcpTools(). */
export const MCP_TOOL_REGISTRY: McpToolDefinition[] = [
  {
    name: 'list_brands',
    group: 'brand_workspace',
    risk: 'read',
    description: 'List brands owned by the signed-in user.',
    enabled: true,
    requiresApproval: false,
  },
  {
    name: 'get_brand_context',
    group: 'brand_workspace',
    risk: 'read',
    description: 'Get one owned brand with offers and brand kit.',
    enabled: true,
    requiresApproval: false,
  },
  {
    name: 'list_offers',
    group: 'brand_workspace',
    risk: 'read',
    description: 'List offers for an owned brand.',
    enabled: false,
    requiresApproval: false,
  },
  {
    name: 'generate_image',
    group: 'visual_studio',
    risk: 'generate',
    description: 'Generate a single social image (Grok Imagine default).',
    enabled: false,
    requiresApproval: true,
  },
  {
    name: 'edit_image',
    group: 'visual_studio',
    risk: 'generate',
    description: 'Edit an existing image with an instruction (Grok Imagine).',
    enabled: false,
    requiresApproval: true,
  },
  {
    name: 'enhance_image',
    group: 'visual_studio',
    risk: 'generate',
    description: 'Enhance/polish an existing image (Grok Imagine).',
    enabled: false,
    requiresApproval: true,
  },
  {
    name: 'generate_carousel',
    group: 'carousel_studio',
    risk: 'generate',
    description: 'Generate a carousel (Gemini Nano Banana Pro).',
    enabled: false,
    requiresApproval: true,
  },
  {
    name: 'generate_script',
    group: 'script_studio',
    risk: 'generate',
    description: 'Generate or revise a sales/organic script.',
    enabled: false,
    requiresApproval: true,
  },
]

export function listEnabledMcpTools(options?: {
  groupsEnabled?: Partial<Record<McpToolGroupId, boolean>>
}): McpToolDefinition[] {
  return MCP_TOOL_REGISTRY.filter((tool) => {
    const groupOn = options?.groupsEnabled?.[tool.group]
    const groupDefault = MCP_TOOL_GROUPS[tool.group].defaultEnabled
    const groupAllowed = groupOn === undefined ? groupDefault : groupOn
    return tool.enabled && groupAllowed
  })
}

export function getMcpTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOL_REGISTRY.find((tool) => tool.name === name)
}
