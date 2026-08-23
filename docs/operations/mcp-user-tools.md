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
| `GET /.well-known/oauth-protected-resource` | OAuth resource metadata → `/api/mcp-oauth-metadata` |

Auth today: `Authorization: Bearer <Supabase user access token>` (same as web APIs).  
Grok browser OAuth consent UI (PKCE against Advance/Supabase) is the next wiring step.

Enabled tools now: `list_brands`, `get_brand_context`.

## Code map
- Host: `api/mcp.ts`, `api/lib/mcp/protocol.ts`
- Registry: `api/lib/mcp/tool-registry.ts`
- Approval: `api/lib/mcp/approval.ts` + migration `070_mcp_approval_tokens.sql`
- Intake validation: `api/lib/mcp/guide-intake.ts`
- Brand delete contract: `api/lib/mcp/brand-delete.ts` (+ web cascade detaches kits)

## Next
1. Apply `070_mcp_approval_tokens` on AIIAN
2. Grok Custom Connector OAuth consent (Advance login → JWT)
3. Enable GUIDE intake processing + EXECUTE tools behind approval popup
