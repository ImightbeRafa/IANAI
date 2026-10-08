# Ad Pack engine — live benchmark (2026-10-07/08)

Script: `npx tsx scripts/adpack-bench.ts --env-file <.env> [--steps A,B,C,D|R] [--offers …] [--copy-offers …]
[--judge-model m] [--judge-calibrate m --calibrate-per-offer n] [--from <out dir>]`
(real `createModelGateway` + `withCostLedger`, `createMemoryPackStore`, `createDefaultRenderer`, local
file storage, no database). Step `R` re-renders saved scenes with the current templates at $0. Generated
images stay local under `%TEMP%\adpack-bench\` and are not committed.

> **Status: gates partly met, run cut short again by xAI.** Second session (2026-10-08): $4.52 of benchmark
> spend (cap $6), then every Grok call returned `403 permission-denied … used all available credits or reached
> its monthly spending limit` (copy and scenes). The full-30-offer copy re-run with the final code and the 4th/5th
> pack categories did not complete. Numbers below are what was measured; nothing is projected.

## Gates — before → after

| Gate | Target | Baseline (session 1, prod defaults) | Session-1 tuning, measured now (r2) | Final code (r3 / pilot) | Verdict |
|---|---|---|---|---|---|
| Copy rubric ≥ 7 | ≥ 80% of judged ads | 0% (6, grok-4.5 copy) · 33% (21, fast copy) | **50%** (45/90, grok-4.5 judge, 30 offers, mean 6.90) · 33% (30/90) with the fast judge | **67%** (20/30, fast judge, 10 offers, mean 7.15) — same 10 offers at r2: 33% fast / 53% grok-4.5. Final code partial (403): 7/9 fast | **Fail** |
| Facts: 0 shipped ads with unconfirmed fact / number mismatch | 0 | 0 shipped (11 caught) | 0 shipped of 299 (42 caught, 42 repaired, 1 blocked) | 0 shipped of 100 (11 caught, 11 repaired); packs: 0 | **Pass** (checker unchanged) |
| Scene vision pass after ≤ 2 retries | ≥ 90% | 10/10 (but blank labels passed) | 30/30 (but missed letterboxing and wrong settings) | **29/30** (96.7%); first try 23/30; stricter check (blank label, borders) | **Pass** |
| Wall time, pack of 10 | ≤ 3 min | 311 s | 116–128 s (3 packs) | **107–127 s** (3 packs) | **Pass** (3 categories) |
| Model cost, pack of 10 | ≤ $0.60 | $0.717 | $0.408–0.449 | **$0.317–0.440** | **Pass** (3 categories) |
| Visual variety / badge / readability | not one look; short badge | 6/10 same dark-green studio; 2-line badge | 8/10 same backdrop; anchor garden cloned into a cleaner's whole pack; letterboxed scenes | settings rotate per format (studio color, light neutral, real place of use, color-block…); badge 1 line; step/explainer cards and badge kept off the label | **Improved**, see weaknesses |

Packs measured: `beauty-serum`, `food-coffee`, `home-cleaner` (beauty, food, home). `pets-bed` got 4/10 before the
403, `fitness-bands` 0/10 — the ≥ 4-category goal is not met.

Judge calibration (r2, same 90 ads): grok-4-1-fast-reasoning mean 6.45 vs grok-4.5 6.90, ≥7 on 30 vs 45,
pass/fail agreement 66%. The fast judge is **stricter**, never more lenient, so it was used for later runs
(grok-4.5 judging cost $0.0126/ad = $1.13 for 90 ads).

## Copy (Step B)

| Run | Ads | Pass check 1st try → after repair | Shipped | Initial issues | Judge (≥7) | Cost |
|---|---|---|---|---|---|---|
| r2: session-1 tuning, 30 offers | 300 | 98 → 256 | 299 | too_long 167, duplicate 65, number_mismatch 38, unconfirmed 4 | 4.5: 50% · fast: 33% | copy $0.43 ($0.0014/ad) + judges $1.14 |
| r3 pilot: final rules minus last 2 tweaks, 10 offers | 100 | 25 → 80 | 100 | duplicate 33, too_long 30, register 29 (new check), number 9, unconfirmed 2 | fast: 67% | copy $0.16 + judge $0.02 |

Judge criteria (fast judge, same 10 offers, r2 → r3): faithful to facts 8.2 → 9.0, brevity 6.2 → 7.7, CTA 7.4 → 8.3,
single message 4.9 → 6.1, hook 6.2 → 6.0, **no repetition 3.5 → 4.1**, tangible 7.5 → 7.8, register 7.8 → 8.0.
Top remaining judge reasons: caption restating chips/subline, hook "doesn't filter with price or proof in 3 s",
mixing two ideas (variants + logistics) in one ad.

## Packs (Step C, final code = r3)

| Pack | Done | Wall | Cost | Copy | Scenes | Vision | Retries | Avg per ad: copy / scene / check / render |
|---|---|---|---|---|---|---|---|---|
| home-cleaner | 9/10 (1 before_after product mismatch ×3) | 127 s | $0.440 | $0.014 | $0.420 | $0.005 | 4 | 15.9 / 22.2 / 2.2 / 1.0 s |
| beauty-serum | 10/10 | 112 s | $0.439 | $0.013 | $0.420 | $0.005 | 4 (borders) | 13.8 / 18.9 / 2.2 / 1.2 s |
| food-coffee | 10/10 | 107 s | $0.317 | $0.013 | $0.300 | $0.004 | 0 | 13.4 / 13.7 / 1.7 / 2.1 s |

Scenes are ~95% of pack cost ($0.03 each: $0.02 draft + $0.01 product ref; the style-anchor ref is gone).
Every retry costs another $0.03, so cost per pack = $0.31 + $0.03 × retries.

## Cost by stage (session 2, $4.52 total; session 1 was $1.94)

| Run | Stage | Cost |
|---|---|---|
| r2-copy-tuned | B copy + repair (300 ads) / judges (90 × grok-4.5 + 90 × fast) | $0.43 / $1.14 |
| r2-packs1 | C 3 packs (session-1 code + 9:16 before/after fix) | $1.27 |
| r3-copy-pilot | B 10 offers + fast judge | $0.18 |
| r3-packs | C 3 packs (final scene/template code) | $1.20 |
| r4 (403) | B 30 ads + C 4 ads before the cut-off | $0.31 |

## What I saw in the renders and what changed

1. **Anchor cloned the pack** (r2: 8/10 identical backdrops; the cleaner's first scene was a garden — category
   label "home garden" — and all 10 ads were in a garden, two letterboxed). → Style anchor **off by default**
   (`styleAnchor` opt-in), per-format **setting rotation** (`SCENE_SETTINGS`, Nth ad of a format gets the Nth
   setting), plain category label ("home and household") + offer name and one-liner in the prompt, setting-neutral
   `sceneIntent`s. Saves $0.01/scene and the anchor wait.
2. **70% of scene briefs were the generic fallback**: the sanitizer dropped any sentence mentioning "text"
   ("…, empty space for text"). → Clause-level sanitizing; copy prompt asks for 1–2 concrete visual sentences.
3. **Letterboxing/blank bars** passed the vision check → new `borders` flag in `checkScene` (regenerates).
4. **Text over the label**: 9:16 step cards were full width; explainer chips sat mid-frame; offer badge was 80% wide.
   → Cards 60–62% wide, explainer grid bottom-anchored, badge in the left column and one line preferred;
   scene hints put the product in the right third / above the card band.
5. **before_after 9:16**: template now splits left/right at every ratio (scene is one left/right image).
6. **"① 1. Limpiá"** double numbering → step bullets are stripped of leading numbers.
7. **Copy**: craft rules rewritten (one idea per ad around 1–2 focus facts; pains/desires/quotes describe the buyer,
   never product results; "What it is" is context; caption adds what the image doesn't say; vary headline
   structure, "No compres…" once). Deterministic, non-blocking checks that trigger the single repair: register drift
   (voseo in a tuteo/usted brand, quotes exempt), same two-word opener as another headline, caption restating a
   chip/subline verbatim. Chip/CTA length = content words (articles/connectors not counted) **plus** a 26-char cap,
   so verbatim confirmed facts ("Niacinamida 5% y aloe vera") stop triggering repairs. Customer quotes with numbers
   no fact backs are kept out of the prompt. CTA example follows the brand register. Planner rotates the focus fact.
8. Judge: told that the spoken `script` is a separate deliverable (criteria text already scoped repetition to
   headline/subline/chips/caption). Rubric otherwise unchanged; fact/compliance checks unchanged.

## Remaining weaknesses

- **Copy gate not met.** Best measured 67% ≥ 7 (fast judge, 10 offers). The last two copy changes (register-correct
  CTA example, caption-repeats-chip check) are measured only on 9 ads. Caption repetition and "hook doesn't filter"
  remain the main judge complaints; ~75% of ads still need the one repair call (adds ~10 s per ad).
- Scene retries are frequent (8 of 30 in r3, mostly `borders`); a retry costs $0.03. Not yet known whether the
  borders flag has false positives on split before/after images.
- before_after is the weakest format (1 failure ×3 attempts, product appears in the "before" half).
- Headlines still sometimes are product name + price ("Sérum Niacinamida ₡12.900") and the same chip
  ("Envíos por Correos") appears in many ads of a pack.
- Explainer scenes generated before the bottom-grid change still put the product low; needs a fresh run to verify.
- Only 3 categories measured end-to-end; services/education/finance packs never ran with images.

## Local output (absolute paths)

- Final contact sheets (final templates, re-rendered from r3/r4 scenes, $0):
  `C:\Users\Ryan\AppData\Local\Temp\adpack-bench\final-sheets\contact-beauty-serum.png`,
  `…\final-sheets\contact-food-coffee.png`, `…\final-sheets\contact-home-cleaner.png`, `…\final-sheets\contact-pets-bed.png` (4/10)
- As generated: `C:\Users\Ryan\AppData\Local\Temp\adpack-bench\r3-packs\contact-*.png`; before: `…\r2-packs1\contact-*.png`,
  `…\baseline-packs\contact-beauty-serum.png`
- Copy runs: `…\r2-copy-tuned\copy-bench.json`, `…\r3-copy-pilot\copy-bench.json`; spend ledger `…\adpack-bench\spend.json`
