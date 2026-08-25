## 2026-08-25 — MCP in-chat approval (0.8.2)

**Area:** mcp
**Files:** `approval-prompt.ts`, `confirm-execute.ts`, execute/bulk/delete tools, `McpApprove.tsx`, protocol/registry

- Primary UX: Grok shows `userPrompt` in chat → user says sí/no → `confirm_execute` → retry EXECUTE.
- Raw `/mcp/approve/:id` links demoted to `optionalAdvancePage` only (Grok instructed not to paste them).
- Web approve page remains as bilingual fallback, less UUID-dumpy.

---

## 2026-08-25 — Fat product complete (branch, no PR yet)

**Area:** credits / mcp / chat-shell / bulk / admin
**Files:** credits 076–080, MCP 0.8.1 full tools, bulk packs, admin tickets, usage source

- Créditos IA on AIIAN: monthly unused expires; pack one-time TiloPay API; Business link wired; bonus→credits migrated.
- MCP: execute reliability (consume after success), admin ticket tools, edit/enhance/carousel/delete/save, bulk angles/scripts/posts/campaign, style DNA.
- ChatShell: P0 races, feedback FAB, streamline gate, bulk slash/dialog.
- Admin: usage filter MCP vs web; ticket diagnostics (ui_surface/locale/viewport).

---


**Area:** billing / mcp
**Files:** `api/lib/credits/*`, `076_credits_ia.sql`, `docs/operations/credits-ia-aiian.md`, auth/tilopay/Settings/UsageBanner, MCP intake+EXECUTE autosave

- Single wallet catalog (weights + plans). FIFO lots math + consume path. SQL for human AIIAN apply only.
- TiloPay: existing Starter/Premium/Enterprise links wired; Business + credit pack placeholders.
- MCP: intake dialog, EXECUTE library autosave, quotes script=3 / Grok image=6 créditos.
- Flag `CREDITS_V1` keeps legacy meters until cutover.

---


**Area:** chat-shell / ops
**Files:** `supabase/production/aiian/chat-shell/*`, `docs/operations/chat-shell-aiian-canary.md`, production transition / inventory / environments docs

- Human-only AIIAN pack outside `supabase/migrations/`: preflight, foundation+rollout (`chat_shell=false`), security overlay (incl. offer FK SET NULL + thread-clear), postflight.
- Canary runbook for classic ↔ chat on real data after apply. No SQL executed against AIIAN.

---

## 2026-08-21 — AIIAN read-only inventory

**Area:** chat-shell / ops
**Files:** `docs/operations/chat-shell-aiian-inventory.md`, `docs/operations/chat-shell-production-transition.md`, `docs/agent/README.md`, `.cursor/skills/advance-ai/reference/chat-shell.md`

- Read-only gap report for production AIIAN vs chat-shell needs (OpenAPI/REST on AIIAN; MCP SQL on IANAI-preview).
- Finding: classic data + usage RPCs present; shell foundation tables/columns and rollout controls missing. No SQL applied.

---

## 2026-08-19 — Composer kit rail + stable folder heights

**Area:** chat-shell
**Files:** `ChatComposerCreateDock.tsx`, `ChatShell.tsx`, `ChatSidebar.tsx`, `chatShellSidebar.ts`, `chat-shell.css`

- Brand Kit create actions live in a compact rail on the left of the composer. Hide is a circular `PanelLeftClose` control in that same slot; restore is `PanelLeft`. Review is an opt-in popover anchored to the rail, not a full-width card over the thread.
- Folder session lists are remembered per marca and stay mounted at `0fr`/`1fr`, so switching the active folder does not empty or accordion-jump the MARCAS list.

---

## 2026-08-19 — Composer create dock, quieter folders

**Area:** chat-shell
**Files:** `ChatComposerCreateDock.tsx`, `ChatThread.tsx`, `ChatShell.tsx`, `ChatSidebar.tsx`, `chatShellSidebar.ts`, `chat-shell.css`

- Create kit is a popover from the left of the composer (Advance mark + eye-off hide). It no longer occupies the transcript. Hidden state still uses the per-business key; restore is the same slot.
- Clicking another marca does not accordion-open that folder. Session counts stay in a reserved column so the list does not jump.

---

## 2026-08-19 — Folder switch: no foreign offers, no reload animation

**Area:** chat-shell
**Files:** `useChatSessionThread.ts`, `useChatBrandSetup.ts`, `useChatShellWorkspace.ts`, `ChatThread.tsx`, `chat-shell.css`

- Cached marcas switch in the same paint (`planBrandSwitch`). Products restore from a per-brand cache and are filtered with `productsOwnedByBusiness`, so Café Luna cannot show Bloom’s offer.
- Setup/create-widget facts reset during render for the new folder. Stage and profile enter-animations removed; thread does not autoscroll while the destination is loading.
- Create widget remains hide/show via `ianai.chat-shell.createWidget.hidden.*` (unchanged).

