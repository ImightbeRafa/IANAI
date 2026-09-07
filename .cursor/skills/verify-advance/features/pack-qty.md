# Pack quantity

Pack Paso 1 **Cantidad (2–25)** accepts typing (including 15) and explicit **− / +** steppers. Native number spinners are not the control.

## Sub-features

- `type-two-digit` typing `15` leaves the field at `15` (does not clamp `1` to `2` mid-keystroke).
- `steppers` **Menos** / **Más** change the value by 1, clamped 2–25.
- `blur-clamp` empty/blur commits to 2–25 (empty → 10).

## How to get to it (user POV)

- Sign in as invited. Open `/chat`. Kit may be incomplete; glass **Pack** stays enabled when an offer exists (soft kit).
- Click **Pack**. Paso 1 de 2 shows **Cantidad (2–25)**.
- Change the number. Click **Cancelar** (do not **Proponer ángulos** / **Confirmar y generar** on a prove-the-skill pass).

## Driving it with verify-advance

Preconditions:

- Instance is healthy.
- `ADVANCE_VERIFY_EMAIL` / `ADVANCE_VERIFY_PASSWORD`. Names only in env.
- Language ES.
- Do not generate a pack. Do not spend credits.

- **Open `/chat`.** `node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive pack-qty`
- Sign in. Dismiss leftover tour if it appears.
- Click glass **Pack**. Wait for `role=dialog` name **Pack**.
- `#chat-shell-bulk-count` starts at `10` (glass default) unless a slash rest set it.
- Clear the field, type `3`. Value is `3`. Screenshot `01-pack-qty-3.png`.
- Click **Más**. Value is `4`. Click **Menos**. Value is `3`.
- Click footer **Cancelar**. Dialog gone. No pack API calls.
- Supporting unit tests: `test/chat-shell-pack-sheet.spec.tsx`, `test/chat-shell-bulk.spec.ts`.

## Gotchas

- Clamping on every `onChange` of `type=number` made `1` of `15` become `2`. Draft string + clamp on blur/submit is required.
- IdleBar incomplete kit still opens Pack (soft). **Primero el kit** is the script-card leftover, not glass Pack.
- Do not click **Confirmar y generar** in this recipe.
