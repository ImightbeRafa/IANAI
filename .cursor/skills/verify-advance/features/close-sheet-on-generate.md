# Close sheet on generate

After **Generar** (or **Crear sin referencias**) on Post / Foto Confirmá referencias, the Pack-family sheet closes immediately. The user waits in the thread on **Generando post…**, not on Paso 6.

## Sub-features

- `refs-generar-closes` clicking **Generar** on Post Paso 6 unmounts `role=dialog` named **Post** before the result arrives.
- `generating-card` the thread shows `ChatShellProgress` kind image (**Generando post…**, model subtitle) while `imageBusy`.
- `foto-same-contract` Foto generate sheets use the same close-then-wait path.

## How to get to it (user POV)

- Sign in as an invited account with a **complete** kit (Brand Kit listo) and an offer.
- Open `/chat`, select that brand’s thread.
- Click glass **Post**, walk to **Confirmá referencias** (Paso 6 de 6).
- Click **Generar**.

## Driving it with verify-advance

Preconditions:

- Instance is healthy (`verify-advance.mjs doctor`).
- `ADVANCE_VERIFY_EMAIL` / `ADVANCE_VERIFY_PASSWORD` for an invited account. Names only in env.
- Language ES.
- **Do not click Generar on Preview during a prove-the-skill pass** unless the operator explicitly allows spending image credits. Default drive records the sheet contract (dialog present; parent-clear unmount) and relies on Vitest `test/chat-shell-clarify-sheet.spec.tsx` for close-after-Generar.

- **Open `/chat`.** `node .cursor/skills/verify-advance/helpers/verify-advance.mjs drive close-sheet-on-generate`
- Sign in. Dismiss leftover tour if it appears.
- If a complete-kit thread is reachable, open glass **Post** only far enough to see a generate sheet **or** skip if the kit would require a paid Generar.
- **Proof without spending credits:** notes record that Generar is wired to `{ useReferences: true }` and the sheet unmounts when `imageClarify` is null. Screenshot of `/chat` chrome is enough for the no-spend path.
- Supporting unit test (required): `test/chat-shell-clarify-sheet.spec.tsx` (`unmounts Post refs sheet when parent clears imageClarify after Generar`).

## Gotchas

- `setImageBusy(true)` used to fire **before** `setImageClarify(null)`, so the generating card appeared **under** a stuck Paso 6. Close the sheet first.
- Do not spend credits to re-prove this on every run. One live Generar on Preview is optional and must be labeled in `notes.log` as a credit spend.
- Do not weaken CSP `script-src` / `connect-src` as part of this feature.
