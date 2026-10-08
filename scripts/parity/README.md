# Cloudflare parity scripts

Read-only / local-only tooling used to check that the Cloudflare Worker +
Container stack behaves the same as Vercel prod. Nothing here deploys,
touches Cloudflare/Supabase/Vercel/Tilopay over the network, or writes to a
database — see the per-script header comments for exactly what each one
does and does not do.

## Checklist

1. `npm run parity:routes` — regenerates `docs/operations/cloudflare-route-table.md`
   from the current `api/**/*.ts` + `vercel.json`. Diff it (`git diff docs/operations/cloudflare-route-table.md`)
   after any route/body-limit/maxDuration change.
2. `npm run parity:env` — exits 0 only when `missingFromContainer` and
   `wranglerVarsNotForwarded` are both empty. Prints `unusedVercelNames`
   (expected: `BFL_API_KEY`, `FAL_KEY` — kept, not dropped).
3. Build and run the container locally (see `docs/operations/cloudflare-containers.md`
   §6), then, against that `docker run` instance only:
   - `node scripts/parity/tilopay-webhook-replay.mjs --base-url http://127.0.0.1:8080 --image advance-ai:local`
     — GET health-ish, wrong-secret 403, missing-secret 403. **No `--write` mode
     exists.** The success path (real secret) writes `payment_transactions` on
     the shared AIIAN database and needs an explicit Orchestrator OK plus a
     dedicated test identity — Phase 2, by a human, never from this script.
   - `node scripts/parity/upload-limits.mjs --base-url http://127.0.0.1:8080 --image advance-ai:local`
     — unauthenticated JSON bodies at each handler's size limit (expect 401)
     and limit+1 (expect 413).
   - `bash scripts/parity/container-smoke.sh http://127.0.0.1:8080` — SPA index,
     hashed asset + MIME, SPA fallback, `/api/ad-pack` OPTIONS/401, `/api/chat`
     401, unknown route 404, oauth-protected-resource rewrites, cron guard,
     body-size 413s. Read-only; also the post-cutover smoke against prod.
   The two `.mjs` scripts refuse non-local base URLs unless `--allow-remote` is passed,
   and print the image digest they ran against (`IMAGE_DIGEST` env, or
   `docker image inspect` via `--image`, or `(unknown)`).
4. Phase 2 QA against a real Preview deployment (behind Cloudflare Access,
   done by a human in a browser session — see
   `docs/operations/cloudflare-parity-checklist.md` for the full list):
   auth flows, Tilopay sandbox create-checkout, chat-shell end to end, admin
   pages, Supabase Storage, cron behavior over a real minute boundary.
