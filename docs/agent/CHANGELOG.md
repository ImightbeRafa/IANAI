## 2026-09-01 — Header past-thread title + named kit chip

**Area:** chat-shell
**Files:** `ChatShell.tsx`, `chatShellSidebar.ts`, `chatShellBrandSetup.ts`

- Header on a past thread uses that session’s title (first user message / sidebar label). Never leftover “Chat nuevo” on an old thread. New empty chat may still say Chat nuevo.
- Glass chip always names the same missing fields as the setup pin (`Falta: Público, Fuentes`) when those gaps are known.

No merge. No invite / `chat_shell` / gift / SQL. Not a new wizard.

## 2026-09-01 — Header session crumb + glass chip named gaps

**Area:** chat-shell
**Files:** `ChatShell.tsx`, `chatShellSidebar.ts`, `chatShellBrandSetup.ts`, `ChatBrandSetupCard.tsx`

- Header crumbs use the same selected-session title as the sidebar (stored title → first user message → relative time, uniquified). No more `IdleBar Demo / Chat nuevo` while the row says `Aug 11 · 1`.
- Glass Brand Kit chip uses the same `Falta: Público, Fuentes` string as the setup pin when the tracker is visible. Drops the vaguer “Falta afinar” in that state.

No merge. No invite / `chat_shell` / gift / SQL.

## 2026-09-01 — Preview leftover nits (login, gate, generationId, i18n)

**Area:** chat-shell / credits / login
**Files:** `Login.tsx`, `ChatShellGate.tsx`, `ChatShellPage.tsx`, `chat-shell.css`, `edit-script.ts`, `streamline-script.ts`, `grokApi.ts`, `catalog.ts`, `ChatShellScriptCard.tsx`

- Login subtitle matches homepage / chat-shell: “Guiones, posts y fotos de agencia. En un chat.”
- Invite-gate is locked to obsidian-dark (`#07090d`) so it matches the chat-shell homepage, not OS light.
- `edit-script` / `streamline-script` require a client `generationId` UUID when `sessionId` is present (same reject-missing as generate-image / `/api/chat`). Chat-shell edits consume `guion_edit` (1) idempotently; streamline stays `prompt_condense` (0). Classic callers without `sessionId` still mint server-side and stay uncharged.
- Script-card hook / awareness more-menu options use `labelEs` / `labelEn`.

No merge. No invite / `chat_shell` / gift / SQL. No getMessages pagination, CORS lock, or Deployment Protection.

## 2026-09-01 — Wire chat-shell tour on PR #35 Preview

**Area:** chat-shell first-run
**Files:** `ChatShellPage.tsx`, `ChatShellTourWizard.tsx`, `chatShellOnboarding.ts`, `chatShellFirstRun.ts`, `ChatShell.tsx`, `ChatSidebar.tsx`

- `ChatShellTourWizard` now mounts for invited `/chat` users: first open (Preview skip-gift still returns real `tourDone`), gift “Ver cómo funciona”, and sidebar “Cómo funciona”. Skip/finish persist via `tour_done`. Does not write kits/brands/offers/sessions.
- Preview gift skip no longer fabricates `tourDone: true` (that hid the wizard). Still no +100 insert off production.
- Soft kit: glass / script CTAs hard-block only when there is no offer and kit is not listo. Existing folders with an offer get ready-empty + “Falta afinar”; setup pin still names what’s missing.

No merge. No invite / `chat_shell` / gift / SQL flips.

## 2026-08-31 — Production-ready nits (merge-bar)

**Area:** credits / chat-shell / homepage
**Files:** `chat-shell-gift.ts`, `generate-image.ts`, `brand-kit.ts`, `homeContent.ts`, `Signup.tsx`, `chatShellFirstRun.ts`

- +100 chat-shell gift is **fail-closed**: insert only when `VERCEL_ENV=production` (and `CREDITS_V1` on). Preview / development / unset skip. Opt out with `CHAT_SHELL_OPEN_GIFT=0`. Does not claw existing lots.
- Image `action=edit` now checks and charges `'edit'` (`image_edit` = 18), matching the confirm-sheet quote. Enhance stays on its own 18-credit path.
- Logo fallback fetch uses `fetchPublicUrl` (SSRF guard). Bloom pin uses loaded kit id only (no client spoof).
- Welcome/tour metadata writes abort if `getUserById` fails (do not clobber `user_metadata`).
- Homepage / signup default post-login is `/dashboard` until invite-all GO. Invited `preferred_ui=chat` still lands on `/chat` via `effectiveHome`.
- First-run CTA hides when the folder already has an offer name (existing classic users).

No merge. No `chat_shell` / invite / credit-gift / flag flips.

## 2026-08-31 — Production-ready nits (Preview → live)

**Area:** chat-shell / credits / first-run
**Files:** `api/chat.ts`, `api/lib/credits/chat-generation-id.ts`, `grokApi.ts`, `useChatSessionThread.ts`, `ChatThread.tsx`, `ChatComposerCreateDock.tsx`, `ChatShellScriptCard.tsx`, tests

