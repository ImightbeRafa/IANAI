# Guiones Pipeline Reference

## Two generation paths in `/api/chat`

1. **Structured pipeline** (preferred): `runGuionesStructuredPipeline()` in `api/lib/guiones/script-pipeline.ts`
2. **Legacy monolith**: large prompt concatenation in `api/chat.ts` when structured context unavailable

Always check which path is triggered before modifying prompt behavior.

## Structured pipeline stages

```
1. buildScriptContextProfile     → normalize business/product facts (local)
2. generateAngleInventory        → AI (grok-4.5 efficient): compact angle candidates
3. selectScriptBriefs            → pick diverse briefs per requested types (local, language-aware)
4. draftScriptsFromBriefs        → AI (grok-4.6): generate scripts from locked briefs
5. evaluateScriptBatch           → quality gate scoring (local)
6. repairFailedScripts           → soft fact inject + scrub EN scaffold leaks (local)
7. renderScriptsAsText           → format output for frontend parser
```

Latency notes (PR D): angle inventory size is `min(max(n*2, n+2), 12)` (was `max(n*3, 8)`);
prompts use compact JSON; angle call omits full type lenses and caps memory/templates at 400 chars.
`_debug.timings` reports `anglesMs` / `draftMs` / `totalMs`.

Supporting modules:
- `script-prompts/category-lenses.ts` — per product type (product, service, restaurant, etc.)
- `script-prompts/type-lenses.ts` — per script type (venta_directa, educativo, etc.)
- `script-memory.ts` — inject AI memory + saved templates
- `script-quality.ts` — evaluation + repair logic

## Frontend flow

```
ProductWorkspace.tsx
  → ScriptSettingsPanel (count, mode, types, CTA strength, model)
  → handleGenerateScript() builds user message
  → grokApi.sendMessageToGrok()
  → POST /api/chat
  → scriptParser.ts parses response
  → ScriptCard.tsx renders each script
  → database.saveScript() persists
```

## Script settings modes

- **Mixed:** N scripts across varied types
- **By type:** explicit count per script type
- **Organic-only / reconocimiento-only:** special frontend message text

## Quality tuning

Tests cover pipeline logic:
- `test/context-profile.spec.ts`
- `test/brief-selection.spec.ts`
- `test/quality-gate.spec.ts`

Run: `npm test`

## Known issues (from GUIONES_PIPELINE_REVIEW.md)

- Legacy path stacks 12+ prompt layers with overlapping rules
- Category behavior inconsistent between bespoke and shared prompts
- Model repeats hooks/angles without explicit planning step in legacy path
- Structured pipeline addresses this but legacy fallback still exists

## Related endpoints

- `/api/edit-script` — modify existing script
- `/api/streamline-script` — optimize for post generation
