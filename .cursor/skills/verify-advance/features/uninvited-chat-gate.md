# Unauthenticated `/chat` gate (post invite-all)

After mass cutover, every **authenticated** user may open chat-shell when the kill switch is on. Unauthenticated `/chat` still goes to login. Unauthenticated `POST /api/chat-shell-open` stays **401**. This skill must not grant invites, flip `chat_shell`, or gift credits.

## Sub-features

- `unauth-redirect` `/chat` without a session shows the login form, not `.chat-shell`.
- `api-unauth` `POST /api/chat-shell-open` without `Authorization` is `401`.
- `no-invite-copy` a signed-in user (including an account that never had `chat_beta_access`) must **not** see **Chat es por invitación**. They enter the shell or the tour.
- Kill-switch-off copy remains **Chat aún no está habilitado** (ops-only; this skill must not flip the flag).

## How to get to it (user POV)

- Open `/chat` in a logged-out browser.
- Sign in with any AIIAN account when the kill switch is on — they land in chat, not an invite card.
- Classic `/dashboard` remains available via **Volver al panel clásico**. Do not use `/posts` as proof of this gate.

## Driving it with verify-advance

Preconditions:

- Instance is healthy (`verify-advance.mjs doctor`).
- No invite grant, no `chat_shell` flag flip, no profile SQL, no gift.
- `ADVANCE_VERIFY_UNINVITED_EMAIL` / `ADVANCE_VERIFY_UNINVITED_PASSWORD` are optional. If unset, drive only `unauth-redirect` + `api-unauth`.

- **Logged-out `/chat`.** Run `node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive uninvited-chat-gate`. Goto `/chat`. The page shows `#email` and **Iniciar sesión**. No `.chat-shell`, no tour, no glass Pack. Screenshot `01-unauth-login.png`.
- **Open API without token.** `POST {base}/api/chat-shell-open` with `{ "action": "ensure" }` and no Authorization. Status `401`. Save `02-api-unauth.json`.
- **Authenticated (only if uninvited env is set).** Sign in, open `/chat`. Heading must **not** be **Chat es por invitación**. Expect `.chat-shell` and/or tour **Un chat para todo**. Screenshot `03-authenticated-open.png`.
- **Proof.** `notes.log` records statuses and that no invite was written.

Supporting unit tests (not a substitute for the HTTP/UI drive): `test/chat-shell-rollout.spec.ts` (flag on + `betaAccess: false` → `canAccessChat`), `test/chat-shell-page-onboarding.spec.tsx` (kill-switch copy, never invite).

## Gotchas

- `/chat` is a SPA behind `ProtectedRoute`. Unauthenticated navigation is a client redirect to `/login`; the document may still be `index.html` with HTTP 200. Assert the **login form**, not the status code alone.
- Kill-switch-off copy is **Chat aún no está habilitado**, not the invite title. Do not flip the flag to prove that card.
- Never “fix” a fail by setting `profiles.chat_beta_access`. Invite-all is already in code.
- Preview shares AIIAN. Preview must not gift +100.