- Chat-shell `/api/chat` now **requires a client `generationId` UUID** when `sessionId` is present (same rule as generate-image). Classic `/scripts` still mints server-side. Stops retry/curl double-charge on guiones.
- Pack sheet step 1 always shows estimated credits (`N créditos · máximo estimado`); locked with a test.
- First-run CTA and glass “Primero el kit” use `labels.es` / `labels.en` (no hardcoded Spanish).
- Empty-state CTA still only shows when the kit is **not** stronglyComplete — existing listo brands stay on the ready empty state (that was the WD recapture false FAIL).

No merge. No `chat_shell` / invite / credit-gift / flag flips.



- Fix Empezá hoy readability: dark ink on cyan (`.home-page a { color: inherit }` was forcing white).
- Hero packed toward center, wider fan, less empty top/side/bottom; sections tighter/wider.
- Fan pop: staggered ~0.5s spring ease (front → mids → far), hover still ~1.12.

## 2026-08-31 — PR #34: locked public homepage (CoS winner)

- Replaces Recess/template landing with dark `#07090d` homepage: floating glass pill nav, hero copy + cyan CTA glow, 5-card CSS 3D fan (desktop) / 3-card (mobile), gallery “Lo que generan las agencias”, features 01–03 only, pricing Free/Starter/Premium/Enterprise (prices unchanged).
- Fan motion: CSS spread ~0.8s + hover scale ~1.12 / stronger glow. JPEG 9:16 ads under `public/home/ads/`.
- CTAs → `/signup?redirect=/chat` / `/login?redirect=/chat` (chat-shell product; not classic `/posts` or `/scripts`).
- No plan price / invite-gate / `chat_shell` flag / credit changes. PR stays draft.

## 2026-08-31 — PR #34: Preview-only /admin for invited QA

- `VERCEL_ENV=preview`: allowlisted QA emails (`sup.rafa0412@gmail.com`, `ralauas@gmail.com`) can open `/admin` + admin read APIs without `profiles.is_admin`.
- Production / non-preview: still requires `profiles.is_admin` (fail closed). No AIIAN `is_admin` writes.
- Chat nuevo single-flight unchanged.

## 2026-08-31 — PR #34: Chat nuevo one-click (WD FAIL fix)

- Module-level `runCreateSessionSingleFlight` (survives Strict Mode remount); joins concurrent callers; 2s post-success coalesce against ghost clicks.
- Sidebar disables on `workspace.busy` (was imageBusy-only); header ignores `detail > 1` double-click.
- Admin credits-vs-$ unchanged.

## 2026-08-31 — PR #34: admin credits vs API $ + Chat nuevo single-flight

- `/api/admin-usage` joins `credit_ledger` (credits charged) + sums `credit_lots.remaining` (circulation); returns `creditsEconomics` and per-model `total_credits` / `estimated_api_cost_usd`.
- Official-list estimates: Imagine 2.0 `$0.04/out + $0.01/input`; Grok text `$2/$6` per 1M; Banana from stored/~$0.12. UI labels estimates (not xAI invoice). Optional `legacy_preview_qa` source chip.
- `estimateGrokImageCostUsd` matches official Imagine pricing for future logs.
- Chat nuevo: one click = one session (in-flight dedupe + explicit `brandId`); empty “Sin chats aún” CTA selects brand and creates (no early return that left the old thread).

## 2026-08-31 — PR #34: gate in-thread Crear post with Primero el kit

- Script card “Crear post” / “Optimizar para post” disabled with **Primero el kit** when kit not `stronglyComplete` (same gate as glass Post).
- Defense: ChatShell prepare/generate-from-script no-ops when kit incomplete.
- Glass Primero el kit + setup Falta: unchanged. Empty CTA still empty-thread only.

## 2026-08-30 — PR #34: first-run CTA + Primero el kit visible (WD FAIL fix)

- Empty first-run: stop auto-Hola welcome; show one line + button **Empezá por tu marca** when kit not `stronglyComplete` (even if a legacy welcome row exists).
- Glass Guiones/Post/Foto/Pack blocked until `stronglyComplete`; visible/disabled label **Primero el kit** (literal in DOM for WD grep).
- Setup pin “Falta: …” unchanged.

## 2026-08-30 — PR #34 fat Preview: invite gate + no Preview gift + generationId + first-run chrome

- Server `userHasChatShellAccess` requires `chat_shell` flag **and** `profiles.chat_beta_access` (frontend rollout mirrors).
- Skip +100 open gift when `VERCEL_ENV=preview` (no clawback of existing lots).
- `generate-image` rejects missing `generationId` (no server mint); shell client mints per Generar/edit/enhance.
- Empty first-run: one line + “Empezá por tu marca”; skip multi-step tour; kit-not-ready blocks Guiones/Post/Foto/Pack with “Primero el kit”.
- Setup pin names missing steps (no bare 3/6 until Configurar open); Pack step 1 shows credits.
- `referenceMode: none` skips auto-hydrate; hydrate binds owner/collab; Bloom ₡9.900 / 9-patch / BLOOM logo only for known kit/product ids.

