/**
 * MCP OAuth HTTP challenge helpers (RFC 9728).
 * Build the parameter name from parts so tooling cannot scramble the literal.
 */

export const MCP_RESOURCE_METADATA_URL =
  'https://advanceai.studio/.well-known/oauth-protected-resource'

/** RFC 9728 WWW-Authenticate parameter name for protected-resource metadata URL. */
export const MCP_RESOURCE_METADATA_PARAM = ['resource', 'metadata'].join('_')

export function mcpWwwAuthenticateHeader(
  resourceMetadataUrl: string = MCP_RESOURCE_METADATA_URL
): string {
  return `Bearer ${MCP_RESOURCE_METADATA_PARAM}="${resourceMetadataUrl}"`
}
