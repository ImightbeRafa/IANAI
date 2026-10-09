/**
 * Single source of the MCP server identity. `serverInfo.version` is only visible to clients at `initialize`; the
 * `get_server_info` tool and the `serverVersion` field of every execute result expose the same data inside a tool
 * response (free, read-only, no side effects) so a client can tell which build answered.
 */
export const MCP_VERSION = '0.18.0'

export const MCP_SERVER_INFO = {
  name: 'advance-ai',
  version: MCP_VERSION,
  title: 'Advance AI',
  websiteUrl: 'https://advanceai.studio',
  icons: [{ src: 'https://advanceai.studio/brand/advance-mark.png', mimeType: 'image/png', sizes: ['74x73'] }],
}

/** Capabilities a client can feature-detect (keep in sync with docs/operations/mcp-user-tools.md). */
export const MCP_FEATURES = [
  'generated_web_flow',
  'exact_with_text_logo_qa',
  'fidelity_warning_feature_match',
  'props_policy_input',
  'props_warning',
  'safe_zone_margin_8pct',
  'one_cta_rule',
  'layout_cap_copy_overflow',
  'auto_retry_keep_better',
  'provider_retry_backoff',
  'halo_warning',
  'server_version_in_results',
  'safe_zone_autofix',
  'code_composited_logo_cta',
  'accessory_refs_budget_5',
  'caption_field',
  'fidelity_palette_fallback',
] as const

declare const __ADVANCE_BUILD_COMMIT__: string | undefined

function buildCommit(env: Record<string, string | undefined>): string {
  const injected = typeof __ADVANCE_BUILD_COMMIT__ !== 'undefined' ? __ADVANCE_BUILD_COMMIT__ : ''
  return (env.BUILD_COMMIT || env.GIT_COMMIT_SHA || env.VERCEL_GIT_COMMIT_SHA || injected || '').trim().slice(0, 40) || 'unknown'
}

export function buildServerInfo(opts: { commit?: string; env?: Record<string, string | undefined> } = {}): {
  name: string
  version: string
  commit: string
  features: readonly string[]
} {
  const env = opts.env ?? (typeof process !== 'undefined' ? process.env : {})
  return { name: MCP_SERVER_INFO.name, version: MCP_VERSION, commit: opts.commit || buildCommit(env), features: MCP_FEATURES }
}
