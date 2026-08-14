---
name: advance-ai
description: >-
  Navigate and modify the Advance AI (copywrite-ai) SaaS codebase — React/Vite
  frontend, Vercel serverless API, Supabase, Grok/Gemini AI pipelines for
  guiones, posts, descriptions, and respuestas. Use when working in this repo,
  on script generation, image generation, billing, Supabase data layer, or
  when the user mentions Advance AI, Copywrite, guiones, or this project.
---

# Advance AI Codebase Skill

Read [AGENTS.md](../../AGENTS.md) first for orientation. Use this skill for task-specific workflows.

## Task routing

| User intent | Start here | Then |
|-------------|-----------|------|
| Script generation / guiones quality | `api/lib/guiones/script-pipeline.ts` | [guiones-pipeline.md](reference/guiones-pipeline.md) |
| Script UI / settings | `src/pages/ProductWorkspace.tsx` | `ScriptSettingsPanel.tsx`, `grokApi.ts` |
| New API endpoint | `api/lib/auth.ts` pattern | [api-routes.md](reference/api-routes.md) |
| Database CRUD | `src/services/database.ts` | [database.md](reference/database.md) |
| New page/route | `src/App.tsx` | Lazy-load pattern, `ProtectedRoute` |
| Image/carousel posts | `api/generate-image.ts`, `generate-carousel.ts` | `PostWorkspace.tsx` |
| Billing/plans | `api/tilopay/*`, `api/lib/auth.ts` | `Settings.tsx`, `useUsageLimits.ts` |
| User-facing release notes | `src/data/changelog.ts` | [changelog-protocol.md](reference/changelog-protocol.md) |
| Dev/agent notes | `docs/agent/CHANGELOG.md` | Same protocol |

## Common workflows

### Add or modify a guiones pipeline stage

1. Read current flow in `api/lib/guiones/script-pipeline.ts`
2. Types live in `api/lib/guiones/types.ts`
3. Tests in `test/*.spec.ts` (context-profile, brief-selection, quality-gate)
4. Run `npm test` after changes
5. Log entry in `docs/agent/CHANGELOG.md`

### Add a new API route

1. Create `api/my-route.ts` (one file = one route)
2. Import auth: `requireAuth`, `checkUsageLimit`, `incrementUsage` from `./lib/auth.js`
3. Import rate limit from `./lib/rate-limit.js` if AI-heavy
4. Log usage via `./lib/usage-logger.js`
5. Use `.js` extensions on all local imports
6. Add CORS headers matching existing routes
7. Set timeout in `vercel.json` if >30s

### Add frontend data operation

1. Add TypeScript type to `src/types/index.ts`
2. Add CRUD function to `src/services/database.ts` (single data layer)
3. Call from page/component — no direct Supabase calls outside `database.ts` or `src/lib/supabase.ts` auth

### Ship a user-visible feature

1. Implement + test
2. Bump `version` in `package.json` if releasing
3. Add entry to top of `CHANGELOG` in `src/data/changelog.ts` (user-facing, non-technical)
4. Add technical entry to `docs/agent/CHANGELOG.md`
5. Update `ROADMAP` in changelog.ts if applicable

## File map (high-signal)

```
api/
  chat.ts              # Main script/description endpoint (~1900 lines)
  lib/
    auth.ts            # JWT, plans, usage limits
    guiones/           # Structured pipeline modules
    brand-kit.ts       # Brand voice/visual injection
    memory-helpers.ts  # AI memory
  data/                # Prompt presets (image, organic, winning DNA)
  tilopay/             # Payments

src/
  pages/               # Route components (lazy-loaded in App.tsx)
  components/          # Forms (*Form.tsx), ScriptCard, modals
  services/
    database.ts        # ALL Supabase CRUD (~1760 lines)
    grokApi.ts         # Chat API client
    carouselApi.ts     # Carousel API client
  types/index.ts       # Domain model (~900 lines)
  data/changelog.ts    # User-facing changelog + roadmap
```

## Product taxonomy (Ian methodology)

**Script types (sales):** `venta_directa`, `desvalidar_alternativas`, `mostrar_servicio`, `variedad_productos`, `paso_a_paso`, `reconocimiento`

**Organic types:** `educativo`, `storytelling`, `tendencia`, `engagement`

**Product types:** `product`, `service`, `restaurant`, `real_estate`, `indumentaria`

**Sales channels:** `physical`, `messages`, `website`

**Buyer stage:** `cold`, `warm`, `hot`

## Pitfalls

- `README.md` and parts of `PROGRESS.md` describe removed features (B-Roll, chat interview)
- `supabase/` migrations are gitignored — don't assume files exist locally
- Dev requires **both** `npm run dev` and `npm run dev:vercel` for full API testing
- `api/chat.ts` has legacy monolithic prompt path alongside structured pipeline — check which path is hit
- No ESLint configured; `npm run lint` does not exist

## Reference docs

- [architecture.md](reference/architecture.md)
- [api-routes.md](reference/api-routes.md)
- [database.md](reference/database.md)
- [guiones-pipeline.md](reference/guiones-pipeline.md)
- [changelog-protocol.md](reference/changelog-protocol.md)
