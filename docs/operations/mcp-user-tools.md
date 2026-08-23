# Advance MCP for Grok bot (`advanceai.studio`)

Primary client: **Grok Custom Connector** → `https://advanceai.studio/api/mcp`  
Later: Codex (same registry / auth).

## Locked product model

### Dual mode (critical)
| Mode | Who generates | Advance credits? | What MCP does |
|---|---|---|---|
| **GUIDE** | Grok bot (user’s own Grok text / Imagine usage) | **No** | Brand/context, skills, packed prompts, refs, constraints |
| **EXECUTE** | Advance AI APIs | **Yes** | Same pipelines as the web app (scripts, images, carousel, …) |

Unfair to charge when Grok does everything. Credits only when Advance runs generation.

### Workspace sync (autosave across surfaces)
Anything MCP creates or attaches (brand folder, offer, URL context, product/scene images, sessions, drafts) is written to the **real AIIAN DB** so opening the web app shows the same business → brand → assets → editable context. Not a separate Grok-only silo.

### Other locks
- Domain: `https://advanceai.studio`
- Auth: OAuth 2.1 + PKCE (Advance/Supabase browser login; no service-role pasting)
- Scope: signed-in user + same team/admin rules as the web app
- Deletes: **included** (permission-checked, confirmed)
- Team/admin: **included** (server-enforced; natural extension of web)
- Plans/billing redesign: **later** — ignore for MCP wiring now
- Image routing in-app: generate default Grok; edit+enhance Grok; carousel Gemini

## What “publishing” meant (clarification)
In this product today, “Publish” on the marketing site means **content ready for you to post** (record/design/post yourself). There is **no** built-in Instagram/Facebook/Meta scheduler or auto-post from Advance.

So “publishing tools” are **not** in scope unless you want us to add social posting later.

## Tool surface (versioned registry)
Code: `api/lib/mcp/tool-registry.ts`

| Group | Modes | Notes |
|---|---|---|
| Brand Workspace | read + sync writes | brands, offers, kits |
| Guide Studio | GUIDE only | prompts/context for Grok’s own generation |
| Execute Studio | EXECUTE + approval | Advance-run scripts/images/carousel |
| Library & Sessions | sync | histories, artifacts, deep links |
| Deletes | confirmed writes | brand/offer/asset/session (no gen credits) |
| Account & Team | read/admin | usage, members — role-gated |

Flip `enabled` flags per tool/group as we test.

## Approval (EXECUTE only)
GUIDE needs no credit approval. EXECUTE still needs a confirmed “run this on Advance.”

Hybrid default direction from product:
- Low-risk workspace sync / saves: can proceed when authenticated
- EXECUTE generation: confirm before spend (exact UX still open — see questions)

## Phase status
| Slice | Status |
|---|---|
| Read helpers + AIIAN adapter | Done |
| Provider routing (Grok edit/enhance) | Done |
| Dual-mode registry (guide vs execute) | In progress |
| Workspace sync writers | Not started |
| `/api/mcp` OAuth host | Not started |
| EXECUTE generate tools | Blocked on remaining questions |

## Remaining questions
1. **EXECUTE approval:** confirm in **Grok chat**, **Advance web link**, or **hybrid** (chat for small, link for batches/expensive)? Rough TTL?
2. **GUIDE analysis:** may GUIDE run free URL/PDF/site analysis into the brand folder, or only read/save what the user already provided?
3. **Importing Grok outputs:** when Grok Imagine finishes on Grok’s side, how should assets land in Advance — **user**, **file upload**, or **either**?
4. **Deletes:** permanent (like current web “cannot undo”), or soft-delete/archive?
5. Confirm: **no social auto-post** for now (only “ready to publish” content in library)?
