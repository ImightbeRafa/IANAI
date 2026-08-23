/**
 * OAuth protected-resource metadata for MCP clients (Grok Custom Connector).
 * https://advanceai.studio/.well-known/oauth-protected-resource → this function
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

const RESOURCE = 'https://advanceai.studio/api/mcp'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.setHeader('Content-Type', 'application/json')
  res.status(200).json({
    resource: RESOURCE,
    authorization_servers: ['https://advanceai.studio'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://advanceai.studio',
    // Full OAuth authorize/token against Supabase Auth + Advance consent UI comes next.
    mcp_auth_note:
      'Use a Supabase user access token (Bearer) issued after Advance login. Grok OAuth consent UI wiring is in progress.',
  })
}
