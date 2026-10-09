# Ad Pack render engine

Deterministic text-on-image ads: a text-free scene + `AdCopy` + brand visual → finished PNGs for
`1:1` (1080×1080), `4:5` (1080×1350) and `9:16` (1080×1920). Every on-image string comes from data,
so prices (₡), accents, ñ and ¿¡ are exact by construction.

```ts
import { renderAd, renderAdAllRatios } from './index.js'

const { png, layoutReport } = await renderAd({
  format: 'offer_graphic',          // any AdFormat
  ratio: '4:5',
  sceneImage: bytesOrDataUrlOrHttpsUrl,
  copy,                              // AdCopy (headline, subline, bullets, offerLine, cta)
  visual: dna.visual,                // colors, headingFont/bodyFont, logoUrl
  productCutout: cutoutPng,          // optional; used by offer_graphic / variant_card / explainer
  logo: logoBytes,                   // optional; overrides visual.logoUrl (no fetch)
  language: 'es',
})
const all = await renderAdAllRatios({ ...sameInputWithoutRatio })   // decodes assets once
```

`layoutReport` lists every text element actually drawn (exact string, lines, font, size, box,
color, background treatment, WCAG contrast) plus `fits`, `scale`, product/logo boxes, warnings,
`layoutFamily`, `placement`, `productBox` / `productBoxRespected` and the font resolution.

## Layout families (`families.ts`)

Seven visual systems, each implementing all 7 formats × 3 ratios with the same exact strings and
guarantees (safe zones, fit, ≥ 4.5:1 contrast, layoutReport). Pass `layoutFamily` (default
`bold_pill`, the original templates).

| Family | Look | Copy treatment |
|---|---|---|
| `bold_pill` | classic performance ad | white check pills, price badge, rounded CTA |
| `editorial_minimal` | magazine | big heading-face type, accent rule, hairline list, price as type, text-link CTA |
| `split_panel` | brand color block | solid primary panel (side, or bottom band), checks, full-width squared button |
| `full_bleed_type` | poster | huge headline over a deep dark scrim, inline facts, outline CTA |
| `badge_corner` | clean product shot | round price sticker, white spec strip, squared button |
| `framed_card` | inset photo | brand-color frame with rounded window, white card with checks + button |
| `ugc_native` | organic post | comment-reply bubble (logo avatar), caption box, stickers, link-sticker CTA |

`FAMILY_SPECS[f].sceneHint(format)` tells the scene prompt where to keep the product (scene.ts
uses it). The pack assigns families in `layout-plan.ts` (Style DNA families, or a rotation of ≤ 2
per family per 10 ads; variations of one angle always differ).

**One product-avoid path.** In exact mode (`productMode: 'exact'`) every family reserves its own
product slot on every format; the composite's placement of the real cut-out (hero + parts) IS the
product box — text, pills, cards and over-layer shapes stay off it (groups move to free zones,
then the product shrinks on its surface), and `layoutReport.productBox` = that placement.
In generated mode, **`productBox`** (fractions of the scene image, from the vision check bbox;
`productAvoid` corner form is accepted as an alias) is mapped through the same cover-fit; the renderer tries the family's placements (left/right/top/bottom, mirror) and then the
free regions around the box, and keeps text, cards, pills and panels off it (scrims/decor may
overlap). When no placement can, it renders the least-overlapping one and sets
`productBoxRespected: false` + a warning (e.g. a product filling the middle of a square).

## Pipeline

1. `sharp` cover-fits the scene to the canvas.
2. The format template (`templates.ts`) lays out pre-fitted text (`text.ts` measures with the same
   font files satori uses, shrinks until it fits 2–3 lines, balances lines) at a global type scale
   that steps down until nothing overflows the safe area.
3. Under layer (scrims, cards, dividers) is SVG → `@resvg/resvg-js`; product cut-out (+ soft shadow)
   and logo are composited with `sharp`.
4. Contrast: each on-scene text box is sampled on that composite (95th/5th-percentile luminance) and
   the scrim is strengthened until headline/subline reach ≥ 4.5:1. Very busy backgrounds get a panel.
   Pills (CTA/offer) swap fill if they blend into the scene.
5. Over layer: pills/icons as SVG + text as glyph paths from `satori`, rasterized by resvg.

