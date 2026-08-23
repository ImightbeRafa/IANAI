/**
 * OAuth protected-resource metadata for MCP clients (Grok Custom Connector).
 * https://advanceai.studio/.well-known/oauth-protected-resource → this function
 *
 * Authorization server = Supabase Auth OAuth 2.1 (must be enabled in Dashboard).
 * Consent UI path on Advance: /oauth/consent
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

const RESOURCE = 'https://advanceai.studio/api/mcp'

function supabaseAuthServerIssuer(): string {
  const base = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  ).replace(/\/$/, '')
  if (!base) {
    throw new Error('SUPABASE_URL / VITE_SUPABASE_URL is required for MCP OAuth metadata')
  }
  return `${base}/auth/v1`
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.setHeader('Content-Type', 'application/json')
  let authorizationServers: string[]
  try {
    authorizationServers = [supabaseAuthServerIssuer()]
  } catch {
    // Metadata must still be fetchable for discovery; clients will fail later if AS is empty.
    authorizationServers = []
  }
  res.status(200).json({
    resource: RESOURCE,
    authorization_servers: authorizationServers,
    scopes_supported: ['openid', 'profile', 'email'],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://advanceai.studio',
    mcp_auth_note:
      'Bearer = Supabase user access token after Advance OAuth consent at /oauth/consent. Enable Supabase Authentication → OAuth Server (path /oauth/consent, Dynamic Client Registration on).',
  })
}
