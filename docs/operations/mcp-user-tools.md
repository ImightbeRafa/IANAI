# Advance MCP for Grok bot (`advanceai.studio`)

Primary client: **Grok Custom Connector** → `https://advanceai.studio/api/mcp`  
Later: Codex (same registry / auth).

## Locked decisions

### Dual mode
| Mode | Who generates | Advance credits? | MCP role |
|---|---|---|---|
| **GUIDE** | Grok bot (user’s Grok text / Imagine) | **No** | Brand/context, skills, packed prompts |
| **EXECUTE** | Advance AI APIs | **Yes** | Same pipelines as the web app |

### Intake via Grok
User can submit **URLs and files** in Grok chat. Advance uses them to build/update the **brand business folder** (offer facts, kit, context) so web + MCP stay in sync.

### Images / provenance
- **Do not import** images Grok generated outside Advance into the asset library as “ours.”
- Session records a clear **`generated_outside`** pointer (provenance only).
- Images **Advance generates** save normally into the session/library and are served at **max Grok Imagine API quality** (`2k` + `medium` — the API’s highest supported pair).

### Approval (EXECUTE)
Primary UX: **nice Grok bot chat approval popup** (confirm action + cost before Advance runs).  
Not an Advance web deep-link as the main path.

### Archive & delete (brands / folders)
- **Archive** = hide from default lists; recoverable.
- **Delete** = permanent, **no recovery**; warn clearly (counts of offers/assets, type brand name) before cascade.
- Same spirit for other deletes: warn first; archive preferred when safe.

### Out of scope (for now)
- **No** Instagram/Facebook/Meta auto-posting or social scheduling.
- Billing/plan redesign: later.

## Auth & host
- Domain: `https://advanceai.studio`
- OAuth 2.1 + PKCE (Advance/Supabase browser login)
- Same team/admin permissions as the web app

## Tool registry
`api/lib/mcp/tool-registry.ts` (`MCP_REGISTRY_VERSION`).

Groups: Brand Workspace · Guide Studio · Execute Studio · Library/Sessions · Deletes/Archive · Account & Team.

## Remaining questions (short)
1. Permanent brand delete: also wipe completed session history, or keep redacted/tombstoned sessions?
2. Initial URL/file intake limits (e.g. max files, PDF/image/URL only)?
3. How long should the Grok EXECUTE approval popup stay valid (e.g. 10 min / 1 hour)?

## Phase status
| Slice | Status |
|---|---|
| Dual-mode registry + docs | Done |
| Grok max quality (`2k`/`medium`) | Already API max |
| OAuth MCP host + GUIDE intake | Next after Q1–3 |
| EXECUTE + Grok approval popup | After host |
| Archive/delete brand contracts | After host |
