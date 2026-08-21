# Chat-shell map

Use this when working on `/chat`. Classic dashboard lives in `src/pages/` and is a different product surface.

## Now

Chat-shell is the brand-folder workspace: left nav (marcas/sesiones), center thread, right rail (contexto/ofertas/imágenes/guiones/marca). Preview (IANAI-preview) is the test bed. Production (AIIAN) stays classic until the kill switch + invite + `preferred_ui` canary in `docs/operations/chat-shell-production-transition.md`.

## Architecture

```
ChatShell
  ├─ useChatShellWorkspace   brand/session selection, URL + localStorage
  ├─ useChatSessionThread    messages, offers, scripts, images
  ├─ useChatBrandSetup       conversational brand kit (not the create widget)
  └─ useChatCreateWidgetVisibility   hide/show create card (user + business)
```

Invariants:

- Do not remount `ChatThread` on brand/session change. Cached folders switch instantly (`planBrandSwitch`). Cache misses keep the previous transcript mounted under a veil and replace it in one paint. Do not animate the stage or create widget on folder change.
- Never merge messages from session A into session B (`mergeFetchedMessagesForOwner`).
- Never hydrate setup/create-widget facts from another folder’s products (`productsOwnedByBusiness` + per-brand product cache). Clearing live products without a cache restore makes the tracker flash.
- Generation is 1 offer per API call, 1 usage increment, artifacts bound to `product_id`.
- Create-widget hidden is a separate key. The Brand Kit sits on the **left of the composer** (compact rail + hide icon). It must not sit in the transcript or cover the thread. Showing it must not reopen setup.

## Persistence keys

| Key | Scope |
|-----|--------|
| `ianai.chat-shell.theme` | device |
| `ianai.chat-shell.activeBrandId` / `activeSessionId` | device |
| `ianai.chat-shell.brandSetup.skipped.${userId}.${businessId}` | user + business |
| `ianai.chat-shell.createWidget.hidden.${userId}.${businessId}` | user + business (`"1"` = hidden; show removes the key) |
| `ianai.chat-welcome.${sessionId}` | sessionStorage, intro once |

## High-signal files

| Area | Start here |
|------|------------|
| Shell layout | `src/features/chat-shell/ChatShell.tsx` |
| Thread / composer | `ChatThread.tsx`, `useChatSessionThread.ts` |
| Folder switch cache | `chatShellThreadCache.ts` |
| Brand setup | `useChatBrandSetup.ts`, `chatShellBrandSetupFlow.ts` |
| Create widget | `useChatCreateWidgetVisibility.ts`, `ChatComposerCreateDock.tsx`, `ChatBrandProfileCard.tsx` |
| Images | `chatShellImages.ts`, `ChatShellImageCard.tsx` |
| Theme tokens | `public/design/chat-shell-obsidian-tokens.css` (mirror: `docs/design/…`) |
| Rollout | `ChatShellRolloutContext.tsx`, `docs/operations/chat-shell-production-transition.md` |
| ADR | `docs/adr/0001-chat-shell-foundation.md` |

## Test map

- Folder switch: `test/chat-shell-thread-cache.spec.ts`, `test/chat-shell-thread-transition.spec.tsx`, `test/chat-shell-async-isolation.spec.ts`
- Widget: `test/chat-shell-create-widget-visibility.spec.ts`, `test/chat-shell-brand-profile-card.spec.tsx`
- Tokens: `test/chat-shell-tokens.spec.ts`
- Images / scripts: `test/chat-shell-image-*.spec.ts`, `test/chat-shell-script-*.spec.ts`

## Known gaps / next

See the production checklist in `docs/operations/chat-shell-production-transition.md` and the read-only gap report in `docs/operations/chat-shell-aiian-inventory.md`.

Product next (not this pack):

1. Human apply of `supabase/production/aiian/chat-shell/` after preflight policy review; then canary per `docs/operations/chat-shell-aiian-canary.md`.
2. Optional protected AIIAN-backed Vercel preview (single branch only).
3. Split `useChatSessionThread.ts` into load / scripts / images controllers.
4. One typed localStorage helper for every `ianai.chat-shell.*` key.
5. Generate the docs token mirror from the public CSS so they cannot drift.
6. Browser smoke for `/chat` (folder switch, hide/show widget, dark/light, 390px).
7. Instrument folder-switch latency and generation stages.

Do not invent a second changelog. User-facing notes go in `src/data/changelog.ts`; agent notes go in `docs/agent/CHANGELOG.md`.
