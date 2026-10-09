# Ad Pack engine — plan (2026-10-07)

**Goal:** any business, in any category, gets **10 sell-ready static social ads** (product image + on-image copy + script/caption) in ~1–3 minutes for ~$0.30–0.60 of model cost, from the **web app and the Grok MCP bot identically**, running on **Vercel today and Cloudflare Containers tomorrow**.

Inputs are only what a normal user can give: **website URL, Instagram URL, product photos, logo, optional reference ads/docs/notes.** No Meta account connection. Nothing is tuned to a specific customer.

## Guarantees vs targets

| Kind | What | How |
|---|---|---|
| **Guaranteed (deterministic)** | Price, offer name, bundle, CTA and headline on the image are exactly what the fact sheet / copy says | Text is rendered by our template layer (Satori → resvg), never by the image model |
| **Guaranteed** | No claim outside confirmed facts (prices, guarantees, delivery times, results) | Facts allowlist + deterministic checker rejects/rewrites |
| **Guaranteed** | Category compliance rules applied (health, beauty, finance…) | Rule packs; violations rewrite or flag, never ship silently |
| **Target (measured)** | Copy rubric ≥ 7/10 on ≥ 80% of benchmark ads | LLM judge on IAN rubric, benchmark of 30 generic offers / 10 industries |
| **Target** | Product passes vision check on ≥ 90% of scenes after ≤ 2 retries | Gemini Flash vision compare vs product reference |
| **Target** | Pack of 10 ≤ 3 min wall time, ≤ $0.60 model cost | Parallel (4–5), draft-resolution scenes, one scene → 3 aspect ratios |

## Pipeline (per pack)

1. **Brand DNA** (`api/lib/adpack/dna/`): website (reuse `site-analysis.ts`) + Instagram public profile (bio, link, recent post images/captions, best-effort) + uploads → `BrandDna` with `facts[]` (each with `source` + `confirmed`), voice, audience, pains/desires/objections, visual style, `gaps[]`. User confirms; only confirmed facts may become claims.
2. **Angles** (`plan-angles.ts`): 10 distinct angles = IAN archetype × buyer pain/desire/objection × format, deduped, each tied to fact keys. Reuses `script-angle-inventory.ts` ideas; deterministic spread.
3. **Copy** (`copy.ts`): one fast call per ad **in parallel** with the IAN master rules (restored), 1–2 archetype examples, brand voice, facts allowlist, hard length limits → `AdCopy` JSON.
4. **Copy check** (`check-copy.ts`): deterministic (facts, numbers, length, banned words, compliance pack) → one targeted rewrite for failures only.
5. **Scene** (`scene.ts`): text-free, product-locked scene per format at draft resolution; first scene = style anchor for the rest (carousel pattern).
6. **Scene check** (`check-scene.ts`): vision check (product matches reference, no stray text, clean space for copy) → ≤ 2 retries.
7. **Render** (`render/`): 7 format templates × 1:1 / 4:5 / 9:16 with brand fonts/colors/logo → PNG. Text edits re-render instantly at $0.
8. **Pack runner** (`pack-runner.ts`): durable per-ad state machine in Supabase, concurrency 4–5, poll-driven advance (works with `waitUntil` on Vercel and the CF container shim), idempotent credits per item, partial success.

## One engine, two doors

`api/ad-pack.ts` (web) and MCP tools (`adpack_*`) are thin wrappers over the same engine functions and tables. Parity tests run every operation through both.

| Operation | Web | MCP tool |
|---|---|---|
| DNA + offer from a SAVED brand (business, kit, offer form, product photos, stored site analysis) | `dna_from_brand` | `adpack_from_brand` |
| Ingest DNA from URL/IG/uploads | `POST /api/ad-pack {action:'dna_ingest'}` | `adpack_dna_ingest` |
| Confirm/edit facts | `dna_confirm` | `adpack_dna_confirm` |
| Plan angles | `angles` | `adpack_angles` |
| Quote | `quote` | `adpack_quote` |
| Start (spends credits) | `start` | `adpack_start` (after in-chat `confirm_execute`) |
| Status / advance | `status` | `adpack_status` |
| Edit text (free) | `edit_text` | `adpack_edit_text` |
| Regenerate one ad | `regenerate` | `adpack_regenerate` |

## Portability rules (Vercel → Cloudflare)

- No new Vercel-only APIs. Background work only via `waitUntil` from `@vercel/functions` (shimmed by the CF `server.mjs`) **plus** poll-driven resume, so a dropped background task never loses work.
- Every step finishes well under 60 s; no request holds a pack open.
- Fonts are bundled `.ttf` files read from disk; native deps limited to `sharp` (already used) and `@resvg/resvg-js` (prebuilt linux-x64-gnu, works in `node:22-slim`).
- Engine core is pure TS with a `PackStore` interface (Supabase impl + in-memory impl for tests).