---

## 2026-08-19 — Folder switch, create widget, live blue, agent map

**Area:** chat-shell / docs
**Files:** `ChatThread.tsx`, `useChatSessionThread.ts`, `chatShellThreadCache.ts`, `useChatCreateWidgetVisibility.ts`, `ChatBrandProfileCard.tsx`, `chat-shell-obsidian-tokens.css`, `chat-shell.css`, `.cursor/skills/advance-ai/reference/chat-shell.md`

- Switching marcas no longer remounts/blanks the thread. Cache hits swap; cache misses keep the previous transcript under a veil and replace it in one paint. Composer/mic/attachments lock while loading.
- Create scripts/posts widget is independent of setup. Hidden state is `ianai.chat-shell.createWidget.hidden.${userId}.${businessId}`. Topbar **Mostrar crear** brings it back without reopening setup.
- Dark stage is a faint blue-black (`#0b0f14`); accents are live blue (`#4f8cff` / classic `#0284c7`). Mobile: 44px targets, truncated crumbs, sticky rail close, one-column create actions at 480px.
- Agent map: `reference/chat-shell.md`. Production checklist added to `docs/operations/chat-shell-production-transition.md`.

---

## 2026-08-14 — Feedback FAB in the Opciones corner

**Area:** chat-shell / frontend
**Files:** `chat-shell.css`

- Feedback button sits at the bottom-right of the viewport (inside the Opciones rail), not over chat chips or the composer. Mobile keeps it on the right, above the composer.

---

## 2026-08-14 — Admin dashboard readable in dark/light

**Area:** frontend
**Files:** `src/pages/admin-dashboard.css`, `AdminDashboard.tsx`, `ChatSettingsDialog.tsx`, `chat-shell.css`

- Admin panel uses chat-shell tokens (surfaces, text, chips) so light theme is no longer navy-on-navy. Model names are nowrap chips instead of wrapping color pills. Wide tables keep a horizontal scrollbar (chat-shell had hidden them).
- Settings dialog widens for Admin/Tickets. Log times are compact; cost shows 4 decimals with full precision on hover.

---

## 2026-08-14 — Admin usage via service-role API

**Area:** api / frontend
**Files:** `api/admin-usage.ts`, `api/lib/admin-usage.ts`, `src/pages/AdminDashboard.tsx`, `api/lib/usage-logger.ts`, `api/edit-script.ts`, `api/analyze-site.ts`, `api/extract-brand.ts`

- Admin dashboard no longer reads `api_usage_logs` or usage RPCs from the browser (RLS/service-role only; Preview may lack `get_usage_summary`). `/api/admin-usage` aggregates with the service role, same auth pattern as billing.
- Feature totals include paid ingest (`brand_extraction`, `url_fetch`, `pdf_extract`, `paste_organize`, `ocr`) plus scripts/images. User table has an Ingesta column. Script edits log as `script_edit` / `script_enhance` / `script_hook` / `script_consciousness`.
- Site/brand Gemini calls now include thinking tokens in estimated cost.

---

## 2026-08-14 — Ofertas panel matches count, theme in General

**Area:** chat-shell / frontend
**Files:** `ChatContextRail.tsx`, `ChatShell.tsx`, `sessionOffer.ts`, `useChatSessionThread.ts`, `Settings.tsx`, `ChatSettingsDialog.tsx`, `ChatSidebar.tsx`, `FeedbackButton.tsx`, `chat-shell.css`

- Ofertas count and panel now share `displaySessionOffers` (legacy `session.product_id` / `activeProduct` no longer counts as 1 while the list is empty). Load backfills `chat_session_offers` when the session still has a product. `brandProducts` is passed into the rail again so brand offers can be added.
- Theme lives in Configuración → General (Oscuro / Claro). Removed from the sidebar footer.
- CLÁSICO is a pill. Feedback FAB sits in the chat column above the composer, not on the rail seam. Scrollbars hidden on the whole chat route.

---

## 2026-08-14 — Folder delete removes offers, not unlink

**Area:** chat-shell / frontend
**Files:** `businessDelete.ts`, `database.ts`, `useChatShellWorkspace.ts`, `Dashboard.tsx`, `ChatContextRail.tsx`, `useChatSessionThread.ts`

- Replaced `unlinkProductsFromBusiness` with fail-closed `deleteBusinessWithContents`: sessions (including archived) → products → verify none remain → business. Shared by chat-shell and classic Dashboard.
- Ofertas leftover rows can be deleted one-by-one or cleared in bulk. `Quick Use Image Studio` stays hidden from that list.
- Partial folder-delete failure reloads businesses from the server instead of restoring a stale optimistic snapshot.

---

## 2026-08-14 — Hidden chat scrollbars, theme-adaptive mark

