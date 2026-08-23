# Per-user MCP tools (Advance AI)

Goal: let a signed-in user (or their Grok bot) call **their own** account tools — brands, context, later generate/edit — without exposing the whole company stack.

## Locked rules
- Auth = the signed-in personal user (RLS / user_id). Never service-role browse of all accounts.
- **No delete tools.**
- Generate / edit / mutations: **approval required** (short-lived, argument-bound, single-use token).
- Credits = same subscription limits as the web app.
- Real AIIAN DB.

## Phase status
| Slice | Status |
|---|---|
| `list_brands` / `get_brand_context` core helpers | Code in `api/lib/mcp/user-tools.ts` |
| AIIAN Supabase adapter (owner-scoped) | `api/lib/mcp/supabase-adapter.ts` |
| HTTP / Grok Custom Connector host | Not wired yet — needs hosting choice |
| Approval inbox + token for generate | Not started |
| Image generate via MCP | Blocked on host + approval |

## AIIAN table mapping (read tools)
| Tool field | Table / filter |
|---|---|
| Brands | `businesses` where `owner_id = auth user` |
| Offers | `products` where `business_id = brand` **and** `owner_id = auth user` |
| Brand kit | `brand_kits` where `business_id = brand` **and** `user_id = auth user` (prefer default) |

Unassigned products (`business_id` null) are **not** exposed.

## Needed from product owner
1. **Host / first client:** Grok.com Custom Connector, Advance-hosted bot, or xAI Responses tools?
2. **Canonical Vercel domain** for the MCP endpoint (and whether OAuth 2.1 → Supabase Auth is OK).
3. **Approval UX:** in-app inbox + deep link? Desired token TTL?
4. Confirm carousel / enhance stay on Gemini for now (single-image default is already Grok).

## Next implementation steps
1. After host choice: wire authenticated MCP transport to these helpers + adapter.
2. Add `request_generation` → pending approval row → approval URL.
3. After approval, `execute_approved_generation` consumes the token once and runs the same generate-image path as chat-shell (Grok default).
