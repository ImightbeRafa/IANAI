# Advance MCP for Grok bot (`advanceai.studio`)

Primary client: **Grok Custom Connector** → `https://advanceai.studio/api/mcp`

## Locked decisions
| Topic | Decision |
|---|---|
| Modes | GUIDE = free (Grok’s own usage); EXECUTE = Advance credits |
| Approval | **In-chat** via `confirm_execute` (show `userPrompt`, user says sí/no). Optional fallback `/mcp/approve/:id`. **TTL = 1 hour**; single-use; input-bound; result replay after consume |
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
| `/mcp/approve/:id` | Optional Advance web consent fallback (prefer in-chat `confirm_execute`) |
| `GET /.well-known/oauth-protected-resource` | OAuth PRM → `/api/mcp-oauth-metadata` (AS = Supabase `/auth/v1`) |
| `/oauth/consent` | Advance consent UI (Supabase OAuth Server path) |

Auth: `Authorization: Bearer <Supabase user access token>`.  
401 responses include `WWW-Authenticate: Bearer resource_metadata="https://advanceai.studio/.well-known/oauth-protected-resource"`.

Enabled tools now:

**Reads:** `list_brands`, `get_brand_context` (optional `brandKitId`), `list_offers`, `list_brand_kits`, `get_brand_kit`

**Brand kits (sync write, no credits):** `create_brand_kit`, `update_brand_kit`, `link_brand_kit` (PatchHouse / explicit `business_id`; no cross-brand moves). `delete_brand_kit` requires typed name + in-chat `confirm_execute`.

**GUIDE (no Advance credits):** `guide_script`, `guide_image`, `guide_brand_pack`, `guide_bulk_angles`

**Workspace sync (no credits):** `workspace_save_url_context`, `workspace_ingest_file`, `workspace_note_generated_outside`, `workspace_import_asset`, `workspace_save_artifact`

**EXECUTE (credits + in-chat approval):** `confirm_execute`, `get_execute_result`, `execute_script_generate`, `execute_image_generate`, `execute_bulk_scripts`, `execute_bulk_posts`, `execute_campaign_pack`, edit/enhance/carousel — first call returns `status: approval_required` with `userPrompt` (Grok shows this in chat; do **not** lead with a raw URL). After the user says yes, call `confirm_execute` then retry with `approvalRequestId`. **Script/image EXECUTE** return `status: running` + `jobId` immediately (background `waitUntil`); poll `get_execute_result` until `completed` (script text / `imageUrl`). Campaign packs run one leased artifact inline on the initial execute and on each poll, then CAS-persist the next checkpoint or a real chunk error before responding; stale leases retry the same artifact without allowing a late worker to clobber a terminal result. Running messages identify `script N/total` or `image N/total`. Completed packs contain script text and stored JPEG HTTPS URLs, never base64. Same `approvalRequestId` and stable per-artifact generation UUIDs prevent double charge. `chargedCredits` is always a number. Optional `optionalAdvancePage` exists only as fallback. Auto-saves to a chat session/library. **MCP caps:** bulk `count` ≤ 10; carousel `slideCount` ≤ 5. Host `maxDuration` for `/api/mcp` is **180s**.

**Style DNA:** `list_style_dnas`, `set_style_dna` — JSON on `brand_kits.style_dnas` (`organic` | `ads`). Bulk posts accept `styleDnaId`.

**Admin (JWT admin only):** compact `admin_list_tickets` / `admin_get_ticket` / `admin_update_ticket` / `admin_get_usage` / `admin_request_cursor_fix` (scrubbed brief; Cursor is never auto-called).

Every `tools/call` is audited via `auditMcpToolCall` (`source=mcp`, lane from tool risk).

Registry / server version: **0.9.0**.

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
- Registry: `api/lib/mcp/tool-registry.ts` (0.9.0)
- Brand kits: `api/lib/mcp/brand-kit-tools.ts`, `api/lib/brand-kit-resolve.ts`, migration `081`
- Audit: `api/lib/mcp/tool-audit.ts`; MCP caps: `api/lib/mcp/limits.ts`
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
