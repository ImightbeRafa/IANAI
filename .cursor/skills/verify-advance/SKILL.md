---
name: verify-advance
description: >-
  Drive Advance AI (IANAI) chat-shell at /chat the way a user does: launch Preview
  or local Vite, doctor the instance, exercise tour / after-skip chrome / invite
  gate, and keep proof artifacts. Use when verifying chat-shell UX on the PR #35
  Preview stack or when asked to prove /chat behavior.
---

# Verify Advance AI chat-shell

Product is **Advance AI** (repo IANAI, package `copywrite-ai`). Primary surface is the **web chat-shell** at `/chat`, not classic `/posts` or `/scripts`.

You are writing for the next agent, cold. Follow this file, then the matching feature under `features/`.

Hard locks (every run):

- Do not merge. Do not open a second PR.
- Do not flip `chat_shell`, gift credits, or run live AIIAN SQL. Invite-all is already in code; do not grant `chat_beta_access`.
- Do not delete kits, brands, offers, or sessions.
- Do not put passwords, emails, tokens, or service-role keys in this skill, the feature map, or evidence notes. Use env/file **names** only.
- Unauthenticated `/chat` staying on login is a pass. A signed-in user seeing **Chat es por invitación** is a fail after cutover.

## Launch

Preferred target for PR #35 is **Preview** (already serves `/chat` + `/api/*`).

```bash
export ADVANCE_VERIFY_BASE_URL="${ADVANCE_VERIFY_BASE_URL:-https://ianai-git-cursor-chat-shell-prod-69817a-rafas-projects-3ea2e797.vercel.app}"
export ADVANCE_VERIFY_TARGET="${ADVANCE_VERIFY_TARGET:-preview}"
node .cursor/skills/verify-advance/helpers/verify-advance.mjs launch
```

Ready when the helper prints `READY url=<…>` and writes `/tmp/verify-advance/instance.json`. Preview launch starts **no** process.

Local SPA (auth still hits AIIAN; AI generation will 404 without `npm run dev:vercel`):

```bash
export ADVANCE_VERIFY_TARGET=local
node .cursor/skills/verify-advance/helpers/verify-advance.mjs launch
```

Ready when Vite logs `Local:` and `http://127.0.0.1:5173/` answers. Default port `5173`. If that port is already owned by something this run did not start, **refuse** (shared instance). Override port with `ADVANCE_VERIFY_PORT`.

Teardown is **Cleanup** below. Do not `pkill -f vite`.

Env names (never commit values):

| Name | Use |
|------|-----|
| `ADVANCE_VERIFY_BASE_URL` | Preview or local origin |
| `ADVANCE_VERIFY_TARGET` | `preview` or `local` |
| `ADVANCE_VERIFY_PORT` | Local Vite port (default `5173`) |
| `ADVANCE_VERIFY_EMAIL` / `ADVANCE_VERIFY_PASSWORD` | QA sign-in (any signed-in AIIAN user when the kill switch is on) |
| `ADVANCE_VERIFY_UNINVITED_EMAIL` / `ADVANCE_VERIFY_UNINVITED_PASSWORD` | Optional extra account to prove invite-all (must **not** see invite copy) |
| `ADVANCE_VERIFY_PLAYWRIGHT` | Module path if `playwright` is not a repo dep |
| `ADVANCE_VERIFY_CHROME` | Chrome executable (Cloud Agent: `/usr/local/bin/google-chrome`) |

Vite picks up `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from the environment (no `.env` required in Cloud Agent).

## Doctor

Run first whenever anything looks off:

```bash
node .cursor/skills/verify-advance/helpers/verify-advance.mjs doctor
```

Pass only if all of these hold:

- `/tmp/verify-advance/instance.json` exists and `url` matches the origin we will drive.
- `GET {url}/` is HTTP 200.
- `GET {url}/login` is HTTP 200 and the SPA shell is present (`Advance AI` title, `#root`). Login copy hydrates in the browser; do not require `Iniciar sesión` in the raw HTML.
- `POST {url}/api/chat-shell-open` without `Authorization` is **401** (Preview) or connection-refused on local SPA-only (record as `api-absent`, still OK for UI-only features).
- For `local`, the recorded pid is still alive and owns `ADVANCE_VERIFY_PORT`.

