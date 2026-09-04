# Pack produces

Pack **Confirmar y generar** closes the sheet immediately. The thread shows a pack progress card, then scripts/posts **or** a clear assistant error. Never a silent empty thread.

## Sub-features

- `close-on-confirm` sheet unmounts on **Confirmar y generar**; wait happens in chat.
- `scripts-or-error` after the API, `reloadMessages` shows script cards, or an assistant turn starts with `No pude generar el pack.`
- `session-bound` generate requires the open chat `sessionId` (no silent new-session dump).

## How to get to it (user POV)

- Sign in. Open `/chat` on a brand with an offer.
- **Pack** → set cantidad → **Proponer ángulos** → **Confirmar y generar**.
- Sheet gone. Thread shows **Generando pack** then results or an error bubble.

## Driving it with verify-advance

Preconditions:

- Same as pack-qty.
- **Default: do not run this drive.** It spends script (and campaign-pack image) credits. Only run when the operator explicitly asks to prove pack-produces on Preview.

- Helper: `node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive pack-produces` (currently records SKIP unless `ADVANCE_VERIFY_ALLOW_PACK_GENERATE=1`).
- If allowed: cantidad `2`, **Solo guiones**, confirm, wait for either `.chat-shell__script-card` or thread text `/No pude generar el pack/`. Screenshot. Never treat an empty thread as pass.

Supporting unit test: `test/chat-shell-pack-sheet.spec.tsx` (`closes to chat on Confirmar y generar`).

## Gotchas

- Success used to `persistTurn` a summary **without** `getMessages`, so artifacts in DB looked like “nothing”.
- API 402 with no `error` field used to surface as `Request failed (402)` only inside the sheet.
- Missing `sessionId` created a **new** MCP session. Require the open chat id.
