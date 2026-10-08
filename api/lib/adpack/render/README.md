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
color, background treatment, WCAG contrast) plus `fits`, `scale`, product/logo boxes and warnings.

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

## Fonts (OFL, bundled in `fonts/`)

| Family | Weights | Used for |
|---|---|---|
| Poppins | 400 / 700 / 800 | default heading + body; geometric brand fonts (Montserrat, Futura, DM Sans…) |
| Fira Sans | 400 / 700 / 800 | humanist/neo-grotesk brands (Inter, Roboto, Helvetica…) and **glyph fallback** (₡ etc.) |
| Archivo Black | 400 | heavy display brands |
| Anton | 400 | condensed display brands (Bebas, Oswald, Impact…) |
| DM Serif Display | 400 | serif brands (Playfair, Lora, Georgia…) — headings only; body falls back to Fira Sans |

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