**Area:** chat-shell / frontend
**Files:** `chat-shell.css`, `advance-logo.css`, `ChatShell.tsx`, `ChatSidebar.tsx`, `ThemeToggle.tsx`

- Overlay-hide scrollbars inside `.chat-shell` (`scrollbar-width: none` + webkit width 0) so chat, rail, and brand lists still scroll without the 6px global bars cutting column edges.
- `AdvanceLogo` drops mix-blend and the light-theme dark tile; `/logo.png` already has alpha. Dark gets a light cyan drop-shadow so navy folds stay visible.
- Theme toggle removed from the chat topbar and kept out of Settings → General. It lives in the left sidebar user row (and the gated splash).

---

## 2026-08-14 — Always-visible chat widget + original Advance mark

**Area:** chat-shell / frontend
**Files:** `ChatShell.tsx`, `ChatContextRail.tsx`, `chat-shell.css`, `AdvanceLogo.tsx`, `chatShellLabels.ts`

- Right widget uses the chat canvas (`--bg-stage`), no left border or rail fill. Removed “En este chat” heading and the index session title so rows sit on the same background as Cursor’s list.
- Mobile still uses the bottom sheet, opened from the rail toggle.
- `AdvanceLogo` uses `/logo.png` with `mix-blend-mode: lighten` on dark surfaces so the black canvas drops out. Light chat keeps a single dark tile.

---

## 2026-08-14 — Cursor-like rail, tighter post optimize, Advance mark

**Area:** chat-shell / frontend
**Files:** `chat-shell.css`, `ChatContextRail.tsx`, `ChatShellScriptCard.tsx`, `AdvanceLogo.tsx`, `ChatShellIcons.tsx`, `Layout.tsx`, auth/home pages, `public/brand/`

- Desktop rail is a third grid column (`0 → --chat-rail-w`) so opening Contexto/Ofertas/Imágenes/Guiones/Marca resizes the chat instead of overlaying it. Mobile keeps the bottom sheet.
- Rail header is a workspace snapshot (brand, session, offer, counts, generation prefs) with shortcuts into existing tabs.
- Post-preview optimize card uses a compact toolbar (density + refs + continue) and smaller editor chrome.
- Shared `AdvanceLogo` uses `/brand/advance-mark-dark.png` and `/brand/advance-mark-light.png` via `data-theme`. Chat wordmark/progress/profile and classic Layout/Login/Home/Signup/ForgotPassword consume it.

---

## 2026-08-14 — Crear post: pick script, then optimize

**Area:** chat-shell
**Files:** `ChatShell.tsx`, `ChatThread.tsx`, `ChatShellScriptCard.tsx`, `useChatSessionThread.ts`, `chat-shell.css`

- Brand Kit / composer “Crear post” no longer jumps to the latest script. It shows the script picker first; the chosen artifact (including latest edited snapshot) opens a dedicated optimize step; then type selection.
- Card-level Crear post still starts at optimize because the script is already chosen.
- Optimize UI replaces the full script card: one primary CTA, segmented density, quieter chrome.

---

## 2026-08-14 — Classic dashboard cache vs chat folders

**Area:** chat-shell / frontend
**Files:** `useDashboardData.ts`, `useChatShellWorkspace.ts`, `useChatSessionThread.ts`, `useChatBrandSetup.ts`

- Classic Guiones/Posts kept a 60s module cache. Chat create/delete/rename/assign never invalidated it, so deleted brands still appeared on classic.
- `invalidateDashboardCache()` now runs after those chat mutations.

---

## 2026-08-14 — Stop reload on tab focus

**Area:** chat-shell / frontend
**Files:** `ChatShellRolloutContext.tsx`

- Removed `window` `focus` refetch that set `loading` true. That unmounted `/dashboard` (`LazyFallback`) and `/chat` (`Cargando chat…`) on every tab/window switch.
- Access still re-reads silently on `visibilitychange` at most once per minute, without a loading flash. User-id changes still show the spinner.

---

## 2026-08-14 — Preview profiles own-row RLS

**Area:** infra / chat-shell
**Files:** `supabase/migrations/068_profiles_select_own.sql`, `docs/operations/chat-shell-preview-rls.md`

- Authenticated Preview reads of `profiles` returned `[]` (RLS on, no SELECT policy after 061). Admin nav and chat invite both fail-closed even when service-role SQL showed `is_admin` / `chat_beta_access` true.
- Additive own-row SELECT/UPDATE policies. Clients still cannot flip `is_admin` or `chat_beta_access` (existing triggers). Apply on IANAI-preview now; do not apply to AIIAN from the agent.

---

## 2026-08-14 — Fail-closed chat rollout + stable folder switch

**Area:** chat-shell / frontend / api / infra
**Files:** `067_chat_shell_rollout_controls.sql`, `chatShellRollout.ts`, `ChatShellRolloutContext.tsx`, `App.tsx`, `Layout.tsx`, `useChatShellWorkspace.ts`, `ChatSidebar.tsx`, `chat-shell.css`, `api/lib/chat-shell-access.ts`, `docs/operations/chat-shell-production-transition.md`

