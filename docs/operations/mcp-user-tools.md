# Advance MCP for Grok bot (`advanceai.studio`)

Primary client: **Grok Custom Connector** → `https://advanceai.studio/api/mcp`  
Later: Codex (same registry, same auth).

## Locked product choices
- Domain: `https://advanceai.studio`
- Auth: OAuth 2.1 + PKCE against Advance/Supabase (browser sign-in; **no pasted service-role keys**)
- Scope: signed-in user only (RLS / `owner_id` / `user_id`)
- Credits: same subscription as the web app
- No delete tools
- Generate / edit / enhance / carousel: **require approval** (UX TBD — see questions below)
- Image routing: generate default Grok; **edit+enhance = Grok**; **carousel = Gemini**

## Tool surface (versioned registry)
Code: `api/lib/mcp/tool-registry.ts` (`MCP_REGISTRY_VERSION`).

| Group | Purpose | Default |
|---|---|---|
| Brand Workspace | brands, offers, kits | ON (reads) |
| Creative Context | uploads, analysis, memory | OFF until unlocked |
| Script Studio | scripts | OFF |
| Visual Studio | generate/edit/enhance images | OFF until approval UX chosen |
| Carousel Studio | carousels (Gemini) | OFF |
| Post & Reply Studio | posts / replies | OFF |
| Library & Sessions | history / artifacts | OFF |
| Account & Team | usage / team | OFF |

Flip groups + per-tool `enabled` flags to expand safely after testing.

## Host plan
1. Public MCP HTTP endpoint on Vercel: `https://advanceai.studio/api/mcp`
2. Grok.com → Connectors → Custom → that URL
3. First use: Grok opens Advance login (OAuth); tokens bound to one user
4. `listTools` returns `listEnabledMcpTools()` only
5. Mutations call the same backend paths as the SPA (shared credits + logging)

## Approval — plain English (needs your pick)
When Grok wants to spend credits or write content, something must confirm **you really want that exact action**.

**Option A — Approve in Grok chat**  
Grok asks “Generate this image for Brand X (~1 credit)?” and you say yes in the chat.  
Simple, stays in Grok. Weaker unless Grok can prove that yes to our server (often it cannot).

**Option B — Approve on Advance web**  
Grok returns a link → you open Advance → see exact preview (brand, prompt, cost) → Approve.  
Strongest security; one extra click outside Grok.

**Option C — Hybrid**  
Cheap/low-risk writes confirm in Grok; paid generation / batches use Advance link.

We will **not** wire generate/edit tools until you choose A/B/C (and the questions below).

## Open questions (do not assume)
1. Approval: **A, B, or C**? Token lifetime (e.g. 10 min / 1 hour)?
2. Does “entire tools” include **deletes**, **publishing**, **team/admin**, shared/team assets?
3. After MCP generate: **auto-save** to posts library, or draft until you say save?
4. Do you already have a **paid Grok account** that can add Custom Connectors at grok.com/connectors?
5. Should the first live unlock be **Brand reads only**, then Visual Studio next?

## Phase status
| Slice | Status |
|---|---|
| Read helpers + AIIAN adapter | Done |
| Tool registry v0.1 | Done |
| Edit/enhance → Grok; carousel → Gemini | Done (app routing) |
| `/api/mcp` OAuth host on advanceai.studio | Blocked on questions 1–5 |
| Generate via MCP | Blocked on approval choice |