## 2026-08-30 — PR #34: Foto last step = Confirmá referencias (same as Post)

- Stopped auto-forcing referenceMode=none for studio-hero/podium Foto, which skipped the refs sheet and opened the ingredients gate + chat credit confirm.
- Foto now ends on the same Confirmá referencias sheet (Subir rail, credits above, estilo No usar, one Generar).
- Pack already shows credits on confirm step — unchanged.

## 2026-08-30 — PR #34: Confirmá referencias sheet layout (no credit/Subir overlap)

- Credits strip renders above the Subir rail with a gap (inside the picker).
- Flow sheet body scrolls; footer stays pinned — optional hint no longer covers Atrás/Cancelar.
- Layout-only; generate / credits / lock / gourmet unchanged.

## 2026-08-30 — PR #34 leftovers harden: credit one-click, Subir 2×2, estilo off

- Reconfirm: Confirmá referencias Generar sets creditConfirmed (no second ¿Seguimos?).
- Subir rail always even 2×2 with wrap-safe labels (no orphan logo / no overflow).
- Preferred refs also strip non-product — estilo/scene/logo stay No usar until opt-in.

## 2026-08-30 — PR #34 Preview QA: one Generar, Subir 2×2, estilo opt-in

- Confirmá referencias Generar spends on that click — no second “¿Seguimos?” credit Paso after spinner.
- Subir producto/escena/estilo/logo: even 2×2 (4-up on wider) so logo is not an orphan row.
- Preselect product angles only; scene/style/logo default No usar (opt-in).
- Hide Setup de marca tracker while Pack/Post/Foto (or credit) sheet is open.

## 2026-08-30 — PR #34: no ingredients gate after Confirmá referencias Generar

- Clicking Generar / Crear sin referencias on Confirmá referencias soft-skips style/logo (and all three when sin refs) so generate runs — never “falta estilo” after the spinner.
- Soft optional hint stays on the refs sheet before Generar; Subir estilo still available.
- Keeps product_lock_scene, gourmet recipe, 8000 clamp, one-click lock.

## 2026-08-30 — PR #34 fat Preview: merge #33 gourmet + product_lock + enhance-18

- Merged `cursor/chat-shell-open-all-a84d` (@0b70ff8) into #34 idle-bar Pack sheets branch (same PR, no master).
- From #33: gourmet SCENE RECIPE (`image-scene-recipe`), `product_lock_scene` pixel lock, enhance/Mejora mágica quote=charge 18, slim UTF-8 Grok prompts, open-all/gift/tour.
- Kept from #34: Pack-family ClarifySheet + Back history, Subir logo, single-flight Generar, FORMATO line-only strip, auto-retry clamp, never “Acortá el guion”.
- Conflicts resolved in generate-image / grok-image-prompt / ChatThread / useChatSessionThread (history + ingredients + creditQuote).

## 2026-08-30 — Post Generar: never fail-closed on 8000 (PR #34 P0)

**Area:** chat-shell / generate-image
**Files:** `api/lib/grok-image-prompt.ts`, `api/generate-image.ts`, `chatShellImageErrors.ts`, tests

- SAFE clamp 7500 + drop business-context dumps / format essays; keep product-fidelity + short copy.
- On Grok prompt-too-long: auto-retry at 6000 once. Never UI “Acortá el guion”.
- Cap injected `businessContext` to 1200 chars at assembly.

---

## 2026-08-30 — Post Generar: Grok 8000 cap + single-flight (PR #34 P0)

**Area:** chat-shell / generate-image
**Files:** `api/lib/grok-image-prompt.ts`, `api/generate-image.ts`, `api/lib/grok-image-generate.ts`, `api/lib/grok-image-edit.ts`, `chatShellImageApi.ts`, `chatShellImageErrors.ts`, `useChatSessionThread.ts`, `ChatShellClarifySheet.tsx`, tests

- Hard-cap Grok Imagine prompts at 8000 Unicode code points; strip FORMATO OBLIGATORIO (use aspect_ratio); prefer condensed user copy + keep product fidelity rules at head.
- One Generar click = one in-flight generate (submit lock + busy disable); no retry loop on 400.
- Spanish-friendly prompt-too-long / rate-limit errors.

---

## 2026-08-30 — Subir logo on Confirmá referencias (PR #34)

**Area:** chat-shell
**Files:** `ChatShellReferencePicker.tsx`, `chatShellReferenceSelection.ts`, `useChatSessionThread.ts`, `chatShellImageApi.ts`, `ChatContextRail.tsx`, labels, tests

