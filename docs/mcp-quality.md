# MCP ad quality — what broke, what we kept, the rules (MCP 0.26.0)

Branch `fix/mcp-quality` (from `loop/round1-ad-quality` @ 68a79ed = MCP 0.25.0). Commits: **part A** (generation), **part B**
(reference gate, preflight), **part C** (docs), **part D** (owner decisions + review fixes: no approval step, price never
required, the one retry charged only if it runs, at most one automatic retry per ad everywhere, paid calls always logged).

> **Deploy.** No migration is required. `supabase/migrations/086_product_images_asset_role.sql` is OPTIONAL (adds
> `product_images.asset_role` for `set_asset_role`); without it roles are inferred and nothing blocks. The runtime image no longer
> needs `tesseract-ocr` (removed from the `Dockerfile`).

## 1. What broke (rounds 0.15 → 0.25)

Up to Oct 9 the MCP ads were good. They came from the web flow: the **model designed the whole ad** — scene, composition,
typography and the copy rendered in-image — from the art-director brief, with the **real product photos as references**.
An automated improvement loop (0.15 → 0.25) then moved more and more of the ad into code:

| Round | Change | Effect |
|---|---|---|
| 0.15 | MCP image = web Grok flow, `productFidelity` default `generated` | good — the parity baseline |
| 0.16–0.18 | binding scene, strict props, safe-zone margins, one CTA, QA auto-retry, accessory slots | mostly good (kept) |
| 0.19 | **scene-only generation**: the model may draw NO text / logo / button; code pastes headline, price, facts, CTA, logo | small product, dead bands, templated look |
| 0.20 | "product in the lower 60–65 %, nothing in the top 18 % / bottom 16 %", seam blending, make-room canvas extension | more dead space; the picture moved / shrank |
| 0.21–0.22 | scale-in rules, CTA never dropped, tesseract pack OCR, packs default to `exact` | slow (10–25 s OCR), false OCR fails |
| 0.23 | one misspelled pack word = fail → **forced** regeneration → **automatic exact fallback** | up to 3 paid calls per image, not in the quote |
| 0.24 | fidelity < 0.7 → **forced** regeneration → exact fallback; `withProviderRetry` around the whole exact run | worst case ~9+ paid calls charged as 1 credit; earlier attempts unlogged (`runExact` overwrote the cost) |
| 0.25 | CTA shrinks the picture to 60 %, role guessed from request text, exact fallback at the generated scale | a "hélice"/"cable" word turned the hero into a part; smaller products |

Root causes: (1) the model was forbidden to design the ad, so code had to; every heuristic patch made the next defect; (2) the kit's
site-analysis images were silently added as PRODUCT references; (3) checks that were meant as warnings fed a severity that forced
paid retries and fallbacks.

## 2. Per feature — removed / kept / simplified

| Feature | 0.26.0 | Why |
|---|---|---|
| Model designs the whole ad (`compositeLayers:false`) | **default** | the winning recipe; web parity |
| Scene-only + code layout (`compositeLayers:true`: layout-ad, compose-scene, scene-prep, extendCanvas, CTA slot search, props / seam / cable / wood-grain heuristics) | **opt-in only** | kept reachable for explicit callers; never on the default path |
| "SOLO ESCENA / bands / 60–65 % / 18 % / 16 %" prompt rules | **removed from the default prompt** | they forbade the model from designing the ad |
| Instagram safe-zone margins, ONE CTA, layout cap, binding scene, strict props, PRODUCT LOCK | **kept** (default prompt) | real improvements |
| Offer lock block | **moved to the prompt head** | the clamp kept the copy tail and could cut the lock; now the lock always survives |
| Pack attributes ("bolsa azul…") treated as accessories ("do not draw") | **fixed** | for packs the packaging IS the product |
| Kit `referenceImages` appended as product refs | **removed** | confirmed product image ids only |
| `roleFromRequestText` | **removed** | role comes from the role column / tags / label only |
| Pack OCR (tesseract) | **deleted** (`pack-ocr.ts`, Dockerfile) | slow, false positives, only fed forced retries |
| Forced retries (pack text, fidelity) | **removed** | — |
| Auto retry | **max ONE, only with explicit `autoRetry:true`**, shown in the approval as a possible +1 image credit, **charged only if it runs** (and skipped when the user cannot afford it) | cost control |
| generated → exact automatic fallback (pack and fidelity) | **removed** | hidden paid calls |
| `withProviderRetry` around the whole exact pipeline | **removed** | provider retry stays on single HTTP calls only |
| `productFidelity:"exact"` | **explicit opt-in, non-pack products only** | — |
| `productFidelity` for printed packs | **deprecated / ignored** (note in the result) | replaced by the real-pixel swap (§5) |
| Fidelity check (feature match) | **kept as a warning only** | never fails, retries or changes charges |
| Code stamps the real logo / price | **opt-in** `stampLogo` / `stampPrice`; automatic logo stamp only for a vector logo (cannot be a ref) | the model places the logo it receives as a reference |
| Claims filter, copy facts, `fetchPublicImageDetailed` hard error on a dead confirmed ref, rehost, strict flood cut-out recall | **kept** | — |
| Cost logging | **one `api_usage_logs` row per paid call** (`paidCalls` in the result), also when the job fails afterwards (`success:false`) | quote = real cost |

