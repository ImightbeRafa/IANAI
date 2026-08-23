# Advance MCP for Grok bot (`advanceai.studio`)

Primary client: **Grok Custom Connector** → `https://advanceai.studio/api/mcp`

## Locked decisions
| Topic | Decision |
|---|---|
| Modes | GUIDE = free (Grok’s own usage); EXECUTE = Advance credits |
| Approval | Nice Grok chat popup; **TTL = 1 hour**; single-use; input-bound |
| Intake | HTTPS URL + up to **5** PDF/image files → build brand folder |
| External Grok images | Not imported; session `generated_outside` only |
| Advance images | Save in session/library at max API quality (`2k`/`medium`) |
| Brand delete | Delete everything under brand; **keep brand kits** (detach; delete kits separately) |
| Archive | Supported for folders |
| Social post | **No** |

## Live endpoints (this branch)
| URL | Role |
|---|---|
| `POST /api/mcp` | MCP JSON-RPC (`initialize`, `tools/list`, `tools/call`) |
| `GET /api/mcp` | Health / discovery blurb |
| `GET /.well-known/oauth-protected-resource` | OAuth PRM → `/api/mcp-oauth-metadata` (AS = Supabase `/auth/v1`) |
| `/oauth/consent` | Advance consent UI (Supabase OAuth Server path) |

Auth: `Authorization: Bearer <Supabase user access token>`.  
401 responses include `WWW-Authenticate: Bearer resource_metadata="https://advanceai.studio/.well-known/oauth-protected-resource"`.

Enabled tools now: `list_brands`, `get_brand_context`, `workspace_save_url_context` (persist URL as `pending_analysis`; no fetch/credits).

## Operator step (required for Grok OAuth)
In **Supabase Dashboard → Authentication → OAuth Server** (AIIAN `lstzfxsdmggkoaxfawny`):
1. Enable OAuth 2.1 Server
2. Set authorization path to `/oauth/consent`
3. Enable Dynamic Client Registration
4. Site URL / redirect allowlist includes `https://advanceai.studio` and `/oauth/consent`

Without this, Custom Connector OAuth discovery fails (`feature_disabled`).

## Code map
- Host: `api/mcp.ts`, `api/lib/mcp/protocol.ts`
- Registry: `api/lib/mcp/tool-registry.ts`
- Approval: `api/lib/mcp/approval.ts` + migration `070_mcp_approval_tokens.sql`
- URL intake: `api/lib/mcp/url-intake.ts` + migration `071_mcp_url_intakes.sql`
- Intake validation: `api/lib/mcp/guide-intake.ts`
- Brand delete contract: `api/lib/mcp/brand-delete.ts` (+ web cascade detaches kits)
- Consent UI: `src/pages/OAuthConsent.tsx`

## Next
1. Enable Supabase OAuth Server (dashboard step above)
2. GUIDE analysis worker for `pending_analysis` rows + file ingest
3. EXECUTE tools behind Grok approval popup
