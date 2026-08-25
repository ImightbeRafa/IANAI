# Advance MCP for Grok bot (`advanceai.studio`)

Primary client: **Grok Custom Connector** → `https://advanceai.studio/api/mcp`

## Locked decisions
| Topic | Decision |
|---|---|
| Modes | GUIDE = free (Grok’s own usage); EXECUTE = Advance credits |
| Approval | Advance web page `/mcp/approve/:id`; **TTL = 1 hour**; single-use; input-bound; result replay after consume |
| Intake | HTTPS URL + up to **5** PDF/image files → Chat upload dialog via `?intake=files\|asset` |
| External Grok images | Not imported; session `generated_outside` only |
| Advance images | Auto-saved to session/library at max API quality (`2k`/`medium`) |
| Brand delete | Delete everything under brand; **keep brand kits** (detach; delete kits separately) |
| Archive | Supported for folders |
| Social post | **No** |

## Live endpoints (this branch)
| URL | Role |
|---|---|
| `POST /api/mcp` | MCP JSON-RPC (`initialize`, `tools/list`, `tools/call`) |
| `GET /api/mcp` | Health / discovery blurb |
| `GET/POST /api/mcp-approve` | Load / approve / deny EXECUTE requests (Bearer Supabase JWT) |
| `/mcp/approve/:id` | Advance web consent UI for EXECUTE |
| `GET /.well-known/oauth-protected-resource` | OAuth PRM → `/api/mcp-oauth-metadata` (AS = Supabase `/auth/v1`) |
| `/oauth/consent` | Advance consent UI (Supabase OAuth Server path) |

Auth: `Authorization: Bearer <Supabase user access token>`.  
401 responses include `WWW-Authenticate: Bearer resource_metadata="https://advanceai.studio/.well-known/oauth-protected-resource"`.

Enabled tools now:

**Reads:** `list_brands`, `get_brand_context`, `list_offers`

**GUIDE (no Advance credits):** `guide_script`, `guide_image`, `guide_brand_pack`, `guide_bulk_angles`

**Workspace sync (no credits):** `workspace_save_url_context`, `workspace_ingest_file`, `workspace_note_generated_outside`, `workspace_import_asset`

**EXECUTE (credits + web approval):** `execute_script_generate`, `execute_image_generate`, `execute_bulk_scripts`, `execute_bulk_posts`, `execute_campaign_pack` — first call returns `/mcp/approve/:id`; after approve + retry, Advance generates, charges credits per succeeded item, auto-saves to a chat session/library, and returns a `/chat?brand=&session=` deep link (compact result; no huge base64). Lost MCP responses can replay the stored result without re-charging.

**Style DNA:** `list_style_dnas`, `set_style_dna` — JSON on `brand_kits.style_dnas` (`organic` | `ads`). Bulk posts accept `styleDnaId`.

ChatShell shares the same libs via `POST /api/bulk-angles`, `/api/bulk-scripts`, `/api/bulk-posts`, `/api/bulk-campaign`.

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
- Approval: `api/lib/mcp/approval.ts`, `api/lib/mcp/approval-store.ts`, `api/mcp-approve.ts`, `src/pages/McpApprove.tsx` + migrations `070`, `073`
- Workspace notes: `api/lib/mcp/workspace-ops.ts` + migration `074`
- GUIDE packs: `api/lib/mcp/guide-packs.ts`
- EXECUTE: `api/lib/mcp/execute-tools.ts`, `api/lib/grok-image-generate.ts`, `api/lib/mcp/artifact-store.ts`
- Chat intake UX: `src/features/chat-shell/ChatShellMcpIntakeDialog.tsx`, `chatShellMcpIntake.ts`
- Migration `075_mcp_e2e_intake_autosave.sql` (approval result_json + note updates)
- URL intake: `api/lib/mcp/url-intake.ts` + migration `071_mcp_url_intakes.sql`
- Intake validation: `api/lib/mcp/guide-intake.ts`
- Brand delete contract: `api/lib/mcp/brand-delete.ts` (+ web cascade detaches kits)
- Consent UI: `src/pages/OAuthConsent.tsx`

## Next
1. Confirm Production `CRON_SECRET` + `GEMINI_API_KEY` (required for URL analysis worker)
2. Carousel / edit / enhance EXECUTE tools (deferred)
3. Deletes / archive / admin tools (deferred)

## GUIDE URL analysis worker
- Save via `workspace_save_url_context` → `mcp_url_intakes.status=pending_analysis`
- Cron `* * * * *` → `GET/POST /api/mcp-guide-analysis` (Bearer `CRON_SECRET`)
- Worker claims one row, runs shared site analyzer, fill-only merges into `businesses` + `brand_kits`
- `get_brand_context` returns richer kit + `latestGuideIntake`
- Deep link: `/chat?brand=<id>&intake=<id>`
- No Advance credits