## 3. The winning recipe (default path)

1. Web art-director brief (`buildSlimGrokPostPrompt`: mode, density, "copy the user text EXACTLY", PRODUCT LOCK contract, scene
   recipe, logo stamp rule, list price, palette, voice) + the MCP head rules (8 % Instagram margins, ONE CTA with the exact text,
   clean layout, strict props, offer lock).
2. The **confirmed (or automatically picked) real product photos** as `/images/edits` references (PRODUCT LOCK), varied: hero + another
   angle / packaging (+ a lifestyle / b-roll context as a scene ref), and the **kit logo as a reference**.
3. One Grok Imagine call at 2k. No code layers. Free local QA + a warning-only fidelity check.
4. The web request stays byte-identical for `mcpRules:false` (`test/web-mcp-parity.spec.ts`).

## 4. Reference rules (part B)

**Gate** (`api/lib/mcp/reference-gate.ts`, all thresholds in `REFERENCE_GATE_CONFIG`, evaluated before any charge):

| Check | Result |
|---|---|
| long side < 1600 px (`MIN_LONG_SIDE`) | accepted + warning; upscaled for free before generation (deterministic Lanczos + edge-aware unsharp, ≤ 2×, verified by SSIM / silhouette, never redrawn) |
| long side < 1080 px (`VERY_LOW_LONG_SIDE`) | same, stronger warning / penalty |
| heavy compression (JPEG quality from the DQT table < 60, or < 0.06 B/px; WebP < 0.03 B/px) | accepted + warning |
| screenshot (phone / desktop screen size + flat status / nav bar) | accepted + warning |
| burned-in text / logo, AI render with fake text (one Gemini 2.5 Flash vision call, cached in `product_images.quality.gate` by content hash) | accepted + warning |
| 404 / unreachable, not an image | **hard error** (refused before charging) |
| duplicate (same sha256 or dHash distance ≤ 5 within the request) | silently dropped |

Warning text: *"Foto de baja calidad: los resultados pueden salir peores. Subí una foto más grande y nítida para mejores anuncios."*
(EN: *"Low-quality photo: results may come out worse…"*). `aiUpscale` is **not** implemented: the gateway has no upscaler
(TODO if one is added — it must stay an explicit, quoted opt-in).

**Roles:** `product | b-roll | unboxing | lifestyle | packaging | logo` (`product_images.asset_role`, `set_asset_role`); when null
they are inferred (box → packaging, contents → unboxing, in-use / context → lifestyle, else product).

**No approval step (part D, owner decision):** every real product / context photo of the brand can be a reference; generated
images never are. (The `approved` flag, `approve_asset` / `unapprove_asset` and the approval trigger were removed.)

**Varied refs:** confirmed ids → exactly those; none → automatic pick, best quality first: hero product (primary first; for packs a
packaging photo, then unboxing, is a valid hero) + another angle / packaging + one lifestyle / b-roll, within Grok's 3-ref asset
budget (the logo rides as an extra style ref). The ranking uses only local, deterministic signals (size, local compression /
screenshot checks) — never the vision verdict — so the quote call and the approved call always pick the same refs.

**Duplicates:** identical bytes (sha256) or a dHash distance ≤ 1 bit; the hero / primary photo is never dropped (`protect`).

**`list_assets`** reads stored data only (`quality` metrics + the cached `quality.gate` verdict): no download, no model call.
The vision verdict is cached on every execute path (single image, bulk, campaign, ad pack).

