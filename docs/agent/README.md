# Agent Context Documentation

This folder holds **developer/agent-facing** documentation. End users never see these files.

## Context structure

```
AGENTS.md                          ← Start here (root entry point)
.cursor/
  skills/advance-ai/
    SKILL.md                       ← Task routing + workflows
    reference/                     ← Deep dives (architecture, API, DB, pipeline)
  rules/                           ← Auto-applied Cursor rules
docs/agent/
  CHANGELOG.md                     ← Technical dev changelog (this folder)
  README.md                        ← This file
src/data/changelog.ts              ← User-facing changelog (in-app)
```

## For AI agents

1. Read `AGENTS.md` at session start
2. Follow `.cursor/skills/advance-ai/SKILL.md` for task-specific workflows
3. Pull reference docs only when needed (progressive disclosure)
4. After meaningful changes, append to `CHANGELOG.md` in this folder
5. For user-visible releases, also update `src/data/changelog.ts`

## Stale root docs (use with caution)

| File | Trust level |
|------|-------------|
| `AGENTS.md` | High — maintained for agents |
| `docs/agent/CHANGELOG.md` | High — maintained for agents |
| `.cursor/skills/advance-ai/` | High |
| `GUIONES_PIPELINE_REVIEW.md` | High for pipeline analysis |
| `CODEBASE_STATUS.md` | Medium — good schema, Feb 2025 |
| `SECURITY_AUDIT.md` | Medium — Feb 2026, some fixes since |
| `PROGRESS.md` | Low — contains removed B-Roll/video features |
| `README.md` | Low — describes deprecated chat interview flow |

## Changelog protocol

See `.cursor/skills/advance-ai/reference/changelog-protocol.md`