- Confirmá referencias rail: Subir logo alongside producto/escena/estilo; empty copy mentions logo.
- Logo upload auto-selects and attaches as `brandLogoUrl` for this generate (not only skip); excluded from productImageIds.
- Same Subir logo control on the images rail for consistency.

---

## 2026-08-30 — Pack-sheet footer / CTA primary / Pack credits (Rafael GO)

**Area:** chat-shell
**Files:** `ChatShellFlowSheet.tsx`, `ChatShellClarifySheet.tsx`, `ChatShellBulkDialog.tsx`, tests

- Footer order: Atrás · Cancelar · primary (when present).
- Guiones Paso 3: CTA chip selects only; Generar primary appears after pick; credits stay visible.
- Pack Confirmar y generar only with a credits line (step 2 quote / estimate).

---

## 2026-08-30 — Pack-sheet nits (leak / one-card / Back / glass)

**Area:** chat-shell
**Files:** `useChatSessionThread.ts`, `ChatShellClarifySheet.tsx`, `ChatThread.tsx`, `chat-shell.css`, `scriptParser.ts`, tests

- Sheet copy no longer dual-writes into the transcript alert while the Pack sheet is open; navy dim overlay ~46%.
- `## Guion N` markdown splits into one Post picker card per script.
- Foto opens on style (Paso 1) so aspect/refs get Back on step 2+; step n/n follows history length.
- Idle glass: more blur, cyan ~20% stroke, lift shadow, less solid fill (light theme).

---

## 2026-08-30 — Preview QA invite for idle-bar CoS shots (PR #34)

**Area:** chat-shell / ops
**Files:** `docs/testing/chat-shell-preview-user.md` (+ AIIAN profile invite, no auth model change)

- CoS blocked on Preview: `sup.rafa0412@gmail.com` hit “Chat es por invitación” because `chat_beta_access=false`.
- Matched existing invite gate: service-role set `chat_beta_access=true` + `preferred_ui=chat` (kill switch already on). No new allowlist.
- Seeded **IdleBar Demo** / session **Quiero crear guiones** / **Arnes Demo** for that QA account so after-shots (idle glass row + four Pack sheets) are reachable on `/chat`.

---

## 2026-08-30 — Chat-shell idle bar glass row + Pack-family flow sheets

**Area:** chat-shell
**Files:** `ChatComposerCreateDock.tsx`, `ChatShellFlowSheet.tsx`, `ChatShellClarifySheet.tsx`, `ChatShellBulkDialog.tsx`, `ChatThread.tsx`, `ChatShell.tsx`, `useChatSessionThread.ts`, `chatShellLabels.ts`, `chat-shell.css`, tests

- Lift Brand Kit chip + Guiones/Post/Foto/Pack into one navy+cyan Apple-glass row **above** the typing card (no 3+1 wrap inside the input).
- Typing row is placeholder + attach + mic + send only.
- Guiones / Post / Foto / Pack share the Pack sheet family: center overlay, dim, step n/n, Back, footer Cancel (closes with nothing left in the transcript), credits line before generate primary.
- Guiones types live in the sheet (not chat chips). Post script picker is a sheet grid (no Optimizar texto divert / empty third Cancel card). Foto sizes (Reel 9:16 / 1:1 / 4:5) use the same sheet.
- Copy-only rename: Pack sheet title `Bulk / Pack` → `Pack`.

---

## 2026-08-25 — MCP prod regression fix (0.9.5)
## 2026-08-30 — Product pixel-lock scene (PR #33)

**Area:** Grok first-gen product fidelity + scene
**Files:** `product-pixel-lock.ts`, `grok-image-generate.ts`, `grok-image-prompt.ts`, `generate-image.ts`, `image-enhance.ts`, tests

- **Finding:** `/images/generations` with product refs soft-references the packshot → Grok redraws/manipulates the SKU. Scene was good; product lock failed.
- **Fix:** With product photos, first-gen uses `/images/edits` mode `product_lock_scene` (pixel-identical SKU + SCENE RECIPE replaces void). No-product path stays `/generations` compose. Scene recipe unchanged (no podium regression).
- **Crear sin referencias:** auto-hydrate offer `product` photos for post/ad sessions when no explicit `productImageIds`, so kit product truth still locks.
- **Enhance:** same PRODUCT LOCK contract; polish locks set; magic/rebuild may replace void only.

---

## 2026-08-30 — Gourmet scene + enhance credit quote (PR #33)

**Area:** chat-shell image first-gen / enhance + Créditos IA quote
**Files:** `image-scene-recipe.ts`, `image-prompt-context.ts`, `grok-image-prompt.ts`, `grok-image-generate.ts`, `generate-image.ts`, `image-enhance.ts`, `chatShellCreditQuote.ts`, `useChatSessionThread.ts`, `ChatShell.tsx`, tests