**Preflight** (`adpack_preflight`, free; also run inside the execute tools and `adpack_start` before quoting):

| Item | Points | Essential |
|---|---|---|
| downloadable product photo (product, packaging or unboxing) | 35 | yes |
| offer / product name | 15 | yes |
| brief / copy / scene / offer description | 20 | yes |
| reference quality (minus gate penalties) | 12 | no |
| reference variety (angle / packaging, lifestyle / b-roll) | 6 | no |
| brand kit (logo 4, colours 2, fonts 2) | 8 | no |
| CTA / contact line | 4 | no |

Block below **70** (`PREFLIGHT_MIN_SCORE`). With every essential present the score is ≥ 70, so **low photo quality alone never
blocks**; a missing essential caps the score below 70 and the tool refuses before charging with an actionable message
(`import_image` a ≥ 1600 px photo, `update_offer {name}`, pass a copy / brief).

**Price (part D, owner decision):** never required, never scored. A price is used / rendered only when the script / copy the post
is generated from contains one: the MCP prompt drops the offer's "list price" line otherwise, and the fallback copy (no copy given)
is the offer name alone.

Brand-kit reference uploads from the web app keep their resolution now (`compressBrandReferenceImage`: ≤ 2560 px, WebP q0.9, or
JPEG q0.9 where the browser cannot encode WebP, output size checked against a 9 MB cap; it was 1024 px, which made every kit
reference fail the 1600 px rule). Logos stay at 512 px.

## 5. Cost / retry policy

- **At most ONE automatic retry per ad, everywhere**, disclosed in the quote / approval as a possible extra charge, and **charged
  only if it runs**:
  - `execute_image_generate`: only with `autoRetry:true`; the approval shows `possibleExtraGeneration {extraCredits, maxCredits,
    chargedOnlyIfRuns}`; the retry runs only if the user can afford 2 image credits; charged as `units: 2` on the same generation
    id when it ran (`autoRetryCharge` in the result). Exact mode (explicit opt-in): one plate by default; with `autoRetry:true` one
    more plate may run (same rule). `maxPlateRetries` defaults to 0 in the pipeline (was 2).
  - Bulk posts / campaign pack: no automatic retry (`maxPlateRetries: 0`).
  - Ad pack: `MAX_SCENE_RETRIES = 0` (was 2) and `MAX_AUTO_RETRIES = 1` (was 2) — one item-level retry per ad in total (scene
    re-run with the corrective hint, copy rewrite, or ONE ratio re-plate). A scene / ratio re-plate retry is charged +1 image credit
    when the ad ships (second generation id); a copy rewrite is a text call (not charged); a failed ad is never charged. The quote
    carries `possibleExtraCredits {perAd, max, chargedOnlyIfRuns}` and the approval text says it.
- No check (fidelity, pack print, props, seams) can force a paid call. No automatic exact fallback.
- Every paid call is logged, also when the job fails later (web path: calls are pushed to a sink as they run; exact: gateway
  ledger in `finally`; persist failures: logged before the error propagates; bulk: per-post catch).
- Every paid call → its own `api_usage_logs` row (`metadata.paidCall {index, of, purpose, provider}`, `costOverrideUsd`); the
  result lists `paidCalls`. Admin usage attributes the credits of one `generation_id` once.
- Vision classification of a new reference (cents): once per content hash, logged as `feature:"mcp_tool"`.

## 6. Printed packs — real-pixel swap

`api/lib/mcp/pack-swap.ts`. For a pack / pouch / box offer (product-kind heuristics): the model designs the whole ad with the real
pack photo as the reference; then the free fidelity check locates the pack (feature match). If the location is **confident** and
the located box has the same shape as the real cut-out (aspect within 35 %), the real cut-out (in-process cut-out cache; local flood
first, one Gemini segmentation only if the flood fails) is scaled to cover the redrawn pack and composited with the existing
harmonize stage (light model, white balance / grade, contact shadow, light wrap, grain). The rest of the ad is not regraded.
Otherwise the generated image is kept and `packSwap.reason` / a QA warning says why. Never another generation; no extra charge.

## 7. Known limitations

- The swap needs a confident feature match; a pack shown from another side is kept as generated (warning).
- The screenshot heuristic is size + flat bars; the vision verdict covers the rest when a Gemini key is configured.