- Three-layer rollout: `chat_shell` kill switch, `profiles.chat_beta_access` (ops-only), `preferred_ui` (user). Missing/failed reads fail closed to classic. Enabling the flag no longer redirects `/dashboard` → `/chat`.
- Shell API calls that send `sessionId` (`/api/chat`, `/api/generate-image`, `/api/edit-script`) require kill switch + invite.
- Brand folder switch is atomic: prefetch + cache, keep the current thread until destination commits, expanded folders keep their lists, context rail overlays instead of resizing the grid.
- Unassigned products can be assigned to the open negocio without rewriting legacy sessions. Feedback is back on `/chat` (`page_url` includes search).
- Do not apply this migration or Preview RLS to AIIAN from the agent. Runbook: `docs/operations/chat-shell-production-transition.md`.

---

## 2026-08-14 — Exclusive create actions + edited script posts

**Area:** chat-shell
**Files:** `useChatSessionThread.ts`, `ChatShellScriptCard.tsx`, `ChatThread.tsx`, `ChatShell.tsx`, `ChatBrandProfileCard.tsx`

- Script and image clarifies are mutually exclusive. Brand Kit Crear post opens the latest script card preview (edited version); Foto de producto clears leftover script chips.
- Script cards show a purpose-specific busy state (`Editando…`, hook/consciousness labels) and dim the body while generating.
- `collectImageScriptChoices` prefers the latest in-card snapshot so composer post picks are not stuck on the original artifact.

---

## 2026-08-14 — Brand kit ghost ids + post density on preview

**Area:** chat-shell / api
**Files:** `database.ts`, `api/brand-kit.ts`, `useChatBrandSetup.ts`, `useChatSessionThread.ts`, `ChatShellScriptCard.tsx`, `ChatThread.tsx`, `ChatShell.tsx`

- Updating a missing brand kit (`PGRST116` / 406) now creates a real row (with `business_id`) instead of PATCHing a ghost id. Session link skips `chat_sessions_brand_kit_business_fkey` (23503/409) instead of showing “Failed to update session”.
- `/api/brand-kit` treats a missing kit id as insert, not a hard 400.
- Crear post density lives on the editable script preview. `script_card` generates pass `explicit.density` and skip the composer “Poco texto / Texto medio” pills.

---

## 2026-08-14 — Independent posts vs image lineage

**Area:** chat-shell / api
**Files:** `chatShellImages.ts`, `chatShellImageIntent.ts`, `useChatSessionThread.ts`, `api/generate-image.ts`

- New generates no longer auto-hydrate leftover offer images (first generated post, style/context refs) when `productImageIds` is explicitly `[]`.
- Auto product refs for a new post are `kind=product` photos only. Generated rows (`kind` or `message_id`) are skipped. Context/style refs apply only if chosen this turn.
- Edit/enhance still send `editImage` / `enhanceImage` for that specific image.

---

## 2026-08-14 — Sidebar brands fill height

**Area:** chat-shell
**Files:** `ChatSidebar.tsx`, `chat-shell.css`

- `+ Nueva marca` sits under the MARCAS label (sticky, not at the bottom of the list). The folder list is a flex-grown scroller to the profile card; user card no longer uses `margin-top: auto` that left a dead gap.

---

## 2026-08-14 — Welcome, thinking copy, post asks, optimize-for-post

**Area:** chat-shell / api
**Files:** `useChatBrandSetup.ts`, `useChatSessionThread.ts`, `ChatThread.tsx`, `ChatShellProgress.tsx`, `ChatShellScriptCard.tsx`, `ChatShellImageCard.tsx`, `chatShellBrandSetupFlow.ts`, `api/brand-kit.ts`, `database.ts`

- Welcome is gated on `loadingMessages` (starts true) + `messageCount` + `sessionStorage`; `dedupeLegacySetupSummaries` keeps only the first `¡Hola!`. `generar post` is an explicit generation request so it does not restart setup “Leyendo…”.
- Progress: `imageBusy` > `setupBusy` > script. Script steps follow `scriptSettings.framework` (venta directa → gancho / prueba / CTA).
- Post flow always asks aspect then density even if sticky prefs exist. `runImageGenerate` does not set `imageBusy` until the generate call; clarify pills hide while generating.
- Image “Optimize for post” opens the matching script card’s condensed editable draft (`openPostPreviewNonce`), not `optimizeShellOfferImage`.
- `getBrandKits` / `createBrandKit` / `updateBrandKit` fall back to `/api/brand-kit` (service role, auth-bound `user_id`) when Preview RLS 403s so a manual logo upload can persist.

---

## 2026-08-14 — Navy surfaces, logo upload, condensed branded posts