Optional supporting tests (not a user-path proof): `npm test -- test/chat-shell-rollout.spec.ts test/chat-shell-tour-wizard.spec.tsx test/chat-shell-composer-create-dock.spec.tsx test/chat-shell-script-post-preview.spec.tsx`.

## Drive

Harness: Playwright against the launched origin. Playwright is **not** a package.json dependency; resolve `playwright` from `ADVANCE_VERIFY_PLAYWRIGHT` or the environment, then Chromium via `ADVANCE_VERIFY_CHROME` or Playwright’s browser.

```bash
node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive after-skip-chrome
node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive uninvited-chat-gate
node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive invited-first-chat-tour
node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive pack-qty
node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive close-sheet-on-generate
node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive pack-produces
node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive kit-refs-used
```

Stable handles (ES unless noted):

| UI | Handle |
|----|--------|
| Login | `#email`, `#password`, button `Iniciar sesión` |
| Language | `localStorage.ai-language = es` |
| Tour | `role=dialog` name `Un chat para todo`; skip `Saltar y no volver a mostrar` |
| Sidebar tour | `Cómo funciona` |
| Past thread | button `Quiero crear guiones` |
| Header | `.chat-shell__crumbs` |
| Falta chip | `.chat-shell__idle-kit-title` |
| Glass verbs | toolbar buttons `Guiones`, `Post`, `Foto`, `Pack` |
| Pack quantity | `#chat-shell-bulk-count`, buttons `Menos` / `Más` |
| Script post CTA | `.chat-shell__artifact-action` text `Primero el kit` / `Crear post` |
| Kill switch off | heading `Chat aún no está habilitado` (ops-only; do not flip the flag) |

Prefer those names over tab order. Feature recipes live in `features/`. Drive **one** mapped feature per prove-the-skill pass.

Isolation: Preview and local share AIIAN. Do not double-drive invited sessions. If `instance.json` is missing, run Launch first.

## Evidence

Proof directory (survives cleanup):

```text
.cursor/skills/verify-advance/evidence/runs/<run-id>/
```

Cloud copies may also be written to `/opt/cursor/artifacts/verify_advance_*`.

Standards:

- Exercise the real `/chat` user path (login, click, visible chrome). Do not call internal setters or seed SQL to fake kit state.
- Capture the action and the resulting state (before-click crumbs vs after-select crumbs; tour visible then gone).
- Side effects: skip persist = tour absent on reload; unauth API = 401 body. Do not assert kit rows via live SQL.
- Mocks only where production already isolates (Vitest unit files). Preview proof is the live SPA.
- Never write passwords into `notes.log`. Redact `Authorization` headers.

## Cleanup

```bash
node .cursor/skills/verify-advance/helpers/verify-advance.mjs cleanup
```

Kills **only** the pid recorded in `instance.json` (local Vite). Preview mode removes the instance file and leaves the deployment running. Never `pkill` by name. Never delete `evidence/runs/`. After cleanup, confirm the run folder still exists.

## Helpers

Executable CLI (invocation is the source of truth):

```bash
node .cursor/skills/verify-advance/helpers/verify-advance.mjs launch
node .cursor/skills/verify-advance/helpers/verify-advance.mjs doctor
node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive after-skip-chrome
node .cursor/skills/verify-advance/helpers/verify-advance.mjs cleanup
```

Script path: `.cursor/skills/verify-advance/helpers/verify-advance.mjs`.

Maintenance: `/maintain-verification-skill` when chat-shell chrome or gates change.
