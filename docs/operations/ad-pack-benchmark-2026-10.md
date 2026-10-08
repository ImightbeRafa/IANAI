# Ad Pack engine — live benchmark (2026-10-07/08)

Script: `npx tsx scripts/adpack-bench.ts --env-file <.env> [--steps A,B,C,D] [--offers …] [--copy-offers …]`
(real `createModelGateway` + `withCostLedger`, `createMemoryPackStore`, `createDefaultRenderer`, local
file storage, no database). Generated images stay local under `%TEMP%\adpack-bench\` and are not committed.

> **Status: INCOMPLETE — blocked by the xAI account.** After $1.94 of benchmark spend (cap $8), every
> Grok call (text and image) started returning `403 permission-denied: … used all available credits or
> reached its monthly spending limit`. Copy, scenes and the judge all run on Grok, so the full 30-offer
> copy run, the 5 full packs and the post-tuning re-runs could not be executed. The numbers below are the
> **baseline** plus the one tuned ad that completed before the 403s. Re-run with credits:
> `npx tsx scripts/adpack-bench.ts --env-file .env` (≈ $3–4 for all steps).

## Gates

| Gate | Target | Baseline (prod defaults) | After tuning |
|---|---|---|---|
| Facts guaranteed by checker | 100% (0 unconfirmed claims shipped) | **Pass** — 0/89 shipped ads with a fact/number issue; 11 caught, 10 repaired, 1 blocked | Not re-run (checker unchanged) |
| Copy rubric ≥ 7 | on ≥ 80% of ads | **Fail** — 0% (6 judged, grok-4.5 copy, mean 6.4); 33% (21 judged, fast copy model, mean 6.5) | Not measured (403) |
| Scene vision pass after ≤ 2 retries | ≥ 90% | **Pass** — 10/10 first try (but the checker passed 2 scenes with a blank label, see below) | 1/1 (stricter label rule) |
| Wall time per pack | ≤ 3 min | **Fail** — 311 s (copy ≈ 49–124 s per ad on grok-4.5) | Projected ≈ 1.5 min (copy 19 s on the tuned item) |
| Model cost per pack | ≤ $0.60 | **Fail** — $0.717 (copy $0.324, scenes $0.390, vision $0.003) | Projected ≈ $0.33 (tuned item: $0.032) |

Baseline = `beauty-serum` pack of 10 with the engine as committed in `05f555b` (copy on the gateway default
`grok-4.5`). "Projected" is per-item measured cost/time × 10 under concurrency 4, not a measured pack.

## Copy benchmark (Step B)

| Run | Ads generated | Pass `checkAdCopy` first try → after 1 repair | Shipped (no blocking issue) | Fact issues caught / repaired / blocked / shipped | Judge mean, ≥7 | Cost |
|---|---|---|---|---|---|---|
| grok-4.5 copy, 2 offers | 20 | 17 → 19 | 20 | 0 / 0 / 0 / 0 | 6.4, 0/6 | $0.70 |
| grok-4-1-fast-reasoning copy, 11 offers (9 completed) | 90 (20 lost to 403) | 30 → 68 | 89 | 11 / 10 / 1 / **0** | 6.5, 7/21 | $0.39 |

Initial issues by code (fast model, 90 ads): `too_long` 48 (bullets 37, cta 29 fields), `duplicate_message` 27,
`number_mismatch` 8, `unconfirmed_fact` 3. After repair: `duplicate_message` 20, `too_long` 2, `number_mismatch` 1
(blocked, not shipped). Judge criteria means (fast run): register 9.2, cold CTA 8.4, brevity 7.8, single message
6.7, tangible benefit 6.4, hook 5.5, faithful to facts 4.7, **no repetition 3.5**.

## Cost breakdown by stage (all runs, $1.94 total)

| Stage | Cost |
|---|---|
| A — 5 product packshots (Grok Imagine compose, 1k) | $0.10 |
| B — copy + repair + judge (grok-4.5 run) | $0.70 |
| B — copy + repair + judge (fast copy, grok-4.5 judge) | $0.39 |
| C — baseline pack (copy $0.32, scenes $0.39, vision $0.003) + aborted 2nd pack | $0.72 + ≈ $0.10 |
| C — tuned pack (1 item before 403) | $0.04 |

Per ad at baseline: copy ≈ $0.032 (grok-4.5 spends ~3.2k reasoning tokens), scene $0.03–0.04
($0.02 draft + $0.01 per reference image), vision ≈ $0.0003.

## Observed failure modes (looked at every render)

1. **Copy was the whole cost and time problem**: grok-4.5 took 49–124 s and ~$0.032 per ad. Same prompt on
   `grok-4-1-fast-reasoning`: ~9–19 s and ~$0.001.
2. **Text over the product**: `offer_graphic` / `how_to_steps` scenes put the bottle dead-center, so chips,
   step cards and the offer slab covered the label. The scene prompt never used `copySpaceHint`, and the
   9:16 → 1:1/4:5 center crop was not mentioned.
3. **Offer badge as a two-line slab**: "₡12.900 · 2 por ₡22.000 · Envíos a todo Costa Rica por Correos" on every ad.
4. **Blank labels passed the vision check**: 2/10 scenes lost the "ALBA" label and still scored 1.0.
5. **Monotony**: 6/10 ads were the same dark-green studio bottle (the style anchor was copied as a set).
6. **Copy repetition**: the same subline ("Niacinamida 5% y aloe vera" / "2 gotas de noche") in most ads; caption
   re-listing chips; customer phrases ("se absorbe rapidísimo…") turned into product claims (judge: unfaithful).
7. Fast model overshoots chip/CTA word limits (fixed by the single repair, +1 cheap call).
8. `before_after` at 9:16: the template splits top/bottom while the scene is left/right (scene follows 4:5).

## Changes made

- `copy-shared.ts` `ADPACK_COPY_MODEL = 'grok-4-1-fast-reasoning'` as the default for copy + repair (gateway default unchanged).
- `copy.ts`: `COPY_CRAFT_RULES` (headline = buyer situation, every field adds new info, concrete chips, subline =
  reason to believe); customer phrases marked as customer voice (quote, never a claim); "already used in this pack" list.
- `facts.ts`: offer badge budget 40 chars — drops plain shipping, then compare-at, then free shipping; price never dropped.
- `scene.ts` / `patterns.ts`: per-format `copySpaceHint` placement (4:5), crop-safe middle band, product ≥ ⅓ of
  the frame with label visible, anchor = grade only (not subject/background); `offer_graphic`/`how_to_steps` product on the right.
- `check-scene.ts`: blank/missing/rewritten label ⇒ `productMatches: false` (stricter, never looser).
- `score-copy.ts`: judge gets the real customer quotes so quoting them is not scored as invention.
- Deterministic fact/compliance checks: unchanged.

## Local output

- Baseline contact sheet: `%TEMP%\adpack-bench\baseline-packs\contact-beauty-serum.png`
- Tuned run (1/10 before 403): `%TEMP%\adpack-bench\tune1\contact-beauty-serum.png`
- Product photos: `%TEMP%\adpack-bench\products\*.png`; copy runs: `copy-before\copy-bench.json`; spend ledger: `spend.json`