**Area:** chat-shell / api
**Files:** `chat-shell-obsidian-tokens.css`, `chat-shell.css`, `ChatSidebar.tsx`, `ChatShellProgress.tsx`, `imageCompression.ts`, `imageStorage.ts`, `useChatBrandSetup.ts`, `Settings.tsx`, `api/generate-image.ts`, `api/lib/brand-kit.ts`, `api/streamline-script.ts`, `chatShellImageIntent.ts`, `useChatSessionThread.ts`

- Dark/light tokens: stage `#0A0A0A` / sidebar `#161616` / cards `#1E1E1E`, 8% hairline borders, desaturated navy with a faint purple-rose hue. Send uses the stronger navy; loading uses a continuous blue→purple→rose gradient.
- Sidebar Advance wordmark is larger and centered. Image loading frame is tighter.
- Logo upload rasterizes SVG, uses one `post-images` helper, no longer silently no-ops without a business, and surfaces persist errors. Generate sends kit colors + `brandLogoUrl` and fails closed if a kit id cannot resolve and there is no client visual fallback.
- Script→post keeps gancho/desarrollo/cierre but hard-condenses, strips `[PLACEHOLDERS]`, asks copy density, and forbids dumping business context onto the image.

---



**Area:** chat-shell
**Files:** `ChatShellIcons.tsx`, `chat-shell-obsidian-tokens.css`, `chat-shell.css`, `ChatSidebar.tsx`, `ChatBrandProfileCard.tsx`, `ChatShellGate.tsx`, `ChatShellProgress.tsx`, `index.html`

- Hairline Advance mark + wordmark (Advance / AI) in sidebar, gate, and brand card. Source/create icons are custom strokes, not Lucide Sparkles/Globe.
- Dark surfaces: stage `#0A0A0A`, sidebar `#161616`, cards `#1E1E1E`. Borders stay 1px at ~7–10% white. Accent is slate; send keeps the only stronger blue.
- Inter variable + JetBrains Mono for counts. Body line-height 1.5. Brand card drops the glow gradient and electric-blue pip.

---

## 2026-08-14 — Brand kit on posts, size ask, script card polish

**Area:** chat-shell / api
**Files:** `chatShellGenerationPreferences.ts`, `chatShellImageIntent.ts`, `chatShellImageApi.ts`, `useChatSessionThread.ts`, `ChatThread.tsx`, `ChatShellScriptCard.tsx`, `api/generate-image.ts`, `api/lib/brand-kit.ts`, `api/analyze-site.ts`, `api/lib/post-aspect.ts`

- Session `brand_kit_id` is sent even before kits hydrate, so colors/logo are not dropped on first generate.
- Brand kit resolve now happens before edit/enhance; edits keep the source image aspect unless the user picked Reel / square / 4:5.
- First post in a session asks size with Reel · 9:16, Post cuadrado · 1:1, Post vertical · 4:5, then optionally a style-reference upload (layout only, not their product).
- Raster logos from site analysis are rehosted into `post-images/{userId}/brand-kit`. SVG/ICO stay as the original URL with a warning.
- Script card versions are compact chips; Copiar / Guardar / Editar / Crear post stay primary, the rest live in `…`.

---

## 2026-08-14 — chatModel crash, Responses helper, script versions

**Area:** chat-shell / api
**Files:** `api/chat.ts`, `api/lib/grok-models.ts`, `ChatShellScriptCard.tsx`, `chat-shell.css`, `generate-image.ts`, `ChatShellImageLightbox.tsx`

- `chatModel` is initialized before `try` so catch logging no longer throws `chatModel is not defined` and masks the real Grok error.
- Script generation prefers xAI Responses (`store: false`) and falls back to Chat Completions.
- Script cards load persisted versions; latest is the main body, earlier edits/hooks/enhances are selectable chips.
- AI/user text bubbles have a tighter chat surface. Image edit/enhance prompts lock prices, accents, and CTAs; lightbox label encoding fixed.

---

## 2026-08-14 — Post-ingest create CTAs + logo fallback

**Area:** chat-shell
**Files:** `ChatBrandProfileCard.tsx`, `useChatBrandSetup.ts`, `api/analyze-site.ts`, `chatShellGenerationPreferences.ts`, `useChatSessionThread.ts`

- Compact brand card always shows Crear guiones / Crear post / Foto de producto. Clicking them confirms the profile first, then starts that flow.
- Ingest assistant copy now asks what to make next so the thread does not dead-end on the summary card.
- Compact card renders the extracted logo. `analyze-site` picks JSON-LD / srcset marks and falls back to the first non-favicon candidate when the model leaves `logo_url` empty (raster over SVG).
- Image generation uses `session.brand_kit_id` over product-localStorage / default kit. Kit persist awaits `onLinkKit` so the session is linked before create.

---

## 2026-08-13 — Setup no longer dies on brand_kits RLS / usage RPC 404