- **Scene:** Ads always emit a SCENE RECIPE (place, lights, 3–6 props, depth, contact shadows; ban seamless/void/podium void), including no-ref path from niche/offer/script. Slim Grok posts include the recipe.
- **Compose:** Grok first-gen with product refs uses `/images/generations` (compose), not packshot `/edits`. Edits stay for enhance + user “change this.”
- **Enhance:** Polish locks composition (no new set). Magic/rebuild are scene passes with recipe + product lock; product light matches environment.
- **Credits:** Mejora mágica / edit quote uses `image_enhance` / `image_edit` (18), matching server charge — was wrongly quoting `image_standard` (6).

---

## 2026-08-28 — CoS retest fixes: ingredients ask, Grok first-pass hojita, no price strikethrough (PR #33)

**Area:** chat-shell ingredients + Grok venta-directa first generate + enhance
**Files:** `chatShellIngredientsCheck.ts`, `useChatSessionThread.ts`, `grok-image-prompt.ts`, `generate-image.ts`, `product-creative-rules.ts`, tests

- **A/C:** `Crear sin referencias` now always triggers ingredients ask (kit/rail files unused for this generate don't skip it).
- **E:** `buildSlimGrokPostPrompt` applies hojita silhouette + logo stamp + locked ₡9.900 + non-Ads-Manager CTA on first-pass Grok venta-directa; kit logo injected on generate when refs skipped.
- **G3:** Enhance/edit forbids strikethrough on list price (₡9.900).

---

## 2026-08-28 — Bloom CD creative rules: hojita silhouette, logo stamp, locked price (PR #33)

**Area:** product image prompts + Bloom TestAccount kit data
**Files:** `product-creative-rules.ts`, `generate-image.ts`, `image-presets.ts`, `brand-kit.ts`, tests

- **Product silhouette (no-ref):** Dermal patch offers render as transparent 3×3 hojita de 9 parches (~12 mm); never generic box/jar/tube.
- **Logo stamp:** Composite uploaded logo; forbid AI redraw of BLOOM wordmark / DERMAL MICRO-INFUSION PATCH lockup; omit lockup when no logo file.
- **Locked price:** Fallback `₡9.900` for Bloom patch SKU when `offer` is null; user-set prices preserved.
- **Enhance / Pedir edición:** Same hojita constraints; improve crop/contrast/floral; no SKU/packaging/box swap or gibberish type.
- **Posts CTA:** Guardrails against Ads Manager “Dale click a este anuncio”; organic Escribime/Pedilo vs paid button via `ctaStrength`.
- **Data (AIIAN):** Patched Bloom kit `f07339f1` + product `be543866` — offer, SILUETA in specs, visual_style_notes, forbidden_phrases, style_dnas.

---

## 2026-08-28 — Ingredients soft-skip, logo upload, no-ref product quality (PR #33)

**Area:** chat-shell UX + product image prompts
**Files:** `chatShellIngredientsCheck.ts`, `useChatSessionThread.ts`, `ChatThread.tsx`, `ChatContextRail.tsx`, `ChatBrandProfileCard.tsx`, `ChatShellScriptCard.tsx`, `image-presets.ts`, `generate-image.ts`, `CreditsChip.tsx`, tests

- **Soft-skip ingredients:** Before paid post/foto, Spanish voseo names each missing product photo / logo / style; per-item `Seguir sin …` confirm; generate proceeds when skipped.
- **Logo upload (0 credits):** Marca tab + brand profile quick upload; no 6-credit logo generate from Marca.
- **Rail thumbs:** Optimistic offer image list after upload.
- **No-ref product:** Offer + brand context in prompt; anti–generic-box when refs missing.
- **Edit:** On-brand improvement prefix on Pedir edición; quote-before-charge unchanged.
- **Script card:** 1:1 / 9:16 on guion post preview.
- **Credits chip:** `/scripts`, `/posts`, `/settings`.

---

## 2026-08-28 — Product foto: skip refs re-ask, no meta copy on image (PR #33)

**Area:** chat-shell product images + Grok API
**Files:** `chatShellImageIntent.ts`, `useChatSessionThread.ts`, `generate-image.ts`, `image-presets.ts`, `grok-image-prompt.ts`, `ChatThread.tsx`, tests

- **Studio-hero/podium:** 0 uploaded refs allowed; rail “Crear en el chat” skips reference picker; API builds from offer context.
- **No Anuncio hijack:** hide “Usar Anuncio” when panel is Producto; meta prompts filtered from Grok copy (`Professional product photograph`, etc.).
- **Product API prompt:** empty `prompt` for product mode; CONTRATO FINAL text-overlay rules skipped for product/logo.
- **Edit bubble:** edits/enhances on their own message show in chat thread (not only Original/Última tabs).

---

## 2026-08-28 — Preview blockers: download, product foto, edit quote (PR #33)

**Area:** chat-shell images + credits + i18n
**Files:** `chatShellDownload.ts`, `useChatSessionThread.ts`, `chatShellImageIntent.ts`, `chatShellImageApi.ts`, `ChatThread.tsx`, `PostWorkspace.tsx`, `LanguageContext.tsx`, tests

- **Descargar:** fetch blob + Supabase storage client fallback; reliable anchor trigger (no silent `window.open`).
- **Foto panel:** rail “Crear en el chat” passes full image prefs; product mode uses product prompt/userText (not “Generar post”); aspect/density clarify respects sticky panel choices; product skips copy-density ask.
- **Pedir edición:** credit quote before charge; result as new chat bubble; usage chip refresh; Spanish action labels (`Editada`).
- **i18n:** chat author `Tú`, Quick Use → `Generador rápido`, `html lang` sync, Posts dashboard accent.

---

## 2026-08-27 — Grok slim prompt + UTF-8 byte cap (PR #33 retest)

**Area:** images / Grok Imagine
**Files:** `api/lib/grok-image-prompt.ts`, `generate-image.ts`, `chatShellImageErrors.ts`, tests

- Retest still failed square 1:1 venta-directa (short script, 0 refs) with `grok_prompt_too_long` after ~60–90s.
- Root cause: `venta-directa` used `buildPostPrompt` (~26KB essays); code-point truncate left mangled system text and still could exceed Grok’s 8000 if counted as UTF-8 bytes.
- Grok post path now uses `buildSlimGrokPostPrompt` (user copy + short fidelity); enforce **7200 UTF-8 bytes** with margin; log code-point + byte lengths; canvas via `aspect_ratio` only.

---

## 2026-08-27 — Grok Imagine prompt 8000 cap + aspect_ratio-only (PR #33)

**Area:** images / Grok Imagine
**Files:** `api/lib/grok-image-prompt.ts`, `generate-image.ts`, `grok-image-generate.ts`, `grok-image-edit.ts`, `chatShellImageErrors.ts`, tests

- Root cause: Grok `invalid-argument` “Prompt length exceeds … 8000” — API allowed 50k and prefixed `FORMATO OBLIGATORIO` (often 9:16) on top of native `aspect_ratio`.
- Before every Grok generate/edit/enhance: strip FORMATO directives, prefer user copy, hard-cap 8000 Unicode code points; log `promptLength`.
- Grok post modes skip textual format prefixes; canvas via `aspect_ratio` (honors 1:1 square).
- Spanish user error for prompt-too-long (`grok_prompt_too_long`).

---

## 2026-08-27 — Preview QA fixes (PR #33 CoS findings)

**Area:** chat-shell + auth + images + credits
**Files:** `Login.tsx`, `useUsageLimits.ts`, `ChatShellPage.tsx`, brand create/setup, `generate-image.ts`, image/credit helpers, a11y labels, tests

- **Confirmed:** bilingual login (A); usage refresh + readable balance + pre-generate credit quote (B); Nueva marca URL field (C); ingest materializes offer + product JPEG/PNG refs (D); Spanish Grok/image errors (E); gift modal dismisses on first click (F); Spanish sidebar/rail aria-labels (G).
- **Discarded:** script quality rewrite / “Simple 3 pasos” (H).
- **Env-only:** Preview must keep `VITE_CREDITS_V1` / `CREDITS_V1` aligned; missing `GROK_API_KEY` is deployment config (UX now explains in Spanish). Gift lot for TestAccount already existed — no regrant.

---

## 2026-08-27 — Chat-shell open for all users (Preview-first)

**Area:** chat-shell + credits + guiones
**Files:** `chatShellRollout.ts`, `chat-shell-access.ts`, `chat-shell-open.ts`, `chat-shell-gift.ts`, welcome/tour/home-preview UI, `Settings.tsx`, `chatShellBrandSetup.ts`, `useChatSessionThread.ts`, `api/chat.ts`, `type-lenses.ts`, tests

- Kill switch alone grants `/chat` (invite gate dropped); `preferred_ui` still defaults classic.
- First `/chat` open: idempotent +100 pack credits (12mo) + Spanish gift popup + informative tour (skip forever via user_metadata).
- Usar Chat como inicio shows animated preview before confirming.
- Preferencias de IA hidden; Plan y facturación shows clearer usage + improvement disclaimer.
- Greetings no longer auto-generate scripts; missing-offer asks clearly and opens Ofertas.
- Tracker Oferta = named product exists; light-mode inputs override global dark color-scheme.
- Venta directa legacy few-shot + type lens less robotic.

---


**Area:** mcp
**Files:** `supabase-adapter.ts`, `protocol.ts`, `bulk-tools.ts`, `run-bulk.ts`, `expand-product-refs.ts`, `grok-image-generate.ts`, `execute-job.ts`, `artifact-store.ts`, `reference-gate.ts`, `tool-registry.ts`, tests

- **Root cause (#31):** `listOffersForBrand` selected nonexistent `products.do_not_claim` → PostgREST error → `list_brands` / `list_offers` / `get_brand_context` / GUIDE / EXECUTE all returned bare `Tool failed`.
- Removed invalid column; claims stay on kit `forbidden_phrases`.
- Structured MCP tool error JSON (`status/error/toolName`) so hosts surface a real body.
- Bulk/campaign: schema refs + `allowImplicitOfferRefs`; resolve owned ids before approval; MCP runs do not silently union kit logo / Style DNA URLs.
- `expandProductRefs` opts into 4:5→3:4 (internal); user EXECUTE stays fail-closed unless `aspectRatioFallback`.
- Failed poll preserves partial `chargedCredits`; `listOwnedScripts` authorizes session before reading rows.
- Registry **0.9.5**.

---

## 2026-08-25 — MCP chat-shell fat PR (0.9.4)

**Area:** mcp + guiones + admin
**Files:** `bulk-tools.ts`, `execute-tools.ts`, `execute-job.ts`, `guide-packs.ts`, `reference-gate.ts`, `artifact-store.ts`, `protocol.ts`, `tool-registry.ts`, `user-tools.ts`, `brand-kit-tools.ts`, `grok-image-edit.ts`, `guiones/*`, admin referrals/usage UI, tests

- Campaign pack: chunks schedule via `waitUntil` (cheap poll, no -32001); stale reclaim capped then terminal fail; running handles keep progress scripts/posts/chargedCredits.
- `list_scripts` + bulk/pack full script `content`.
- Product-ref GUIDE clarify + hard EXECUTE gates (image/bulk posts/pack/carousel); confirmed IDs only (no silent kit-logo union).
- Grok aspectRatio fail-closed (opt-in `aspectRatioFallback` for 4:5→3:4); return requested vs applied.
- Offer facts: exact price + mapped price_range; quality gate fails placeholders/enum leaks; stronger hooks; strip unresolved brackets before save.
- `get_brand_kit(brandId)` primary resolve; `list_brands` defaults to kitReady; carousel slides include copy; preview binds billed N.
- Admin Meta collapsible + service-role emails; MCP audit $0 noise excluded from cost totals; wider admin embed.

---

## 2026-08-25 — Admin dashboard Meta/referrals + MCP cost noise

**Area:** admin
**Files:** `api/admin-referrals.ts`, `api/lib/admin-usage.ts`, `AdminDashboard.tsx`, `admin-dashboard.css`, `chat-shell.css`, `admin-usage.spec.ts`

- Meta AdVance referral block is collapsible (closed by default).
- New `/api/admin-referrals` (service role) enriches signup emails via profiles + Auth Admin — fixes "Unknown" after profiles RLS 068.
- Trial/expired/converted badges use real trial end + treat paid/active `meta_advanze` as converted (not forever expired).
- `$0` `mcp_tool` audit rows excluded from usage cost/call aggregates; real MCP EXECUTE costs (feature≠mcp_tool, source=mcp) still counted. Logs still list audits.
- Wider/taller admin settings embed; table cells wrap; emails truncate with `title`.

---

**Area:** mcp
**Files:** `cas-running-result.ts`, `approval-store.ts`, `approval.ts`, `execute-job.ts`, `mcp-charge-uuid-reclaim.spec.ts`

- `storeResult` refuses writing running/queued over completed (memory guard + Supabase `result_json->>status.neq.completed` filter).
- Stale-running reclaim always uses atomic CAS; no bare `storeResult` fallback that could clobber.
- Regression: `storeResult`/`claimMcpExecuteJob` leave completed intact.

---

## 2026-08-25 — MCP reclaim CAS atomic JSON filters

**Area:** mcp
**Files:** `approval-store.ts`, `cas-running-result.ts`, `approval.ts`, `mcp-charge-uuid-reclaim.spec.ts`

- Prod `compareAndSwapRunningResult` is a single UPDATE with `result_json->>status = running` and `startedAtMs` match — no check-then-write gap that could clobber completed → running.
- Shared `matchesRunningCasExpectation` + race regression test.

---

## 2026-08-25 — MCP bulk/carousel credit UUID + reclaim CAS

**Area:** mcp / credits
**Files:** `generation-id.ts`, `consume.ts`, `run-bulk.ts`, `expand-product-refs.ts`, `execute-tools.ts`, `bulk-tools.ts`, `execute-job.ts`, `approval.ts`, `approval-store.ts`

- Root cause of live `Credit charge failed: UNAVAILABLE` on bulk/carousel: composite generation ids (`{approval}-script-1`, `{approval}-carousel-0`) are not UUID-typed for `consume_credits` / `credit_ledger`. Now use deterministic UUIDs (or one approval UUID + `units` for carousel).
- RPC errors (invalid UUID, etc.) no longer fall through to the TS lot-mutation fallback.
- Charge failure after artifacts are saved stores `artifactsSaved` + URLs/ids and is **not** generation-reclaimable (stops regen storm). Poll returns the failed payload with artifacts.
- Stale reclaim re-reads and CAS-swaps running only — cannot overwrite a completed `result_json` (fixes poll stuck on `running`).

---

## 2026-08-25 — CreativeDirector MCP must-haves (0.9.3)

**Area:** mcp + chat-shell
**Files:** `execute-tools.ts`, `bulk-tools.ts`, `artifact-store.ts`, `workspace-ops.ts`, `user-tools.ts`, `guide-packs.ts`, `protocol.ts`, `tool-registry.ts`, `generated-image-jpeg.ts`, `imageCompression.ts`, `chatShellImageApi.ts`, `chatShellDownload.ts`

- Generated ads upload as high-quality JPEG HTTPS URLs only (MCP artifact store + chat-shell persist). Fixes Storage “object exceeded maximum allowed size” on 2k PNG. Job results never store blobs.
- Carousel EXECUTE accepts an owned `scriptId`, edit/enhance default to the offer’s latest generated image, and execute tools preserve settings, GUIDE direction, references, and bulk angle selections through approval.
- New `list_assets` returns reusable library image ids/URLs; `workspace_save_artifact` saves HTTPS product/context references directly without credits or a chat upload detour.
- `list_brands` reports kit/offer readiness, deterministic default-offer resolution, and duplicate-name sibling ids without mutating records.
- MCP `serverInfo.icons` advertises `/brand/advance-mark.png` for Grok connector tile.

---

## 2026-08-25 — All MCP generation tools async (0.9.2)

**Area:** mcp
**Files:** `execute-tools.ts`, `bulk-tools.ts`, `tool-registry.ts`, `protocol.ts`, `api/mcp.ts`

- Image edit/enhance, carousel, bulk scripts/posts, and campaign packs now claim a job and return `jobId` + `statusMessage` immediately; clients poll `get_execute_result`.
- Background failures persist a retryable failed job result, and carousel slide charge IDs are deterministic per approval.

---

## 2026-08-25 — MCP EXECUTE jobId + poll (0.9.1)

**Area:** mcp
**Files:** `execute-job.ts`, `execute-tools.ts`, `approval.ts`, `approval-store.ts`, `api/mcp.ts`, `protocol.ts`, `tool-registry.ts`, admin/url P1

- P0: `execute_script_generate` / `execute_image_generate` claim a running job, return `jobId` immediately via `waitUntil`, poll with `get_execute_result` (avoids Grok MCP -32001). Same `approvalRequestId` is idempotent (atomic `claimEmptyResult`).
- P0: `chargedCredits` is always a number on job handles + completed results; usage audit reads it.
- P0: `storeResult` works while `approved` (was requiring `consumed` after store-then-consume — results never persisted).
- P0 SD-01: replay skips **stale running** and **failed** so reclaim can retry after a dead `waitUntil` (under-delivery; credits only on success). Stale TTL `190s` > host `maxDuration` `180s`.
- P0: `api/mcp.ts` maxDuration 180s aligned with generate runtime.
- P1: admin get/**update** ticket mask email; strip session query/path UUIDs; breadcrumbs CSS selector only; strip breadcrumb `url`/`href` query.
- P1: carousel preview quote/userPrompt says 1 slide / 24 credits when `previewFirstSlideOnly`.
- P1: image edit/enhance omitted aspect → `1:1` (not silent `9:16`).
- P1: URL intake holds high-risk medical/absolute claims out of `brand_voice` / `must_use_phrases` (review flag).

---

## 2026-08-25 — MCP brand kits complete (0.9.0)

**Area:** mcp
**Files:** `brand-kit-tools.ts`, `tool-registry.ts`, `protocol.ts`, `tool-audit.ts`, `limits.ts`, `mcp.ts`, admin compact tickets

- Brand kit CRUD + PatchHouse `business_id` linking (`list/get/create/update/link/delete_brand_kit`).
- `get_brand_context` accepts optional `brandKitId`; resolution prefers primary linked kit.
- Central `auditMcpToolCall` on every `tools/call` (success + failure); MCP caps bulk ≤10 / carousel ≤5.
- Admin ticket list compact + scrubbed Cursor brief; consent UI notes admin ticket/usage tools (Cursor never auto-called).

---

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
## 2026-08-25 — MCP campaign packs survive host timeout

**Files:** `bulk-tools.ts`, `run-bulk.ts`, `protocol.ts`, `mcp-campaign-resume.spec.ts`

- `execute_campaign_pack` now persists a CAS-leased checkpoint after every script and image rather than trying to finish the full pack inside one 180-second MCP request.
- The first chunk and each chunk leased by `get_execute_result` run inline in that request, avoiding nested `waitUntil` work that can be dropped before generation starts. Stale working leases retry the same stable pack/index generation UUID.
- Every chunk outcome is CAS-persisted, so a late worker cannot overwrite a newer checkpoint or change `completed` back to `running`; provider/save/charge errors record the real failing chunk and error.
- Running status identifies the next script/image index. The terminal payload includes full script text and saved JPEG HTTPS URLs, never blobs.
