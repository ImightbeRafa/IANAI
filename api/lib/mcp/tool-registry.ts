/**
 * Versioned MCP tool registry for Grok bot (primary) and later Codex.
 *
 * Dual mode:
 * - GUIDE: context/prompts/skills for Grok's own generation — no Advance credits
 * - EXECUTE: Advance APIs run generation — credits + approval
 */

export type McpToolRisk = 'read' | 'guide' | 'sync_write' | 'execute' | 'delete' | 'admin'

export type McpToolGroupId =
  | 'brand_workspace'
  | 'guide_studio'
  | 'execute_studio'
  | 'library_sessions'
  | 'deletes'
  | 'account_team'

export type McpToolDefinition = {
  name: string
  group: McpToolGroupId
  risk: McpToolRisk
  description: string
  enabled: boolean
  requiresApproval: boolean
  consumesAdvanceCredits: boolean
}

export const MCP_REGISTRY_VERSION = '0.6.0'

export const MCP_TOOL_GROUPS: Record<McpToolGroupId, {
  title: string
  summary: string
  defaultEnabled: boolean
}> = {
  brand_workspace: {
    title: 'Brand Workspace',
    summary: 'Brands, offers, brand kits — shared with the web app.',
    defaultEnabled: true,
  },
  guide_studio: {
    title: 'Guide Studio',
    summary: 'Prompts and context so Grok generates with the user’s own Grok usage (no Advance credits).',
    defaultEnabled: true,
  },
  execute_studio: {
    title: 'Execute Studio',
    summary: 'Advance-run scripts/images (credits + Advance web approval page).',
    defaultEnabled: true,
  },
  library_sessions: {
    title: 'Library & Sessions',
    summary: 'Sessions, provenance, URL/file intake into brand folders, deep links.',
    defaultEnabled: true,
  },
  deletes: {
    title: 'Archive & Deletes',
    summary: 'Archive brands/folders; permanent delete with clear no-recovery warnings.',
    defaultEnabled: false,
  },
  account_team: {
    title: 'Account & Team',
    summary: 'Usage and team/admin — same rules as the web app.',
    defaultEnabled: false,
  },
}

export const MCP_TOOL_REGISTRY: McpToolDefinition[] = [
  // Brand / sync reads
  {
    name: 'list_brands',
    group: 'brand_workspace',
    risk: 'read',
    description: 'List brands owned by the signed-in user (or team-visible).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'get_brand_context',
    group: 'brand_workspace',
    risk: 'read',
    description: 'Get one brand with offers and brand kit for GUIDE or EXECUTE.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'list_offers',
    group: 'brand_workspace',
    risk: 'read',
    description: 'List offers for an owned brand.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },

  // GUIDE — free for Advance credits
  {
    name: 'guide_script',
    group: 'guide_studio',
    risk: 'guide',
    description: 'Return brand-aware script brief + prompt for Grok text (user’s Grok usage).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'guide_image',
    group: 'guide_studio',
    risk: 'guide',
    description: 'Return Grok Imagine prompt, refs, size, and fidelity rules (user’s Grok Imagine usage).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'guide_brand_pack',
    group: 'guide_studio',
    risk: 'guide',
    description: 'Pack voice, palette, logo URL, offer facts for Grok without generating.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },

  // Workspace sync writes (no generation credits)
  {
    name: 'workspace_save_url_context',
    group: 'library_sessions',
    risk: 'sync_write',
    description: 'Save a source URL onto an owned brand as pending_analysis (no credits; analyzed by worker).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'workspace_ingest_file',
    group: 'library_sessions',
    risk: 'sync_write',
    description: 'Accept file descriptors and return Advance upload deep link (PDF/images; no credits).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'workspace_note_generated_outside',
    group: 'library_sessions',
    risk: 'sync_write',
    description: 'Record session provenance that an image/script was generated outside Advance (no binary import).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'workspace_import_asset',
    group: 'library_sessions',
    risk: 'sync_write',
    description: 'Return Advance upload deep link for product/context refs (not external Grok outputs).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'workspace_save_artifact',
    group: 'library_sessions',
    risk: 'sync_write',
    description: 'Persist an Advance-generated script/image into the library with deep link.',
    enabled: false,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },

  // EXECUTE — Advance credits + Grok chat approval popup
  {
    name: 'execute_script_generate',
    group: 'execute_studio',
    risk: 'execute',
    description: 'Generate a script via Advance AI (credits; Advance web approval required).',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_image_generate',
    group: 'execute_studio',
    risk: 'execute',
    description: 'Generate an image via Advance at max Grok quality 2k/medium (credits; Advance web approval required).',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_image_edit',
    group: 'execute_studio',
    risk: 'execute',
    description: 'Edit an image via Advance (Grok Imagine, credits; Grok approval popup).',
    enabled: false,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_image_enhance',
    group: 'execute_studio',
    risk: 'execute',
    description: 'Enhance an image via Advance (Grok Imagine, credits; Grok approval popup).',
    enabled: false,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_carousel_generate',
    group: 'execute_studio',
    risk: 'execute',
    description: 'Generate a carousel via Advance (Gemini render, credits; Grok approval popup).',
    enabled: false,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },

  // Archive & deletes
  {
    name: 'archive_brand',
    group: 'deletes',
    risk: 'delete',
    description: 'Archive a brand/business folder (recoverable; hidden from default lists).',
    enabled: false,
    requiresApproval: true,
    consumesAdvanceCredits: false,
  },
  {
    name: 'delete_offer',
    group: 'deletes',
    risk: 'delete',
    description: 'Delete an offer after confirmation (same rules as web).',
    enabled: false,
    requiresApproval: true,
    consumesAdvanceCredits: false,
  },
  {
    name: 'delete_brand',
    group: 'deletes',
    risk: 'delete',
    description: 'Permanently delete a brand/folder after typed confirm + impact warning (no recovery).',
    enabled: false,
    requiresApproval: true,
    consumesAdvanceCredits: false,
  },
  {
    name: 'delete_asset',
    group: 'deletes',
    risk: 'delete',
    description: 'Delete a product/context/generated image after confirmation.',
    enabled: false,
    requiresApproval: true,
    consumesAdvanceCredits: false,
  },

  // Team / admin
  {
    name: 'team_list_members',
    group: 'account_team',
    risk: 'admin',
    description: 'List team members when the user has team access.',
    enabled: false,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'admin_get_usage',
    group: 'account_team',
    risk: 'admin',
    description: 'Admin-only usage summary (server-enforced).',
    enabled: false,
    requiresApproval: false,
    consumesAdvanceCredits: false,
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

export function listGuideTools(): McpToolDefinition[] {
  return MCP_TOOL_REGISTRY.filter((tool) => tool.risk === 'guide')
}

export function listExecuteTools(): McpToolDefinition[] {
  return MCP_TOOL_REGISTRY.filter((tool) => tool.risk === 'execute')
}