**Area:** chat-shell
**Files:** `database.ts`, `useChatBrandSetup.ts`, `supabase/migrations/065_brand_kits_owner_rls.sql`

- `get_usage_limits` 404 is treated as missing RPC (once, with an in-flight lock) then table fallback — no retry spam.
- `brand_kits` RLS 403 no longer aborts URL setup. Ingest still saves business/offer; palette save shows a real error if the kit cannot be written.
- `createBrandKit` throws a real `Error` (Postgrest payloads are not `instanceof Error`, so the UI was showing a generic “Setup failed”).
- Migration `065` adds owner CRUD policies on `brand_kits` and GRANTs `get_usage_limits` when the function exists. Apply on IANAI-preview.

---

## 2026-08-13 — Composer clear, progress CSS, palette + uploads

**Area:** chat-shell
**Files:** `ChatThread.tsx`, `ChatShellProgress` CSS, `useChatBrandSetup.ts`, `chatShellBrandSetupFlow.ts`, `ChatBrandPaletteCard.tsx`, `chatShellSetupUploads.ts`, `api/extract-brand.ts`, `api/lib/brand-kit.ts`, `api/generate-image.ts`

- Composer clears the draft immediately on send (restore only if the send is ignored), so URL ingest no longer leaves a copy in the input.
- Restored `.chat-shell__think*` / `.chat-shell__gen-*` CSS so the working animation actually animates; thread auto-scrolls to the progress block.
- URL setup runs `/api/extract-brand` in parallel with business autofill. Colors land in an in-thread palette widget (tune + save). Logo/voice/visual persist immediately when extracted.
- Composer paperclip uploads logo or style references onto the BrandKit. Post generation injects up to 2 style references (mood only).

---

## 2026-08-13 — Folder trash confirm + pinned setup stays put

**Area:** chat-shell
**Files:** `ChatSidebar.tsx`, `useChatShellWorkspace.ts`, `database.ts`, `ChatThread.tsx`, `chat-shell.css`, `index.html`

- Folder delete is an inline trash icon (then X / trash confirm) so the menu is no longer clipped by the sidebar. Confirm no longer calls `preventDefault` on pointerdown, which was swallowing the click.
- Folder delete now removes every chat for that brand (including archived), unlinks products, then deletes the business row — leftover FKs were rolling the delete back.
- Chat shell is locked to the viewport. Setup pin sits above the scrolling thread, so it stays visible while you scroll.

---

## 2026-08-13 — Tighter images, folder menu, pinned setup

**Area:** chat-shell
**Files:** `chat-shell.css`, `ChatShellImageCard.tsx`, `ChatSidebar.tsx`, `ChatBrandSetupCard.tsx`, `ChatShell.tsx`

- In-chat images shrink-wrap to the portrait (left, ChatGPT-like) instead of stretching a full-width grey frame around a small 9:16.
- Folder ⋯ inherited `pointer-events: none` from session rows, so clicks never opened Delete. Brand ⋯ is always clickable now.
- Setup tracker is a sticky pin at the top of the thread, not a draggable overlay. It hides when every step is complete.

---

## 2026-08-13 — Folder delete, image viewer, setup widget, tighter posts

**Area:** chat-shell
**Files:** `useChatShellWorkspace.ts`, `ChatSidebar.tsx`, `ChatShellImageCard.tsx`, `ChatShellImageLightbox.tsx`, `ChatContextRail.tsx`, `ChatBrandSetupCard.tsx`, `useChatBrandSetup.ts`, `chatShellBrandSetupFlow.ts`, `useChatSessionThread.ts`, `grokApi.ts`

- Folders (brands) can be deleted from the sidebar ⋯ menu with the same confirm pattern as sessions. `deleteBusiness` now verifies a row was actually deleted.
- In-chat images are compact (no widescreen black frame). Click opens a shell lightbox; request-edit opens a new `Edición · {offer}` chat with the reason.
- Images rail is a gallery + reference upload + request edit. Generate knobs stay in Crear / chat.
- Setup tracker is a draggable/minimizable widget. Clicking a missing step continues that question in chat. After offer confirm, the flow asks brand visual (skippable) and persists `BrandKit.visual_style_notes`.
- Creating a post from a script always streamlines at hard density first; if streamline fails, image generation does not start.

---

## 2026-08-13 — Setup commit attaches offer + persists thread

**Area:** chat-shell
**Files:** `useChatBrandSetup.ts`, `useChatSessionThread.ts`, `ChatContextRail.tsx`, `chatShellOfferResolve.ts`, `chatShellThreadCache.ts`

- Confirming setup now saves the product, attaches it to the session, and writes `session.context` from folder facts. One offer auto-picks; several offers ask once in chat — no rail click required.
- Setup turns persist as real messages and merge by id so refresh does not duplicate or drop bubbles.
- Context rail is a folder inspector (negocio, canales, público, oferta) plus the generation brief, not empty title/notes/channel fields.

---

