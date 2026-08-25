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
  | 'admin'

export type McpToolDefinition = {
  name: string
  group: McpToolGroupId
  risk: McpToolRisk
  description: string
  enabled: boolean
  requiresApproval: boolean
  consumesAdvanceCredits: boolean
}

export const MCP_REGISTRY_VERSION = '0.9.0'

export const MCP_TOOL_GROUPS: Record<McpToolGroupId, {
  title: string
  summary: string
  defaultEnabled: boolean
}> = {
  brand_workspace: {
    title: 'Brand Workspace',
    summary:
      'Brands, offers, and brand kits (CRUD + explicit business linking / PatchHouse) — shared with the web app.',
    defaultEnabled: true,
  },
  guide_studio: {
    title: 'Guide Studio',
    summary: 'Prompts and context so Grok generates with the user’s own Grok usage (no Advance credits).',
    defaultEnabled: true,
  },
  execute_studio: {
    title: 'Execute Studio',
    summary:
      'Advance-run scripts/images (credits + in-chat confirm_execute). MCP caps: bulk ≤10, carousel ≤5 slides.',
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
    defaultEnabled: true,
  },
  account_team: {
    title: 'Account & Team',
    summary: 'Usage and team/admin — same rules as the web app.',
    defaultEnabled: false,
  },
  admin: {
    title: 'Admin',
    summary: 'Admin-only tickets and usage. Hidden unless the user is an Advance admin.',
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
    description:
      'Get one brand with offers and brand kit for GUIDE or EXECUTE. Optional brandKitId selects among linked kits.',
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
  {
    name: 'list_brand_kits',
    group: 'brand_workspace',
    risk: 'read',
    description: 'List brand kits (optionally filtered by brand). Free sync read.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'get_brand_kit',
    group: 'brand_workspace',
    risk: 'read',
    description: 'Get one brand kit detail by kitId (voice, palette, refs, Style DNAs).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'create_brand_kit',
    group: 'brand_workspace',
    risk: 'sync_write',
    description:
      'Create a brand kit linked to a brand (business_id). Free sync write — no Advance credits.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'update_brand_kit',
    group: 'brand_workspace',
    risk: 'sync_write',
    description: 'Update brand kit fields (colors, voice, refs). Free sync write.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'link_brand_kit',
    group: 'brand_workspace',
    risk: 'sync_write',
    description:
      'Link an unlinked kit to a brand (PatchHouse / business_id). Does not move kits between brands.',
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
  {
    name: 'guide_bulk_angles',
    group: 'guide_studio',
    risk: 'guide',
    description: 'Return a diverse buyer-niche angle board (not same-ad-different-words). Free GUIDE.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'list_style_dnas',
    group: 'brand_workspace',
    risk: 'read',
    description: 'List Style DNAs saved on the brand kit (organic/ads reference packs).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'set_style_dna',
    group: 'brand_workspace',
    risk: 'sync_write',
    description: 'Create or update a Style DNA on the brand kit (no generation credits).',
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
    description: 'Save a GUIDE/external script or image into the Advance library via https URL or already-in-workspace id (no credits; no base64).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },

  // EXECUTE — Advance credits + in-chat confirm_execute (optional web fallback)
  {
    name: 'confirm_execute',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Approve or deny a pending Advance EXECUTE after the user confirms in THIS chat. ' +
      'Pass approvalRequestId from the previous approval_required response. Prefer this over any optionalAdvancePage URL. ' +
      'After status=approved, immediately retry the same EXECUTE tool with that approvalRequestId.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'execute_script_generate',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Generate a script via Advance AI (credits). Without approvalRequestId, returns a chat confirmation prompt — show userPrompt, then call confirm_execute after the user says yes.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_image_generate',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Generate an image via Advance at max Grok quality 2k/medium (credits). Ask in chat via userPrompt + confirm_execute — do not lead with a raw approval URL.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_bulk_scripts',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Generate up to N diverse scripts from an angle board (3 credits each succeeded; one in-chat approval via confirm_execute).',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_bulk_posts',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Generate varied posts for selected angles (6 or 24 credits each; may expand product refs; one in-chat approval via confirm_execute).',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_campaign_pack',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Launch pack: angles → scripts → posts with one in-chat approval (confirm_execute) and a quoted total.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_image_edit',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Edit an image via Advance (Grok Imagine; 18 credits). Confirm in chat with userPrompt + confirm_execute.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_image_enhance',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Enhance an image via Advance (Grok Imagine; 18 credits). Confirm in chat with userPrompt + confirm_execute.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_carousel_generate',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Generate a carousel via Advance (Gemini Pro, 24 credits/slide; one in-chat approval). Host timeout is 180s — large carousels may need a smaller slideCount.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },

  // Archive & deletes
  {
    name: 'archive_brand',
    group: 'deletes',
    risk: 'delete',
    description:
      'Archive a brand/folder (recoverable; hidden from default MCP lists). Requires typed confirm + in-chat confirm_execute.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: false,
  },
  {
    name: 'delete_offer',
    group: 'deletes',
    risk: 'delete',
    description:
      'Permanently delete an offer after typed confirm + in-chat confirm_execute (same rules as web).',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: false,
  },
  {
    name: 'delete_brand',
    group: 'deletes',
    risk: 'delete',
    description:
      'Permanently delete a brand/folder after typed brand-name confirm + impact warning + in-chat confirm_execute (no recovery).',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: false,
  },
  {
    name: 'delete_asset',
    group: 'deletes',
    risk: 'delete',
    description:
      'Permanently delete a product/context/generated image after typed confirm + in-chat confirm_execute.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: false,
  },
  {
    name: 'delete_brand_kit',
    group: 'deletes',
    risk: 'delete',
    description:
      'Permanently delete a brand kit after typed kit-name confirm + in-chat confirm_execute (no Advance credits).',
    enabled: true,
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
    group: 'admin',
    risk: 'admin',
    description: 'Admin-only usage summary (server-enforced).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'admin_list_tickets',
    group: 'admin',
    risk: 'admin',
    description: 'Admin-only list of feedback tickets (server-enforced).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'admin_get_ticket',
    group: 'admin',
    risk: 'admin',
    description: 'Admin-only ticket detail including diagnostics (server-enforced).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'admin_update_ticket',
    group: 'admin',
    risk: 'admin',
    description: 'Admin-only ticket status + comment update (server-enforced).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'admin_request_cursor_fix',
    group: 'admin',
    risk: 'admin',
    description: 'Admin-only structured Cursor Cloud Agent brief for a ticket. Does not auto-call Cursor.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
]

export function listEnabledMcpTools(options?: {
  groupsEnabled?: Partial<Record<McpToolGroupId, boolean>>
  isAdmin?: boolean
}): McpToolDefinition[] {
  return MCP_TOOL_REGISTRY.filter((tool) => {
    if (tool.group === 'admin' || tool.risk === 'admin') {
      return Boolean(options?.isAdmin) && tool.enabled
    }
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
