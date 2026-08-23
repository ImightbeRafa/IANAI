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

### Vercel env (Preview + Production)
PRM reads `SUPABASE_URL` / `VITE_SUPABASE_URL` at runtime. Both Preview and Production must point at **AIIAN** (`lstzfxsdmggkoaxfawny`), not the old IANAI-preview project. After changing env vars, redeploy.

Authorize always redirects to the Supabase **Site URL** (`https://advanceai.studio/oauth/consent`), so full Grok OAuth needs this branch **deployed to Production**. Preview can smoke PRM / MCP / consent SPA only.

## Code map
- Host: `api/mcp.ts`, `api/lib/mcp/protocol.ts`
- Registry: `api/lib/mcp/tool-registry.ts`
- Approval: `api/lib/mcp/approval.ts` + migration `070_mcp_approval_tokens.sql`
- URL intake: `api/lib/mcp/url-intake.ts` + migration `071_mcp_url_intakes.sql`
- Intake validation: `api/lib/mcp/guide-intake.ts`
- Brand delete contract: `api/lib/mcp/brand-delete.ts` (+ web cascade detaches kits)
- Consent UI: `src/pages/OAuthConsent.tsx`

## Next
1. Confirm Production `CRON_SECRET` + `GEMINI_API_KEY` (required for worker)
2. File ingest (PDF/images) for GUIDE
3. EXECUTE tools behind Grok approval popup

## GUIDE URL analysis worker
- Save via `workspace_save_url_context` → `mcp_url_intakes.status=pending_analysis`
- Cron `* * * * *` → `GET/POST /api/mcp-guide-analysis` (Bearer `CRON_SECRET`)
- Worker claims one row, runs shared site analyzer, fill-only merges into `businesses` + `brand_kits`
- `get_brand_context` returns richer kit + `latestGuideIntake`
- Deep link: `/chat?brand=<id>&intake=<id>`
- No Advance credits
