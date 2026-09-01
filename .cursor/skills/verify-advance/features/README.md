# Advance AI chat-shell verification map

This directory is the maintained source for verifying the **web chat-shell** at `/chat` (Advance AI / IANAI). Classic `/posts` and `/scripts` are a different product surface — do not treat them as proof of chat-shell.

## Baseline preconditions

- Surface is `/chat` on the PR #35 Preview stack unless `ADVANCE_VERIFY_BASE_URL` points elsewhere.
- Default Preview URL is the `ianai-git-cursor-chat-shell-prod-*` deployment for branch `cursor/chat-shell-prod-review-2f38`.
- Local SPA alternative: `npm run dev` on port `5173` (auth still talks to AIIAN). AI generation needs `npm run dev:vercel` and is out of scope for these three features.
- Credentials live only in env: `ADVANCE_VERIFY_EMAIL` / `ADVANCE_VERIFY_PASSWORD` (invited) and optionally `ADVANCE_VERIFY_UNINVITED_EMAIL` / `ADVANCE_VERIFY_UNINVITED_PASSWORD`. Never put secrets in this map.
- Run `node .cursor/skills/verify-advance/helpers/verify-advance.mjs doctor` and require a healthy instance owned by this run.
- Never grant `chat_beta_access`, never flip `chat_shell`, never gift credits, never run live AIIAN SQL, never delete kits/brands/sessions.

## Driving conventions

- Start every recipe from the named preconditions.
- Prefer ARIA roles and accessible names (`Iniciar sesión`, `Un chat para todo`, `Guiones`, `Pack`, `Primero el kit`) over coordinates.
- Language: set `localStorage.ai-language` to `es` before login unless the feature says otherwise.
- Treat quoted labels as literal.
- Restore nothing that would wipe user kits. Cleanup tears down the instance this run started, not product data.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes a screenshot with shell identity visible (sidebar brand and/or gate card).
- Gate proof includes the visible title **and** the unauthenticated `/api/chat-shell-open` status.
- Record the feature ID with every artifact.
- Report an unreachable path with the unmet precondition. Do not report a skipped entry as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph, then exactly four H2 sections: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-advance`, `Gotchas`.

## Features

- [Invited first `/chat` tour](./invited-first-chat-tour.md) — tour “Un chat para todo”, skip persists, existing kits stay.
- [After-skip chrome](./after-skip-chrome.md) — header matches the selected session; glass Guiones/Post/Foto/Pack; incomplete kit named Falta + disabled Primero el kit; Pack fully readable.
- [Uninvited `/chat` gate](./uninvited-chat-gate.md) — Chat es por invitación / 403. The skill must not grant invites.
