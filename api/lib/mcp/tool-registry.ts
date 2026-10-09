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

export const MCP_REGISTRY_VERSION = '0.10.0'

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
    description:
      'List brands owned by the signed-in user (or team-visible). To make a batch of ads for one of them: adpack_start {brandId, offerId (defaultOfferId), size, brief?} (optionally adpack_from_brand first to review gaps).',
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
    name: 'list_assets',
    group: 'brand_workspace',
    risk: 'read',
    description:
      'List product, context, and generated images for an owned brand/offer. Returns stored HTTPS URLs and reusable productImageId values.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'list_scripts',
    group: 'brand_workspace',
    risk: 'read',
    description:
      'List saved scripts for an owned brand (optional offerId/sessionId). Returns full content so agents can reload copy after bulk/pack jobs.',
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
    description: 'Return a diverse buyer-niche angle board (not same-ad-different-words) with full hooks. Free GUIDE, cached 1 h per brand/offer/count/language (refresh: true for a new one). Every item carries adpackAngleId + adpackAngle (shared angle catalog: regalo, cómo funciona, valor/precio, qué incluye, uso real, detalle técnico, comparación, temporada, problema→solución, prueba social) that adpack_start accepts as {angles} or {angleIds}.',
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
    description: 'Save a GUIDE/external script or image into the Advance library, including product/context refs from an https URL (no credits; no base64).',
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
    name: 'get_execute_result',
    group: 'execute_studio',
    risk: 'read',
    description:
      'Poll any async EXECUTE job by jobId (same as approvalRequestId). Returns running|completed|failed plus a bilingual statusMessage. ' +
      'Keep polling after an EXECUTE tool returns status=running so the artifact reaches chat without MCP client timeout.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'execute_script_generate',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Generate a script via Advance AI (credits). Without approvalRequestId, returns a chat confirmation prompt — show userPrompt, then call confirm_execute after the user says yes. ' +
      'After approve, returns quickly with jobId (status=running); poll get_execute_result until completed (includes script text). Same approvalRequestId is idempotent.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_image_generate',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Generate an image via Advance at max Grok quality 2k/medium (credits), with optional library reference ids and guidePrompt. Ask in chat via userPrompt + confirm_execute — do not lead with a raw approval URL. ' +
      'After approve, returns quickly with jobId (status=running); poll get_execute_result until completed (includes imageUrl). Same approvalRequestId is idempotent.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_bulk_scripts',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Generate up to N diverse scripts from an angle board (3 credits each succeeded; one in-chat approval via confirm_execute). ' +
      'After approve, returns jobId + statusMessage; poll get_execute_result until completed.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_bulk_posts',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Generate varied posts for selected angles (6 or 24 credits each; may expand product refs; one in-chat approval via confirm_execute). ' +
      'After approve, returns jobId + statusMessage; poll get_execute_result until completed.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_campaign_pack',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Launch pack: angles → scripts → posts with one in-chat approval (confirm_execute) and a quoted total. ' +
      'After approve, returns jobId + statusMessage; poll get_execute_result until completed.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_image_edit',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Edit an image via Advance (Grok Imagine; 18 credits). Defaults to the offer’s latest generated image when no source is supplied. Confirm in chat with userPrompt + confirm_execute. ' +
      'After approve, returns jobId + statusMessage; poll get_execute_result until completed.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_image_enhance',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Enhance an image via Advance (Grok Imagine; 18 credits). Defaults to the offer’s latest generated image when no source is supplied. Confirm in chat with userPrompt + confirm_execute. ' +
      'After approve, returns jobId + statusMessage; poll get_execute_result until completed.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_carousel_generate',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Generate a carousel from scriptId or scriptContent via Advance (Gemini Pro, max 5 slides, 24 credits/slide; one in-chat approval). ' +
      'After approve, returns jobId + statusMessage; poll get_execute_result until completed.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },

  // Ad Pack engine (same service as POST /api/ad-pack) — 10 sell-ready static ads
  {
    name: 'adpack_from_brand',
    group: 'guide_studio',
    risk: 'guide',
    description:
      'Ad Pack for an EXISTING brand (happy path): list_brands → adpack_from_brand {brandId, offerId?} (optional, to review gaps) → adpack_start {brandId, offerId, size, brief?} → the user confirms in chat (confirm_execute) → poll adpack_status until moreWork=false → share the image links, captions and the brand-folder deepLink. ' +
      'This tool builds the Brand DNA + offer from what the owner already saved (brand, brand kit voice/colors/logo/forbidden phrases, offer form, real product photos, stored site analysis) — no URLs or uploads needed, no credits. ' +
      'Returns {dna, offer, gaps, notes, quote, missingPrice}. Only facts the owner typed are confirmed and only confirmed facts are used for prices/claims (a price appears only if the offer has a concrete price). ' +
      'Before adpack_start, show the user the gaps; if missingPrice=true say clearly that no ad will show a price and ask whether to add it first or continue. ' +
      'Never invent brandId/offerId: use ids returned by list_brands / list_offers / this tool.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_dna_ingest',
    group: 'guide_studio',
    risk: 'guide',
    description:
      'Ad Pack for a NEW brand not saved in AdvanceAI: build the Brand DNA (facts, voice, audience, visual style, gaps) from a website URL, Instagram profile, https uploads, an offer form and/or user facts. No Advance credits. ' +
      'For a brand that already exists use adpack_from_brand / adpack_start {brandId} instead. Show dna.facts and dna.gaps to the user, then confirm with adpack_dna_confirm.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_dna_confirm',
    group: 'guide_studio',
    risk: 'sync_write',
    description:
      'Ad Pack step 2: apply the user\'s confirmations / edits / additions / removals to the DNA facts. Only confirmed facts may become claims (price, guarantee, delivery). Returns the updated dna. No credits.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_angles',
    group: 'guide_studio',
    risk: 'guide',
    description:
      'Ad Pack (optional): plan distinct ad angles from the shared angle catalog (regalo, cómo funciona, valor/precio, qué incluye, uso real, detalle técnico, comparación, temporada, problema→solución, prueba social only with verified proof) × hook × format for dna + offer, or for a saved brand via {brandId, offerId}. Each angle has a stable id "<category>-<hookType>-<format>" and a short rationale. Deterministic, no credits. Pass chosen ids as angleIds to adpack_start (guide_bulk_angles adpackAngleId values work too).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_quote',
    group: 'guide_studio',
    risk: 'read',
    description: 'Ad Pack: credit quote for a pack (size, or dna + offer for the planned size). No credits.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_start',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Ad Pack: start a pack of sell-ready static ads (credits per finished ad). For an existing brand pass {brandId, offerId, size, brief?} INSTEAD of dna/offer — the server builds them from the saved brand (no adpack_from_brand call required). ' +
      'brief = optional campaign context from the user (e.g. "Black Friday, focus on bundles"); it steers theme only and is never used as a fact. ' +
      'Creative control: creativeFreedom "high" (default when you give only brand/offer) lets Advance choose angle, hook, format, layout family and scene; pass angleIds (adpack_angles / guide_bulk_angles adpackAngleId) or angles (guide_bulk_angles adpackAngle objects) to steer. variations 1–3 = ads per angle (same copy, different scene/layout; credits = ads × variations). styleDnaId (list_style_dnas) makes the layouts follow the brand\'s winning ads; layoutFamily forces one look. The response lists per ad {angleId, category, hookType, format, layoutFamily, rationale}. ' +
      'Without approvalRequestId returns an in-chat confirmation (userPrompt + quote) — call confirm_execute after the user says yes, then retry with the same arguments plus approvalRequestId. ' +
      'Never invent brandId, offerId or approvalRequestId: use only ids returned by list_brands / list_offers / adpack_from_brand and the approvalRequestId returned by this tool. If adpack_from_brand reported missingPrice, tell the user before starting. ' +
      'Guarantees: only confirmed facts are used for prices/claims; images keep the real product photo; text on the image is rendered exactly (never drawn by the image model). Takes ~2 min per 10 ads. ' +
      'Returns packId; then poll adpack_status every ~20-30 s until moreWork=false.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'adpack_status',
    group: 'execute_studio',
    risk: 'read',
    description:
      'Ad Pack: progress of a pack by packId (from adpack_start; never invent one). Returns summary (one human line with ready/failed counts and ~time left — relay it), etaSeconds and, while running, compact per-ad rows. ' +
      'Poll every ~20-30 s (work continues in the background between polls; a pack of 10 takes ~2 min) and STOP as soon as moreWork=false. ' +
      'When finished it returns deliverable {ads[{index, format, angleId, category, hookType, rationale, layoutFamily, headline, caption, links{1:1,4:5,9:16}}], captionsText, deepLink}: present it as a numbered list of links + captions with the angle and why, offer captionsText to copy all captions, and share the deepLink (brand folder where every ad is saved). ' +
      'failures[] explains failed ads in plain language with the exact adpack_regenerate call to retry (paid, needs confirmation).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_edit_text',
    group: 'execute_studio',
    risk: 'sync_write',
    description:
      'Ad Pack: edit the on-image text or caption of one finished ad (headline, subline, bullets, offerLine, cta, caption) and re-render it instantly. Free; rejected when it breaks facts or length rules.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_regenerate',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Ad Pack: regenerate one ad (mode scene = new image, copy = new text + image). Use the exact call from adpack_status failures[].retry.call for a failed ad. Costs one ad of credits: in-chat confirmation via confirm_execute, then retry with approvalRequestId (never invent it) and poll adpack_status every ~20-30 s.',
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