## Phases and gates

| # | Deliverable | Gate |
|---|---|---|
| 0 | Contract (`types.ts`), benchmark set (30 fictional offers, 10 industries), scorer | Baseline scored |
| 1 | Copy engine (IAN restored, parallel, checks) | Facts 100%, rubric ≥ 7 on ≥ 80% |
| 2 | Render engine (7 formats × 3 ratios, fonts, logo) | Text exact by construction, snapshot tests |
| 3 | Brand DNA ingest (website + Instagram + uploads) | Facts + gaps produced for benchmark brands |
| 4 | Scene + scene check + pack runner + store + migration | 10 ads ≤ 3 min, cost ≤ $0.60, partial success |
| 5 | Web endpoint + MCP tools + parity tests | Same results from both doors |
| 6 | Chat-shell "Pack de 10" UI (DNA card → angles → quote → live grid) | Manual QA in browser |
| 7 | Live benchmark run + report | All gates above |

Out of scope now: Meta account connection, video generation, auto-publishing.

## Status (2026-10-08)

| Phase | State |
|---|---|
| 0 Contract + benchmark set | Done (`types.ts`, 30 fictional offers) |
| 1 Copy engine | Done; facts gate **met** (0 shipped issues / 399 ads); judge gate **not met**: 33% → 50% (grok-4.5, 30 offers) → 67% (stricter fast judge, 10 offers) vs 80% target |
| 2 Render engine | Done (7 formats × 3 ratios, exact text, contrast/safe-zone tests) |
| 3 Brand DNA | Done (website + IG best-effort + uploads). IG blocks server fetches → UI asks for screenshots |
| 4 Scene/check/runner/store | Done; migration `082_ad_packs.sql` **not applied** |
| 5 Web + MCP doors | Done (`/api/ad-pack`, `adpack_*` tools, parity tests, registry 0.10.0) |
| 6 Studio UI | Done behind `VITE_ADPACK_STUDIO=true`; dev harness `/dev/adpack-studio` |
| 7 Live benchmark | Partial (2026-10-08, `ad-pack-benchmark-2026-10.md`): 3 categories pass time/cost/scene gates (107–127 s, $0.32–0.44, 29/30 scenes); copy judge 67% < 80%; 4th/5th category and final 30-offer copy run blocked by xAI 403 (credits) |

### Saved brands (Grok happy path, 2026-10-08)

