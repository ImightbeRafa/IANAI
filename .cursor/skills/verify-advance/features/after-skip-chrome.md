# After-skip chrome

After the tour is skipped, invited `/chat` chrome matches the selected session, shows glass verbs **Guiones / Post / Foto / Pack**, names incomplete-kit gaps on the Falta chip, disables in-thread Crear post as **Primero el kit** (not filled primary), and keeps **Pack** fully readable.

## Sub-features

- `header-session` crumbs include the selected session title (not leftover **Chat nuevo** on an old thread).
- `glass-verbs` shows Guiones, Post, Foto, and Pack as full labels.
- `named-falta` glass chip shows `Falta: Público, Fuentes` when those fields are missing.
- `primero-el-kit` script cards show disabled **Primero el kit** with no `is-primary` / no enabled **Crear post**.
- `pack-readable` Pack label is `Pack`, not `Pa…` (span `scrollWidth <= clientWidth`).

## How to get to it (user POV)

- Sign in as an invited account that already skipped the tour.
- Open `/chat`.
- Select a past thread that has scripts and an incomplete kit (the IdleBar Demo / **Quiero crear guiones** folder on Preview is the known incomplete-kit path).
- Look at the header crumbs, the glass row above the composer, and a script card footer.

## Driving it with verify-advance

Preconditions:

- Instance is healthy (`verify-advance.mjs doctor`).
- `ADVANCE_VERIFY_EMAIL` / `ADVANCE_VERIFY_PASSWORD` are set for an invited after-skip account. Names only in env — never in this file.
- Language ES.
- Do not generate posts, do not click Pack, do not edit the kit, do not delete sessions.

- **Open `/chat`.** Run `node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive after-skip-chrome`. Sign in with `#email` / `#password` / **Iniciar sesión**. Dismiss a leftover tour only if it appears (`Saltar y no volver a mostrar`).
- **Select the past thread.** Choose the sidebar button named **Quiero crear guiones**. Wait for `.chat-shell__crumbs` and `.chat-shell__idle-kit-title`.
- **Header.** Crumbs contain `Quiero crear guiones` and must not be `… / Chat nuevo / …` for that old thread. Screenshot `01-header-session.png` (or full shell).
- **Named Falta.** `.chat-shell__idle-kit-title` text is `Falta: Público, Fuentes` (not generic `Falta afinar`). The chip stays visible — do not hide it to make Pack fit.
- **Glass verbs.** Buttons **Guiones**, **Post**, **Foto**, **Pack** exist. Each action `span` text equals the verb. Pack `scrollWidth <= clientWidth + 1`. Screenshot `02-glass-pack.png` of `.chat-shell__idle-glass`.
- **Script card.** A `.chat-shell__artifact-action` for post is disabled, labeled **Primero el kit**, class does not include `is-primary`, `data-kit-blocked=true`. No enabled **Crear post**. Screenshot `03-script-card-primero-el-kit.png`.
- **Proof.** `notes.log` records crumb text, chip text, verb metrics, and the Crear post class/disabled flags.

Supporting unit tests (not a substitute for the Preview drive): `test/chat-shell-script-post-preview.spec.tsx`, `test/chat-shell-composer-create-dock.spec.tsx`.

## Gotchas

- Soft kit still unlocks **glass** verbs when an offer name exists. The leftover under test is the **script card** Crear post, not glass Post showing Primero el kit.
- A filled cyan Crear post (`is-primary` while kit is incomplete) is a fail even if the button is clickable.
- Pack clipped to `Pa…` is a fail. Do not ellipsis or hide the Falta chip to fake Pack.
- New empty chats may still say **Chat nuevo**. That does not prove `header-session`.
- Do not wipe or rewrite the incomplete kit to make the card look gated.