Safe areas: 9:16 keeps text out of the top 14% and bottom 20% (Meta Stories/Reels); feed ratios use
a 60 px margin. `copySpaceHint(format, ratio)` tells the scene prompt where to leave empty space.

## Fonts

The kit's heading/body fonts are used when available (`font-resolver.ts`, `ensureBrandFonts`):
uploaded kit font (`visual.headingFontUrl` / `bodyFontUrl`, TTF/OTF) → registered (bundled,
vendored, fetched earlier) → disk cache `<os tmp>/adpack-fonts` → Google Fonts by name (CSS2 API
with a legacy UA that returns static TTFs, then google/fonts GitHub static TTFs). Timeouts 5 s per
request / 9 s total, failures negative-cached 15 min, never throws. Network only when a `fetch` is
passed: the production adapter passes global fetch (`ADPACK_FONT_FETCH=0` disables it); tests use
fixtures + fake fetch. Glyph coverage (₡, accents, ¿¡, ñ) is reported per role; missing glyphs are
drawn with Fira Sans per glyph. Without the brand face, the closest bundled family is used
(e.g. any "Grotesk" → Fira Sans, never the rounded default).

Vendoring an OFL family into the bundle (so it works offline):
`node scripts/adpack-vendor-fonts.mjs "Family Name"` downloads it from the google/fonts GitHub
repo (static TTFs, or the variable font instanced locally to 400/700 with fontTools) + OFL.txt
into `fonts/`; any extra TTF there is registered under its own family name. Space Grotesk was
vendored this way and is listed in the `fonts.ts` manifest (a bundled system font).

### Bundled (OFL, in `fonts/`)

| Family | Weights | Used for |
|---|---|---|
| Poppins | 400 / 700 / 800 | default heading + body; geometric brand fonts (Montserrat, Futura, DM Sans…) |
| Fira Sans | 400 / 700 / 800 | humanist/neo-grotesk brands (Inter, Roboto, Helvetica…) and **glyph fallback** (₡ etc.) |
| Archivo Black | 400 | heavy display brands |
| Anton | 400 | condensed display brands (Bebas, Oswald, Impact…) |
| DM Serif Display | 400 | serif brands (Playfair, Lora, Georgia…) — headings only; body falls back to Fira Sans |
| Space Grotesk | 400 / 700 | brands whose kit names Space Grotesk (exact match, no fetch; has its own ₡) |

`resolveFonts(visual)` maps brand font names to these families (default Poppins). Licenses:
`fonts/*-OFL.txt`. Source: github.com/google/fonts (static TTFs).

## Deployment notes

- Fonts are read from disk with literal `new URL('./fonts/<file>.ttf', import.meta.url)` paths so
  Vercel's file tracing bundles them. If a function ever misses them, add
  `"includeFiles": "api/lib/adpack/render/fonts/**"` to that function in `vercel.json`.
- **Cloudflare container**: `scripts/build-api.mjs` compiles `api/` → `dist-api/` and copies
  `api/lib/adpack/render/fonts/**` to `dist-api/lib/adpack/render/fonts/`, so no `ADPACK_FONTS_DIR`
  is needed. The Dockerfile renders one ad from `dist-api` at build time
  (`scripts/adpack-render-smoke.mjs`) and fails the image if fonts or native bindings are missing.
- Native deps: `sharp` and `@resvg/resvg-js` (prebuilt `win32-x64-msvc`, `linux-x64-gnu` for Vercel
  and `node:22-slim`, `linux-x64-musl` for Alpine). `satori` ships HarfBuzz as WASM (`harfbuzzjs/hb.wasm`);
  keep `node_modules/harfbuzzjs` intact when pruning.
- No network at render time except fetching an http(s) `sceneImage`/`productCutout`/`logo` you pass.

## QA

`npx tsx scripts/adpack-render-samples.ts [outDir]` renders all formats × ratios (plus stress cases)
with synthetic scenes into `<os tmp>/adpack-render-samples` (PNG + layout JSON).
`npx tsx scripts/adpack-layouts-qa.ts [outDir] [--families a,b] [--formats x,y]` renders every
family × format × ratio into `<os tmp>/adpack-layouts-qa` plus one contact sheet per family
(`_sheet_<family>.png`).