## 2026-08-13 — Local API CORS/TLS + Quiet Graphite progress

**Area:** chat-shell
**Files:** `scripts/dev-api.ts`, `api/auto-fill.ts`, `ChatShellProgress.tsx`, `ChatThread.tsx`, `database.ts`

- Local API now answers OPTIONS and always sends CORS, so Vite `:5173` can call `:3000/api/*`.
- Node 24 now loads the Windows system CA store so `supabase.auth.getUser` / URL scrape stop failing with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (that was the 401 on `/api/fetch-url`).
- `auto-fill` sets CORS + OPTIONS like other AI routes.
- Missing `get_usage_limits` RPC is tried once, then table fallback (stops console 404 spam).
- Setup / script / image waits use Quiet Graphite progress (thinking steps + generating frame), not the old blue grid.

---

## 2026-08-13 — Setup is resume-from-URL, not a quiz

**Area:** chat-shell
**Files:** `useChatBrandSetup.ts`, `chatShellBrandSetupFlow.ts`, `formAutoFill.ts`, `ChatThread.tsx`

- Pasted URL + notes are scraped once and filled together (old form behavior). No more dropping “Arnés ForgeCR / CRC 14,900” when a link is present.
- After ingest, the agent shows a summary to confirm/correct. “Si correcto” / “Correcto.” are confirmations, not product copy. No one-by-one interrogation after that.
- Composer keeps the draft if setup is busy so overlapping sends are not swallowed.
- Setup errors now surface in the thread. After a resume is shown, `nextSetupQuestion` stays null so we never fall back into a quiz.

---

## 2026-08-13 — Quiet Graphite shell (system, not polish)

**Area:** chat-shell
**Files:** `chat-shell-obsidian-tokens.css`, `chat-shell.css`, `ChatContextRail.tsx`, `index.html`

- Replaced Obsidian electric (IBM Plex 13.5 + `#4f8cff` glow/grid) with Quiet Graphite: Inter 15px, zinc surfaces, brand blue only on send / focus / selected nav.
- Conversation fills the stage (no 720px island). User bubbles are zinc, AI is open 15.5/1.62 type. Message enter animations removed.
- Context rail is an inspector (title/notes/channel) — setup stays in chat. Old auto-opening session interview form is gone.

---

## 2026-08-13 — Local API runner for full chat-shell testing

**Area:** local-dev
**Files:** `scripts/dev-api.ts`, `package.json`

- `npm run dev:api` serves `api/*.ts` on `127.0.0.1:3000` from `.env` / `.env.local` without Vercel CLI login. Needed because `vercel whoami` is logged out and `vercel dev` cannot start.
- Health: `GET /api/health` reports whether GROK / GEMINI / OPENAI / Supabase keys are present (booleans only).

---



**Area:** chat-shell
**Files:** `ChatThread.tsx`, `useChatComposerVoice.ts`, `chat-shell.css`, `ChatSidebar.tsx`, `ChatBrandSetupCard.tsx`

- Composer is a centered docked field (no brand/offer chips inside the box). Mic + send are 40px targets. Transcripts insert into the draft; they do not auto-send.
- Voice uses the existing `/api/transcribe-audio` Whisper route (needs `OPENAI_API_KEY` + local `vercel dev` on :3000).
- Visual pass: quieter top pills, primary New Chat, tracker as a hairline progress row, larger thread type.

---

## 2026-08-13 — Conversational folder setup (not a form)

**Area:** chat-shell
**Files:** `chatShellBrandSetupFlow.ts`, `ChatBrandSetupCard.tsx`, `useChatBrandSetup.ts`, `ChatThread.tsx`, `ChatShell.tsx`

- First-session setup is a chat with the agent. Composer replies are intercepted unless the user explicitly asks to generate.
- Slim tracker widget only shows Negocio/Canales/Público/Oferta/Marca/Fuentes checkmarks from persisted completeness.
- URL/text is ingested with strict autofill; agent proposes the offer and asks “is this accurate?” then asks type-tuned questions (product/service/restaurant/real_estate/indumentaria) one at a time.

---

## 2026-08-13 — Folder setup in chat + Settings popup

**Area:** chat-shell
**Files:** `chatShellBrandSetup.ts`, `ChatBrandSetupCard.tsx`, `ChatSettingsDialog.tsx`, `Settings.tsx`, `AdminDashboard.tsx`, `AdminTickets.tsx`, `database.ts`, `api/auto-fill.ts`

- First session in a new brand/folder shows a thread checklist (business, channels, audience, offer, brand kit, sources). Later sessions skip it. Skip is per user+business in localStorage. Generation is never blocked; advice is type-aware (scripts vs images).
- Completeness is inferred from existing rows. New brands start with empty `sales_channels` so the messages default is not a false complete. `updateBusiness` added. Auto-fill supports `strictUnknowns`.
- Gear opens a Cursor-style Settings dialog (left categories). Reuses Settings/Admin/Tickets inner content. Legacy `/settings` `/admin` `/admin/tickets` stay.

