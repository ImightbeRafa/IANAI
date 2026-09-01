# Uninvited `/chat` gate

A user without a chat invite never enters the shell. Unauthenticated `/chat` stays on login. An authenticated uninvited account sees **Chat es por invitación**. The open-chat API answers **403** `Chat is not available for this account`. This skill must not grant invites.

## Sub-features

- `unauth-redirect` `/chat` without a session shows the login form, not `.chat-shell`.
- `invite-copy` authenticated uninvited `/chat` shows heading **Chat es por invitación** (ES) or **Chat is invite-only** (EN).
- `api-unauth` `POST /api/chat-shell-open` without `Authorization` is `401`.
- `api-forbidden` the same POST with an uninvited session token is `403` with `Chat is not available for this account`.

## How to get to it (user POV)

- Open `/chat` in a logged-out browser.
- Or sign in with an account that does **not** have `chat_beta_access`, then open `/chat`.
- Classic `/dashboard` remains available. Do not use `/posts` as proof of this gate.

## Driving it with verify-advance

Preconditions:

- Instance is healthy (`verify-advance.mjs doctor`).
- No invite grant, no `chat_shell` flag flip, no profile SQL.
- `ADVANCE_VERIFY_UNINVITED_EMAIL` / `ADVANCE_VERIFY_UNINVITED_PASSWORD` are optional. If unset, drive only `unauth-redirect` + `api-unauth` and report the authenticated sub-features as skipped.

- **Logged-out `/chat`.** Run `node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive uninvited-chat-gate`. Goto `/chat`. The page shows `#email` and **Iniciar sesión**. No `.chat-shell`, no tour, no glass Pack. Screenshot `01-unauth-login.png`.
- **Open API without token.** `POST {base}/api/chat-shell-open` with `{ "action": "ensure" }` and no Authorization. Status `401`. Save `02-api-unauth.json`.
- **Authenticated uninvited (only if uninvited env is set).** Sign in, open `/chat`. Heading **Chat es por invitación**. Screenshot `03-invite-gate.png`. POST `/api/chat-shell-open` with that session’s bearer token → `403` and error `Chat is not available for this account`. Save `04-api-forbidden.json`.
- **Proof.** `notes.log` records statuses and that no invite was written.

Supporting unit tests (not a substitute for the HTTP/UI drive): `test/chat-shell-rollout.spec.ts` (`betaAccess: false` denies chat).

## Gotchas

- `/chat` is a SPA behind `ProtectedRoute`. Unauthenticated navigation is a client redirect to `/login`; the document may still be `index.html` with HTTP 200. Assert the **login form**, not the status code alone.
- Kill-switch-off copy is **Chat aún no está habilitado**, not the invite title. Wrong card is a fail for `invite-copy`.
- Never “fix” a fail by setting `profiles.chat_beta_access`. Report the gate.
- Preview and production share AIIAN. An invited QA login is the wrong account for this feature.
