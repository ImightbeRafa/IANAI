# Invited first `/chat` tour

An invited user opening `/chat` before `tour_done` sees the tour dialog titled **Un chat para todo**. Skipping it persists so the next visit does not remount the tour. Existing brand kits, offers, and sessions stay.

## Sub-features

- `tour-mount` shows dialog `Un chat para todo` (ES) / `One chat for everything` (EN) as step 1 of 6.
- `tour-skip` chooses **Saltar y no volver a mostrar** and the dialog closes.
- `tour-persist` reloads `/chat` and the tour does not remount.
- `kits-stay` leaves existing sidebar brands/sessions in place after skip.

## How to get to it (user POV)

- Sign in as an invited account (`profiles.chat_beta_access`) whose user metadata does not yet have `tour_done`.
- Open `/chat` (or `/login?redirect=/chat`).
- If the gift modal appears first, choose **Ver cómo funciona** to reach the tour (do not use gift as a substitute for the tour title).
- Reopen `/chat` after skip to confirm it does not return.
- Sidebar **Cómo funciona** reopens the tour on demand; that is a different entry, not first-open.

## Driving it with verify-advance

Preconditions:

- Instance is healthy (`verify-advance.mjs doctor`).
- `ADVANCE_VERIFY_EMAIL` / `ADVANCE_VERIFY_PASSWORD` are set for an **invited** account that has not finished the tour. Do not use an after-skip chrome account if you need a first-open proof.
- Do not grant invites. If the account is uninvited, stop and report the gate instead.
- Language ES (`localStorage.ai-language = es`).

- **Open `/chat`.** Run `node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive invited-first-chat-tour`. The harness signs in through `#email` / `#password` and the button **Iniciar sesión**, then waits for `/chat`.
- **See the tour.** A `role=dialog` named `Un chat para todo` is visible. Screenshot `01-tour-mount.png`.
- **Skip.** Choose **Saltar y no volver a mostrar**. The dialog is gone. Screenshot `02-tour-skipped.png`.
- **Confirm persist.** Reload `/chat`. The tour dialog is absent. Screenshot `03-tour-gone-on-reload.png`.
- **Confirm kits stay.** Sidebar still lists the same brand folder(s) that existed before skip (no empty wipe). Screenshot `04-kits-stay.png`.
- **Proof.** `notes.log` records the four screenshots and that no invite/SQL/gift call was made.

## Gotchas

- Preview gift insert is fail-closed (`VERCEL_ENV≠production`). Skip-gift must not fabricate `tourDone`.
- Skip writes `tour_done` via `POST /api/chat-shell-open` `{ action: 'tour_done' }`. That is user metadata, not a kit wipe — still do not run this on an account you need to re-tour unless you accept persist.
- After-skip chrome accounts (already `tour_done`) cannot prove `tour-mount`. Report skip; do not claim pass from **Cómo funciona** unless that sub-feature is the one under test.
- Never create brands/offers “to have something in the sidebar.” If the folder is empty, prove kits-stay as “still empty, no new wipe.”
