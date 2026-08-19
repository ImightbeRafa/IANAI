# Agent Context Documentation

This folder holds **developer/agent-facing** documentation. End users never see these files.

## Context structure

```
AGENTS.md                          ← Start here (root entry point)
.cursor/
  skills/advance-ai/
    SKILL.md                       ← Task routing + workflows
    reference/                     ← Deep dives (architecture, API, DB, pipeline, chat-shell)
  rules/                           ← Auto-applied Cursor rules
docs/agent/
  CHANGELOG.md                     ← Technical dev changelog (this folder)
  README.md                        ← This file
docs/operations/
  chat-shell-production-transition.md  ← Rollout + production checklist
src/data/changelog.ts              ← User-facing changelog (in-app)
```

## For AI agents

1. Read `AGENTS.md` at session start
2. Follow `.cursor/skills/advance-ai/SKILL.md` for task-specific workflows
3. Pull reference docs only when needed (progressive disclosure)
   - Chat-shell: `.cursor/skills/advance-ai/reference/chat-shell.md`
4. After meaningful changes, append to `CHANGELOG.md` in this folder
5. For user-visible releases, also update `src/data/changelog.ts`

## Stale root docs (use with caution)

| File | Trust level |
|------|-------------|
| `AGENTS.md` | High — maintained for agents |
| `docs/agent/CHANGELOG.md` | High — maintained for agents |
| `.cursor/skills/advance-ai/` | High |
| `docs/operations/chat-shell-production-transition.md` | High — preview vs AIIAN cutover |
| `GUIONES_PIPELINE_REVIEW.md` | High for pipeline analysis |
| `CODEBASE_STATUS.md` | Medium — good schema, Feb 2025 |
| `SECURITY_AUDIT.md` | Medium — Feb 2026, some fixes since |
| `PROGRESS.md` | Low — contains removed B-Roll/video features |
| `README.md` | Low — describes deprecated chat interview flow |

## For other projects

Copy this shape; do not invent a second changelog or a parallel wiki.

1. Root `AGENTS.md` — how to run, env, and a pointer to the skill + surface map.
2. `.cursor/skills/<product>/SKILL.md` — task routing table (intent → start file → reference).
3. `.cursor/skills/<product>/reference/<surface>.md` — **Now / Architecture / Invariants / Persistence / File map / Test map / Next**.
4. `docs/agent/CHANGELOG.md` — agent notes after each meaningful PR.
5. One operations runbook if there is a production cutover.

Keep **Now / Next** current on every PR that changes the surface. That is the knowledge base. Future agents should update those sections instead of appending ad-hoc notes in chat.

## Changelog protocol

See `.cursor/skills/advance-ai/reference/changelog-protocol.md`