`list_brands` → `adpack_from_brand {brandId, offerId?}` (optional, review gaps) → `adpack_start {brandId, offerId, size, brief?}` → user confirms in chat → `adpack_status` until done → share `results[]` (PNG per ratio + caption) and `deepLink` (brand folder). `start` accepts `brandId`/`offerId` instead of `dna`/`offer` (built server-side by `api/lib/adpack/saved-brand.ts`; owner-scoped, other users' ids → NOT_FOUND). Owner-typed business/offer fields are confirmed facts; stored site analysis stays unconfirmed; a price is used only when the offer holds a concrete amount. `brief` (≤ 500 chars, sanitized, unbacked numbers stripped) is campaign context in copy/angle prompts, never a fact. On completion every render is saved as `product_images` (kind `generated`, linked to the offer), idempotent per render URL (`ad_pack_items.library_images`).

Status (both doors, shared builder `api/lib/adpack/status-summary.ts`): `summary` (one ES/EN line: ready/failed counts + ETA), `etaSeconds` (from this pack's per-step timings ÷ 4 workers), `failures[]` (plain-language reason + exact `adpack_regenerate` retry call) and, once finished, `deliverable` {ads[{index (1-based), format, headline, caption, links{1:1,4:5,9:16}}], captionsText, deepLink}. MCP drops per-ad rows once the deliverable exists and suggests polling every ~20–30 s. The web app opens `?adpack=<packId>` (with `?brand=`) straight on the studio's Resultados step, even with `VITE_ADPACK_STUDIO` off.

### Product fidelity — "real product, better scene" (2026-10-08)

`productFidelity: 'exact'` is the default whenever the offer has a usable product photo (`'generated'` = legacy model-redrawn product, only when asked or no photo). Code: `api/lib/adpack/fidelity/`.

- **Cut-out** (`segment.ts`): alpha passthrough → Lab flood fill from the borders on clean backgrounds (morphology, dominant component, feathered + decontaminated edge) → Gemini segmentation via `gateway.segment` (box_2d 0–1000 + mask PNG, threshold 127) → else `cutout_failed`. Cached by sha256 at `<userId>/adpack/cutouts/<hash>.png`. Multi-part products: `offer.productPhotos[{url, role: hero|part|contents|box|in_use|detail}]`, one cut-out per photo; parts are placed only in offer_graphic / explainer and never synthesized.
- **Plate** (`plate.ts`): the image model draws only the empty setting (no product refs), with the placement area from the layout's product boxes and the light direction; props/parts vision check (≤ 2 retries → `scene_props_failed`).
- **Composite** (`composite.ts`): product pixels scaled into the product box (aspect kept), alpha-derived cast shadow + contact shadow, luminance-neutral gain toward the plate (≤ 4%, spec cap 6%), ≤ 2 px light wrap. Optional `relight` (`relight.ts`) kept only if fidelity still passes.
- **Fidelity** (`score.ts`): masked grayscale SSIM (8×8) + mean ΔE (Lab, CIE76); pass = SSIM ≥ 0.90 and ΔE ≤ 6. Per render and per item (worst ratio) with a heatmap (`diffImageUrl`); a failing item is `fidelity_failed` and its renders are dropped. Exposed in status items, `deliverable.ads[].fidelity`, MCP `adpack_status` and `get_execute_result` (image generate / bulk / campaign).
- **Text never over the product** (`render/avoid.ts`): text/pill/card groups move off the product box; in exact mode the product shrinks on its surface when nothing can move; generated mode uses the vision check's product bbox.
- **Logo** (`render/logo.ts`): background removal (alpha / color key / SVG via resvg), trim, `onLight` / `onDark` / `badge` picked per ad (contrast ≥ 3). Also cleans the logo sent to image models (`brand-kit.ts`).
- **Ratios** (`api/lib/image-ratios.ts`): 1:1, 4:5, 9:16, 16:9 everywhere; Grok-missing ratios are generated at the nearest native one and reframed.
- **No migration**: pack options ride in `ad_packs.offer.packRender`, item fidelity in `ad_pack_items.scene_check.fidelity`, roles come from `product_images.label`. A follow-up migration could add `ad_packs.render_options jsonb`, `ad_pack_items.fidelity jsonb` and `product_images.role text`.
- Visual QA: `ADPACK_FIDELITY_QA=1 npx vitest run test/adpack/fidelity-qa.spec.ts` → `<os tmp>/adpack-fidelity-qa/`.

Before enabling in prod: apply 082 + 083 (`083_ad_pack_brief_library.sql`) + 084 (`084_product_images_adpack_unique.sql`, partial unique index on Ad Pack library rows; run its duplicate check first — the code tolerates it missing and treats 23505 as already saved), finish the 30-offer copy run + 5-category packs with the final code until the copy gate passes, copy `api/lib/adpack/render/fonts/` in the CF Dockerfile.

### Creative control (2026-10-08, owner feedback D1–D5, E4, F4, H1, H2, H5)

- **One angle system**: `angle-catalog.ts` (regalo, cómo funciona, valor/precio, qué incluye, uso real, detalle técnico, comparación, temporada [needs a brief], problema→solución, prueba social [verified proof only]). Stable ids `<category>-<hookType>-<format>` shared by `adpack_angles`, `adpack_start {angleIds}` and `guide_bulk_angles` (`adpackAngleId` / `adpackAngle` per board item → `adpack_start {angles}`). Unusable ids are an error listing each one; guide angles the facts cannot back are adapted (count kept).
- **Clichés**: `cliches.ts` blocklist → `cliche` copy issue (repairable), banned in prompts and planner frames.
- **creativeFreedom** `high` (default with only brand/offer) / `guided`; every ad reports `{angleId, category, hookType, rationale, layoutFamily}` in start, status rows and the deliverable.
- **Layout families** (render/README.md): 7 families, rotation ≤ 2 per 10, Style DNA families when `styleDnaId` is given, `layoutFamily` to force one; `productBox` respected.
- **Brand fonts**: kit font loaded at render time (bundled → cache → Google Fonts), Space Grotesk via `scripts/adpack-vendor-fonts.mjs` for offline bundling.
- **Style DNA**: `styleDnaId` → `style-profile.ts` (visionJson once, stored as `analysis` inside the kit's `style_dnas` jsonb entry — no migration) → families, copy density, type weight, CTA emphasis. References are never sent to the scene model.
- **Variations** 1–3 per angle: same copy (written once), different scene/composition/family; quote = ads × variations; `expectedAds` makes start refuse a plan that differs from the approval.
- **guide_bulk_angles**: full hooks (`hook`), 1 h cache per brand+offer+count+language (memory + optional store), 12 s model budget then the deterministic catalog board (`source: 'planner'`, `refining: true`, late model board fills the cache).
