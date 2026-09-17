# Advance AI — guiones formatting, generation speed, image UX, MCP parity

**Status:** PLAN + PROPOSALS ONLY. No production code in this PR. Implementation is locked to Grok 4.6 (Cursor cloud executor) after Rafael GO per phase. Sol / Codex are not to be used on this work.
**Date:** 2026-09-17 · **Advisor:** Fable 5.1 · **Baseline audited:** `master` @ `cd78bb2` (GAP-01 product lock merged, PR #44)
**Inputs:** two screenshots (Sleeping Patches guiones thread, script card), `advance-mcp-upgrade-plan-2026-09-16.md`, PR #43 `docs/operations/advance-mcp-content-bot-plan.md` (open, gap list GAP-02…GAP-08), `docs/operations/mcp-user-tools.md`, `api/lib/guiones/*`, `api/chat.ts`, `api/generate-image.ts`, `api/lib/grok-image-generate.ts`, `api/lib/mcp/execute-tools.ts`, `src/features/chat-shell/*`, `src/utils/scriptParser.ts`.

Companion docs: PR #43 owns the Content-bot MCP gaps (post-with-copy, byte-copy ingest, offer CRUD). This plan owns **output quality, latency, chat-shell image UX, and chat-drop editing**. Where both touch the same tool the phase mapping in §3 says which PR carries it.

## 0. Executive summary

1. **The "clustered blob" is a parser miss, not a model problem.** Chat-shell defaults to the **legacy** `/api/chat` prompt (`useStructuredPipeline: false` in `src/services/grokApi.ts`). The model improvises a hybrid header `### GUIÓN/OPCIÓN #1 — [Estilo: Venta Directa] — "…"` plus timed labels `[GANCHO - 3 seg]:`. Neither regex in the SPA accepts that: `parseScripts` cannot split `GUIÓN/OPCIÓN` (so two options land in one card) and `parseScriptSections` only matches bare `[GANCHO]` (so labels stay inline with body text and `###` leaks). The structured pipeline already produces a clean `GeneratedScript { spokenScript: { hook, development, ctaOrClose } }` object, but `/api/chat` ships only the flattened string to the SPA and hides the object under `_debug`.
2. **Latency has no baseline.** No `durationMs` is logged for `/api/chat` or `/api/generate-image` (`api/lib/usage-logger.ts` has cost/tokens only). Structured guiones = 2 serial Grok calls (angles on `grok-4.5`, draft always on `grok-4.6`; the "Mejor calidad / Más rápido" toggle is ignored on that path). Images = always `2k`/`medium`, one blocking fetch up to 180 s, preceded by a serial `/api/streamline-script` call. The progress UI advances on a 2 200 ms timer, unrelated to real stages.
3. **Image UX glitches are three concrete bugs** (`imageStatus` never resets when the URL changes; no reserved aspect box so the layout jumps; no in-thread pending card), plus a structural one: **Confirmá referencias is mandatory** for every non-logo generate, which is what blocks the ChatGPT-style "drop a photo, say what to change" path.
4. **Zero-context generation is structurally blocked**: upload, persistence, and session auth all require an offer `productId`. Recommended unlock is a hidden per-user *scratch* brand + offer (reuses every existing owner check), not a new artifact owner model.
5. **MCP is already close on scripts and edits** (`execute_script_generate` returns `scripts[]`; `execute_image_edit` accepts an arbitrary https `imageUrl`). What is missing is the same **section shape** on every script surface, one saved row per script, `lockApplied`/`grokMode` in results, and the edit lock policy (§5).

Phase 0 is small and high-leverage: structured pipeline default for chat-shell, canonical text format + tolerant parsers, structured `scripts[]` on the wire, per-option cards, latency instrumentation, honor the speed toggle, skip the redundant streamline call, and async image jobs for the shell.

## 1. Problems tied to the screenshots

### Screenshot 1 — thread header + progress ("Escribiendo venta directa 1/1 · Sleeping Patches")

| Observation | Cause (code) | Fix phase |
|---|---|---|
| Stage lines (`Leyendo la oferta y el ángulo…` → `Cerrando con el CTA…`) advance regardless of what the server is doing | `ChatShellProgress.tsx` `setInterval(…, 2200)`; `/api/chat` returns once, no streaming | P0 (align timer to measured p50), P1 (real SSE stage events) |
| `827 créditos IA` + `Mejor calidad` pill visible, but toggle does nothing for this generation | `textModelPreference.ts` → `scriptSettings.model` only read by legacy path; `script-output.ts` draft hard-codes `GROK_TEXT_MODEL` (4.6) | P0 |
| One blocking wait for the whole batch | no streaming, no partial render | P1 |

### Screenshot 2 — script card (dense blob)

| Observation | Cause (code) | Fix phase |
|---|---|---|
| `### GUIÓN/OPCIÓN #1 — [Estilo: Venta Directa] — "Parche, no pastilla"` rendered as literal text | Legacy prompt lets the model invent the header; card renders text, not markdown; `parseScripts` header regex (`(GUI[OÓ]N\|…\|OPCI[OÓ]N)\s*#?\s*(\d+)`) fails on `GUIÓN/OPCIÓN` | P0 |
| Two options (#1, #2) in one card with one `#1` badge and one set of actions | Same split failure → fallback single card | P0 |
| `[GANCHO - 3 seg]: Dormís mal…` — label glued to the body, no visual break | `parseScriptSections.ts` `SECTION_MARKER_RE` requires `]` right after the keyword (`[GANCHO]`, `[GANCHO A]`); `[GANCHO - 3 seg]` is not a marker → whole text is one `other` section rendered `white-space: pre-wrap` | P0 |
| Timing (`3 seg`, `25 seg`, `4 seg`) is useful but arbitrary and model-invented | No timing field in `GeneratedScript`; timing only appears in legacy/organic prompt templates | P0 (deterministic spoken-seconds estimate) |
| Style badge `Sleeping Patches` is the offer, not the script type | Card shows offer chip; `scriptType` not on the wire | P0 |
| `Copiar` copies the raw blob with brackets and `###` | Card copies `content` verbatim | P0 |
| Same content reaches MCP `list_scripts` / `execute_script_generate.content` — Grok bot users see the same blob | MCP saves the whole batch string as one `scripts` row; `list_scripts` is text-only | P0 (shape), P1 (one row per script) |

## 2. Website vs MCP parity matrix

Legend: **OK** = same behaviour · **GAP** = missing/diverges · **P#** = phase in §3 · `#43` = carried by PR #43.

| Capability | Website (chat-shell `/chat`) | MCP (`POST /api/mcp`, registry 0.9.5) | Parity | Owner |
|---|---|---|---|---|
| Guiones generate | `/api/chat` legacy by default; structured only on "ángulos frescos" | `execute_script_generate` always structured | GAP (web worse) | P0 |
| Script return shape | flattened `content` string | `content` + `scripts: GeneratedScript[]` (nested `spokenScript`) | GAP | P0: both return `content` + `scripts[]` with `sections` |
| Section labels / timing | inline brackets, no timing | same string | GAP | P0 canonical format v2 |
| Saved rows | one `scripts` row per split option (when split works) | one row for the whole batch | GAP | P1 |
| Script type on the card / result | not on wire | `scriptType` on `scripts[]` | GAP | P0 |
| Edit script (NL) | `/api/edit-script` (`grok-4.6`) | none (`guide_script` only) | GAP | P2 `execute_script_edit` |
| Speed / quality profile | header toggle (legacy path only) | none (`GROK_TEXT_MODEL`) | GAP | P0 web honors toggle; P1 MCP `profile: best\|efficient` |
| Progress | fake 2 200 ms stages | `status: running` + `get_execute_result` poll | GAP | P1 SSE stages web |
| Latency telemetry | none | `auditMcpToolCall.durationMs` (tool only) | GAP | P0 `durationMs` + stage timings in `api_usage_logs.metadata` |
| Post with copy (9:16 JPEG) | `/api/generate-image mode=post` with PRODUCT LOCK | lifestyle still only | GAP-02 | `#43` |
| First-gen product lock | `/images/edits` + lock | same since #44 | OK | — |
| Image edit (NL) | lightbox form, base64 `editImage`, TEXT LOCK | `execute_image_edit` https `imageUrl` or `productImageId`, TEXT LOCK | OK-ish; **neither applies PRODUCT LOCK when the source is a product photo** | P1 (§5 lock policy, both) |
| Image enhance | `action: enhance`, lock when product refs | `execute_image_enhance`, same helper | OK | — |
| Chat-drop → NL edit without wizard | not possible (refs sheet mandatory) | possible today (`imageUrl` + `editPrompt`), but no lock policy | GAP (web) | P1 |
| Zero-context generate/edit | blocked (`productId` required everywhere) | blocked (`brandId` required) | GAP both | P2 scratch brand |
| Lock evidence in result | none | none | GAP | P1 `grokMode`, `lockApplied`, `endpoint` on both |
| Brand KB read | Brand Kit card | `get_brand_context`, `get_brand_kit` | OK | — |
| Brand KB write (colors/voice/logo) | Brand Kit editor | `create/update/link_brand_kit`, `set_style_dna` | OK (logo hot-linked: GAP-04) | `#43` |
| Offer CRUD | setup flow | none | GAP-05 | `#43` |
| Product/context ingest | upload → Storage | https URL hot-link / deep link | GAP-04 | `#43` |
| Carousel | `/api/generate-carousel` Nano Banana Pro | `execute_carousel_generate` | OK | — |
| Image model choice | `grok-imagine` default, Nano manual | `grok-imagine` only | OK (policy) | P2 optional `nano-banana` compose fast path both sides |
| Credits + approval | client quote + server charge | `confirm_execute` | OK | — |

## 3. Phased roadmap

Each phase = one fat PR by Grok 4.6, verified locally (`npm test`, `npm run build`) before push, SecureDog review, Rafael merges. Registry bumps only when tool schemas change.

### P0 — Script formatting + must-ship latency (GO asked now)

**Scripts**

1. Chat-shell sends `useStructuredPipeline: true` for every guiones intent (`chatShellScriptIntent.ts`), not only "ángulos frescos". Classic `ScriptSettingsPanel` toggle unchanged. Legacy path stays for classic + fallback when the structured pipeline throws.
2. Canonical text format **v2** in `renderScriptsAsText` (`api/lib/guiones/script-output.ts`), label on its own line, blank line between blocks:
   ```
   OPCIÓN #1 — Venta directa — "Parche, no pastilla"
   [GANCHO · ~3 s]
   Dormís mal y al día siguiente lo pagás. …

   [DESARROLLO · ~25 s]
   Cada parche de 12 x 17 cm …

   [CTA · ~4 s]
   Envianos un mensaje para pedir tu bolsa.
   ```
   `CIERRE` replaces `CTA` for organic/reconocimiento types (existing rule). EN mirror: `OPTION`, `HOOK`, `DEVELOPMENT`, `CTA/CLOSE`.
3. Deterministic spoken timing: `estimateSpokenSeconds(text, language)` in `api/lib/guiones/script-timing.ts` (ES ≈ 2.6 words/s, EN ≈ 2.8; round to whole seconds; `~` prefix). Add `timing: { hookSeconds, developmentSeconds, ctaSeconds, totalSeconds }` to `GeneratedScript`. Quality gate warning (not failure) when `totalSeconds > 40` for sales types.
4. `/api/chat` structured response adds top-level `scripts: ScriptSectionsDto[]`:
   ```ts
   interface ScriptSectionsDto {
     index: number; title: string; scriptType: ScriptFramework; scriptTypeLabel: string
     hook: { label: string; text: string; seconds: number }
     development: { label: string; text: string; seconds: number }
     close: { label: 'CTA' | 'CIERRE' | 'CLOSE'; text: string; seconds: number }
     totalSeconds: number; content: string   // per-script v2 text
   }
   ```
   Same DTO on MCP `execute_script_generate` / `get_execute_result` (`sections[]` next to existing `scripts[]`), `execute_bulk_scripts` items, and `list_scripts` (parsed server-side from stored text). `_debug` unchanged.
5. Shared **tolerant** parser, one implementation in `api/lib/guiones/script-sections-parse.ts` (server) and a byte-identical mirror in `src/utils/scriptSections.ts` (SPA; `src` must not import `api/`), guarded by a fixture-parity vitest:
   - header: accepts `###`/`**`, `GUIÓN`, `OPCIÓN`, `GUIÓN/OPCIÓN`, `SCRIPT`, `OPTION`, `#N`/`N`, separators `-–—:.`; extracts `[Estilo: X]` / `- Type -` into `scriptTypeLabel`; strips it from the title.
   - section marker: `\[(GANCHO|HOOK|DESARROLLO|DEVELOPMENT|CTA|CIERRE|CLOSE)S?(?:\s*[AB])?(?:\s*[-–—·:]\s*[^\]]*)?\]:?` (timing suffix optional, captured as `seconds` when parseable).
   - normalizer: drop leading `###`/`**`, collapse ≥3 newlines, strip trailing `:` after a marker.
   - fixture set includes the exact Sleeping Patches blob from screenshot 2 → must yield 2 scripts × 3 sections with seconds 3/25/4 and 3/28/4.
6. Chat-shell card = **one card per option** (`ChatShellScriptCard`): header row `Opción 1 · Venta directa · "Parche, no pastilla" · ~32 s`, three blocks (§6). Fallback when `scripts[]` absent (old saved rows, legacy path): run the tolerant parser client-side. Classic `ScriptCard` reuses the same section blocks instead of inline chips.
7. `Copiar` copies clean labeled plain text (v2 format, no `###`), `Copiar solo texto` copies body only. Saved row `content` stays v2 text (no schema change).

**Latency (must-ship)**

8. Instrumentation first: `durationMs` + `stageTimings` (`anglesMs`, `draftMs`, `streamlineMs`, `imageMs`, `persistMs`) into `api_usage_logs.metadata` for `/api/chat`, `/api/streamline-script`, `/api/generate-image`, MCP execute jobs. Admin `/admin` image-performance card shows p50/p90 per model+action. Without this, every model swap is a guess.
9. Honor the header toggle in the structured pipeline: `efficient` → draft on `grok-4.5`, `best` → `grok-4.6` (`resolveGrokTextModel(scriptSettings.model)` passed into `draftScriptsFromBriefs`). Angle inventory stays efficient.
10. Skip the angle-inventory call when `count ≤ 2` and the request is not "ángulos frescos": `selectScriptBriefs` already picks briefs deterministically from type lenses + context profile; feed it a local candidate list. Saves one round-trip (measured `anglesMs` today is the number to beat; log it in P0 step 8 first, then flip via env `GUIONES_SKIP_ANGLES_MAX_COUNT=2`).
11. Prompt ordering for xAI cache hits: static system blocks (category/type lenses, rules) first, dynamic facts (offer, memory, brief) last, identical byte prefix across requests. Cached input is $0.50/1M vs $2/1M on 4.6.
12. Images: skip `/api/streamline-script` when `scriptText.length ≤ 320` or the post style is `product`/`logo` (no copy). Otherwise run it **in parallel** with server-side prompt assembly by moving the condense into `/api/generate-image` (one round-trip instead of two).
13. Images: chat-shell moves to **async job + poll** (`generationId` as job id, `waitUntil` like MCP, `get`/`poll` on `/api/generate-image`) so the SPA never holds a 180 s fetch and a client timeout cannot double-charge. Pending card with reserved aspect box (§6 image notes) appears immediately.
14. Pin `api/chat.ts` `maxDuration` in `vercel.json` (currently unpinned; propose 120) once step 8 shows p90.

**Exit:** §8 A-series + L1–L4 green; Sleeping Patches regenerate shows 2 separate cards with 3 labeled blocks each; p50 script latency logged and reported before/after.

### P1 — Real progress, image polish, chat-drop edit with lock policy

1. SSE streaming from `/api/chat` (stage events `angles`, `draft`, `quality`, then final JSON); `ChatShellProgress` consumes events, timer becomes fallback only.
2. Image card fixes: reset `imageStatus` on `url` change (`key={url}` or effect), CSS `aspect-ratio` box from `data-aspect` with shimmer, in-thread pending card, 390 px rules, `Producto intacto ✓` badge when `grokMode === 'product_lock_scene'` / `lockApplied`.
3. Edit payload: server-side fetch of `sourceImageUrl` (Supabase Storage only, allowlisted) replaces client base64 `editImage` for shell-owned images.
4. **Chat-drop NL edit (§5):** composer attachment + edit intent skips Confirmá referencias; lock policy by source role; inline role chip instead of the sheet.
5. Lock evidence on the wire: `grokMode`, `endpoint`, `lockApplied` in `/api/generate-image` responses and MCP `get_execute_result`.
6. MCP: `execute_script_generate` saves one row per script; `profile: best|efficient` arg; `execute_image_edit` gains `sourceRole` + `editKind` and applies the same lock policy; registry → 0.10.x (coordinate with #43 so both land in one registry bump).

### P2 — Zero-context + fast compose lane + script edit parity

1. Hidden per-user **scratch brand + offer** (`businesses.kind='scratch'`, created lazily, hidden from `list_brands`, sidebar, dashboard). Chat-drop with no brand selected, and MCP `execute_image_edit` without `brandId`, resolve to it. "Guardar en marca…" moves artifacts (`product_id` update) later.
2. Optional fast compose lane: `nano-banana` (`gemini-2.5-flash-image`, $0.039) allowed for **no-product-ref** compose when profile is `efficient`, web + MCP (`imageModel` arg). Product-lock paths stay on Grok `/images/edits`. Gate on P0 latency data.
3. `execute_script_edit` (MCP) mirroring `/api/edit-script`; `/api/edit-script` on `grok-4.5`.
4. Bake-off for a third text profile `fast` (`grok-4-1-fast-reasoning`, $0.20/$0.50 — already priced in `model-pricing.ts` from historical rows) for angle inventory, streamline, auto-fill, memory. Ship only if quality gate scores stay within 5% of `grok-4.5` on the fixture set.

### P3 — Enhancement backlog (§7) items ranked 1–5, plus MCP runbook update

## 4. Model routing (options present in the codebase today)

Only models already referenced in `api/lib/grok-models.ts`, `api/lib/image-provider-routing.ts`, `api/generate-image.ts`, or `api/lib/model-pricing.ts`. Anything else needs a provider smoke test first.

| Task | Today | Proposed `efficient` ("Más rápido") | Proposed `best` ("Mejor calidad") | Phase |
|---|---|---|---|---|
| Angle inventory (JSON plan) | `grok-4.5`, 1 600 tok | skip when count ≤ 2; else `grok-4.5` → bake-off `grok-4-1-fast-reasoning` | `grok-4.5` | P0 / P2 |
| Script draft | `grok-4.6` always | `grok-4.5` | `grok-4.6` | P0 |
| Legacy `/api/chat` monolith | toggle-driven | retire for chat-shell (structured default); classic unchanged | — | P0 |
| `/api/edit-script` | `grok-4.6` | `grok-4.5` | `grok-4.6` on explicit "reescribí todo" | P2 |
| `/api/streamline-script` | `grok-4.5` | skip ≤ 320 chars; else `grok-4.5` → bake-off fast | same | P0 / P2 |
| `/api/reply-chat` | `grok-4.6` | `grok-4.5` | `grok-4.6` | P1 |
| auto-fill / memory / synthesize | `grok-4.5` | bake-off fast | `grok-4.5` | P2 |
| Post / product image first-gen | `grok-imagine-image-2.0`, `2k`, `medium` | same (lock path is Grok-only) | same | — |
| Compose (no product ref) | Grok `/images/generations` `2k` | `nano-banana` (measure) | Grok `2k` | P2 |
| Edit / enhance | Grok `/images/edits` | same | same | — |
| Carousel | `nano-banana-pro` | same | same | — |
| OCR / brand extract / style analysis | `gemini-2.5-flash` | same | same | — |

Rules: `GROK_TEXT_MODEL_EFFICIENT` remains `grok-4.5`; `grok-4.3` never routed (existing rule). Resolution stays `2k` for any deliverable creative — `1k` (~576×1024 for 9:16) is below IG Story 1080×1920 and JPEG-only ads must not ship at that size. xAI quality accepts `low|medium` only; `medium` is already the ceiling, so quality is not a latency knob for finals. Every routing change lands behind an env flag with the previous default as fallback (`GUIONES_DRAFT_MODEL_EFFICIENT`, `GUIONES_SKIP_ANGLES_MAX_COUNT`, `IMAGE_COMPOSE_FAST_MODEL`).

## 5. Chat-drop image edit architecture

Goal: user drops a photo into the composer, types `quitá el fondo`, `ponelo en un campo abierto al atardecer`, `mejorá la luz`, and gets a result without the Confirmá referencias sheet. Product lock still holds whenever the dropped image is the product.

### 5.1 Flow (chat-shell)

```
composer drop (chatShellComposerAttachments, role default = product)
  + text → parseChatShellImageEditIntent (new)   ── no edit verbs → existing generate intent
  → editKind ∈ background_remove | background_replace | scene_swap | relight | retouch | text_edit | enhance
  → lock policy (5.2) → request body
  → POST /api/generate-image { action:'edit', sourceImageUrl | attachment upload, editKind, sourceRole, editPrompt, aspectRatio? }
  → async job + poll (P0.13) → pending card → result card with lockApplied badge
```

- Attachment present + edit intent ⇒ `referenceMode = 'use'` implicitly; the sheet is skipped (`shouldPromptImageReferences` gets a new `hasTurnAttachment` short-circuit). An inline chip `Producto: foto adjunta · cambiar a contexto` replaces confirmation. Attachments already upload through `uploadShellOfferImage` → `product_images` row under the active offer (P2 scratch offer when none).
- Reply-to-card: typing an edit instruction right after an image card, with no attachment, targets the **last image artifact in the session** (`source_product_image_id` join already exists in `chat-shell-image-workspaces.spec.ts`).
- No attachment, no prior image, edit verbs ⇒ clarify chip "¿Sobre qué imagen? Adjuntá una o elegí una del hilo."

### 5.2 Lock policy (server, fail-closed)

| Source role | Edit kind | Contract injected | Endpoint | Mode |
|---|---|---|---|---|
| `product` (kind=product row, or dropped photo default) | `background_*`, `scene_swap`, `relight`, `retouch` | `buildProductPixelLockContract({ sceneReplace: true })` + user instruction | `/images/edits`, product as first image | `product_lock_scene` |
| `product` | `text_edit` | PRODUCT LOCK + TEXT LOCK | `/images/edits` | `product_lock_scene` |
| `product` | instruction targets the SKU (`cambiá el color de la etiqueta`, `hacelo más grande`, `sacale el logo`) | **refuse** with clarify: "El producto está protegido; puedo cambiar fondo, luz o escena." | — | — |
| `generated` (previous ad) | any | TEXT LOCK (today's `runGrokImageEdit`) + PRODUCT LOCK if the ad's `source_product_image_id` is a product | `/images/edits` | `edit` |
| `context` / `logo` | any | brand rules only (logo never redrawn) | `/images/edits` | `edit` |

`assertLockContract()` runs before the provider call and throws when `sourceRole === 'product'` and `hasProductPixelLockLanguage(prompt) === false` (same pattern as `runGrokPostFirstGen`). The SKU-targeting detector is a small ES/EN verb+noun list (`etiqueta|label|envase|botella|logo del producto|forma|tamaño|color del producto`) plus `editKind === 'retouch'` scoped to background terms; unknown ⇒ treat as SKU-targeting ⇒ refuse (fail-closed).

### 5.3 API changes

- `/api/generate-image action=edit`: accept `sourceImageUrl` (Supabase Storage host only, ≤ 10 MB, jpeg/png/webp; SSRF-safe fetch reused from `fetchPublicUrl`) as an alternative to base64 `editImage`; new `sourceRole`, `editKind`; response adds `grokMode`, `endpoint`, `lockApplied`. Output stays JPEG via `saveImageArtifact`.
- MCP `execute_image_edit`: same `sourceRole` (default inferred: `productImageId` kind=product → `product`; https `imageUrl` → `product` unless `sourceRole` says otherwise; latest generated → `generated`), `editKind`, result fields above. `execute_image_enhance` unchanged (already locks with product refs).
- Credits: `image_edit` = 18 today vs `image_standard` = 6. A background swap on a dropped photo at 18 will feel wrong next to a 6-credit post. **Decision for Rafael** (not changed in P1 by default): keep 18, or add `image_edit_source` = 6 for `sourceRole === 'product'` with no visible text.

### 5.4 Zero-context (P2)

Scratch brand: `businesses` row per user with `kind = 'scratch'` (new nullable column, default `'brand'`) and one offer `Sin oferta`. Hidden from `list_brands`, `ChatSidebar`, dashboard counts, `kitReady` logic. All existing owner checks (`authorizeSessionImageProduct`, `getOwnedProductImage`, `assertOwnsBrand`) keep working. Artifacts can be moved to a real offer later. No service-role paths, no new RLS policy beyond the column default. MCP: `brandId` optional on `execute_image_edit` / `execute_image_generate referenceMode:'none'` → scratch.

## 6. UI notes — script cards (separated blocks)

Card anatomy (chat-shell, dark + light tokens from `chat-shell-obsidian-tokens.css`):

```
┌─ Opción 1 · Venta directa · "Parche, no pastilla"                     ~32 s · #1 ─┐
│ GANCHO                                                        ~3 s                 │
│ Dormís mal y al día siguiente lo pagás. …                                          │
│                                                                                    │
│ DESARROLLO                                                    ~25 s                │
│ Cada parche de 12 x 17 cm trae fórmula nocturna …                                  │
│                                                                                    │
│ CIERRE                                                        ~4 s                 │
│ Envianos un mensaje para pedir tu bolsa y despertar renovado.                      │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Copiar · Guardar · Editar · Crear post                              Sleeping Patches│
└────────────────────────────────────────────────────────────────────────────────────┘
```

- One card per option; batch header (`### 1. Sleeping Patches`) becomes a thin group label above the cards, not card text.
- Section label row: small caps label left, `~N s` chip right (muted). Body: 15–16 px, `line-height 1.55`, `max-width ~68ch`, `white-space: pre-wrap` kept for intentional line breaks only after the normalizer collapses runs.
- Script type shows as a badge from `scriptTypeLabel` (Venta directa / Educativo / …); offer chip moves to the footer.
- Never render `###`, `**`, `[Estilo: …]`, or bracket markers inside the body. If the parser still cannot find sections (free-form text), render a single block without a label and log `script_sections_unparsed` to console debug + a usage metadata flag so it shows in `/admin`.
- Copy: `Copiar` → v2 labeled text; long-press/secondary → body only.
- Edit keeps the whole option; `Crear post` passes `scripts[i].content` (clean) to the post flow so `streamline` gets clean input.
- Progress (P1): stage lines bind to SSE events; until then the timer uses the measured p50 per profile.

Image card notes (P1): reserved `aspect-ratio` box sized from the requested aspect before the URL exists; shimmer; `imageStatus` resets per URL; pending card in-thread with stage text and cancel (cancel = stop polling, job still settles; no refund promise); 390 px: card full width, actions wrap to two rows; `Producto intacto ✓` badge from `lockApplied`; download stays JPEG; lightbox edit form pre-fills the last NL instruction.

## 7. Enhancement backlog (prioritized, fits Advance)

| # | Feature | Why it fits | Cost / model | Phase |
|---|---|---|---|---|
| 1 | Hook A/B: 2 alternate ganchos per option, inline swap | Ian methodology leans on the hook; cheap; reuses `angleCandidates` | `grok-4.5`, ~300 tok | P3 |
| 2 | Spoken-time meter + "recortar a 30 s" action | Timing already computed in P0; TikTok/Reels pacing | local + `grok-4.5` | P3 |
| 3 | `Producto intacto ✓` lock badge + hover "cómo se generó" | Turns the lock into visible trust | none (P1 wire fields) | P1 |
| 4 | Story + Feed from one post (9:16 → 1:1 recomposition with same copy) | Two deliverables per idea; JPEG both | 1 extra `image_standard` | P3 |
| 5 | Caption + hashtags + CTA sticker text for the post | Completes the deliverable for CR IG/TikTok | `grok-4.5`, no image credits | P3 |
| 6 | "¿Por qué este ángulo?" chip from `briefs` rationale | Educates the user, already in `_debug` | none | P3 |
| 7 | Variaciones: same prompt, new seed, 2–3 thumbnails, pick one to keep at 2k | Faster creative exploration | Grok `n` or serial; credit rule needed | P3 |
| 8 | Script export `.txt` / clipboard clean + teleprompter view | Creators read on phone while filming | none | P3 |
| 9 | Session-level "estilo que funcionó" pin (Style DNA from a liked image) | `set_style_dna` exists on MCP; web parity | none | P3 |
| 10 | MCP `guide_script` returns `sections[]` shape (free) | Grok bot renders the same blocks | none | P1 |

Out: TTS voice-over (no provider), video, Meta posting, PIL collage fallbacks.

## 8. Acceptance tests + Done checks

Legend — **Auto** = vitest Grok 4.6 must add; **Manual** = runbook on Preview (AIIAN) or Production per `chat-shell-environments.md`.

### A. Script format (P0)

| ID | Test | Expected | Auto |
|---|---|---|---|
| A1 | Fixture = exact Sleeping Patches blob (screenshot 2) through tolerant parser | 2 scripts; each 3 sections `gancho/desarrollo/cierre`; seconds `3/25/4` and `3/28/4`; titles `Parche, no pastilla`, `30 noches de calma`; `scriptTypeLabel = Venta Directa`; no `###` in any field | `test/script-sections-tolerant.spec.ts` |
| A2 | `renderScriptsAsText` v2 snapshot ES + EN, sales + organic (`CIERRE`) | label on own line, blank line between blocks, `~N s` chips | `test/script-output-v2.spec.ts` |
| A3 | Server parser ↔ SPA mirror parity on 12 fixtures | identical JSON | `test/script-sections-parity.spec.ts` |
| A4 | `/api/chat` structured response (mocked Grok) | top-level `scripts[]` DTO with `hook/development/close/totalSeconds`; `content` unchanged v2 | extend `test/guiones-faster-coherent.spec.ts` |
| A5 | `ChatShellScriptCard` render for 2-option batch | 2 cards; each has 3 `.chat-shell__script-section` with label + seconds chip; no bracket text in body; `Copiar` writes v2 text | `test/chat-shell-script-card-sections.spec.tsx` |
| A6 | Old saved row with legacy `[GANCHO]:` inline format | still renders 3 blocks (client fallback parser) | A5 |
| A7 | Chat-shell guiones intent | `useStructuredPipeline === true` for plain "Quiero crear guiones" | extend `test/chat-shell-script-intent.spec.ts` |
| A8 | `estimateSpokenSeconds` | 65 ES words → 25 s ± 1; empty → 0 | `test/script-timing.spec.ts` |
| A9 | MCP `execute_script_generate` result | `sections[]` present with same DTO; `content` v2 | extend `test/mcp-execute-jobs.spec.ts` |
| A10 | Manual: Sleeping Patches CR, "Quiero crear guiones", 2 options | 2 cards, separated blocks, type badge, copy clean; screenshot as artifact | Manual |

### L. Latency (P0)

| ID | Test | Expected | Auto |
|---|---|---|---|
| L1 | `api_usage_logs.metadata.durationMs` + `stageTimings` written for `/api/chat`, `/api/generate-image`, MCP jobs | present, numeric | `test/usage-logger-timings.spec.ts` |
| L2 | Toggle `efficient` → structured draft model | draft request `model === 'grok-4.5'`; `best` → `grok-4.6` | extend `test/guiones-faster-coherent.spec.ts` |
| L3 | `count ≤ 2`, not fresh angles | zero angle-inventory fetch; briefs still 2 distinct types | same |
| L4 | Streamline skip rule | `scriptText.length ≤ 320` or style `product|logo` ⇒ no `/api/streamline-script` call | `test/chat-shell-image-intent.spec.ts` |
| L5 | Shell image async job | first response `status: running` + `jobId`; poll → `completed` with `imageUrl`; replay same `generationId` ⇒ no second charge | `test/chat-shell-image-jobs.spec.ts` |
| L6 | Manual before/after on Production, 10 runs each: 1-script venta directa, 2-script mixed, 1 post 9:16 | p50 reported in PR; target ≥ 30% lower script p50 in `efficient`, no regression in `best`; image p50 not worse | Manual |

### I. Image UX + chat-drop (P1)

| ID | Test | Expected | Auto |
|---|---|---|---|
| I1 | `ChatShellImageCard` URL change | `imageStatus` back to `loading` then `ready`; no stale error | `test/chat-shell-image-card.spec.tsx` |
| I2 | Aspect box | `data-aspect="9:16"` element has `aspect-ratio: 9 / 16` before load (tokens-style CSS assertion) | `test/chat-shell-image-aspect.spec.ts` |
| I3 | Edit intent classifier | `quitá el fondo` → `background_remove`; `ponelo en un campo abierto` → `background_replace`; `mejorá la luz` → `relight`; `cambiá el color de la etiqueta` → `sku_target` refuse | `test/chat-shell-image-edit-intent.spec.ts` |
| I4 | Lock policy (fetch-mocked xAI) | `sourceRole=product` + `background_replace` ⇒ `/images/edits`, `hasProductPixelLockLanguage === true`, product first image; `sourceRole=generated` ⇒ TEXT LOCK present | `test/image-edit-lock-policy.spec.ts` (web + MCP share helper) |
| I5 | Refs sheet skip | attachment + edit intent ⇒ `setImageClarify` not called; inline role chip rendered | extend `test/chat-shell-image-intent.spec.ts` |
| I6 | `sourceImageUrl` allowlist | Supabase Storage host OK; other https ⇒ 400; `data:` ⇒ 400 | `test/generate-image-source-url.spec.ts` |
| I7 | Response evidence | `grokMode`, `endpoint`, `lockApplied` on web + `get_execute_result` | I4 |
| I8 | Manual: drop Sleeping Patches packshot, "quitá el fondo y ponelo sobre una mesa de madera" | result JPEG, SKU unchanged (CreativeDirector visual check), no sheet shown, ≤ 2 clicks; 390 px viewport recording | Manual |

### Z. Zero-context (P2)

| ID | Test | Expected | Auto |
|---|---|---|---|
| Z1 | First edit with no brand | scratch brand + offer created once per user; `list_brands` and sidebar hide it | `test/scratch-brand.spec.ts` |
| Z2 | Cross-user | user B cannot read user A scratch artifacts (existing owner checks) | extend `test/chat-shell-image-auth.spec.ts` |
| Z3 | Move to real offer | `product_id` updated; artifact appears in that brand's `list_assets` | new |

### Done checks per phase

- `npm test` and `npm run build` green locally before push (fat PR rule); no new lint tooling introduced.
- `docs/agent/CHANGELOG.md` entry; user-facing `src/data/changelog.ts` entry for P0 (card format) and P1 (chat-drop edit).
- `docs/operations/mcp-user-tools.md` single-page rewrite when the registry bumps (shared with #43).
- SecureDog review on lock policy + `sourceImageUrl` fetch.
- Manual proof artifacts (screenshots / recording) attached to each PR: A10, L6, I8.
- No merge by agents; Rafael merges.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Credits: async shell image jobs could double-charge on retry | user trust, refunds | `generationId` idempotency exactly as MCP `approvalRequestId`; ledger test L5; replay returns the same artifact |
| Credits: chat-drop edit at 18 vs post at 6 feels arbitrary | adoption | decision in §5.3; no price change without Rafael |
| Quality regression from `grok-4.5` drafts or fast angle model | worse guiones for `efficient` users | env-flag rollout; quality gate scores (`evaluateScriptBatch`) compared on fixture set; `best` unchanged; revert = flip flag |
| Model availability: `grok-4-1-fast-reasoning` may be unavailable or renamed on the xAI account | bake-off fails | probe with a 1-token call before routing; never default to it; P2 only |
| Product lock bypass through NL edit verbs | content-safety property broken | fail-closed classifier (unknown ⇒ SKU-target ⇒ refuse); `assertLockContract()` before provider call; I3/I4 required |
| Scratch brand leaking into brand lists, counts, invoices | confusing UX, bad metrics | `kind='scratch'` filtered at `database.ts` + `mcpListBrands`; test Z1; admin usage groups it separately |
| Vercel: SSE from `/api/chat`, `waitUntil` on shell jobs, unpinned `maxDuration` | truncated streams, killed jobs | pin `maxDuration`; keep JSON fallback when SSE unsupported; reuse the MCP `waitUntil` + lease-reclaim pattern that already runs in Production |
| Parser drift between `api/` and `src/` mirrors | web and MCP render differently again | parity fixtures test A3 in CI; single source of fixtures under `test/fixtures/scripts/` |
| Cache-ordering refactor of prompts changes outputs | subtle voice drift | snapshot the assembled prompt in tests; compare quality gate on fixtures |
| Storage growth from scratch uploads and variations | cost | 10 MB gate exists; add 30-day cleanup cron for scratch artifacts not moved to a brand (P2) |
| Preview vs Production: credit-bearing manual runs | burn credits | manual latency runs on Production with Rafael's account, ≤ 60 credits per session; Preview for UI-only checks |

## 10. GO asks (for Rafael)

**Phase 0 — asking GO now.** Scope: §3 P0 items 1–14 (script format v2 + tolerant parsers + `scripts[]` on the wire + per-option cards + copy clean; latency instrumentation, toggle honored in structured draft, skip angles for ≤ 2, streamline skip/merge, async shell image jobs, prompt cache ordering, pin `maxDuration`). One fat PR by Grok 4.6. No pricing changes, no new models, no schema changes.

Decisions needed with the GO:
1. Timing chips `~N s` computed locally (recommended) vs asking the model for timing.
2. `Copiar` default = labeled v2 text (recommended) vs body only.

**Later phases — hold until P0 is merged and L6 numbers are in:**
3. P1 GO: SSE progress, image card fixes, chat-drop NL edit with the §5.2 lock policy, lock evidence fields, MCP one-row-per-script + `profile`. Decision: edit credit price for `sourceRole=product` (§5.3).
4. P2 GO: scratch brand for zero-context (schema: one nullable column), `nano-banana` fast compose lane for no-product-ref only, `execute_script_edit`, `grok-4-1-fast-reasoning` bake-off.
5. P3 GO: backlog items 1–5.

Explicitly **not** proposed: lowering image resolution below `2k` for deliverables, any non-JPEG creative output, redrawing product photos under lock, Meta/IG posting, Sol/Codex on this work.
