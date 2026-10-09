/**
 * Ad Pack MCP tool names. Kept dependency-free so the MCP host can route
 * without loading the render stack (satori/resvg/sharp) at cold start.
 */
export const ADPACK_MCP_TOOLS = [
  'adpack_from_brand',
  'adpack_dna_ingest',
  'adpack_dna_confirm',
  'adpack_angles',
  'adpack_quote',
  'adpack_start',
  'adpack_status',
  'adpack_edit_text',
  'adpack_regenerate',
  'adpack_resize',
] as const

export type AdPackMcpToolName = typeof ADPACK_MCP_TOOLS[number]

export function isAdPackMcpTool(name: string): name is AdPackMcpToolName {
  return (ADPACK_MCP_TOOLS as readonly string[]).includes(name)
}