---

## 2026-08-13 — Native Create rail: old script/post generation in /chat

**Area:** chat-shell
**Files:** `ChatCreatePanel.tsx`, `ChatContextRail.tsx`, `ChatShell.tsx`, `useChatSessionThread.ts`, `chatShellCommands.ts`

- Create rail hosts the old ScriptSettingsPanel (types, counts, CTA, Best/Efficient) plus post styles (anuncio, orgánico, producto, logo) with a Generate button.
- `/post`, `/producto`, `/logo` now dispatch typed image generation instead of falling through to script chat. `/guion` opens Create or generates from the rest.
- Removed `/config` `/settings` `/admin` slash commands — gear and Layout routes already cover those.
- Carousel, custom post types, Descriptions, Respuestas stay on More / legacy routes.

---

## 2026-08-13 — Chat shell Preview cutover (PR only, not master)

**Area:** chat-shell, models, admin, settings
**Files:** `src/features/chat-shell/*`, `api/lib/grok-models.ts`, `api/lib/usage-logger.ts`, `src/App.tsx`, `src/components/Layout.tsx`, `src/pages/{Settings,AdminDashboard,ProductWorkspace,DescriptionsWorkspace}.tsx`, `src/services/database.ts`

- `/chat` is Preview home when `app_feature_flags.chat_shell` is enabled; `/dashboard` redirects to `/chat`. Legacy `/scripts`, `/posts`, `/descriptions`, `/respuestas` stay linked from More / slash commands.
- Text routing is Grok 4.6 (Best) / 4.5 (Efficient) site-wide. User picker in Settings + ScriptSettingsPanel; stored in `advance-ai:text-model`. Images stay Gemini + Grok Imagine.
- Persist each successful offer immediately; composer lives in ChatThread; thread cache; bulk session counts; `brand_kit_id` is a safe session update.
- Brand rail selects kits (colors/voice) for the session. Images rail: Ad / Product photo / Logo (archetype, create vs enhance, background). `/logo` `/producto` `/marca`.
- Admin command strip: flag state, text models, image models, home route. Usage in chat sidebar footer.
- Fail-closed flag: `unreadable` shows gate, not the shell. Do not enable production `chat_shell` from this change.

---

## 2026-07-08 — Agent context structure (MCP) established

**Area:** infra
**Files:** `AGENTS.md`, `.cursor/skills/advance-ai/`, `.cursor/rules/`, `docs/agent/`

- Created agent context protocol for future model sessions
- Added project skill with reference docs: architecture, API routes, database, guiones pipeline, changelog protocol
- Added Cursor rules: core (always), API backend, frontend React, guiones pipeline
- Documented stale vs current docs (README, PROGRESS.md contain removed B-Roll/chat-interview features)
- Established dual-changelog system: user-facing (`src/data/changelog.ts`) vs agent-facing (this file)

---

## 2026-03-06 — v0.1.3 release

**Area:** frontend
**Files:** `src/App.tsx`, navigation/lazy-loading, mobile optimization

- Fixed app reload on tab switch / return from background
- Smoother navigation with reduced unnecessary loading
- Mobile optimization for phone usage
- Editable optimized script prompt in "Optimize for post" flow

---

## 2026-02-27 — v0.1.2 release

**Area:** posts, brand, frontend
**Files:** `api/generate-image.ts`, brand kit modules, `src/data/changelog.ts`

- Product Photo post type with 6 AI photography styles
- Square (1:1) format for e-commerce/catalog use
- Ideal customer description (ICP) field on business
- Brand Kit: colors, voice, phrases in Settings
- "From the Developer" section with changelog + roadmap
- Script ratings persist across sessions; positive ratings feed AI memory
- Reply usage visible in plan summary

---

## 2026-02-23 — v0.1.1 release

**Area:** posts, respuestas
**Files:** `RespuestasWorkspace.tsx`, `api/reply-chat.ts`, custom post types

- Custom post styles from reference uploads
- Respuestas feature: AI-powered sales DM replies
- Magic wand post enhancement

---

## 2026-02-16 — v0.1.0 release

**Area:** posts
**Files:** `PostWorkspace.tsx`, `api/generate-image.ts`, image presets

- 8 post style presets
- Color palette system
- AI image editing with instructions

---

## Prior history

See `PROGRESS.md` and `CODEBASE_STATUS.md` for earlier development notes.
Note: those files contain references to removed features (B-Roll/video, fal.ai, 5-question chat interview).

Key architectural milestones not captured above:
- Structured guiones pipeline in `api/lib/guiones/` (replaces monolithic prompt-only approach)
- Business → Product form hierarchy (replaces chat interview)
- Team/client account structure
- TiloPay billing integration (CRC)
- Supabase RLS + usage RPC functions
