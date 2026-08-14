# Changelog Protocol

Two changelogs, two audiences. Never mix them.

## 1. User-facing: `src/data/changelog.ts`

**Audience:** End users (shown in Settings → "Desde el Desarrollador")

**When to update:** User-visible releases only (new features, UX improvements, user-relevant fixes)

**Rules (from file header):**
1. NEVER include admin-only changes
2. NEVER expose security fixes in detail — use vague language like "General stability improvements"
3. Only list changes visible or meaningful to end users
4. Keep language simple, non-technical, benefit-oriented
5. Do NOT mention internal architecture, migrations, or RLS policies

**Format:**
```typescript
{
  version: '0.1.x',
  date: 'YYYY-MM-DD',
  items: [{
    category: 'feature' | 'fix' | 'improvement' | 'rework',
    text: { es: '...', en: '...' }
  }]
}
```

Add new entries at the **top** of `CHANGELOG` array.
Also update `ROADMAP` and `STATUS_ALERT` when relevant.

## 2. Agent/dev: `docs/agent/CHANGELOG.md`

**Audience:** Developers and AI agents

**When to update:** Any meaningful code change — refactors, new endpoints, pipeline changes, schema changes, breaking changes, deprecations

**Rules:**
1. Be technical and specific
2. Include file paths and architecture decisions
3. Note breaking changes explicitly
4. Reference related PRs/issues if known
5. Add entries at the **top** (newest first)

**Format:**
```markdown
## YYYY-MM-DD — Short title

**Area:** guiones | posts | api | frontend | billing | infra
**Files:** list of key files changed

- What changed and why
- Breaking changes (if any)
- Migration notes (if any)
```

## Version bumps

Bump `package.json` version for user-facing releases.
Current: `0.1.3`

## Stale docs to cross-reference (not replace)

| Doc | Status |
|-----|--------|
| `docs/agent/CHANGELOG.md` | **Current** — maintain this |
| `src/data/changelog.ts` | **Current** — user releases |
| `PROGRESS.md` | Partially stale (B-Roll, old architecture) |
| `CODEBASE_STATUS.md` | Feb 2025 — good schema reference, some drift |
| `README.md` | Stale — do not trust for current features |

When stale docs conflict with code, trust code + agent changelog.
